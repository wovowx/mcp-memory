// ============================================================
// AI 能力工具 v2 —— Agnes 全能整合版（2026-08-29）
// 整合：describe_image / generate_image / generate_video / describe_video
// 功能：① 一个 agnes 入口全包 ② key 自动降级 ③ 模型自动降级
//       ④ 精准错误分析（不盲重试） ⑤ verbose 诊断信息
// ============================================================
import { getEnabledSkills } from '../utils/skills.js';

// ---------- 常量 ----------
const AGNES_ENDPOINT = 'https://apihub.agnes-ai.com/v1';

// 动作 → 默认模型 + fallback 模型
const ACTION_MODELS = {
  describe_image:  { default: 'agnes-2.5-flash',       fallback: 'agnes-2.0-flash' },
  generate_image:  { default: 'agnes-image-2.1-flash', fallback: 'agnes-image-2.0-flash' },
  generate_video:  { default: 'agnes-video-2.5-flash', fallback: 'agnes-video-v2.0' },
  describe_video:  { default: 'agnes-2.5-flash',       fallback: 'agnes-2.0-flash' },
};

// 动作 → 端点路径
const ACTION_ENDPOINT = {
  describe_image: '/chat/completions',
  generate_image: '/images/generations',
  generate_video: '/videos',
  describe_video: '/chat/completions',
};

// 动作 → 返回文案标签
const ACTION_LABEL = {
  describe_image: '🖼️ 图片识别结果',
  generate_image: '🖼️ 图片生成成功',
  generate_video: '🎞️ 视频生成',
  describe_video: '🎬 视频识别结果',
};

// 旧工具名兼容映射
const LEGACY_MAP = {
  describe_image: 'describe_image',
  generate_image: 'generate_image',
  generate_video: 'generate_video',
};

// ---------- 精准错误诊断 ----------
function diagnoseHttpError(status, body) {
  const snippet = (body || '').substring(0, 300);
  if (status === 401 || status === 403) {
    return { kind: 'key_invalid', label: '🔑 API Key 失效或被拒绝（401/403）', suggestion: '该 key 可能过期/无权限。已尝试用备用 key；若 AGNES_PLUS 报此错，可考虑删除该环境变量（tokenplan 不续期的话）。' };
  }
  if (status === 429) {
    return { kind: 'rate_limited', label: '⏳ 请求过于频繁（429 限流）', suggestion: '当前 key 触发限流，已自动切换备用 key / 备用模型。若仍频繁出现，可能是套餐额度耗尽。' };
  }
  if (status === 404 || status === 400) {
    return { kind: 'model_invalid', label: '🧩 模型不存在或参数错误（' + status + '）', suggestion: '当前模型不可用，已自动切换 fallback 模型。' + (snippet ? ' 响应片段：' + snippet : '') };
  }
  if (status === 402) {
    return { kind: 'quota_exhausted', label: '💸 额度耗尽（402）', suggestion: '当前 key 余额/额度不足，已尝试备用 key。' };
  }
  if (status >= 500) {
    return { kind: 'server_error', label: '🔧 Agnes 服务端故障（' + status + '）', suggestion: '服务端异常，已尝试切 key / 切模型各一次。若持续，请稍后再试。' };
  }
  return { kind: 'http_' + status, label: '⚠️ HTTP ' + status, suggestion: '未知 HTTP 错误。' + (snippet ? ' 响应片段：' + snippet : '') };
}

function diagnoseNetworkError(err) {
  const msg = String(err && err.message ? err.message : err);
  if (/DNS|ENOTFOUND|getaddrinfo|EAI_AGAIN/i.test(msg)) {
    return { kind: 'dns_failed', label: '🌐 DNS 解析失败（域名不可达）', suggestion: 'Agnes 域名解析不了，重试无意义；请检查网络 / 稍后再试。', isNetwork: true };
  }
  if (/ECONNREFUSED|refused/i.test(msg)) {
    return { kind: 'conn_refused', label: '🚫 服务器拒绝连接', suggestion: 'Agnes 服务可能未开机/被墙；重试无意义，稍后再试。', isNetwork: true };
  }
  if (/timeout|timed out|ETIMEDOUT|abort/i.test(msg)) {
    return { kind: 'timeout', label: '⏱️ 请求超时', suggestion: '服务器响应超时，已限次重试1次；仍失败说明链路慢。', isNetwork: true };
  }
  if (/TLS|SSL|certificate|handshake/i.test(msg)) {
    return { kind: 'tls_failed', label: '🔒 TLS/SSL 握手失败', suggestion: '安全连接建立失败，重试无意义；检查证书/代理。', isNetwork: true };
  }
  if (/fetch failed|ENOTCONN|ENETDOWN|ENETUNREACH|network|offline|No network/i.test(msg)) {
    return { kind: 'no_network', label: '📡 网络连接失败/离线', suggestion: '当前环境无网络或链路断；重试无意义，检查网络。', isNetwork: true };
  }
  return { kind: 'unknown_net', label: '❓ 网络层未知错误：' + msg, suggestion: '无法分类的请求失败，不做盲目重试。', isNetwork: true };
}

