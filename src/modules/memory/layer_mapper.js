// L5 v0.1 — deterministic, metadata-only memory view suggestions.
// No fetch, storage, MCP registration, DB access or lifecycle transitions.
import { BOOTSTRAP_KEYS } from '../session/keys.js';

export const BOOTSTRAP_CORE_KEYS = Object.freeze(Object.values(BOOTSTRAP_KEYS));

const CORE_KEY_SET = new Set(BOOTSTRAP_CORE_KEYS);
const MEMORY_TYPES = new Set(['fact', 'quote', 'inference', 'agreement']);
const REFLECTION_STATES = new Set(['pending', 'validated', 'rejected', 'deferred']);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (value, name) => Object.prototype.hasOwnProperty.call(value, name);
const nonblank = value => typeof value === 'string' && value.trim().length > 0;
const safeText = value => nonblank(value) ? value.trim() : null;

function referenceArray(value) {
    return Array.isArray(value) && value.every(nonblank)
        ? [...new Set(value.map(x => x.trim()))] : [];
}

/** A single memory row is not a Reflection candidate, regardless of type/key. */
export function mapMemoryMetadata(input) {
    const row = isObject(input) ? input : {};
    const uncertainties = [];
    const reasons = [];
    if (!isObject(input)) uncertainties.push('invalid_record_shape');

    const recordId = safeText(row.id) || safeText(row.record_id);
    const key = safeText(row.key);
    const category = safeText(row.category);
    const type = MEMORY_TYPES.has(row.type) ? row.type : null;
    const sourceRef = safeText(row.source_ref);
    const status = safeText(row.status);
    const validToPresent = hasOwn(row, 'valid_to');
    const validTo = validToPresent ? row.valid_to : undefined;
    const evidenceRefs = referenceArray(row.evidence_refs);

    if (!recordId) uncertainties.push('record_id_missing');
    if (!key) uncertainties.push('key_missing');
    if (!category) uncertainties.push('category_missing');
    if (!type) uncertainties.push(hasOwn(row, 'type') ? 'type_invalid_or_unmarked' : 'type_missing');
    if (!sourceRef) uncertainties.push('provenance_missing');
    if (hasOwn(row, 'evidence_refs') && evidenceRefs.length === 0) {
        uncertainties.push('evidence_refs_invalid_or_empty');
    }
    if (type === 'agreement') uncertainties.push('agreement_confirmation_source_unverified');

    let validity = 'unknown';
    if (status === 'active' && validToPresent && validTo === null) {
        validity = 'current';
        reasons.push('current_active_record');
    } else if (status === 'active' && validToPresent && validTo !== null) {
        validity = 'conflicting';
        uncertainties.push('active_status_with_valid_to');
    } else if (['deleted', 'expired', 'inactive', 'archived'].includes(status)) {
        validity = 'historical';
        reasons.push('non_current_record');
    } else if (status && status !== 'active') {
        uncertainties.push('unknown_status');
    }
    if (validity === 'unknown') uncertainties.push('validity_unverified');

    const views = [];
    let coreInclusion = 'not_in_core_5_keys';
    if (validity === 'current') {
        views.push('Long-term');
        if (key && CORE_KEY_SET.has(key)) {
            reasons.push('exact_bootstrap_core_key');
            if (row.body_readable === true) {
                views.unshift('Core');
                coreInclusion = 'eligible_with_explicit_body_evidence';
            } else {
                coreInclusion = 'UNCERTAIN';
                uncertainties.push(row.body_readable === false
                    ? 'core_body_unreadable' : 'core_body_readability_unverified');
            }
        } else {
            reasons.push('not_a_bootstrap_core_key');
        }
    } else if (validity === 'historical') {
        views.push('Archive');
        coreInclusion = 'non_current_record';
    } else {
        views.push('UNCLASSIFIED');
        if (key && CORE_KEY_SET.has(key)) coreInclusion = 'UNCERTAIN';
    }

    return {
        record_id: recordId,
        key,
        category,
        type,
        validity: { status: status || null, valid_to: validToPresent ? validTo : null,
            classification: validity, valid_to_provided: validToPresent },
        maturity: null,
        provenance: sourceRef,
        suggested_views: views,
        core_inclusion: coreInclusion,
        evidence_refs: evidenceRefs,
        reasons,
        uncertainties,
        recommendation: 'review_only',
        writes_executed: false
    };
}

/** Learning candidates are independent of memories rows and never promoted here. */
export function mapReflectionMetadata(input) {
    const row = isObject(input) ? input : {};
    const candidateId = safeText(row.candidate_id);
    const state = safeText(row.validation_state);
    const sourceRefs = referenceArray(row.source_refs);
    const uncertainties = [];
    if (!isObject(input)) uncertainties.push('invalid_candidate_shape');
    if (!candidateId) uncertainties.push('candidate_id_missing');
    if (!REFLECTION_STATES.has(state)) uncertainties.push('reflection_state_invalid_or_missing');
    if (!sourceRefs.length) uncertainties.push('reflection_source_refs_missing');
    return {
        candidate_id: candidateId,
        maturity: REFLECTION_STATES.has(state) ? state : null,
        provenance_refs: sourceRefs,
        suggested_views: candidateId && REFLECTION_STATES.has(state) && sourceRefs.length
            ? ['Reflection'] : ['UNCLASSIFIED'],
        uncertainties,
        recommendation: 'review_only',
        approval_required: true,
        writes_executed: false
    };
}

/** Inventory here means only the supplied rows, never a database-wide count. */
export function buildMemoryLayerReport({ records = [], reflection_candidates: candidates = [] } = {}) {
    if (!Array.isArray(records) || !Array.isArray(candidates)) {
        throw new TypeError('records_and_reflection_candidates_must_be_arrays');
    }
    const mapped = records.map(mapMemoryMetadata);
    const keyCounts = new Map();
    for (const row of mapped) {
        if (row.key) keyCounts.set(row.key, (keyCounts.get(row.key) || 0) + 1);
    }
    const possibleDuplicates = [...keyCounts.entries()]
        .filter(([, count]) => count > 1).map(([key]) => key).sort();
    const duplicateSet = new Set(possibleDuplicates);
    const memory_rows = mapped.map(row => duplicateSet.has(row.key)
        ? { ...row, uncertainties: [...row.uncertainties, 'possible_duplicate_key'] } : row);
    const reflection_candidates = candidates.map(mapReflectionMetadata);
    const viewCounts = { Core: 0, 'Long-term': 0, Reflection: 0, Archive: 0, UNCLASSIFIED: 0 };
    for (const row of [...memory_rows, ...reflection_candidates]) {
        for (const view of row.suggested_views) viewCounts[view]++;
    }
    return {
        contract_version: 'MEMORY-L5-0.1',
        inventory_scope: 'provided_metadata_only',
        full_database_coverage_verified: false,
        read_only: true,
        writes_executed: false,
        memory_rows,
        reflection_candidates,
        possible_duplicate_keys: possibleDuplicates,
        summary: {
            provided_memory_rows: records.length,
            provided_reflection_candidates: candidates.length,
            rows_with_uncertainties: [...memory_rows, ...reflection_candidates]
                .filter(row => row.uncertainties.length > 0).length,
            view_counts: viewCounts
        }
    };
}
