// L3 Reflection v0.1 synthetic-only contracts — no business DB, network or MCP calls.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    validateCandidate, decideCandidate, previewPromotion, evaluateReflectionCandidates,
    evaluateBehaviorObservation
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
        toolRouteFixture.scenarios.length === 5 &&
        previewPromotion(toolRouteFixture).status === 'blocked');
    check('loaded guide spells out actual Ziven MCP route, dry run and readback',
        guide.includes('跨宿主选工具防复发') && guide.includes('github_edit') &&
        guide.includes('dry_run=true') && guide.includes('github_read'));
    check('master router triggers the host-aware connector 403 lesson',
        router.includes('跨宿主修改 Ziven GitHub 已有文件') &&
        router.includes('403') && router.includes('先验当前宿主'));

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
    check('behavior comparison cannot turn caller-reported evidence into E3',
        trial('T1', { tool: 'ziven_mcp.github_edit' },
            { tool: 'ziven_mcp.github_edit' }).host_verified === false);

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
