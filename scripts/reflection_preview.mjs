#!/usr/bin/env node
// L3 v0.3: local, read-only Reflection candidate and lesson preflight preview.
// Usage: npm run reflection:preview -- tests/learning/learning_reflection_candidate_001.json
// Or: node scripts/reflection_preview.mjs --preflight '{"intent":"...","entities":[],"available_tools":[],"repo":"owner/repo","branch":"dev"}' <artifact.json>
// Never sends network requests or writes Memory/Skill/Workflow.
import { readFile } from 'node:fs/promises';
import { evaluateReflectionCandidates, planLearningPreflight } from '../src/modules/reflection.js';

const args = process.argv.slice(2);
const preflightMode = args[0] === '--preflight';
const paths = preflightMode ? args.slice(2) : args;
if (!paths.length) {
    console.error('Usage: node scripts/reflection_preview.mjs [--preflight <task-json>] <learning-artifact.json> [...]');
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
        const preflight = preflightMode ? planLearningPreflight(JSON.parse(args[1]), input) : undefined;
        console.log(JSON.stringify({ contract_version: 'REFLECTION-0.3', read_only: true,
            writes_executed: false, reports, ...(preflight ? { preflight } : {}) }, null, 2));
        if (reports.some(row => !row.validation.ok || row.proposal.reason === 'duplicate_candidate_id')) {
            process.exitCode = 1;
        }
    } catch (error) {
        console.error('REFLECTION_PREVIEW_ERROR: ' + error.message);
        process.exitCode = 1;
    }
}
