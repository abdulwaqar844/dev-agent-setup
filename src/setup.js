import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const CLAUDE_PERMISSIONS = {
  defaultMode: 'default',
  allow: ['Read', 'Glob', 'Grep', 'Bash(git status)', 'Bash(git diff *)', 'Bash(git log *)', 'Bash(npm run lint)', 'Bash(npm test)', 'Bash(npm run test *)'],
  ask: ['Bash(git push *)', 'Bash(npm install *)', 'Bash(npm ci *)', 'Bash(npm publish *)', 'Bash(git reset *)', 'Bash(git clean *)'],
  deny: ['Read(./.env)', 'Read(./.env.*)', 'Read(./**/.env)', 'Read(./**/.env.*)', 'Read(./**/id_rsa)', 'Read(./**/id_ed25519)', 'Bash(git push --force *)', 'Bash(rm -rf /*)']
};

const CODEX_TOML_KEYS = { approval_policy: '"on-request"', sandbox_mode: '"workspace-write"' };
const CODEX_SANDBOX_TABLE = '[sandbox_workspace_write]\nnetwork_access = false\n';
const CODEX_RULES = `# dev-agent-setup balanced preset. Project rules only load after trust approval.\n# Command prefix rules are token-based, not a full shell security policy.\nprefix_rule(pattern=["git", "status"], decision="allow")\nprefix_rule(pattern=["git", "diff"], decision="allow")\nprefix_rule(pattern=["git", "log"], decision="allow")\nprefix_rule(pattern=["git", "push"], decision="prompt", justification="Review remote changes before pushing")\nprefix_rule(pattern=["npm", "install"], decision="prompt", justification="Installing dependencies may execute lifecycle scripts")\nprefix_rule(pattern=["npm", "publish"], decision="prompt", justification="Publishing releases a public package")\nprefix_rule(pattern=["git", "reset", "--hard"], decision="forbidden", justification="Destructive reset is blocked")\nprefix_rule(pattern=["git", "clean", "-fd"], decision="forbidden", justification="Destructive clean is blocked")\n`;
const NOTES = `## Agent working agreement (dev-agent-setup)
- Examine existing code and tests before modifying files.
- Prefer minimal, reviewable changes; run tests and lint where available.
- Do not read or disclose .env files, credentials, tokens, private keys, or secrets.
- Request explicit approval before installing packages, publishing, pushing, changing infrastructure, or performing destructive operations.
- Never silently run destructive git operations or bypass sandbox/approval controls.
- Describe important changes and verification performed.
`;
const START = '<!-- dev-agent-setup:begin -->';
const END = '<!-- dev-agent-setup:end -->';
const MARKED_NOTES = `${START}\n${NOTES}${END}\n`;
const DEFAULT_GUIDELINES = `# AGENTS.md

## Setup commands
- Install deps: \`pnpm install\`
- Start dev server: \`pnpm dev\`
- Run tests: \`pnpm test\`

## Code style
- TypeScript strict mode
- Single quotes, no semicolons
- Use functional patterns where possible
`;
const DEFAULT_AGENTS = `${DEFAULT_GUIDELINES}\n${MARKED_NOTES}`;
const REACT_GUIDELINES = [
  "# Repository Guidelines",
  "",
  "## Project Structure & Module Organization",
  "",
  "This repository is a Vite-powered React dashboard built with Material UI. Application code lives in `src/`: route-level screens are in `src/pages`, reusable UI in `src/components`, feature compositions in `src/sections`, layouts in `src/layouts`, Redux state in `src/redux`, and shared helpers in `src/hooks` and `src/utils`. Theme configuration is under `src/theme`, authentication providers and guards are in `src/auth`, and translations live in `src/locales`. Static files served unchanged belong in `public/`; imported data and graphics belong in `src/assets`. Production output is generated in `dist/` and should not be committed.",
  "",
  "## Build, Test, and Development Commands",
  "",
  "- `npm install` installs the locked dependencies. Use Node 24 (`.nvmrc`) and npm 11.",
  "- `npm run dev` starts the Vite development server; `npm start` is an alias.",
  "- `npm run build` creates the production bundle in `dist/`.",
  "- `npm run preview` serves the built bundle for local verification.",
  "- `npm run lint` checks all JavaScript and JSX with ESLint.",
  "- `npm run lint:fix` applies safe lint fixes; `npm run prettier` formats `src/**/*.{js,jsx}`.",
  "",
  "## Coding Style & Naming Conventions",
  "",
  "Use ES modules, functional React components, and 2-space indentation. Prettier enforces single quotes, trailing ES5 commas, and a 100-character line width. ESLint extends Airbnb, React Hooks, and Prettier rules. Name components and page files in PascalCase (`ProductDetailsSummary.jsx`), hooks with a `use` prefix (`useResponsive.js`), and utility modules in camelCase. Keep feature-specific code near its page or section; promote code to `src/components` only when it is genuinely reusable.",
  "",
  "## Testing Guidelines",
  "",
  "No automated test runner or coverage threshold is currently configured. For every change, run `npm run lint` and `npm run build`, then exercise affected routes with `npm run dev`. When introducing tests, colocate them with the implementation using `*.test.js` or `*.test.jsx`, and add the runner command to `package.json` and this guide.",
  "",
  "## Commit & Pull Request Guidelines",
  "",
  "Recent history primarily follows Conventional Commit-style subjects such as `chore: update dependencies`; use concise, imperative subjects with an appropriate prefix (`feat:`, `fix:`, `chore:`, or `refactor:`). Keep commits focused. Pull requests should explain the user-visible change, list verification performed, link relevant issues, and include screenshots or recordings for UI changes. Call out configuration, dependency, or environment-variable changes explicitly.",
  "",
  "## Security & Configuration",
  "",
  "Vite accepts both `VITE_` and legacy `REACT_APP_` environment variable prefixes. Never commit secrets: browser-exposed environment values are public by design. Document any new required variable and provide a safe placeholder rather than credentials."
].join("\n") + "\n";
const REACT_AGENTS = `${REACT_GUIDELINES}\n${MARKED_NOTES}`;