// ---------- 请求构造 ----------
function buildBody(action, args, model) {
  const prompt = args.prompt || '';
  if (action === 'describe_image' || action === 'describe_video') {
    const content = [{ type: 'text', text: prompt || (action === 'describe_image' ? 'Describe this image in detail.' : 'Describe this video in detail.') }];
    if (action === 'describe_image') {
      content.push({ type: 'image_url', image_url: { url: args.image_url } });
    } else {
      content.push({ type: 'video_url', video_url: { url: args.video_url || args.image_url } });
    }
    return {
      model,
      messages: [{ role: 'user', content }],
      max_tokens: args.max_tokens || 1024,
    };
  }
  if (action === 'generate_image') {
    return {
      model,
      prompt,
      size: args.size || '1024x768',
      n: 1,
    };
  }
  if (action === 'generate_video') {
    const mode = args.mode || 'text';
    const body = {
      model,
      prompt,
      num_frames: args.num_frames || 121,
      frame_rate: args.frame_rate || 24,
    };
    if (mode === 'image') {
      body.image = args.image;
    } else if (mode === 'keyframes') {
      body.extra_body = { image: args.images || [], mode: 'keyframes' };
    } else {
      body.height = args.height || 768;
      body.width = args.width || 1152;
    }
    return body;
  }
  return { model, prompt };
}

// ---------- 核心：带降级的请求 ----------
async function callAgnes(action, args, env) {
  const keys = [];
  if (env.AGNES_PLUS) keys.push({ name: 'AGNES_PLUS', value: env.AGNES_PLUS });
  if (env.AGNES_API_KEY) keys.push({ name: 'AGNES_API_KEY', value: env.AGNES_API_KEY });
  if (keys.length === 0) {
    throw new Error('❌ 未配置任何 AGNES API Key（AGNES_PLUS / AGNES_API_KEY）');
  }

  const models = ACTION_MODELS[action] || { default: 'agnes-2.5-flash', fallback: 'agnes-2.0-flash' };
  const modelQueue = args.model
    ? [args.model, models.default, models.fallback].filter((v, i, a) => a.indexOf(v) === i)
    : [models.default, models.fallback];

  let lastError = null;
  let attempts = [];

  for (const key of keys) {
    for (const model of modelQueue) {
      const attemptMeta = { key: key.name, model };
      let controller = null;
      let timer = null;
      try {
        const endpoint = ACTION_ENDPOINT[action];
        const url = AGNES_ENDPOINT + endpoint;
        controller = new AbortController();
        timer = setTimeout(() => controller.abort(), 60000);
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + key.value, 'Content-Type': 'application/json' },
          body: JSON.stringify(buildBody(action, args, model)),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (response.ok) {
          const data = await response.json();
          return { ok: true, data, meta: { ...attemptMeta, attempts } };
        }

        const errText = await response.text();
        const diag = diagnoseHttpError(response.status, errText);
        attemptMeta.diag = diag;
        attempts.push(attemptMeta);

        // 模型无效 → 换模型（内层继续）；key/限流/服务端 → 换 key（外层）
        if (diag.kind === 'model_invalid') {
          lastError = new Error(diag.label + ' -- ' + diag.suggestion);
          continue;
        }
        if (['key_invalid', 'rate_limited', 'quota_exhausted', 'server_error'].includes(diag.kind)) {
          lastError = new Error(diag.label + ' -- ' + diag.suggestion);
          break; // 换 key
        }
        lastError = new Error(diag.label + ' -- ' + diag.suggestion);
        // 其他 HTTP 错误：默认也换（不盲重试）
        break;
      } catch (err) {
        if (timer) clearTimeout(timer);
        const diag = diagnoseNetworkError(err);
        attemptMeta.diag = diag;
        attempts.push(attemptMeta);

        // 网络层不可恢复 → 立即抛（不换 key / 不换模型）
        if (diag.isNetwork) {
          throw new Error(diag.label + ' -- ' + diag.suggestion);
        }
        // 超时等可试一次 → 换组合
        lastError = new Error(diag.label + ' -- ' + diag.suggestion);
        continue;
      }
    }
  }

  throw (lastError || new Error('❌ Agnes 调用失败：所有 key/模型组合均未成功'));
}

