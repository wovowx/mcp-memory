#!/usr/bin/env node
// L3 v0.1: local, read-only Reflection candidate preview.
// Usage: npm run reflection:preview -- tests/learning/learning_reflection_candidate_001.json
// Never sends network requests or writes Memory/Skill/Workflow.
import { readFile } from 'node:fs/promises';
import { evaluateReflectionCandidates } from '../src/modules/reflection.js';

const paths = process.argv.slice(2);
if (!paths.length) {
    console.error('Usage: node scripts/reflection_preview.mjs <learning-artifact.json> [...]');
    process.exitCode = 2;
} else {
    try {
        const input = [];
        for (const path of paths) {
            const parsed = JSON.parse(await readFile(path, 'utf8'));
            if (Array.isArray(parsed)) input.push(...parsed);
            else input.push(parsed);
        }
        const reports = evaluateReflectionCandidates(input);
        console.log(JSON.stringify({ contract_version: 'REFLECTION-0.1', read_only: true,
            writes_executed: false, reports }, null, 2));
        if (reports.some(row => !row.validation.ok || row.proposal.reason === 'duplicate_candidate_id')) {
            process.exitCode = 1;
        }
    } catch (error) {
        console.error('REFLECTION_PREVIEW_ERROR: ' + error.message);
        process.exitCode = 1;
    }
}
