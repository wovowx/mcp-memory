// Deterministic synthetic-only benchmark for searchMemories; no Supabase or search-history writes.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { searchMemories } from '../src/modules/memory/retrieval.js';

const fixtureUrl = new URL('./fixtures/memory_retrieval_benchmark_v0_1.json', import.meta.url);
const fixtureText = await readFile(fixtureUrl, 'utf8');
const fixture = JSON.parse(fixtureText);
const fixtureBlobSha = createHash('sha1').update('blob ' + Buffer.byteLength(fixtureText) + '\0' + fixtureText).digest('hex');
const baseline = JSON.parse(await readFile(new URL('./fixtures/memory_retrieval_benchmark_v0_1.baseline.json', import.meta.url), 'utf8'));
const env = { SUPABASE_URL: 'https://memory-retrieval-benchmark.invalid', SUPABASE_ANON_KEY: 'synthetic-benchmark-key' };
const associationReasons = new Set(['related_memory', 'shared_entity']);
const originalFetch = globalThis.fetch;
const requests = [];
const failures = [];
const reports = [];
const expect = (ok, message) => { if (!ok) failures.push(message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ids = rows => rows.map(row => row.id);
const isAssociation = row => associationReasons.has(row?._match?.reason);
const staleIds = new Set(fixture.memories.filter(row => row.status !== 'active' || row.valid_to != null).map(row => row.id));
const bigrams = value => {
  const chars = Array.from(String(value || '').toLocaleLowerCase());
  return new Set(chars.slice(0, -1).map((char, index) => char + chars[index + 1]));
};

function checkAssociationMetadata(query, rows) {
  const expected = new Map((query.expected_association_metadata || []).map(item => [item.memory_id, item]));
  for (const row of rows) {
    const target = expected.get(row.id);
    if (!target) { expect(false, query.id + ': unexpected association provenance for ' + row.id); continue; }
    expect(row._match?.reason === target.reason, query.id + ': ' + row.id + ' reason mismatch');
    expect(row._match?.related_from_key === target.related_from_key, query.id + ': ' + row.id + ' source key mismatch');
    expect(same(row._match?.matched_terms || [], target.matched_terms || []), query.id + ': ' + row.id + ' matched terms mismatch');
  }
}

function calculateMetrics() {
  const direct = reports.filter(row => row.roles.includes('direct'));
  const positive = direct.filter(row => row.expectedDirect.length);
  const relevantTotal = positive.reduce((sum, row) => sum + row.expectedDirect.length, 0);
  const recall = k => {
    const found = positive.reduce((sum, row) => {
      const relevant = new Set(row.expectedDirect);
      return sum + row.direct.slice(0, k).filter(id => relevant.has(id)).length;
    }, 0);
    return relevantTotal ? found / relevantTotal : null;
  };
  const reciprocal = positive.map(row => {
    const rank = row.direct.findIndex(id => row.expectedDirect.includes(id));
    return rank < 0 ? 0 : 1 / (rank + 1);
  });
  const precisionRows = direct.flatMap(row => row.direct.slice(0, 3).map(id => ({
    relevant: row.expectedDirect.includes(id)
  })));
  const negative = reports.filter(row => row.roles.includes('negative'));
  const stale = reports.filter(row => row.roles.includes('stale'));
  const association = reports.filter(row => row.roles.includes('association'));
  const associationTotal = association.reduce((sum, row) => sum + row.expectedAssociation.length, 0);
  const associationFound = association.reduce((sum, row) => {
    const found = new Set(row.associations.slice(0, 3));
    return sum + row.expectedAssociation.filter(id => found.has(id)).length;
  }, 0);
  let provenanceCorrect = 0;
  let provenanceTotal = 0;
  for (const report of association) {
    for (const actual of report.associationRows) {
      provenanceTotal++;
      const expected = report.expectedMetadata.find(item => item.memory_id === actual.id);
      if (expected && actual.reason === expected.reason &&
          actual.related_from_key === expected.related_from_key &&
          same(actual.matched_terms || [], expected.matched_terms || [])) provenanceCorrect++;
    }
  }
  return {
    direct: {
      recall_at_1: recall(1),
      recall_at_3: recall(3),
      mrr_macro: reciprocal.length ? reciprocal.reduce((a, b) => a + b, 0) / reciprocal.length : null,
      precision_at_3: precisionRows.length ? precisionRows.filter(row => row.relevant).length / precisionRows.length : null,
      positive_query_count: positive.length,
      expected_direct_count: relevantTotal,
      precision_candidate_count: precisionRows.length
    },
    negative_false_hit_rate: negative.length ? negative.filter(row => row.direct.length).length / negative.length : null,
    stale_hit_rate: stale.length ? stale.filter(row => row.forbidden.length).length / stale.length : null,
    association: {
      recall_at_3: associationTotal ? associationFound / associationTotal : null,
      provenance_accuracy: provenanceTotal ? provenanceCorrect / provenanceTotal : null,
      expected_association_count: associationTotal,
      actual_association_count: provenanceTotal
    }
  };
}

try {
  expect(fixture.memories.length === 16, 'fixture must contain exactly 16 memories');
  expect(fixture.queries.length === 16, 'fixture must contain exactly 16 queries');
  for (const probe of fixture.fallback_probes || []) {
    const query = fixture.queries.find(row => row.id === probe.query_id);
    const memory = fixture.memories.find(row => row.id === probe.memory_id);
    const grams = bigrams(query?.query);
    const combined = (String(memory?.key || '') + ' ' + String(memory?.value || '')).toLocaleLowerCase();
    const matched = [...grams].filter(gram => combined.includes(gram));
    expect(grams.size === probe.expected_query_bigram_count, probe.query_id + ': bigram count drifted');
    expect(matched.length === probe.expected_matched_bigram_count, probe.query_id + ': overlap count drifted');
  }

  globalThis.fetch = async (input, options = {}) => {
    const requestMethod = input && typeof input === 'object' && 'method' in input ? input.method : undefined;
    const requestUrl = input && typeof input === 'object' && 'url' in input ? input.url : input;
    const method = String(options.method || requestMethod || 'GET').toUpperCase();
    const url = new URL(String(requestUrl));
    requests.push({ method, pathname: url.pathname });
    if (method !== 'GET') throw new Error('benchmark blocked non-GET request: ' + method);
    if (url.origin !== env.SUPABASE_URL) throw new Error('benchmark blocked external origin: ' + url.origin);
    if (url.pathname === '/rest/v1/memories') {
      expect(url.searchParams.get('select') === '*', 'memories select must be *');
      expect(url.searchParams.get('status') === 'eq.active', 'memories request must filter active rows');
      expect(url.searchParams.get('valid_to') === 'is.null', 'memories request must filter current rows');
      // Return stale rows deliberately: repository's local isCurrentMemory filter must reject them.
      return { ok: true, status: 200, json: async () => fixture.memories };
    }
    if (url.pathname === '/rest/v1/memory_aliases') {
      expect(url.searchParams.get('select') === 'memory_id', 'alias request must select memory_id only');
      const filter = url.searchParams.get('alias') || '';
      if (!filter.startsWith('ilike.%') || !filter.endsWith('%')) throw new Error('unexpected alias filter: ' + filter);
      const needle = filter.slice('ilike.%'.length, -1).toLocaleLowerCase();
      const rows = fixture.aliases.filter(item => item.alias.toLocaleLowerCase().includes(needle))
        .map(item => ({ memory_id: item.memory_id }));
      return { ok: true, status: 200, json: async () => rows };
    }
    throw new Error('benchmark blocked unexpected path: ' + url.pathname);
  };

  for (const query of fixture.queries) {
    const start = requests.length;
    const results = await searchMemories(env, query.query);
    const direct = results.filter(row => !isAssociation(row));
    const associated = results.filter(isAssociation);
    const directIds = ids(direct);
    const associationIds = ids(associated);
    const allIds = ids(results);
    const forbidden = allIds.filter(id => (query.forbidden_ids || []).includes(id));
    const expectedDirectOrder = query.expected_direct_order || query.expected_direct_ids || [];
    const metricScoped = (query.metric_roles || []).some(role => role !== 'structure');
    expect(query.metric_scope === metricScoped, query.id + ': metric_scope does not match metric_roles');
    for (const id of query.known_nonrelevant_ids || []) {
      expect(directIds.includes(id), query.id + ': known non-relevant decoy missing: ' + id);
      expect(!(query.expected_direct_ids || []).includes(id), query.id + ': decoy incorrectly marked relevant: ' + id);
    }
    expect(!allIds.some(id => staleIds.has(id)), query.id + ': an expired/deleted fixture memory was returned');
    expect(same(directIds, expectedDirectOrder), query.id + ': direct IDs mismatch; got ' + JSON.stringify(directIds));
    expect(same(associationIds, query.expected_association_ids || []), query.id + ': association IDs mismatch; got ' + JSON.stringify(associationIds));
    expect(forbidden.length === 0, query.id + ': forbidden IDs returned: ' + forbidden.join(','));
    expect(new Set(allIds).size === allIds.length, query.id + ': duplicate result IDs');
    expect(associated.length <= 3, query.id + ': association cap exceeded');
    const firstAssociation = results.findIndex(isAssociation);
    expect(firstAssociation < 0 || results.slice(firstAssociation).every(isAssociation), query.id + ': direct result after association');
    expect(direct.length > 0 || associated.length === 0, query.id + ': association without direct hit');
    for (const [id, reason] of Object.entries(query.expected_reasons || {})) {
      expect(results.find(row => row.id === id)?._match?.reason === reason, query.id + ': reason mismatch for ' + id);
    }
    for (const [id, count] of Object.entries(query.expected_matched_terms_count || {})) {
      expect((results.find(row => row.id === id)?._match?.matched_terms || []).length === count, query.id + ': matched_terms count mismatch for ' + id);
    }
    checkAssociationMetadata(query, associated);
    expect(requests.length - start === 2, query.id + ': expected two GET requests');
    reports.push({
      id: query.id,
      roles: query.metric_roles || [],
      expectedDirect: query.expected_direct_ids || [],
      expectedAssociation: query.expected_association_ids || [],
      expectedMetadata: query.expected_association_metadata || [],
      direct: directIds,
      associations: associationIds,
      associationRows: associated.map(row => ({
        id: row.id,
        reason: row._match?.reason,
        related_from_key: row._match?.related_from_key,
        matched_terms: row._match?.matched_terms || []
      })),
      forbidden
    });
  }

  expect(requests.length === fixture.queries.length * 2, 'expected exactly 32 requests');
  expect(requests.every(row => row.method === 'GET'), 'all requests must be GET');
  expect(requests.every(row => ['/rest/v1/memories', '/rest/v1/memory_aliases'].includes(row.pathname)), 'request path allowlist violated');

  const metrics = calculateMetrics();
  expect(baseline.schema_version === 1, 'baseline schema version mismatch');
  expect(baseline.benchmark === 'memory-retrieval-v0.1', 'baseline benchmark id mismatch');
  expect(baseline.fixture_version === fixture.version, 'baseline fixture version mismatch');
  expect(baseline.fixture_blob_sha === fixtureBlobSha, 'fixture changed since the frozen baseline; review and explicitly re-freeze it');
  expect(baseline.request_count === requests.length, 'baseline request count mismatch');

  const higherIsBetter = [
    ['direct.recall_at_1', baseline.metrics?.direct?.recall_at_1, metrics.direct.recall_at_1],
    ['direct.recall_at_3', baseline.metrics?.direct?.recall_at_3, metrics.direct.recall_at_3],
    ['direct.mrr_macro', baseline.metrics?.direct?.mrr_macro, metrics.direct.mrr_macro],
    ['direct.precision_at_3', baseline.metrics?.direct?.precision_at_3, metrics.direct.precision_at_3],
    ['association.recall_at_3', baseline.metrics?.association?.recall_at_3, metrics.association.recall_at_3],
    ['association.provenance_accuracy', baseline.metrics?.association?.provenance_accuracy, metrics.association.provenance_accuracy]
  ];
  const lowerIsBetter = [
    ['negative_false_hit_rate', baseline.metrics?.negative_false_hit_rate, metrics.negative_false_hit_rate],
    ['stale_hit_rate', baseline.metrics?.stale_hit_rate, metrics.stale_hit_rate]
  ];
  for (const [name, previous, current] of higherIsBetter) {
    expect(Number.isFinite(previous) && Number.isFinite(current), 'baseline metric must be numeric: ' + name);
    if (Number.isFinite(previous) && Number.isFinite(current)) {
      expect(current + 1e-12 >= previous, name + ' regressed: ' + previous + ' -> ' + current);
    }
  }
  for (const [name, previous, current] of lowerIsBetter) {
    expect(Number.isFinite(previous) && Number.isFinite(current), 'baseline metric must be numeric: ' + name);
    if (Number.isFinite(previous) && Number.isFinite(current)) {
      expect(current <= previous + 1e-12, name + ' regressed: ' + previous + ' -> ' + current);
    }
  }
  expect(metrics.direct.positive_query_count === baseline.metrics.direct.positive_query_count, 'positive query count changed');
  expect(metrics.direct.expected_direct_count === baseline.metrics.direct.expected_direct_count, 'expected direct target count changed');
  expect(metrics.direct.precision_candidate_count === baseline.metrics.direct.precision_candidate_count, 'precision candidate count changed');
  expect(metrics.association.expected_association_count === baseline.metrics.association.expected_association_count, 'expected association count changed');
  expect(metrics.association.actual_association_count === baseline.metrics.association.actual_association_count, 'actual association count changed');

  const report = {
    benchmark: 'memory-retrieval-v0.1',
    fixture_version: fixture.version,
    synthetic_only: true,
    request_count: requests.length,
    frozen_baseline: { measured_commit: baseline.measured_commit, workflow_run_id: baseline.workflow_run_id, fixture_blob_sha: baseline.fixture_blob_sha },
    metrics,
    queries: reports.map(row => ({ id: row.id, direct_ids: row.direct, association_ids: row.associations, forbidden_hits: row.forbidden }))
  };
  console.log('\n[memory-retrieval-benchmark] Metrics compared with frozen baseline (read-only):');
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) {
    console.error('\n[memory-retrieval-benchmark] FAILED: ' + failures.length + ' failure(s)');
    for (const failure of failures) console.error(' - ' + failure);
    process.exitCode = 1;
  } else {
    console.log('\n[memory-retrieval-benchmark] PASS: 16 queries, GET-only/provenance contracts and frozen-baseline non-regression passed.');
  }
} finally {
  globalThis.fetch = originalFetch;
}
