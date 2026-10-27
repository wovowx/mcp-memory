// ============================================================
// 通用 Supabase 数据库工具（统一版 v2）
// ============================================================
// 用法：supabase_db(action, table, data, filters, ...)
// action: query/insert/update/delete/tables/exec
// v2 新增：create_table / drop_table（自动建表/删表，走 exec_sql RPC）

import { buildErrorResponse, jsonResponse } from '../utils/response.js';

// DDL through the generic exec action must obey the same necessity gate as create_table.
// The conservative keyword match intentionally prefers false positives over an unguarded schema change.
const TABLE_CHANGE_SQL_PATTERN = /\b(?:CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COMMENT|REINDEX|CLUSTER|VACUUM|DO|CALL|EXECUTE|IMPORT|SECURITY)\b/i;

function hasTableChangeNecessity(args) {
    return typeof args?.necessity === 'string' && args.necessity.trim().length > 0;
}

async function tableChangeGuardMessage(supabaseUrl, headers, operation) {
    let tableList = '（获取现有表失败）';
    try {
        const listResp = await fetch(`${supabaseUrl}/rest/v1/`, { headers });
        if (!listResp.ok) {
            tableList = `（获取现有表失败：HTTP ${listResp.status}）`;
        } else {
            const listData = await listResp.json();
            const tables = (listData.definitions && Object.keys(listData.definitions)) || [];
            tableList = tables.length ? tables.join(', ') : '（schema 响应中没有可用表清单）';
        }
    } catch (e) {
        tableList = '（获取现有表失败）';
    }
    return `❌ TABLE_CHANGE_GUARD_REQUIRED: ${operation} 前必须先过一遍现有表并证明必要性。\n当前已有表：${tableList}\n请传 necessity 参数说明：为什么现有表无法覆盖/不是重复造轮子（参照 database-overview.md）。`;
}

// DDL identifiers and column definitions are parsed into a small allowlisted grammar.
// Never validate a fragment and then concatenate the original fragment into SQL.
function quoteDdlIdentifier(value, label) {
    if (typeof value !== 'string' || !/^[a-z_][a-z0-9_]{0,62}$/.test(value)) {
        throw new Error(label + '必须是1-63位小写 ASCII 标识符（字母/下划线开头，仅含字母、数字、下划线）');
    }
    return '"' + value + '"';
}

function skipSqlWhitespace(input, position) {
    while (position < input.length && /\s/.test(input[position])) position++;
    return position;
}

function readSqlWord(input, position) {
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(input.slice(position));
    return match ? { word: match[0], end: position + match[0].length } : null;
}

function splitColumnDefinitions(input) {
    if (typeof input !== 'string' || !input.trim()) {
        throw new Error('columns 必须是非空字符串');
    }
    if (input.includes('\0')) throw new Error('columns 不允许包含 NUL 字符');

    const parts = [];
    let start = 0;
    let depth = 0;
    let inString = false;
    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (ch === "'") {
            if (inString && input[i + 1] === "'") {
                i++;
                continue;
            }
            inString = !inString;
            continue;
        }
        if (inString) continue;

        if (ch === ';') throw new Error('columns 不允许分号或额外 SQL 语句');
        if ((ch === '-' && input[i + 1] === '-') ||
            (ch === '/' && input[i + 1] === '*') ||
            (ch === '*' && input[i + 1] === '/')) {
            throw new Error('columns 不允许 SQL 注释');
        }
        if (ch === '(') {
            depth++;
            if (depth > 1) throw new Error('columns 只允许受限类型参数，不支持嵌套括号');
        } else if (ch === ')') {
            depth--;
            if (depth < 0) throw new Error('columns 括号不匹配');
        } else if (ch === ',' && depth === 0) {
            parts.push(input.slice(start, i).trim());
            start = i + 1;
        }
    }

    if (inString) throw new Error('columns 字符串字面量未闭合');
    if (depth !== 0) throw new Error('columns 括号未闭合');
    parts.push(input.slice(start).trim());
    if (parts.some(part => !part)) throw new Error('columns 含空列定义或多余逗号');
    return parts;
}

