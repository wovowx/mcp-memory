// Common Ground MCP tools. Keep business logic in chat.js; this layer only adapts MCP arguments.
import { createMessage, getPendingEvents, readMessage, ackEvent } from './chat.js';

const ALL_ACTORS = ['liuliu', 'gpt', 'ziven'];

export const CHAT_TOOL_DEFS = [
    {
        name: 'chat_send',
        description: 'Send a message through the Common Ground chat service. The shared chat layer creates recipient Agent events automatically. Use your own author identity.',
        input_schema: {
            type: 'object',
            properties: {
                thread_id: { type: 'string', description: 'Common Ground thread ID' },
                author: { type: 'string', enum: ALL_ACTORS, description: 'Message author identity' },
                content: { type: 'string', description: 'Message content' },
                reply_to: { type: ['string', 'null'], description: 'Optional message ID being replied to' }
            },
            required: ['thread_id', 'author', 'content']
        },
        handler: 'chat'
    },
    {
        name: 'chat_pending_events',
        description: 'Read pending Common Ground events for an Agent.',
        input_schema: {
            type: 'object',
            properties: {
                agent: { type: 'string', enum: ['gpt', 'ziven'] },
                limit: { type: 'integer', minimum: 1, maximum: 100 },
                offset: { type: 'integer', minimum: 0 }
            },
            required: ['agent']
        },
        handler: 'chat'
    },
    {
        name: 'chat_read_message',
        description: 'Read one complete Common Ground chat message by message ID.',
        input_schema: {
            type: 'object',
            properties: { message_id: { type: 'string' } },
            required: ['message_id']
        },
        handler: 'chat'
    },
    {
        name: 'chat_ack_event',
        description: 'Acknowledge a Common Ground Agent event after processing it.',
        input_schema: {
            type: 'object',
            properties: {
                event_id: { type: 'string' },
                agent: { type: 'string', enum: ['gpt', 'ziven'] },
                status: { type: 'string', enum: ['success', 'failed', 'processing'] }
            },
            required: ['event_id', 'agent', 'status']
        },
        handler: 'chat'
    }
];

const CHAT_TOOL_MAP = new Map(CHAT_TOOL_DEFS.map(def => [def.name, def]));

export async function handleChatTool(name, args, env) {
    const def = CHAT_TOOL_MAP.get(name);
    if (!def) throw new Error('未知聊天工具：' + name);

    if (name === 'chat_send') {
        const author = String(args.author || '').toLowerCase();
        if (!ALL_ACTORS.includes(author)) throw new Error(`非法 author: ${author}`);
        if (!args.thread_id) throw new Error('缺少参数：thread_id');
        if (!args.content) throw new Error('缺少参数：content');
        return JSON.stringify(await createMessage(env, String(args.thread_id), {
            author,
            content: String(args.content),
            reply_to: args.reply_to || null
        }));
    }

    if (name === 'chat_pending_events') {
        const agent = String(args.agent || '').toLowerCase();
        if (!['gpt', 'ziven'].includes(agent)) throw new Error(`非法 agent: ${agent}`);
        return JSON.stringify(await getPendingEvents(env, agent, args.limit, args.offset));
    }

    if (name === 'chat_read_message') {
        if (!args.message_id) throw new Error('缺少参数：message_id');
        return JSON.stringify(await readMessage(env, String(args.message_id)));
    }

    if (name === 'chat_ack_event') {
        const agent = String(args.agent || '').toLowerCase();
        if (!['gpt', 'ziven'].includes(agent)) throw new Error(`非法 agent: ${agent}`);
        return JSON.stringify(await ackEvent(env, String(args.event_id), agent, args.status));
    }
}