const unique = arr => [...new Set(arr)];
function mergeClaude(existing) {
  if (!existing || Array.isArray(existing) || typeof existing !== 'object') throw new Error('Claude settings must be a JSON object');
  const p = existing.permissions ?? {};
  if (!p || Array.isArray(p) || typeof p !== 'object') throw new Error('Claude permissions must be a JSON object');
  for (const key of ['allow', 'ask', 'deny']) if (p[key] !== undefined && (!Array.isArray(p[key]) || p[key].some(v => typeof v !== 'string'))) throw new Error(`Claude permissions.${key} must be an array of strings`);
  // Keep all existing rules. Deny precedence is enforced by Claude, not by this installer.
  return { ...existing, permissions: { ...p, defaultMode: p.defaultMode ?? CLAUDE_PERMISSIONS.defaultMode,
    allow: unique([...(p.allow ?? []), ...CLAUDE_PERMISSIONS.allow]),
    ask: unique([...(p.ask ?? []), ...CLAUDE_PERMISSIONS.ask]),
    deny: unique([...(p.deny ?? []), ...CLAUDE_PERMISSIONS.deny]) } };
}
function patchTopLevelToml(old) {
  // Edit only the document's top-level scalar keys; preserve all unknown TOML tables/comments verbatim.
  // Reject ambiguous duplicate declarations to avoid corrupting or silently weakening config.
  let next = old;
  const firstTable = /^\s*\[\[?[^\n]+/m.exec(next);
  const head = firstTable ? next.slice(0, firstTable.index) : next;
  const tail = firstTable ? next.slice(firstTable.index) : '';
  let updated = head;
  for (const [key, value] of Object.entries(CODEX_TOML_KEYS)) {
    const re = new RegExp(`^([ \\t]*${key}[ \\t]*=[ \\t]*)([^\\n#]*)([^\\n]*)$`, 'gm');
    const matches = [...updated.matchAll(re)];
    if (matches.length > 1) throw new Error(`Duplicate ${key} in Codex top-level config`);
    if (matches.length) updated = updated.replace(re, `$1${value}$3`);
    else updated = `${key} = ${value}\n` + updated;
  }
  next = updated + tail;
  const count = (next.match(/^\s*\[sandbox_workspace_write\]\s*(?:#.*)?$/gm) ?? []).length;
  if (count > 1) throw new Error('Duplicate [sandbox_workspace_write] table');
  if (!count) return next.replace(/\s*$/, '\n\n') + CODEX_SANDBOX_TABLE;
  // Avoid rewriting an existing network policy: it may be stricter or intentionally customized.
  const section = /(^\s*\[sandbox_workspace_write\]\s*(?:#.*)?\r?\n)([\s\S]*?)(?=^\s*\[|$(?![\s\S]))/m;
  const match = section.exec(next);
  if (!match) throw new Error('Unable to parse [sandbox_workspace_write]');
  const body = match[2];
  if (/^\s*network_access\s*=/m.test(body)) return next;
  return next.slice(0, match.index) + match[1] + 'network_access = false\n' + next.slice(match.index + match[1].length);
}
function mergeNotes(old) {
  const a = old.indexOf(START), b = old.indexOf(END);
  if ((a === -1) !== (b === -1) || (a !== -1 && b < a)) throw new Error('Malformed agent instructions marker');
  if (a !== -1) return old.slice(0, a) + MARKED_NOTES.trimEnd() + old.slice(b + END.length);
  return old ? `${old.replace(/\s*$/, '')}\n\n${MARKED_NOTES}` : MARKED_NOTES;
}
function mergeClaudeReference(old) {
  const reference = '@AGENTS.md';
  const a = old.indexOf(START), b = old.indexOf(END);
  if ((a === -1) !== (b === -1) || (a !== -1 && b < a)) throw new Error('Malformed agent instructions marker');
  if (a !== -1) return old.slice(0, a) + reference + old.slice(b + END.length);
  if (new RegExp(`^${reference.replace('.', '\\.')}$`, 'm').test(old)) return old;
  return old ? `${old.replace(/\s*$/, '')}\n\n${reference}\n` : `${reference}\n`;
}
function mergeRules(old) {
  // Generated file lives separately to avoid changing user-authored policy files.
  const a = old.indexOf('# dev-agent-setup balanced preset.');
  if (a === -1) throw new Error('Existing balanced.rules is not ours; refusing to overwrite it');
  return CODEX_RULES;
}
async function readSafe(file) {
  try {
    const s = await fs.lstat(file);
    if (!s.isFile() || s.isSymbolicLink()) throw new Error(`Not a regular file: ${file}`);
    return await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}
async function secureDirectory(project, relative) {
  let current = project;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { const stat = await fs.lstat(current); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe directory: ${current}`); }
    catch (e) { if (e.code !== 'ENOENT') throw e; await fs.mkdir(current); }
  }
}
async function writeAtomic(file, content) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temp, content, { flag: 'wx', mode: 0o600 }); await fs.rename(temp, file); }
  finally { await fs.rm(temp, { force: true }); }
}
export async function setup({ project, agents = ['claude','codex'], tags = [], dryRun = false }) {
  project = path.resolve(project);
  const root = await fs.lstat(project);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('Project must be a real existing directory');
  const jobs = [];
  if (agents.includes('claude')) {
    jobs.push({ file: '.claude/settings.json', transform(old) { let parsed = {}; if (old !== null) { try { parsed = JSON.parse(old); } catch { throw new Error('Invalid JSON in .claude/settings.json; left unchanged'); } } return JSON.stringify(mergeClaude(parsed), null, 2) + '\n'; } });
    jobs.push({ file: 'CLAUDE.md', transform(old) { return mergeClaudeReference(old ?? ''); } });
  }
  if (agents.includes('codex')) {
    jobs.push({ file: '.codex/config.toml', transform(old) { return patchTopLevelToml(old ?? ''); } });
    jobs.push({ file: '.codex/rules/balanced.rules', transform(old) { return old === null ? CODEX_RULES : mergeRules(old); } });
  }
  if (agents.includes('claude') || agents.includes('codex')) {
    jobs.push({ file: 'AGENTS.md', transform(old) {
      if (tags.includes('react') && (old === null || [MARKED_NOTES, DEFAULT_AGENTS].some(generated => old.trim() === generated.trim()))) return REACT_AGENTS;
      if (!tags.length && (old === null || old.trim() === MARKED_NOTES.trim())) return DEFAULT_AGENTS;
      return mergeNotes(old ?? '');
    } });
  }
  // Plan every change and validate all source files before touching the filesystem.
  const changes = [];
  for (const job of jobs) {
    const absolute = path.join(project, job.file);
    const old = await readSafe(absolute);
    const next = job.transform(old);
    changes.push({ file: job.file, absolute, old, next, action: old === next ? 'unchanged' : old === null ? 'create' : 'update' });
  }
  if (dryRun) return changes.map(({file,action}) => ({file,action}));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const results = [];
  for (const change of changes) {
    const { absolute, old, next, file, action } = change;
    if (action === 'unchanged') { results.push({file,action}); continue; }
    await secureDirectory(project, path.dirname(file) === '.' ? '' : path.dirname(file));
    let backup;
    if (old !== null) {
      backup = `${file}.bak-${stamp}-${randomUUID().slice(0,8)}`;
      await fs.copyFile(absolute, path.join(project, backup), fs.constants.COPYFILE_EXCL);
    }
    await writeAtomic(absolute, next);
    results.push({ file, action, ...(backup ? { backup } : {}) });
  }
  return results;
}
