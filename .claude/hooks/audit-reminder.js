// SessionStart hook: counts new sessions since the last audit and, from the
// 6th one, reminds Roman (and Claude) to run /audit. The /audit skill resets
// the counter with: node .claude/hooks/audit-reminder.js --reset
//
// The counter lives in .claude/audit-state.json (git-ignored, this Mac only).

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const EVERY = 6;
const file = path.join(__dirname, '..', 'audit-state.json');
const root = path.join(__dirname, '..', '..');

let state = { sessions: 0, lastAudit: null };
try { state = { ...state, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}

if (process.argv.includes('--reset')) {
  state = { sessions: 0, lastAudit: new Date().toLocaleDateString('sv') };
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
  console.log(`Audit counter reset (${state.lastAudit}).`);
  process.exit(0);
}

state.sessions += 1;
fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n');

if (state.sessions < EVERY) process.exit(0);

let commits = '';
try {
  const since = state.lastAudit ? `--since="${state.lastAudit}"` : '-20';
  const n = execSync(`git log --oneline ${since}`, { cwd: root }).toString().trim().split('\n').filter(Boolean).length;
  commits = `, ${n} commits`;
} catch {}

const when = state.lastAudit ? `since the audit on ${state.lastAudit}` : 'since the last audit';
const msg = `${state.sessions} sessions${commits} ${when}. Time for a cleanup: type /audit.`;

console.log(JSON.stringify({
  systemMessage: msg,
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: `Audit reminder: ${msg} Mention this to Roman in one line at the start of your first reply (in Russian), then carry on with his request. Don't start the audit unless he asks.`
  }
}));