function parseDdlDefault(input, position) {
    position = skipSqlWhitespace(input, position);
    if (position >= input.length) throw new Error('DEFAULT 缺少默认值');

    if (input[position] === "'") {
        let value = '';
        let i = position + 1;
        while (i < input.length) {
            const ch = input[i];
            if (ch === "'") {
                if (input[i + 1] === "'") {
                    value += "'";
                    i += 2;
                    continue;
                }
                const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "''");
                return { sql: "E'" + escaped + "'", end: i + 1 };
            }
            if (ch === '\0') throw new Error('DEFAULT 字符串不允许 NUL 字符');
            value += ch;
            i++;
        }
        throw new Error('DEFAULT 字符串字面量未闭合');
    }

    const remainder = input.slice(position);
    const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(remainder);
    if (numeric) {
        const next = remainder[numeric[0].length];
        if (next === undefined || /\s/.test(next)) {
            return { sql: numeric[0], end: position + numeric[0].length };
        }
    }

    const word = readSqlWord(input, position);
    if (word) {
        const normalized = word.word.toLowerCase();
        if (['null', 'true', 'false', 'current_date', 'current_timestamp'].includes(normalized)) {
            return { sql: normalized.toUpperCase(), end: word.end };
        }
    }

    const fn = /^(now|gen_random_uuid)\s*\(\s*\)/i.exec(remainder);
    if (fn) {
        const next = remainder[fn[0].length];
        if (next === undefined || /\s/.test(next)) {
            return { sql: fn[1].toLowerCase() + '()', end: position + fn[0].length };
        }
    }

    throw new Error('DEFAULT 仅支持数值、布尔/NULL、单引号字符串、CURRENT_DATE/CURRENT_TIMESTAMP、now() 或 gen_random_uuid()');
}

