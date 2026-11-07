// L3 Reflection v0.1 synthetic-only contracts — no business DB, network or MCP calls.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    validateCandidate, decideCandidate, previewPromotion, evaluateReflectionCandidates,
    evaluateBehaviorObservation, evaluateCorrectionTrail, planLearningPreflight,
    compareLearningTrials
} from '../src/modules/reflection.js';

const fixture = JSON.parse(await readFile(
    new URL('./learning/learning_reflection_candidate_001.json', import.meta.url), 'utf8'
));
let passed = 0;
const check = (label, ok) => {
    assert.ok(ok, label);
    passed++;
    console.log('  ✅ ' + label);
};
const modify = mutator => {
    const copy = structuredClone(fixture);
    mutator(copy.reflection, copy);
    return copy;
};
const makeValidated = () => modify(r => {
    r.validation_state = 'validated';
    r.evidence_for = ['Synthetic mock test: failure path produced an explicit error'];
    r.validation_refs = ['synthetic:ci-run-001'];
    r.decision_reason = 'Synthetic evidence sufficient to propose manual review (not E3)';
});
const savedFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('unexpected network call'); };
try {
    console.log('\n[L3 Reflection candidate structural and behavioral contracts]');
    check('synthetic pending fixture is structurally valid', validateCandidate(fixture).ok);
    check('pending decision never proposes promotion', !decideCandidate(fixture).eligible_for_preview);
    check('pending preview is blocked', previewPromotion(fixture).status === 'blocked'
        && previewPromotion(fixture).reason === 'not_validated');

    check('reject invalid input record', !validateCandidate(null).ok);
    check('reject active lesson masquerading as candidate', !validateCandidate(modify((r, a) => {
        a.status = 'active';
    })).ok);
    check('reject missing reflection body', !validateCandidate({ test_id: 'x', status: 'candidate' }).ok);
    check('reject missing candidate id', !validateCandidate(modify(r => { r.candidate_id = ''; })).ok);
    check('reject missing hypothesis', !validateCandidate(modify(r => { r.hypothesis = ' '; })).ok);
    check('reject missing source references', !validateCandidate(modify(r => { r.source_refs = []; })).ok);
    check('reject blank source references', !validateCandidate(modify(r => {
        r.source_refs = ['valid', ' '];
    })).ok);
    check('reject duplicated source references', !validateCandidate(modify(r => {
        r.source_refs = ['synthetic:duplicate', 'synthetic:duplicate'];
    })).ok);
    check('reject missing evidence arrays', !validateCandidate(modify(r => {
        delete r.evidence_for;
    })).ok);
    check('reject invalid validation state', !validateCandidate(modify(r => {
        r.validation_state = 'auto_approved';
    })).ok);
    check('reject invalid promotion target', !validateCandidate(modify(r => {
        r.target = 'database';
    })).ok);
    check('reject missing decision reason', !validateCandidate(modify(r => {
        r.decision_reason = '';
    })).ok);

    check('validated needs supporting evidence', !validateCandidate(modify(r => {
        r.validation_state = 'validated';
        r.validation_refs = ['synthetic:ci-run-001'];
    })).ok);
    check('validated needs an explicit traceable verification reference', !validateCandidate(modify(r => {
        r.validation_state = 'validated';
        r.evidence_for = ['Synthetic proof'];
    })).ok);
    check('validated cannot silently ignore contradictory evidence', !validateCandidate(modify(r => {
        r.validation_state = 'validated';
        r.evidence_for = ['Synthetic proof'];
        r.validation_refs = ['synthetic:ci-run-001'];
        r.evidence_against = ['Synthetic counterexample'];
    })).ok);
    check('counterexample must have explicit resolution before eligible review', validateCandidate(modify(r => {
        r.validation_state = 'validated';
        r.evidence_for = ['Synthetic proof'];
        r.validation_refs = ['synthetic:ci-run-001'];
        r.evidence_against = ['Synthetic counterexample'];
        r.contradiction_resolution = 'Synthetic counterexample was outside this rule scope';
    })).ok);

    const validated = makeValidated();
    const before = structuredClone(validated);
    const decision = decideCandidate(validated);
    const proposal = previewPromotion(validated);
    check('validated candidate with sources can be proposed', validateCandidate(validated).ok
        && decision.state === 'validated' && decision.eligible_for_preview);
    check('proposal requires separate approval and cannot execute writes', proposal.status === 'ready_for_review'
        && proposal.approval_required === true && proposal.executed === false);
    check('preview retains provenance and target without inventing E3', proposal.target === 'skill'
        && proposal.source_refs[0] === fixture.reflection.source_refs[0]
        && proposal.validation_refs[0] === 'synthetic:ci-run-001');
    check('evaluation does not mutate input candidate', JSON.stringify(validated) === JSON.stringify(before));

    for (const state of ['rejected', 'deferred', 'pending']) {
        const candidate = modify(r => { r.validation_state = state; });
        const result = previewPromotion(candidate);
        check(state + ' cannot promote', result.status === 'blocked' && result.reason === 'not_validated');
    }
    check('validated with target none produces no promotion proposal', previewPromotion(modify(r => {
        r.validation_state = 'validated';
        r.target = 'none';
        r.evidence_for = ['Synthetic proof'];
        r.validation_refs = ['synthetic:ci-run-001'];
    })).reason === 'target_none');

    check('prior proposal ID prevents re-proposing an identical candidate', previewPromotion(validated, {
        previouslyProposedIds: [validated.reflection.candidate_id]
    }).reason === 'duplicate_candidate_id');

    check('null preview options do not accidentally grant or throw',
        previewPromotion(validated, null).status === 'ready_for_review');

    const batch = evaluateReflectionCandidates([validated, structuredClone(validated), fixture]);
    check('batch emits at most one proposal per candidate ID', batch.length === 3
        && batch[0].proposal.status === 'ready_for_review'
        && batch[1].proposal.reason === 'duplicate_candidate_id'
        && batch[2].proposal.reason === 'duplicate_candidate_id');
    check('batch never reports completed writes', batch.every(row => row.proposal.executed === false));
    check('invalid candidate produces structured error rather than success', evaluateReflectionCandidates([
        modify(r => { r.source_refs = []; })
    ])[0].proposal.reason === 'invalid_candidate');

    assert.throws(() => evaluateReflectionCandidates({}), /artifacts_must_be_array/);
    passed++;
    console.log('  ✅ batch input must be an array');

    // Every future Reflection artifact participates in CI, not only this frozen sample.
    const learningDir = new URL('./learning/', import.meta.url);
    const candidateIds = new Set();
    let checkedArtifacts = 0;
    for (const filename of (await readdir(learningDir)).filter(name => name.endsWith('.json'))) {
        const artifact = JSON.parse(await readFile(new URL(filename, learningDir), 'utf8'));
        if (!Object.hasOwn(artifact, 'reflection')) continue; // legacy lessons retain their contract
        const validation = validateCandidate(artifact);
        assert.ok(validation.ok, filename + ': ' + validation.errors.join(', '));
        assert.ok(!candidateIds.has(artifact.reflection.candidate_id),
            filename + ': duplicate Reflection candidate_id');
        candidateIds.add(artifact.reflection.candidate_id);
        checkedArtifacts++;
    }
    check('all Reflection files under tests/learning are structurally valid and uniquely identified',
        checkedArtifacts >= 1 && candidateIds.size === checkedArtifacts);

    console.log('\n[L3 v0.2 GitHub connector 403 → host-aware route recurrence prevention]');
    const toolRouteFixture = JSON.parse(await readFile(
        new URL('./learning/learning_github_tool_route_001.json', import.meta.url), 'utf8'
    ));
    const guide = await readFile(new URL('../src/skills/guide/github-use-guide/SKILL.md',
        import.meta.url), 'utf8');
    const router = await readFile(new URL('../src/skills/master-router/SKILL.md',
        import.meta.url), 'utf8');
    check('observed failure lesson is pending until fresh-host E3',
        toolRouteFixture.reflection.validation_state === 'pending' &&
        toolRouteFixture.reflection.source_refs.some(ref => ref.startsWith('conversation:')) &&
        toolRouteFixture.scenarios.length === 8 &&
        previewPromotion(toolRouteFixture).status === 'blocked');
    check('loaded guide spells out actual Ziven MCP route, dry run and readback',
        guide.includes('跨宿主选工具防复发') && guide.includes('github_edit') &&
        guide.includes('dry_run=true') && guide.includes('github_read'));
    check('master router triggers the host-aware connector 403 lesson',
        router.includes('跨宿主修改 Ziven GitHub 已有文件') &&
        router.includes('403') && router.includes('先验当前宿主'));
    check('new-file scene discovers github_copy before requiring manual upload',
        router.includes('github_copy') && guide.includes('github_copy') &&
        guide.includes('source_path') && guide.includes('overwrite=false') &&
        toolRouteFixture.scenarios.some(s => s.scenario_id === 'T6'));
    check('old existing-file preflight never incorrectly recommends github_edit for brand-new files',
        planLearningPreflight({ intent: '创建 GitHub 新文件', entities: ['github_copy'],
            available_tools: ['ziven_mcp.github_copy', 'ziven_mcp.github_edit'],
            branch: 'dev', repo: 'wovowx/mcp-memory' }, [toolRouteFixture]).status === 'NO_MATCH');

    const trial = (scenario_id, expected, observed) =>
        evaluateBehaviorObservation({ scenario_id, expected, observed,
            evidence_refs: ['synthetic:tool-route-contract-v0.2'] });
    // T1: the dev existing-file route selects the configured Ziven MCP edit path.
    check('T1 dev existing-file synthetic route uses Ziven MCP with dry_run and readback',
        trial('T1', { tool: 'ziven_mcp.github_edit', branch: 'dev',
            dry_run: true, readback: true },
        { tool: 'ziven_mcp.github_edit', branch: 'dev',
            dry_run: true, readback: true }).status === 'PASS');
    // T2: connector-specific 403 is not treated as global GitHub denial.
    check('T2 connector-specific 403 can be recovered via another available route',
        trial('T2', { global_denial_inferred: false, fallback: 'ziven_mcp.github_edit' },
            { global_denial_inferred: false, fallback: 'ziven_mcp.github_edit' }).status === 'PASS' &&
        trial('T2-negative', { global_denial_inferred: false },
            { global_denial_inferred: true }).status === 'FAIL');
    // T3: do not invent a Ziven MCP tool in hosts that do not expose it.
    check('T3 unavailable route cannot masquerade as a successful write',
        trial('T3', { status: 'UNAVAILABLE', write_executed: false },
            { status: 'UNAVAILABLE', write_executed: false }).status === 'PASS' &&
        trial('T3-negative', { write_executed: false },
            { write_executed: true }).mismatches.includes('write_executed'));
    // T4: main deployment remains a separately gated high-risk operation.
    check('T4 unauthorized direct main write remains blocked',
        trial('T4', { branch: 'main', status: 'BLOCKED', write_executed: false },
            { branch: 'main', status: 'BLOCKED', write_executed: false }).status === 'PASS');
    // T5: no made-up first-turn evidence; only a separate cold-frame observation can pass.
    check('T5 cold-start continuity without real observation is NOT_VERIFIED',
        evaluateBehaviorObservation({ scenario_id: 'T5',
            expected: { tool: 'ziven_mcp.github_edit' }, evidence_refs: [] })
            .status === 'NOT_VERIFIED' &&
        evaluateBehaviorObservation({ scenario_id: 'T5', expected: {tool:'x'},
            observed: { tool: 'x' }, evidence_refs: ['synthetic:mock'] }).host_verified === false);
    check('T6 new-file route reuses copy and edit without requiring upload',
        trial('T6', { route: 'github_copy→github_edit→github_read', upload_required: false },
            { route: 'github_copy→github_edit→github_read', upload_required: false }).status === 'PASS');
    check('T7 no seed and no upload capability returns precise unavailable',
        trial('T7', { status: 'UNAVAILABLE', global_denial_inferred: false },
            { status: 'UNAVAILABLE', global_denial_inferred: false }).status === 'PASS' &&
        trial('T7-negative', { status: 'UNAVAILABLE' },
            { status: 'READY' }).status === 'FAIL');
    check('T8 copying into main without release permission remains forbidden',
        trial('T8', { target_branch: 'main', write_executed: false },
            { target_branch: 'main', write_executed: false }).status === 'PASS' &&
        trial('T8-negative', { write_executed: false },
            { write_executed: true }).status === 'FAIL');
    check('behavior comparison cannot turn caller-reported evidence into E3',
        trial('T1', { tool: 'ziven_mcp.github_edit' },
            { tool: 'ziven_mcp.github_edit' }).host_verified === false);

    console.log('\n[L3 v0.3 correction provenance → approved lesson preflight → paired outcome]');
    const trail = evaluateCorrectionTrail(toolRouteFixture);
    check('correction trail links failure, feedback and recovery to original episode',
        trail.status === 'RECORDED' && trail.source_refs.length === 3 &&
        trail.source_verified === false && trail.promotion_executed === false);
    const partial = structuredClone(toolRouteFixture);
    delete partial.correction_trail.recovery;
    check('missing recovery stays partial instead of invented success',
        evaluateCorrectionTrail(partial).status === 'RECORDED_PARTIAL');
    const unlinked = structuredClone(toolRouteFixture);
    unlinked.correction_trail.feedback.source_ref = 'synthetic:unlinked';
    check('correction source not in original candidate is rejected',
        evaluateCorrectionTrail(unlinked).status === 'INCOMPLETE');
    const missingFeedback = structuredClone(toolRouteFixture);
    delete missingFeedback.correction_trail.feedback;
    check('correction cannot be declared complete without feedback',
        evaluateCorrectionTrail(missingFeedback).status === 'INCOMPLETE');
    const anonymousFeedback = structuredClone(toolRouteFixture);
    delete anonymousFeedback.correction_trail.feedback.actor;
    check('feedback attribution must name its actor',
        evaluateCorrectionTrail(anonymousFeedback).status === 'INCOMPLETE');

    const task = { intent: '修改 GitHub 已有文件', entities: ['github_edit'],
        branch: 'dev', repo: 'wovowx/ZivenLab',
        available_tools: ['ziven_mcp.github_edit'] };
    const candidatePreflight = planLearningPreflight(task, [toolRouteFixture]);
    check('candidate can match context but never self-activate',
        candidatePreflight.status === 'PENDING_REVIEW' &&
        candidatePreflight.executed === false && candidatePreflight.host_verified === false);
    const active = structuredClone(toolRouteFixture); // E2 synthetic; never persisted or promoted.
    active.status = 'active';
    active.reflection.validation_state = 'validated';
    active.application.approval_ref = 'synthetic:reviewed-fixture-not-real-approval';
    const ready = planLearningPreflight(task, [active]);
    check('synthetic approved lesson selects actual exposed tool and ordered actions',
        ready.status === 'READY' && ready.recommended_tool === 'ziven_mcp.github_edit' &&
        ready.steps[0] === 'dry_run' && ready.steps.at(-1) === 'github_read_back');
    check('preflight is advice only and does not claim host/tool execution',
        ready.advisory_only && !ready.executed && !ready.host_verified &&
        ready.evidence_scope === 'caller_supplied_approval_and_capabilities');
    check('no approval ref prevents a lesson from becoming active advice',
        planLearningPreflight(task, [{ ...active,
            application: { ...active.application, approval_ref: null } }]).status === 'PENDING_REVIEW');
    check('pending reflection cannot masquerade as approved advice',
        planLearningPreflight(task, [{ ...active,
            reflection: { ...active.reflection, validation_state: 'pending' } }]).status === 'PENDING_REVIEW');
    check('unexposed tool explicitly returns UNAVAILABLE, never success',
        planLearningPreflight({ ...task, available_tools: ['generic.github_edit'] }, [active])
            .status === 'UNAVAILABLE');
    const aliased = planLearningPreflight({ ...task,
        available_tools: ['mcp__codex_apps__ziven_mcp_github_edit'] }, [active]);
    check('ChatGPT tool alias resolves to the actual exposed name, not a fake tool',
        aliased.status === 'READY' &&
        aliased.recommended_tool === 'mcp__codex_apps__ziven_mcp_github_edit' &&
        aliased.canonical_tool === 'ziven_mcp.github_edit');
    check('main is outside v0.3 advice scope regardless of lesson claim',
        planLearningPreflight({ ...task, branch: 'main' }, [active]).status === 'BLOCKED');
    check('other repositories cannot inherit Ziven-only tool guidance',
        planLearningPreflight({ ...task, repo: 'another-owner/repo' }, [active]).reason
            === 'repo_not_allowed');
    check('irrelevant intent does not trigger the GitHub lesson',
        planLearningPreflight({ ...task, intent: '查看天气' }, [active]).status === 'NO_MATCH');
    check('irrelevant entity does not trigger the GitHub lesson',
        planLearningPreflight({ ...task, entities: ['Cloudflare'] }, [active]).status === 'NO_MATCH');
    check('revoked rule is not revived by a stale trigger',
        planLearningPreflight(task, [{ ...active, status: 'revoked' }]).status === 'NO_MATCH');
    check('conflicting matching active rules block ambiguous advice',
        planLearningPreflight(task, [active, structuredClone(active)]).status === 'CONFLICT');
    check('invalid caller contract cannot trigger a tool',
        planLearningPreflight({ intent: 'GitHub 403' }, [active]).status === 'INVALID');

    const baseline = { task_fingerprint: 'synthetic:edit-dev-file',
        capability_fingerprint: 'synthetic:both-connectors-exposed',
        success: false, error_recurred: true, evidence_refs: ['synthetic:before'] };
    const after = { ...baseline, success: true, error_recurred: false,
        evidence_refs: ['synthetic:after'] };
    const pair = { scenario_id: 'synthetic-GitHub-route', baseline, after };
    check('paired improvement explicitly remains caller-supplied, not E3',
        compareLearningTrials(pair).status === 'IMPROVED' &&
        compareLearningTrials(pair).host_verified === false);
    check('negative control detects regressions',
        compareLearningTrials({ ...pair, baseline: after, after: baseline }).status === 'REGRESSED');
    check('same outcome cannot be marketed as improvement',
        compareLearningTrials({ ...pair, baseline: after, after: { ...after } }).status === 'UNCHANGED');
    check('different tool capabilities invalidate before/after comparison',
        compareLearningTrials({ ...pair, after: { ...after,
            capability_fingerprint: 'synthetic:other-tools' } }).status === 'INVALID');
    check('missing actual outcome refs is unverified, not a pass',
        compareLearningTrials({ ...pair, after: { ...after, evidence_refs: [] } })
            .status === 'NOT_VERIFIED');

    const preflightCli = spawnSync(process.execPath, [
        'scripts/reflection_preview.mjs', '--preflight', JSON.stringify(task),
        'tests/learning/learning_github_tool_route_001.json'
    ], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' });
    const preflightOutput = preflightCli.status === 0 ? JSON.parse(preflightCli.stdout) : null;
    check('read-only CLI exposes the preflight gate for actual candidate',
        preflightCli.status === 0 && preflightOutput.read_only === true &&
        preflightOutput.writes_executed === false &&
        preflightOutput.preflight.status === 'PENDING_REVIEW');

    const cli = spawnSync(process.execPath, ['scripts/reflection_preview.mjs',
        'tests/learning/learning_reflection_candidate_001.json'], {
        cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8'
    });
    const result = cli.status === 0 ? JSON.parse(cli.stdout) : null;
    check('CLI can read a candidate and return an inert preview', cli.status === 0
        && result?.read_only === true && result.writes_executed === false
        && result.reports[0].proposal.status === 'blocked'
        && result.reports[0].decision.state === 'pending');
    console.log('\nPASS: L3 Reflection contracts ' + passed + '/' + passed);
} finally {
    globalThis.fetch = savedFetch;
}
