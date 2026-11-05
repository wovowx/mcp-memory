// Pure constrained DDL parser.
// No network, database, schema, or permission side effects live in this module.
// It validates a deliberately small grammar and returns quoted SQL fragments.

// DDL identifiers and column definitions are parsed into a small allowlisted grammar.
// Never validate a fragment and then concatenate the original fragment into SQL.
export function quoteDdlIdentifier(value, label) {
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

export function parseColumnDefinitions(columns) {
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
