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

/**
 * L3 v0.2: compare an expected behavior contract with a caller-supplied observation.
 * This is a pure E2/evidence-gathering primitive. Passing a synthetic or reported
 * observation NEVER proves a real agent/host cold start (E3). No I/O or promotion.
 */
export function evaluateBehaviorObservation(trial) {
    if (!isRecord(trial) || !hasText(trial.scenario_id) ||
        !isRecord(trial.expected) || Object.keys(trial.expected).length === 0) {
        return { status: 'INVALID', reason: 'behavior_contract_required', host_verified: false };
    }
    if (!isRecord(trial.observed) || !textArray(trial.evidence_refs) ||
        trial.evidence_refs.length === 0) {
        return { status: 'NOT_VERIFIED', reason: 'missing_observation_or_evidence',
            host_verified: false };
    }
    const mismatches = Object.entries(trial.expected)
        .filter(([key, value]) => !Object.hasOwn(trial.observed, key) ||
            trial.observed[key] !== value)
        .map(([key]) => key);
    return {
        status: mismatches.length ? 'FAIL' : 'PASS',
        scenario_id: trial.scenario_id,
        mismatches,
        evidence_refs: [...trial.evidence_refs],
        evidence_scope: 'caller_supplied_not_independently_verified',
        host_verified: false
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

// L3 v0.3 — evidence, preflight and transfer primitives. These never load
// private memories, execute a tool, publish a lesson or claim host E3 proof.
const normalized = value => String(value || '').trim().toLocaleLowerCase();

/** A source pointer is a provenance claim, not proof that its contents are true. */
export function evaluateCorrectionTrail(artifact) {
    const candidate = validateCandidate(artifact);
    if (!candidate.ok) return { status: 'INVALID', errors: candidate.errors, source_verified: false };
    const trail = artifact.correction_trail;
    const problems = [];
    for (const stage of ['failure', 'feedback']) {
        const entry = trail?.[stage];
        if (!isRecord(entry) || !hasText(entry.action) || !hasText(entry.outcome) ||
            !hasText(entry.source_ref)) problems.push(stage + '_evidence_required');
    }
    if (trail?.feedback && !hasText(trail.feedback.actor)) problems.push('feedback_actor_required');
    if (trail?.recovery !== undefined) {
        const entry = trail.recovery;
        if (!isRecord(entry) || !hasText(entry.action) || !hasText(entry.outcome) ||
            !hasText(entry.source_ref)) problems.push('recovery_evidence_invalid');
    }
    if (problems.length) return { status: 'INCOMPLETE', errors: problems, source_verified: false };
    const refs = [trail.failure.source_ref, trail.feedback.source_ref,
        ...(trail.recovery ? [trail.recovery.source_ref] : [])];
    if (refs.some(ref => !artifact.reflection.source_refs.includes(ref))) {
        return { status: 'INCOMPLETE', errors: ['unlinked_source_refs'],
            source_verified: false };
    }
    return {
        status: trail.recovery ? 'RECORDED' : 'RECORDED_PARTIAL',
        source_refs: refs, source_verified: false, promotion_executed: false
    };
}

function matchesApplication(task, application) {
    if (!isRecord(application) || !textArray(application.intent_any) ||
        application.intent_any.length === 0) return false;
    const intentMatched = application.intent_any.some(intent => normalized(intent) === normalized(task.intent));
    const entityMatched = !Array.isArray(application.entity_any) ||
        application.entity_any.length === 0 ||
        (textArray(application.entity_any) && application.entity_any.some(entity =>
            task.entities.some(value => normalized(value) === normalized(entity))));
    return intentMatched && entityMatched;
}

/**
 * A task-time read-only recommendation, not a tool dispatcher. Only already
 * active, explicitly approved lessons may recommend a tool. Synthetic copies
 * can exercise the contract without activating a real candidate.
 */
export function planLearningPreflight(task, artifacts) {
    const inert = { advisory_only: true, executed: false, host_verified: false };
    if (!isRecord(task) || !hasText(task.intent) || !textArray(task.entities) ||
        !textArray(task.available_tools) || !hasText(task.branch) || !hasText(task.repo) ||
        !Array.isArray(artifacts)) {
        return { status: 'INVALID', reason: 'task_contract_required', ...inert };
    }
    const matching = artifacts.filter(a => isRecord(a) && a.status !== 'revoked' &&
        a.status !== 'superseded' && matchesApplication(task, a.application));
    if (!matching.length) return { status: 'NO_MATCH', ...inert };
    if (task.branch === 'main') return { status: 'BLOCKED', reason: 'main_out_of_scope', ...inert };
    const ready = matching.filter(a => a.status === 'active' &&
        hasText(a.application.approval_ref) &&
        (!isRecord(a.reflection) || a.reflection.validation_state === 'validated'));
    if (!ready.length) return { status: 'PENDING_REVIEW',
        candidate_ids: matching.map(a => a.reflection?.candidate_id || a.test_id), ...inert };
    if (ready.length !== 1) return { status: 'CONFLICT', reason: 'multiple_active_lessons', ...inert };
    const lesson = ready[0];
    const app = lesson.application;
    if (!hasText(app.preferred_tool) || !textArray(app.steps) || !app.steps.length ||
        !textArray(app.allowed_branches) || !app.allowed_branches.length ||
        !textArray(app.allowed_repos) || !app.allowed_repos.length ||
        (app.tool_aliases !== undefined && !textArray(app.tool_aliases))) {
        return { status: 'INVALID_LESSON', ...inert };
    }
    if (!app.allowed_branches.includes(task.branch)) return {
        status: 'BLOCKED', reason: 'branch_not_allowed', ...inert
    };
    if (!app.allowed_repos.includes(task.repo)) return {
        status: 'BLOCKED', reason: 'repo_not_allowed', ...inert
    };
    const exposedTool = [app.preferred_tool, ...(app.tool_aliases || [])]
        .find(tool => task.available_tools.includes(tool));
    if (!exposedTool) return {
        status: 'UNAVAILABLE', reason: 'preferred_tool_not_exposed',
        required_tool: app.preferred_tool, ...inert
    };
    return {
        status: 'READY', recommended_tool: exposedTool, canonical_tool: app.preferred_tool,
        steps: [...app.steps], lesson_key: lesson.lesson_key,
        approval_ref: app.approval_ref,
        source_refs: Array.isArray(lesson.reflection?.source_refs)
            ? [...lesson.reflection.source_refs] : [],
        evidence_scope: 'caller_supplied_approval_and_capabilities', ...inert
    };
}

/** Paired outcomes must share task and capabilities; reports cannot certify E3. */
export function compareLearningTrials(pair) {
    const inert = { host_verified: false, evidence_scope: 'caller_supplied_not_independently_verified' };
    if (!isRecord(pair) || !hasText(pair.scenario_id) || !isRecord(pair.baseline) ||
        !isRecord(pair.after)) return { status: 'INVALID', ...inert };
    const before = pair.baseline;
    const after = pair.after;
    for (const result of [before, after]) {
        if (!hasText(result.task_fingerprint) || !hasText(result.capability_fingerprint) ||
            typeof result.success !== 'boolean' || typeof result.error_recurred !== 'boolean') {
            return { status: 'INVALID', reason: 'outcome_contract_required', ...inert };
        }
    }
    if (before.task_fingerprint !== after.task_fingerprint ||
        before.capability_fingerprint !== after.capability_fingerprint) {
        return { status: 'INVALID', reason: 'unpaired_conditions', ...inert };
    }
    if (!textArray(before.evidence_refs) || !before.evidence_refs.length ||
        !textArray(after.evidence_refs) || !after.evidence_refs.length) {
        return { status: 'NOT_VERIFIED', reason: 'evidence_missing', ...inert };
    }
    const improved = (!before.success && after.success) ||
        (before.error_recurred && !after.error_recurred && after.success);
    const regressed = (before.success && !after.success) ||
        (!before.error_recurred && after.error_recurred);
    return {
        status: regressed ? 'REGRESSED' : improved ? 'IMPROVED' : 'UNCHANGED',
        scenario_id: pair.scenario_id,
        evidence_refs: [...before.evidence_refs, ...after.evidence_refs], ...inert
    };
}
