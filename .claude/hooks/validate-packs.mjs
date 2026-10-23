#!/usr/bin/env node
/*
 * PostToolUse hook: after an edit to packs/**, showcase.json or blocked.json, run tools/validate.mjs on the whole repository.
 * Exit code 2 feeds the errors back to Claude so it can fix them; warnings alone are shown too but say they don't block.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

let input = '';

for await (const chunk of process.stdin)
    input += chunk;

const filePath = (JSON.parse(input || '{}').tool_input?.file_path ?? '').replace(/\\/g, '/');

if (!/(^|\/)(packs\/.+|showcase\.json|blocked\.json)$/.test(filePath))
    process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const run        = spawnSync(process.execPath, [join(projectDir, 'tools', 'validate.mjs'), projectDir], { encoding: 'utf8' });
const output     = (run.stdout + run.stderr).split('\n').filter(line => /ERROR|warning|error\(s\)/.test(line)).join('\n').trim();

if (run.status !== 0) {
    console.error(`tools/validate.mjs failed:\n${ output }`);
    process.exit(2);
}

if (/warning /.test(output)) {
    console.error(`tools/validate.mjs warnings (not blocking):\n${ output }`);
    process.exit(2);
}