function parseOneColumnDefinition(definition) {
    const match = /^([a-z_][a-z0-9_]{0,62})\s+([\s\S]+)$/.exec(definition);
    if (!match) throw new Error('列定义必须以小写 ASCII 列名和类型开头');

    const columnName = match[1];
    const input = match[2];
    let position = 0;
    const typeWord = readSqlWord(input, position);
    if (!typeWord) throw new Error('列 ' + columnName + ' 缺少有效类型');
    const baseType = typeWord.word.toLowerCase();
    position = typeWord.end;
    let typeSql = baseType;

    if (baseType === 'double') {
        const whitespaceEnd = skipSqlWhitespace(input, position);
        const precisionWord = readSqlWord(input, whitespaceEnd);
        if (whitespaceEnd === position || !precisionWord || precisionWord.word.toLowerCase() !== 'precision') {
            throw new Error('double 类型必须写作 double precision');
        }
        position = precisionWord.end;
        typeSql = 'double precision';
    } else {
        const simpleTypes = new Set([
            'uuid', 'text', 'boolean', 'smallint', 'integer', 'bigint', 'int2', 'int4', 'int8',
            'real', 'date', 'time', 'timestamp', 'timestamptz', 'json', 'jsonb', 'bytea'
        ]);
        if (!simpleTypes.has(baseType) && !['numeric', 'varchar', 'char'].includes(baseType)) {
            throw new Error('不支持的列类型：' + typeWord.word);
        }

        const modifierPosition = skipSqlWhitespace(input, position);
        if (baseType === 'numeric') {
            if (input[modifierPosition] === '(') {
                const modifier = /^\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)/.exec(input.slice(modifierPosition));
                if (!modifier) throw new Error('numeric 类型参数必须是 numeric(p) 或 numeric(p,s)');
                const precision = Number(modifier[1]);
                const scale = modifier[2] === undefined ? null : Number(modifier[2]);
                if (precision < 1 || precision > 1000 || (scale !== null && (scale < 0 || scale > precision))) {
                    throw new Error('numeric 精度/小数位超出首期允许范围');
                }
                typeSql += '(' + precision + (scale === null ? '' : ',' + scale) + ')';
                position = modifierPosition + modifier[0].length;
            }
        } else if (baseType === 'varchar' || baseType === 'char') {
            const modifier = /^\(\s*(\d+)\s*\)/.exec(input.slice(modifierPosition));
            if (!modifier) throw new Error(baseType + ' 首期必须带正整数长度参数');
            const length = Number(modifier[1]);
            if (!Number.isSafeInteger(length) || length < 1 || length > 10485760) {
                throw new Error(baseType + ' 长度超出首期允许范围');
            }
            typeSql += '(' + length + ')';
            position = modifierPosition + modifier[0].length;
        }
    }

    const arrayPosition = skipSqlWhitespace(input, position);
    if (input.slice(arrayPosition, arrayPosition + 2) === '[]') {
        typeSql += '[]';
        position = arrayPosition + 2;
        const afterArray = skipSqlWhitespace(input, position);
        if (input.slice(afterArray, afterArray + 2) === '[]') {
            throw new Error('首期只支持一维数组类型');
        }
    }

    let nullable = null;
    let primaryKey = false;
    let unique = false;
    let defaultSql = null;
    while (true) {
        position = skipSqlWhitespace(input, position);
        if (position >= input.length) break;
        const token = readSqlWord(input, position);
        if (!token) throw new Error('列 ' + columnName + ' 含不支持的语法片段');
        const keyword = token.word.toLowerCase();
        position = token.end;

        if (keyword === 'not') {
            const nextPosition = skipSqlWhitespace(input, position);
            const next = readSqlWord(input, nextPosition);
            if (!next || next.word.toLowerCase() !== 'null') throw new Error('只支持 NOT NULL 约束');
            if (nullable !== null) throw new Error('列 ' + columnName + ' 重复指定 NULL/NOT NULL');
            nullable = false;
            position = next.end;
        } else if (keyword === 'null') {
            if (nullable !== null) throw new Error('列 ' + columnName + ' 重复指定 NULL/NOT NULL');
            nullable = true;
        } else if (keyword === 'primary') {
            const nextPosition = skipSqlWhitespace(input, position);
            const next = readSqlWord(input, nextPosition);
            if (!next || next.word.toLowerCase() !== 'key') throw new Error('只支持 PRIMARY KEY 约束');
            if (primaryKey) throw new Error('列 ' + columnName + ' 重复指定 PRIMARY KEY');
            primaryKey = true;
            position = next.end;
        } else if (keyword === 'unique') {
            if (unique) throw new Error('列 ' + columnName + ' 重复指定 UNIQUE');
            unique = true;
        } else if (keyword === 'default') {
            if (defaultSql !== null) throw new Error('列 ' + columnName + ' 重复指定 DEFAULT');
            const parsedDefault = parseDdlDefault(input, position);
            defaultSql = parsedDefault.sql;
            position = parsedDefault.end;
        } else {
            throw new Error('列 ' + columnName + ' 不支持约束/表达式：' + token.word);
        }
    }

    const constraints = [];
    if (defaultSql !== null) constraints.push('DEFAULT ' + defaultSql);
    if (nullable === false) constraints.push('NOT NULL');
    else if (nullable === true) constraints.push('NULL');
    if (primaryKey) constraints.push('PRIMARY KEY');
    if (unique) constraints.push('UNIQUE');

    return quoteDdlIdentifier(columnName, '列名') + ' ' + typeSql + (constraints.length ? ' ' + constraints.join(' ') : '');
}

function parseColumnDefinitions(columns) {
    const definitions = splitColumnDefinitions(columns);
    const names = new Set();
    return definitions.map(definition => {
        const nameMatch = /^([a-z_][a-z0-9_]{0,62})\s+/.exec(definition);
        if (!nameMatch) throw new Error('列定义必须以小写 ASCII 列名开头');
        const name = nameMatch[1];
        if (names.has(name)) throw new Error('列名重复：' + name);
        names.add(name);
        return parseOneColumnDefinition(definition);
    });
}

