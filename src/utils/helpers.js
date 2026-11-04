// ============================================================
// 通用辅助函数
// ============================================================
export function getCategory(key) {
    if (key && key.includes('/')) return key.split('/')[0];
    return '默认';
}
export function getTitle(key) {
    if (key && key.includes('/')) return key.split('/').slice(1).join('/');
    return key || '';
}
export function formatTime(isoString) {
    if (!isoString) return '未知';
    try {
        const d = new Date(isoString);
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0') + ' ' +
            String(d.getHours()).padStart(2, '0') + ':' +
            String(d.getMinutes()).padStart(2, '0');
    } catch {
        return isoString;
    }
}
export function generateId() {
    return crypto.randomUUID();
}
export function now() {
    return new Date().toISOString();
}
export function parsePagination(args) {
    let limit = 50;
    if (args && args.limit !== undefined) {
        const raw = parseInt(args.limit);
        if (!isNaN(raw)) limit = Math.max(1, Math.min(200, raw));
    }
    return { limit, cursor: (args && args.cursor) || null };
}
export function isValidDate(str) {
    if (!str) return false;
    const d = new Date(str);
    return !isNaN(d.getTime());
}
export function highlightText(text, keywords) {
    if (!text || !keywords || keywords.length === 0) return text;
    let result = text;
    for (const kw of keywords) {
        if (!kw) continue;
        const regex = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        result = result.replace(regex, '**' + kw + '**');
    }
    return result;
}
export function calculateStats(usageData) {
    let count = 0;
    let prompt_tokens = 0;
    let completion_tokens = 0;
    let cache_hit_tokens = 0;
    let cost = 0;
    if (!usageData || !Array.isArray(usageData)) {
        return { count: 0, prompt_tokens: 0, completion_tokens: 0, cache_hit_tokens: 0, cost: 0, total_tokens: 0 };
    }
    for (const item of usageData) {
        count++;
        prompt_tokens += item.prompt_tokens || 0;
        completion_tokens += item.completion_tokens || 0;
        cache_hit_tokens += item.cache_hit_tokens || 0;
        cost += item.cost || 0;
    }
    return {
        count,
        prompt_tokens,
        completion_tokens,
        cache_hit_tokens,
        cost,
        total_tokens: prompt_tokens + completion_tokens
    };
}

// Validate and safely encode a repository-relative GitHub content path.
// Dot segments must be rejected because encodeURIComponent('.') / ('..') does not neutralize URL path normalization.
export function validateRepoRelativePath(value, { allowRoot = false } = {}) {
    if (typeof value !== 'string') return { ok: false, code: 'INVALID_REPO_PATH', reason: '路径必须是字符串' };
    if (value === '' && allowRoot) return { ok: true, path: '', encodedPath: '' };
    if (!value || value !== value.trim() || value.startsWith('/') || value.includes(String.fromCharCode(92)) || Array.from(value).some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) {
        return { ok: false, code: 'INVALID_REPO_PATH', reason: '路径必须是相对路径，不能有首尾空白，也不能含反斜杠或控制字符' };
    }
    const segments = value.split('/');
    if (segments.some(segment => !segment || segment !== segment.trim() || segment === '.' || segment === '..')) {
        return { ok: false, code: 'INVALID_REPO_PATH', reason: '路径不能包含空路径段、首尾空白的路径段、. 或 .. 段' };
    }
    return { ok: true, path: value, encodedPath: segments.map(encodeURIComponent).join('/') };
}