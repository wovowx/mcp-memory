// ============================================================
// Chatroom MVP - 页面 + 通信 API 路由（v2）
// 2026-09-01 GPT implementation based on 44; Ziven review pending
// ============================================================
import { jsonResponse, buildErrorResponse } from '../utils/response.js';

const AGENTS = ['gpt', 'ziven'];
const ALL_ACTORS = ['liuliu', 'gpt', 'ziven'];
const EVENT_TYPES = ['message_created'];
const EVENT_STATUSES = ['processing', 'success', 'failed'];
const PRECIPITATE_KEYWORD = '@沉淀';
const MAX_PREVIEW_CHARS = 200;
const DEFAULT_EVENT_LIMIT = 50;

function supabaseHeaders(env) {
    const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
    return {'Authorization': `Bearer ${key}`, 'apikey': key, 'Content-Type': 'application/json'};
}

async function sbQuery(env, table, opts = {}) {
    const { select = '*', filters = null, order = null, limit = null, offset = null } = opts;
    let url = `${env.SUPABASE_URL}/rest/v1/${table}?select=${select}`;
    if (filters) for (const [col, val] of Object.entries(filters)) url += `&${col}=eq.${encodeURIComponent(val)}`;
    if (order) url += `&order=${order}`;
    if (limit != null) url += `&limit=${limit}`;
    if (offset != null) url += `&offset=${offset}`;
    const resp = await fetch(url, { headers: supabaseHeaders(env) });
    if (!resp.ok) throw new Error(`查询失败 ${resp.status}: ${await resp.text()}`);
    return resp.json();
}

async function sbInsert(env, table, data, { ignoreDuplicates = false } = {}) {
    const headers = supabaseHeaders(env);
    headers['Prefer'] = ignoreDuplicates ? 'resolution=ignore-duplicates,return=representation' : 'return=representation';
    const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {method:'POST', headers, body:JSON.stringify(data)});
    if (!resp.ok) throw new Error(`插入失败 ${resp.status}: ${await resp.text()}`);
    return resp.json();
}

async function sbUpdate(env, table, filters, data) {
    const query = Object.entries(filters).map(([col,val]) => `${col}=eq.${encodeURIComponent(val)}`).join('&');
    const headers = supabaseHeaders(env); headers['Prefer']='return=representation';
    const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, {method:'PATCH',headers,body:JSON.stringify(data)});
    if (!resp.ok) throw new Error(`更新失败 ${resp.status}: ${await resp.text()}`);
    return resp.json();
}

function parseMentions(content) {
    const mentions=[]; const events=[]; if(!content)return{mentions,events}; const lower=content.toLowerCase();
    if(lower.includes('@all')){for(const actor of ALL_ACTORS)mentions.push(actor);for(const agent of AGENTS)events.push(agent);}
    if(lower.includes(PRECIPITATE_KEYWORD))mentions.push('沉淀');
    for(const actor of ALL_ACTORS){if(lower.includes('@'+actor)){if(!mentions.includes(actor))mentions.push(actor);if(AGENTS.includes(actor)&&!events.includes(actor))events.push(actor);}}
    return{mentions,events};
}
function contentPreview(content){return Array.from(content).slice(0,MAX_PREVIEW_CHARS).join('').replace(/\s+/g,' ').trim();}

export async function createMessage(env, threadId, payload) {
    const author=String(payload.author||'liuliu').toLowerCase(); const content=String(payload.content||'').trim();
    if(!content)throw new Error('消息内容不能为空'); if(!ALL_ACTORS.includes(author))throw new Error(`非法 author: ${author}`);
    const {mentions,events}=parseMentions(content);
    const inserted=await sbInsert(env,'chat_messages',{thread_id:threadId,author,content,mentions:mentions.length?mentions:[],reply_to:payload.reply_to||null});
    const message=Array.isArray(inserted)?inserted[0]:inserted; const messageId=message?.message_id; if(!messageId)throw new Error('消息写入成功但未返回 message_id');
    const created=[];const existed=[];const failed=[];
    for(const agent of events){const eventData={message_id:messageId,agent,status:'processing',payload:{event_type:'message_created',thread_id:threadId,author,content_preview:contentPreview(content),mentions}};
        try{const result=await sbInsert(env,'chat_agent_events',eventData,{ignoreDuplicates:true});if(Array.isArray(result)&&result.length===0)existed.push(agent);else if(Array.isArray(result)&&result.length>0)created.push(agent);else throw new Error('事件写入成功但未返回可识别结果');}catch(e){failed.push({agent,error:e.message});}}
    return{message,mentions,events:created,existed_events:existed,partial_failure:failed.length>0,event_errors:failed};
}
export async function getPendingEvents(env,agent,limit=DEFAULT_EVENT_LIMIT,offset=0){
    if(!AGENTS.includes(agent))throw new Error(`非法 agent: ${agent}`); const safeLimit=Math.min(Math.max(Number(limit)||DEFAULT_EVENT_LIMIT,1),100); const safeOffset=Math.max(Number(offset)||0,0);
    const rows=await sbQuery(env,'chat_agent_events',{select:'event_id,message_id,agent,status,payload,created_at,updated_at',filters:{agent,status:'processing'},order:'created_at.asc,event_id.asc',limit:safeLimit+1,offset:safeOffset});
    const hasMore=rows.length>safeLimit; return{events:hasMore?rows.slice(0,safeLimit):rows,limit:safeLimit,offset:safeOffset,has_more:hasMore};
}
export async function readMessage(env,messageId){const rows=await sbQuery(env,'chat_messages',{filters:{message_id:messageId},limit:1});if(!rows.length)throw new Error('消息不存在');return rows[0];}
export async function ackEvent(env,eventId,agent,targetStatus){
    if(!AGENTS.includes(agent))throw new Error(`非法 agent: ${agent}`); if(!['success','failed','processing'].includes(targetStatus))throw new Error(`非法 status: ${targetStatus}`);
    const currentRows=await sbQuery(env,'chat_agent_events',{select:'event_id,agent,status,message_id,payload,created_at,updated_at',filters:{event_id:eventId},limit:1}); if(!currentRows.length)throw new Error('事件不存在'); const current=currentRows[0]; if(current.agent!==agent)throw new Error('无权确认其他 Agent 的事件');
    const allowed=(current.status==='processing'&&['success','failed'].includes(targetStatus))||(current.status==='failed'&&targetStatus==='processing'); if(!allowed)throw new Error(`非法状态转换: ${current.status} -> ${targetStatus}`);
    const updated=await sbUpdate(env,'chat_agent_events',{event_id:eventId,agent,status:current.status},{status:targetStatus}); if(!updated.length)throw new Error('事件状态更新失败或状态已被其他请求改变'); return updated[0];
}