export async function handleDatabaseTool(name, safeArgs, env) {
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) return '❌ Supabase 未配置';

    const headers = {
        'Authorization': `Bearer ${supabaseKey}`,
        'apikey': supabaseKey,
        'Content-Type': 'application/json'
    };

    try {
        // 兼容旧名称：supabase_query/supabase_insert 等也映射到对应 action
        const actionMap = {
            'supabase_query': 'query',
            'supabase_insert': 'insert',
            'supabase_update': 'update',
            'supabase_delete': 'delete',
            'supabase_tables': 'tables',
            'supabase_exec': 'exec'
        };
        const action = actionMap[name] || safeArgs.action || 'query';

        // ============================================
        // query - 查询任意表
        // ============================================
        if (action === 'query') {
            if (!safeArgs.table) return '❌ 缺少参数：需要 table（表名）';
            
            let url = `${supabaseUrl}/rest/v1/${safeArgs.table}?select=${safeArgs.select || '*'}`;
            
            if (safeArgs.filters && typeof safeArgs.filters === 'object') {
                for (const [col, val] of Object.entries(safeArgs.filters)) {
                    if (Array.isArray(val)) {
                        url += `&${col}=in.(${val.map(v => `"${v}"`).join(',')})`;
                    } else if (typeof val === 'string' && val.startsWith('like.')) {
                        url += `&${col}=like.${encodeURIComponent(val.substring(5))}`;
                    } else if (typeof val === 'string' && val.startsWith('gt.')) {
                        url += `&${col}=gt.${val.substring(3)}`;
                    } else if (typeof val === 'string' && val.startsWith('lt.')) {
                        url += `&${col}=lt.${val.substring(3)}`;
                    } else {
                        url += `&${col}=eq.${encodeURIComponent(val)}`;
                    }
                }
            }
            
            if (safeArgs.order) url += `&order=${safeArgs.order}`;
            if (safeArgs.limit) url += `&limit=${safeArgs.limit}`;
            if (safeArgs.offset) url += `&offset=${safeArgs.offset}`;
            
            const resp = await fetch(url, { headers });
            if (!resp.ok) {
                const errText = await resp.text();
                return `❌ 查询失败 (${resp.status}): ${errText}`;
            }
            const data = await resp.json();
            return '✅ 查询结果：\n```json\n' + JSON.stringify(data, null, 2).substring(0, 4000) + '\n```';
        }

        // ============================================
        // insert - 插入数据
        // ============================================
        if (action === 'insert') {
            if (!safeArgs.table || !safeArgs.data) return '❌ 缺少参数：需要 table 和 data';
            const body = typeof safeArgs.data === 'string' ? JSON.parse(safeArgs.data) : safeArgs.data;
            const resp = await fetch(`${supabaseUrl}/rest/v1/${safeArgs.table}`, {
                method: 'POST',
                headers: { ...headers, 'Prefer': 'return=representation' },
                body: JSON.stringify(body)
            });
            if (!resp.ok) {
                const errText = await resp.text();
                return `❌ 插入失败 (${resp.status}): ${errText}`;
            }
            const data = await resp.json();
            return '✅ 插入成功：\n```json\n' + JSON.stringify(data, null, 2).substring(0, 2000) + '\n```';
        }

        // ============================================
        // update - 更新数据
        // ============================================
        if (action === 'update') {
            if (!safeArgs.table || !safeArgs.data || !safeArgs.filters) return '❌ 缺少参数：需要 table, data, filters';
            const body = typeof safeArgs.data === 'string' ? JSON.parse(safeArgs.data) : safeArgs.data;
            let url = `${supabaseUrl}/rest/v1/${safeArgs.table}?`;
            for (const [col, val] of Object.entries(safeArgs.filters)) {
                url += `${col}=eq.${encodeURIComponent(val)}&`;
            }
            const resp = await fetch(url, {
                method: 'PATCH',
                headers: { ...headers, 'Prefer': 'return=representation' },
                body: JSON.stringify(body)
            });
            if (!resp.ok) {
                const errText = await resp.text();
                return `❌ 更新失败 (${resp.status}): ${errText}`;
            }
            const data = await resp.json();
            return '✅ 更新成功：\n```json\n' + JSON.stringify(data, null, 2).substring(0, 2000) + '\n```';
        }

        // ============================================
        // delete - 删除数据
        // ============================================
        if (action === 'delete') {
            if (!safeArgs.table || !safeArgs.filters) return '❌ 缺少参数：需要 table 和 filters';
            let url = `${supabaseUrl}/rest/v1/${safeArgs.table}?`;
            for (const [col, val] of Object.entries(safeArgs.filters)) {
                url += `${col}=eq.${encodeURIComponent(val)}&`;
            }
            const resp = await fetch(url, {
                method: 'DELETE',
                headers
            });
            if (!resp.ok) {
                const errText = await resp.text();
                return `❌ 删除失败 (${resp.status}): ${errText}`;
            }
            return '✅ 删除成功';
        }

        // ============================================
        // tables - 列出所有表
        // ============================================
        if (action === 'tables') {
            const resp = await fetch(`${supabaseUrl}/rest/v1/`, { headers });
            if (!resp.ok) {
                const errText = await resp.text();
                return `❌ 查询表失败 (${resp.status}): ${errText}`;
            }
            const data = await resp.json();
            const tables = (data.definitions && Object.keys(data.definitions)) || [];
            return '📋 数据库表列表（' + tables.length + ' 个）：\n' + tables.map(t => '- ' + t).join('\n');
        }

        // ============================================
        // exec - 执行 SQL（需要 exec_sql RPC，v2 支持空响应）
        // ============================================
        if (action === 'exec') {
            if (!safeArgs.sql) return '❌ 缺少参数：需要 sql';
            if (TABLE_CHANGE_SQL_PATTERN.test(String(safeArgs.sql)) && !hasTableChangeNecessity(safeArgs)) {
                return await tableChangeGuardMessage(supabaseUrl, headers, '通过 exec 执行结构变更');
            }
            const resp = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ sql: safeArgs.sql })
            });
            if (!resp.ok) {
                const errText = await resp.text();
                return `❌ SQL执行失败 (${resp.status}): ${errText}`;
            }
            // exec_sql 返回 void（204 空体）时不再 JSON.parse，直接返回成功
            const raw = await resp.text();
            if (!raw) return '✅ SQL执行成功（无返回体，DDL 已完成）';
            try {
                const data = JSON.parse(raw);
                return '✅ SQL执行结果：\n```json\n' + JSON.stringify(data, null, 2).substring(0, 4000) + '\n```';
            } catch {
                return '✅ SQL执行成功：\n' + raw;
            }
        }

        // ============================================
        // create_table - 创建表（v2 新增，走 exec_sql RPC）
        // 用法：{ action:'create_table', table:'my_table', columns:'id uuid primary key, name text not null', rls:false }
        // ============================================
        if (action === 'create_table' || action === 'createTable' || name === 'supabase_schema_create') {
            // v3（2026-09-09 Table Change Guard · 柳柳铁律）：加表前必须过现有表 + 证明必要性
            if (!safeArgs.table) return '❌ 缺少参数：需要 table（表名）';
            if (!safeArgs.columns) return '❌ 缺少参数：需要 columns（逗号分隔的列定义）';
            if (!hasTableChangeNecessity(safeArgs)) {
                return await tableChangeGuardMessage(supabaseUrl, headers, '建表');
            }
            let tableIdentifier;
            let columnsSql;
            try {
                tableIdentifier = quoteDdlIdentifier(safeArgs.table, '表名');
                columnsSql = parseColumnDefinitions(safeArgs.columns);
            } catch (e) {
                return '❌ 输入校验失败：' + e.message;
            }
            let sql = 'CREATE TABLE IF NOT EXISTS public.' + tableIdentifier + ' (' + columnsSql.join(', ') + ')';
            if (safeArgs.rls !== false) {
                sql += ';\nALTER TABLE public.' + tableIdentifier + ' ENABLE ROW LEVEL SECURITY';
            }
            const resp = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ sql })
            });
            if (!resp.ok) {
                const errText = await resp.text();
                return `❌ 建表失败 (${resp.status}): ${errText}`;
            }
            const raw = await resp.text();
            return raw ? `✅ 建表成功：${safeArgs.table}（${raw}）` : `✅ 建表成功：${safeArgs.table}`;
        }

        // ============================================
        // drop_table - 删除表（v2 新增，走 exec_sql RPC）
        // 用法：{ action:'drop_table', table:'my_table' }
        // ============================================
        if (action === 'drop_table' || action === 'dropTable') {
            if (!safeArgs.table) return '❌ 缺少参数：需要 table（表名）';
            if (!hasTableChangeNecessity(safeArgs)) {
                return await tableChangeGuardMessage(supabaseUrl, headers, '删表');
            }
            let tableIdentifier;
            try {
                tableIdentifier = quoteDdlIdentifier(safeArgs.table, '表名');
            } catch (e) {
                return '❌ 输入校验失败：' + e.message;
            }
            const sql = 'DROP TABLE IF EXISTS public.' + tableIdentifier + ' CASCADE';
            const resp = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ sql })
            });
            if (!resp.ok) {
                const errText = await resp.text();
                return `❌ 删表失败 (${resp.status}): ${errText}`;
            }
            const raw = await resp.text();
            return raw ? `✅ 删表成功：${safeArgs.table}（${raw}）` : `✅ 删表成功：${safeArgs.table}`;
        }

        // ============================================
        // schema_dump - 生成数据库表结构快照（v3 · 2026-09-09 数据库治理）
        // 从 OpenAPI definitions 生成全表结构 md/json，供 generated-schema.md 同步
        // 用法：{ action:'schema_dump', format:'md' | 'json' }
        // ============================================
        if (action === 'schema_dump' || action === 'dump_schema') {
            const resp = await fetch(`${supabaseUrl}/rest/v1/`, { headers });
            if (!resp.ok) {
                const errText = await resp.text();
                return `❌ 获取 schema 失败 (${resp.status}): ${errText}`;
            }
            const data = await resp.json();
            const defs = data.definitions || {};
            const tableNames = Object.keys(defs).sort();
            const format = safeArgs.format || 'md';
            if (format === 'json') {
                const dump = {};
                for (const t of tableNames) {
                    const props = (defs[t] && defs[t].properties) || {};
                    const required = (defs[t] && defs[t].required) || [];
                    dump[t] = { columns: Object.entries(props).map(([name, p]) => ({
                        name,
                        type: p.format || p.type || '?',
                        nullable: !required.includes(name),
                        description: p.description || ''
                    })) };
                }
                return JSON.stringify(dump, null, 2);
            }
            let md = '# Schema Snapshot（机器生成 · ' + new Date().toISOString().slice(0, 10) + ')\n\n> 由 supabase_schema schema_dump 自动生成，勿手改。\n\n';
            for (const t of tableNames) {
                const props = (defs[t] && defs[t].properties) || {};
                const required = (defs[t] && defs[t].required) || [];
                md += '## ' + t + '\n\n| 列 | 类型 | nullable | 说明 |\n|---|---|---|---|\n';
                for (const [name, p] of Object.entries(props)) {
                    const type = p.format || p.type || '?';
                    const nullable = required.includes(name) ? 'NO' : 'YES';
                    md += '| ' + name + ' | ' + type + ' | ' + nullable + ' | ' + (p.description || '') + ' |\n';
                }
                md += '\n';
            }
            return md;
        }

        return '❌ 未知操作：' + action + '（支持 query/insert/update/delete/tables/exec/create_table/drop_table/schema_dump）';
    } catch (e) {
        return '❌ 执行出错：' + e.message;
    }
}