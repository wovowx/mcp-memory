// Memory Retrieval — 当前有效记忆检索、匹配评分与有界一跳关联
// 不写业务记忆；搜索历史仍由 utils/search.js 处理。

import { getCurrentMemories, getMemoryAliasIds } from './repository.js';
import { parsePagination } from '../../utils/helpers.js';

const MAX_ASSOCIATED_MEMORIES = 3;
// 人名/泛化标签不构成足以召回另一条记忆的业务关联证据。
const GENERIC_ASSOCIATION_ENTITIES = new Set(['柳柳', '哥哥', 'ziven', 'agent', '项目', 'project']);

function normalize(value) {
    return String(value || '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function splitTerms(keyword) {
    return normalize(keyword).split(/[\s,，。！？!?;；:：、|]+/).filter(Boolean);
}

function isCjk(value) {
    return /[\u3400-\u9fff]/.test(value);
}

function cjkBigrams(value) {
    const chars = Array.from(value);
    const grams = new Set();
    for (let i = 0; i < chars.length - 1; i++) grams.add(chars[i] + chars[i + 1]);
    return grams;
}

function scoreExactCandidate(memory, terms, keyword, aliasIds) {
    const key = normalize(memory.key);
    const value = normalize(memory.value);
    const combined = key + ' ' + value;
    const lowerKeyword = normalize(keyword);
    const keyPhraseHit = key.includes(lowerKeyword);
    const phraseHit = combined.includes(lowerKeyword);
    const termHits = terms.filter(term => combined.includes(term));
    const allTermsHit = terms.length > 0 && termHits.length === terms.length;
    const triggerHit = Array.isArray(memory.trigger_intents) &&
        memory.trigger_intents.some(item => normalize(item).includes(lowerKeyword));
    const entityHit = Array.isArray(memory.entities) &&
        memory.entities.some(item => normalize(item) === lowerKeyword);
    const aliasHit = aliasIds.has(memory.id);

    if (!keyPhraseHit && !phraseHit && !allTermsHit && !triggerHit && !entityHit && !aliasHit) return null;

    let score = 0;
    if (keyPhraseHit) score += 1000;
    else if (phraseHit) score += 800;
    if (allTermsHit) score += 500;
    for (const term of termHits) score += key.includes(term) ? 70 : 30;
    if (aliasHit) score += 250;
    if (triggerHit) score += 180;
    if (entityHit) score += 160;

    return {
        ...memory,
        _match: {
            score,
            reason: keyPhraseHit ? 'key_phrase' :
                phraseHit ? 'phrase' :
                allTermsHit ? 'all_terms' :
                aliasHit ? 'alias' :
                triggerHit ? 'trigger_intent' : 'entity',
            matched_terms: termHits
        }
    };
}

function scoreCoreFallback(memory, terms) {
    const key = normalize(memory.key);
    const combined = key + ' ' + normalize(memory.value);
    const queryGrams = new Set();
    for (const term of terms) {
        if (isCjk(term)) {
            for (const gram of cjkBigrams(term)) queryGrams.add(gram);
        }
    }
    if (queryGrams.size < 2) return null;

    const matched = [...queryGrams].filter(gram => combined.includes(gram));
    const coverage = matched.length / queryGrams.size;
    if (matched.length < 2 || coverage < 0.30) return null;

    const keyMatches = matched.filter(gram => key.includes(gram)).length;
    const score = 100 + Math.round(coverage * 300) + matched.length * 8 + keyMatches * 5;
    return {
        ...memory,
        _match: {
            score,
            reason: 'core_ngram_fallback',
            matched_terms: matched
        }
    };
}

function compareCandidates(a, b) {
    const scoreDelta = (b._match?.score || 0) - (a._match?.score || 0);
    if (scoreDelta) return scoreDelta;
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
}

function businessEntities(memory) {
    const entities = new Map();
    for (const item of Array.isArray(memory.entities) ? memory.entities : []) {
        if (typeof item !== 'string') continue;
        const name = item.trim();
        const normalized = normalize(name);
        if (normalized.length < 2 || GENERIC_ASSOCIATION_ENTITIES.has(normalized)) continue;
        if (!entities.has(normalized)) entities.set(normalized, name);
    }
    return entities;
}

/**
 * Search active/current memories.
 * Priority: phrase/all-term/alias/context matches; only when those produce no
 * candidates, use a constrained CJK bigram fallback. Related memories expand
 * one hop (explicit IDs first, then shared business entities), with at most
 * three additions and source evidence kept below all direct matches.
 */
function readSourceFailure(error) {
    const allowedCodes = new Set(['http_error', 'network_error', 'invalid_json', 'invalid_response_shape']);
    return {
        status: 'error',
        error_code: allowedCodes.has(error?.code) ? error.code : 'read_failed'
    };
}

export async function searchMemories(env, keyword) {
    const query = String(keyword || '').trim();
    if (!query) throw new TypeError('search keyword is required');

    const [memoryOutcome, aliasOutcome] = await Promise.allSettled([
        getCurrentMemories(env),
        getMemoryAliasIds(env, query)
    ]);
    const sources = {
        memories: memoryOutcome.status === 'fulfilled'
            ? { status: 'ok', count: memoryOutcome.value.length }
            : readSourceFailure(memoryOutcome.reason),
        aliases: aliasOutcome.status === 'fulfilled'
            ? { status: 'ok', count: aliasOutcome.value.length }
            : readSourceFailure(aliasOutcome.reason)
    };
    if (memoryOutcome.status === 'rejected') {
        const error = new Error('Memory search could not read the required memories source');
        error.name = 'MemorySearchError';
        error.code = 'memory_source_unavailable';
        error.search_status = 'ERROR';
        error.sources = sources;
        throw error;
    }
    const current = memoryOutcome.value;
    const aliasIds = new Set(aliasOutcome.status === 'fulfilled' ? aliasOutcome.value : []);
    const terms = splitTerms(query);

    let direct = current
        .map(memory => scoreExactCandidate(memory, terms, query, aliasIds))
        .filter(Boolean);

    if (direct.length === 0) {
        direct = current
            .map(memory => scoreCoreFallback(memory, terms))
            .filter(Boolean);
    }
    direct.sort(compareCandidates);

    const matchedIds = new Set(direct.map(memory => memory.id));
    const currentById = new Map(current.map(memory => [memory.id, memory]));
    const related = [];
    for (const hit of direct) {
        if (related.length >= MAX_ASSOCIATED_MEMORIES) break;
        const ids = Array.isArray(hit.related_memory_ids) ? hit.related_memory_ids : [];
        for (const id of ids) {
            if (related.length >= MAX_ASSOCIATED_MEMORIES) break;
            if (matchedIds.has(id)) continue;
            const found = currentById.get(id);
            if (!found) continue;
            matchedIds.add(id);
            related.push({
                ...found,
                _match: {
                    score: 0, reason: 'related_memory', matched_terms: [],
                    related_from_key: hit.key
                }
            });
        }
    }

    related.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    if (related.length < MAX_ASSOCIATED_MEMORIES) {
        const sources = direct.map(memory => ({ memory, entities: businessEntities(memory) }))
            .filter(source => source.entities.size > 0);
        const candidates = [];
        for (const candidate of current) {
            if (matchedIds.has(candidate.id)) continue;
            const candidateEntities = businessEntities(candidate);
            let best = null;
            for (const source of sources) {
                const shared = [...source.entities.entries()]
                    .filter(([id]) => candidateEntities.has(id))
                    .map(([, name]) => name);
                if (shared.length > 0 && (!best || shared.length > best.shared.length)) {
                    best = { source: source.memory, shared };
                }
            }
            if (best) candidates.push({ candidate, ...best });
        }
        candidates.sort((a, b) =>
            b.shared.length - a.shared.length ||
            new Date(b.candidate.created_at || 0) - new Date(a.candidate.created_at || 0) ||
            String(a.candidate.key || '').localeCompare(String(b.candidate.key || '')));
        for (const { candidate, source, shared } of candidates.slice(0, MAX_ASSOCIATED_MEMORIES - related.length)) {
            related.push({
                ...candidate,
                _match: {
                    score: 0, reason: 'shared_entity', matched_terms: shared,
                    related_from_key: source.key
                }
            });
        }
    }
    const results = direct.concat(related);
    const status = aliasOutcome.status === 'rejected'
        ? 'PARTIAL'
        : results.length > 0 ? 'OK' : 'EMPTY';
    Object.defineProperty(results, 'search_status', {
        value: status, enumerable: false, configurable: false
    });
    Object.defineProperty(results, 'search_sources', {
        value: sources, enumerable: false, configurable: false
    });
    return results;
}

export async function searchMemoriesWithStatus(env, keyword) {
    const query = String(keyword || '').trim();
    if (!query) throw new TypeError('search keyword is required');
    try {
        const results = await searchMemories(env, query);
        return {
            status: results.search_status || (results.length > 0 ? 'OK' : 'EMPTY'),
            results,
            sources: results.search_sources || {}
        };
    } catch (error) {
        if (error?.search_status === 'ERROR') {
            return { status: 'ERROR', results: [], sources: error.sources || {} };
        }
        throw error;
    }
}

export async function listMemoryCategories(env) {
    const all = await getCurrentMemories(env);
    const counts = new Map();
    for (const item of all) {
        const category = item.category || '默认';
        counts.set(category, (counts.get(category) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function paginateItems(items, args = {}) {
    const { limit, cursor } = parsePagination(args);
    let startIndex = 0;
    if (cursor) {
        const cursorIndex = items.findIndex(item => item.id === cursor);
        if (cursorIndex !== -1) startIndex = cursorIndex + 1;
    }
    const page = items.slice(startIndex, startIndex + limit);
    const nextCursor = items.length > startIndex + limit ? page[page.length - 1]?.id : null;
    return { total: items.length, page, nextCursor };
}

export async function listMemories(env, args = {}) {
    const order = (args.order || 'desc').toLowerCase();
    const all = await getCurrentMemories(env);
    all.sort((a, b) => {
        const left = new Date(a.created_at), right = new Date(b.created_at);
        return order === 'asc' ? left - right : right - left;
    });
    return paginateItems(all, args);
}

export async function listMemoriesByCategory(env, category, args = {}) {
    const matched = (await getCurrentMemories(env))
        .filter(item => item.category === category)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return paginateItems(matched, args);
}

export async function listMemoriesByDate(env, startDate, endDate, args = {}) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    const matched = (await getCurrentMemories(env))
        .filter(item => {
            const created = new Date(item.created_at);
            return created >= start && created <= end;
        })
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return paginateItems(matched, args);
}

export async function getMemoryStats(env) {
    const all = await getCurrentMemories(env);
    const categories = new Map();
    let weekCount = 0;
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    for (const item of all) {
        const category = item.category || '默认';
        categories.set(category, (categories.get(category) || 0) + 1);
        if (new Date(item.created_at) >= oneWeekAgo) weekCount++;
    }
    return {
        total: all.length,
        categoryCount: categories.size,
        categories: [...categories.entries()].sort((a, b) => b[1] - a[1]),
        weekCount
    };
}

export async function getRandomMemory(env, category) {
    const all = await getCurrentMemories(env);
    if (all.length === 0) return { status: 'empty', item: null };
    const candidates = category ? all.filter(item => item.category === category) : all;
    if (candidates.length === 0) return { status: 'category_empty', item: null };
    return { status: 'ok', item: candidates[Math.floor(Math.random() * candidates.length)] };
}