export async function handleChatRequest(request,url,env){
    const path=url.pathname; const method=request.method;
    if(path==='/chat'||path==='/chat/'){if(method!=='GET')return new Response('Method not allowed',{status:405});try{const resp=await fetch('https://raw.githubusercontent.com/wovowx/mcp-memory/main/src/public/chat.html');const html=await resp.text();return new Response(html,{status:200,headers:{'Content-Type':'text/html; charset=utf-8','Access-Control-Allow-Origin':'*'}});}catch(e){return buildErrorResponse('加载聊天室失败: '+e.message,500);}}
    if(!path.startsWith('/api/chat'))return null; const segments=path.split('/').filter(Boolean);
    try{
        // MVP note: chat reads are intentionally open for the current manual test environment.
        // They are NOT an authentication/authorization boundary; add agent/user auth before production use.
        if(segments.length===3&&segments[2]==='threads'&&method==='GET'){return jsonResponse(await sbQuery(env,'chat_threads',{order:'created_at.desc',limit:100}));}
        if(segments.length===3&&segments[2]==='threads'&&method==='POST'){const body=await request.json();const title=String(body.title||'未命名话题').trim();const creator=String(body.creator||'liuliu').toLowerCase();if(!ALL_ACTORS.includes(creator))throw new Error(`非法 creator: ${creator}`);const data=await sbInsert(env,'chat_threads',{title,creator,status:'active'});return jsonResponse(Array.isArray(data)?data[0]:data,201);}
        if(segments.length===5&&segments[2]==='threads'&&segments[4]==='messages'&&method==='GET'){const id=decodeURIComponent(segments[3]);return jsonResponse(await sbQuery(env,'chat_messages',{filters:{thread_id:id},order:'created_at.asc'}));}
        if(segments.length===5&&segments[2]==='threads'&&segments[4]==='messages'&&method==='POST'){const id=decodeURIComponent(segments[3]);const payload=await request.json();const result=await createMessage(env,id,payload);return jsonResponse(result,result.partial_failure?207:201);}
        if(segments.length===3&&segments[2]==='events'&&method==='GET'){const agent=url.searchParams.get('agent');const status=url.searchParams.get('status')||'processing';const limit=url.searchParams.get('limit')||DEFAULT_EVENT_LIMIT;const offset=url.searchParams.get('offset')||0;if(status==='processing'&&agent)return jsonResponse(await getPendingEvents(env,agent,limit,offset));if(!EVENT_STATUSES.includes(status))throw new Error(`非法 status: ${status}`);const safeLimit=Math.min(Math.max(Number(limit)||DEFAULT_EVENT_LIMIT,1),100);const safeOffset=Math.max(Number(offset)||0,0);const data=await sbQuery(env,'chat_agent_events',{filters:agent?{agent,status}:{status},order:'created_at.asc,event_id.asc',limit:safeLimit+1,offset:safeOffset});const hasMore=data.length>safeLimit;return jsonResponse({events:hasMore?data.slice(0,safeLimit):data,limit:safeLimit,offset:safeOffset,has_more:hasMore});}
        if(segments.length===5&&segments[2]==='events'&&segments[4]==='message'&&method==='GET'){const eventId=decodeURIComponent(segments[3]);const eventRows=await sbQuery(env,'chat_agent_events',{select:'event_id,message_id,agent,status,payload,created_at,updated_at',filters:{event_id:eventId},limit:1});if(!eventRows.length)throw new Error('事件不存在');return jsonResponse(await readMessage(env,eventRows[0].message_id));}
        if(segments.length===4&&segments[2]==='messages'&&method==='GET')return jsonResponse(await readMessage(env,decodeURIComponent(segments[3])));
        if(segments.length===5&&segments[2]==='events'&&segments[4]==='update'&&method==='POST'){const eventId=decodeURIComponent(segments[3]);const body=await request.json();const agent=String(body.agent||'').toLowerCase();return jsonResponse(await ackEvent(env,eventId,agent,body.status));}
        return buildErrorResponse('API 路由不存在: '+path,404);
    }catch(e){return buildErrorResponse(e.message,400);}
}
