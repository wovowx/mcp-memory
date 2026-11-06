// L5 v0.1: isolated synthetic-only mapping and no-write contracts.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import {
    BOOTSTRAP_CORE_KEYS, mapMemoryMetadata, mapReflectionMetadata, buildMemoryLayerReport
} from '../src/modules/memory/layer_mapper.js';
import { BOOTSTRAP_KEYS } from '../src/modules/session/bootstrap.js';

const fixture = JSON.parse(await readFile(
    new URL('./fixtures/memory_layer_mapper_synthetic.json', import.meta.url), 'utf8'
));
const snapshot = structuredClone(fixture);
const previousFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = () => { networkCalls++; throw new Error('network_forbidden_in_L5'); };
let passed = 0;
function check(name, condition) {
    assert.ok(condition, name);
    passed++;
    console.log('  ✅ ' + name);
}

try {
    console.log('\n[L5 synthetic-only memory layer mapping contracts]');
    const report = buildMemoryLayerReport(fixture);
    const byId = id => report.memory_rows.find(row => row.record_id === id);
    check('five exact bootstrap keys only', BOOTSTRAP_CORE_KEYS.length === 5
        && new Set(BOOTSTRAP_CORE_KEYS).size === 5
        && JSON.stringify(BOOTSTRAP_CORE_KEYS) === JSON.stringify(Object.values(BOOTSTRAP_KEYS)));
    check('Core requires exact key, current validity and explicit readable-body evidence',
        byId('synthetic-core-001').suggested_views.join(',') === 'Core,Long-term');
    check('unread Core is UNCERTAIN, never silently included',
        byId('synthetic-core-unverified-006').core_inclusion === 'UNCERTAIN'
        && !byId('synthetic-core-unverified-006').suggested_views.includes('Core'));
    check('agreement does not auto-promote into Core',
        byId('synthetic-rule-002').suggested_views.join(',') === 'Long-term'
        && byId('synthetic-rule-002').uncertainties.includes('agreement_confirmation_source_unverified'));
    check('category 📦 is not automatically Archive',
        byId('synthetic-box-003').suggested_views.join(',') === 'Long-term');
    check('non-current record maps to Archive only',
        byId('synthetic-old-004').suggested_views.join(',') === 'Archive');
    check('uncertain type and provenance are preserved as gaps',
        byId('synthetic-unknown-005').uncertainties.includes('type_missing')
        && byId('synthetic-unknown-005').uncertainties.includes('provenance_missing'));
    check('status/valid_to conflict is quarantined',
        byId('synthetic-conflict-008').suggested_views.join(',') === 'UNCLASSIFIED'
        && byId('synthetic-conflict-008').uncertainties.includes('active_status_with_valid_to'));
    check('same key only flags possible duplicates, never merges records',
        report.memory_rows.length === fixture.records.length
        && report.possible_duplicate_keys.length === 1
        && report.possible_duplicate_keys[0] === '⚙️/示例规则'
        && byId('synthetic-rule-002').uncertainties.includes('possible_duplicate_key'));
    check('Reflection candidates are separate, not inferred from memory type',
        report.reflection_candidates.length === 2
        && report.reflection_candidates[0].suggested_views[0] === 'Reflection'
        && report.memory_rows.every(row => !row.suggested_views.includes('Reflection')));
    check('invalid Reflection state/source never becomes a learning fact',
        report.reflection_candidates[1].suggested_views[0] === 'UNCLASSIFIED'
        && report.reflection_candidates[1].approval_required);
    check('only input metadata are exposed, never invented references',
        byId('synthetic-core-001').evidence_refs[0] === 'synthetic:input-row-1'
        && byId('synthetic-unknown-005').evidence_refs.length === 0);
    check('status active without valid_to is not assumed current',
        mapMemoryMetadata({ id: 's', key: '⚙️/x', status: 'active' })
            .suggested_views.join(',') === 'UNCLASSIFIED');
    check('deleted record with null valid_to is still historical',
        mapMemoryMetadata({ id: 's', key: '⚙️/x', status: 'deleted', valid_to: null })
            .suggested_views.join(',') === 'Archive');
    check('a missing/invalid record is explicit and never a false empty inventory',
        mapMemoryMetadata(null).suggested_views[0] === 'UNCLASSIFIED'
        && mapMemoryMetadata(null).uncertainties.includes('invalid_record_shape'));
    check('invalid top-level arrays are rejected', (() => {
        try { buildMemoryLayerReport({ records: null }); return false; }
        catch (e) { return e.message === 'records_and_reflection_candidates_must_be_arrays'; }
    })());
    check('no database-wide coverage claim or automatic writes',
        report.inventory_scope === 'provided_metadata_only'
        && report.full_database_coverage_verified === false
        && report.read_only && report.writes_executed === false
        && report.memory_rows.every(row => row.recommendation === 'review_only' && !row.writes_executed));
    check('deterministic report and immutable inputs',
        JSON.stringify(report) === JSON.stringify(buildMemoryLayerReport(fixture))
        && JSON.stringify(fixture) === JSON.stringify(snapshot));
    check('no network calls', networkCalls === 0);
    check('empty supplied inventory remains an input-scoped EMPTY, not total DB zero',
        buildMemoryLayerReport().summary.provided_memory_rows === 0
        && buildMemoryLayerReport().full_database_coverage_verified === false);
    check('Reflection invalid shape gives review-only uncertainty',
        mapReflectionMetadata(null).suggested_views[0] === 'UNCLASSIFIED'
        && mapReflectionMetadata(null).writes_executed === false);

    const preview = spawnSync(process.execPath, ['scripts/memory_layer_preview.mjs'], {
        cwd: new URL('..', import.meta.url), encoding: 'utf8'
    });
    const result = preview.status === 0 ? JSON.parse(preview.stdout) : null;
    check('CLI preview accepts fixed synthetic fixture and never writes',
        result?.synthetic_only === true && result?.fixture_id === fixture.fixture_id
        && result?.writes_executed === false
        && result?.memory_rows?.length === fixture.records.length);
    console.log(`✅ L5 synthetic mapping contracts: ${passed} passed, 0 failed`);
} finally {
    globalThis.fetch = previousFetch;
}
