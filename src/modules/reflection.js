// L3 Reflection v0.1 — pure evaluation of existing learning artifacts.
// No I/O, memory writes, Skill publication, runtime hooks or MCP registration.
const VALID_STATES = new Set(['pending', 'validated', 'rejected', 'deferred']);
const VALID_TARGETS = new Set(['memory', 'skill', 'workflow', 'none']);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasText = value => typeof value === 'string' && value.trim().length > 0;
const textArray = value => Array.isArray(value) && value.every(hasText);

/**
 * Structural evidence gate. References are caller-reported, NOT independently
 * verified. A validated label must never be presented as real host E3 evidence.
 */
export function validateCandidate(artifact) {
    const errors = [];
    if (!isRecord(artifact)) return { ok: false, errors: ['artifact_must_be_object'] };
    if (!hasText(artifact.test_id)) errors.push('test_id_required');
    if (artifact.status !== 'candidate') errors.push('artifact_status_must_be_candidate');

    const r = artifact.reflection;
    if (!isRecord(r)) return { ok: false, errors: [...errors, 'reflection_required'] };
    if (!hasText(r.candidate_id)) errors.push('candidate_id_required');
    if (!hasText(r.hypothesis)) errors.push('hypothesis_required');
    if (!textArray(r.source_refs) || r.source_refs.length === 0) errors.push('source_refs_required');
    else if (new Set(r.source_refs).size !== r.source_refs.length) errors.push('source_refs_duplicate');
    if (!textArray(r.evidence_for)) errors.push('evidence_for_must_be_array');
    if (!textArray(r.evidence_against)) errors.push('evidence_against_must_be_array');
    if (!VALID_STATES.has(r.validation_state)) errors.push('invalid_validation_state');
    if (!VALID_TARGETS.has(r.target)) errors.push('invalid_target');
    if (!hasText(r.decision_reason)) errors.push('decision_reason_required');
    if (r.validation_refs !== undefined && !textArray(r.validation_refs)) {
        errors.push('validation_refs_must_be_array');
    }
    if (r.contradiction_resolution !== undefined && !hasText(r.contradiction_resolution)) {
        errors.push('contradiction_resolution_must_be_text');
    }
    if (r.validation_state === 'validated') {
        if (!Array.isArray(r.evidence_for) || r.evidence_for.length === 0) {
            errors.push('validated_requires_supporting_evidence');
        }
        if (!textArray(r.validation_refs) || r.validation_refs.length === 0) {
            errors.push('validated_requires_validation_refs');
        }
        if (Array.isArray(r.evidence_against) && r.evidence_against.length > 0 &&
            !hasText(r.contradiction_resolution)) {
            errors.push('unresolved_contradictory_evidence');
        }
    }
    return { ok: errors.length === 0, errors };
}

/** Determine eligibility; only a reviewable proposal can result, never a write. */
export function decideCandidate(artifact) {
    const validation = validateCandidate(artifact);
    if (!validation.ok) {
        return { state: 'invalid', eligible_for_preview: false, errors: validation.errors };
    }
    const state = artifact.reflection.validation_state;
    return {
        state,
        eligible_for_preview: state === 'validated' && artifact.reflection.target !== 'none',
        errors: []
    };
}

/** Return an inert, explicitly approval-gated promotion preview. */
export function previewPromotion(artifact, options = {}) {
    const decision = decideCandidate(artifact);
    if (decision.state === 'invalid') {
        return { status: 'blocked', reason: 'invalid_candidate', errors: decision.errors, executed: false };
    }
    const r = artifact.reflection;
    const prior = isRecord(options) && Array.isArray(options.previouslyProposedIds)
        ? options.previouslyProposedIds : [];
    if (prior.includes(r.candidate_id)) {
        return { status: 'blocked', reason: 'duplicate_candidate_id', executed: false };
    }
    if (!decision.eligible_for_preview) {
        return {
            status: 'blocked',
            reason: decision.state === 'validated' ? 'target_none' : 'not_validated',
            executed: false
        };
    }
    return {
        status: 'ready_for_review',
        candidate_id: r.candidate_id,
        target: r.target,
        hypothesis: r.hypothesis,
        source_refs: [...r.source_refs],
        validation_refs: [...r.validation_refs],
        decision_reason: r.decision_reason,
        approval_required: true,
        executed: false
    };
}

/** Batch workflow: duplicate IDs cannot yield multiple proposals. No side effects. */
export function evaluateReflectionCandidates(artifacts) {
    if (!Array.isArray(artifacts)) throw new TypeError('artifacts_must_be_array');
    const seen = new Set();
    return artifacts.map(artifact => {
        const validation = validateCandidate(artifact);
        const decision = decideCandidate(artifact);
        const id = isRecord(artifact?.reflection) ? artifact.reflection.candidate_id : null;
        const duplicate = hasText(id) && seen.has(id);
        const proposal = duplicate
            ? { status: 'blocked', reason: 'duplicate_candidate_id', executed: false }
            : previewPromotion(artifact);
        if (hasText(id)) seen.add(id);
        return {
            test_id: isRecord(artifact) ? artifact.test_id ?? null : null,
            candidate_id: hasText(id) ? id : null,
            validation,
            decision,
            proposal
        };
    });
}
