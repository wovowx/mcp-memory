#!/usr/bin/env node
// L5 v0.1: fixed synthetic example only. No user memory, network or write path.
import { readFile } from 'node:fs/promises';
import { buildMemoryLayerReport, explainMemoryLayerRow } from '../src/modules/memory/layer_mapper.js';

const fixture = JSON.parse(await readFile(
    new URL('../tests/fixtures/memory_layer_mapper_synthetic.json', import.meta.url), 'utf8'
));
const report = buildMemoryLayerReport(fixture);
const explanations = report.memory_rows.map(explainMemoryLayerRow);
console.log(JSON.stringify({ fixture_id: fixture.fixture_id, synthetic_only: true, ...report, explanations }, null, 2));