// ---------- 工具入口 ----------
export async function handleAITool(name, safeArgs, env) {
  // ---- DeepSeek 官方余额（保持原样，不并入 agnes）----
  if (name === 'ds_quota') {
    const apiKey = env.DEEPSEEK_API_KEY;
    if (!apiKey) { return '❌ DeepSeek API Key 未配置，请在环境变量中设置 DEEPSEEK_API_KEY'; }
    try {
      const balanceResp = await fetch('https://api.deepseek.com/user/balance', {
        method: 'GET', headers: { 'Accept': 'application/json', 'Authorization': 'Bearer ' + apiKey }
      });
      if (balanceResp.ok) {
        const balanceData = await balanceResp.json();
        if (balanceData.balance_infos && balanceData.balance_infos.length > 0) {
          const info = balanceData.balance_infos[0];
          return '💡 **DeepSeek 账户余额**\n\n💰 总余额：' + info.total_balance + ' ' + info.currency + '\n🎁 赠送余额：' + info.granted_balance + ' ' + info.currency + '\n💳 充值余额：' + info.topped_up_balance + ' ' + info.currency;
        }
        return '💡 余额信息：' + JSON.stringify(balanceData);
      }
      return '⚠️ 余额查询失败：HTTP ' + balanceResp.status;
    } catch (e) { return '❌ 查询失败：' + e.message; }
  }

  // ---- Agnes 工具（新入口 agnes + 旧名兼容）----
  const isAgnes = name === 'agnes' || LEGACY_MAP.hasOwnProperty(name);
  if (!isAgnes) return '';

  // 计算 action：agnes 用 args.action；旧名直接映射
  let action = null;
  if (name === 'agnes') {
    action = safeArgs.action;
    if (!action || !ACTION_MODELS[action]) {
      return '❌ agnes 需要合法的 action 参数。可选：' + Object.keys(ACTION_MODELS).join(' / ') + '\n用法：agnes(action, prompt, image_url, size, mode, ...)\n例：agnes(action="describe_image", image_url="...")';
    }
  } else {
    action = LEGACY_MAP[name];
  }

  // 参数预检
  if (action === 'describe_image' && !safeArgs.image_url) {
    return '❌ describe_image 需要 image_url 参数（图片的公网 URL）';
  }
  if (action === 'generate_image' && !safeArgs.prompt) {
    return '❌ generate_image 需要 prompt 参数（图片描述）';
  }
  if (action === 'generate_video') {
    if (!safeArgs.prompt) return '❌ generate_video 需要 prompt 参数（视频描述）';
    if ((safeArgs.mode || 'text') === 'image' && !safeArgs.image) return '❌ 图生视频模式（mode=image）需要 image 参数';
    if ((safeArgs.mode || 'text') === 'keyframes' && (!safeArgs.images || !Array.isArray(safeArgs.images) || safeArgs.images.length < 2)) return '❌ 关键帧模式（mode=keyframes）需要 images 数组，至少 2 张图';
  }
  if (action === 'describe_video' && !safeArgs.video_url && !safeArgs.image_url) {
    return '❌ describe_video 需要 video_url（或 image_url）参数';
  }

  try {
    const result = await callAgnes(action, safeArgs, env);
    const data = result.data;
    const label = ACTION_LABEL[action];

    let text = label + '\n\n';
    if (action === 'describe_image' || action === 'describe_video') {
      const desc = data.choices?.[0]?.message?.content || '未能解析出描述内容';
      text += desc;
    } else if (action === 'generate_image') {
      text += '📝 提示词：' + (safeArgs.prompt || '') + '\n📐 尺寸：' + (safeArgs.size || '1024x768') + '\n🔗 图片链接：' + (data.data?.[0]?.url || '未能获取图片链接');
    } else if (action === 'generate_video') {
      const modeText = { 'text': '💡 文生视频', 'image': '🖼️ 图生视频', 'keyframes': '🖼️ 关键帧插值' }[safeArgs.mode || 'text'] || '💡 视频生成';
      text += modeText + '\n📝 提示词：' + (safeArgs.prompt || '') + '\n🎞️ 帧数：' + (safeArgs.num_frames || 121) + '\n⚡ 帧率：' + (safeArgs.frame_rate || 24) + ' fps\n';
      if (safeArgs.mode === 'image') text += '🖼️ 参考图：' + (safeArgs.image || '') + '\n';
      else if (safeArgs.mode === 'keyframes') text += '🖼️ 关键帧数量：' + (safeArgs.images || []).length + '\n';
      else text += '📐 分辨率：' + (safeArgs.width || 1152) + 'x' + (safeArgs.height || 768) + '\n';
      const videoId = data.id || data.video_id || data.task_id;
      const videoUrl = data.url || data.video_url || data.output_url;
      if (videoUrl) text += '🔗 视频链接：' + videoUrl + '\n';
      if (videoId) text += '📋 任务ID：' + videoId + '（可用于查询生成进度）';
    }

    // verbose 诊断信息
    if (safeArgs.verbose) {
      text += '\n\n---\n🔍 诊断信息：\n';
      text += '· 使用 key：' + result.meta.key + '\n';
      text += '· 使用模型：' + result.meta.model + '\n';
      text += '· 尝试组合数：' + (result.meta.attempts ? result.meta.attempts.length : 0) + '\n';
      if (result.meta.attempts && result.meta.attempts.length > 0) {
        text += '· 降级记录：\n';
        for (const a of result.meta.attempts) {
          text += '  - ' + a.key + ' / ' + a.model + ' → ' + (a.diag ? a.diag.label : '失败') + '\n';
        }
      }
    }
    return text;
  } catch (e) {
    return '❌ ' + (e.message || 'Agnes 调用失败');
  }
}