#!/usr/bin/env node
// Lightweight documentation gate (no dependencies, no network).
// Fails when a change touches feature-defining files but does not also touch docs/PROJECT_FEATURE_STATUS.md.
//   node scripts/check-feature-status.mjs --staged            # pre-commit: staged changes
//   node scripts/check-feature-status.mjs --base origin/main  # CI / review: everything since the base ref
//   FEATURE_STATUS_SKIP=1 ...                                 # explicit, visible bypass (e.g. pure refactor)
// This only proves the report file was touched, NOT that its content is correct; reviewers must still read the diff.
import { execFileSync } from 'node:child_process';

const REPORT = 'docs/PROJECT_FEATURE_STATUS.md';
const TRIGGERS = [
  /\.controller\.ts$/, /\.module\.ts$/, /(^|\/)app\.module\.ts$/, /permissions\.(guard|decorator)\.ts$/, /roles\.(guard|decorator)\.ts$/,
  /^database\/(schema\.prisma|schema\.sql|.*\.sql)$/, /^database\/proposals\/migrations\//, /^apps\/api\/prisma\/migrations\//,
  /\.spec\.ts$/, /^\.env\.example$/, /^apps\/web\/src\/app\/.*page\.tsx$/, /^apps\/api\/src\/modules\/.*\.service\.ts$/,
  /^docker-compose\.yml$/, /Dockerfile$/,
];

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean);
const args = process.argv.slice(2);
const baseIdx = args.indexOf('--base');
let changed;
if (args.includes('--staged')) changed = git('diff', '--cached', '--name-only');
else if (baseIdx >= 0) changed = git('diff', '--name-only', `${args[baseIdx + 1]}...HEAD`);
else changed = git('diff', '--name-only', 'HEAD');

if (process.env.FEATURE_STATUS_SKIP === '1') { console.log('feature-status check SKIPPED (FEATURE_STATUS_SKIP=1)'); process.exit(0); }
const triggered = changed.filter((f) => TRIGGERS.some((re) => re.test(f)));
if (!triggered.length || changed.includes(REPORT)) { console.log(`feature-status check OK (${triggered.length} feature file(s) changed, report ${changed.includes(REPORT) ? 'updated' : 'not required'})`); process.exit(0); }
console.error(`\nFEATURE STATUS REPORT NOT UPDATED\n${REPORT} must change in the same change as:\n  - ${triggered.slice(0, 15).join('\n  - ')}${triggered.length > 15 ? `\n  ... and ${triggered.length - 15} more` : ''}\nUpdate statuses only with evidence, record the verification date, keep unresolved risks. See AGENTS.md.\n`);
process.exit(1);
