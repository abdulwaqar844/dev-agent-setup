import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setup } from '../src/setup.js';

async function temp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-agent-setup-'));
  t.after(async () => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
const read = (dir,file) => fs.readFile(path.join(dir,file), 'utf8');
test('creates both agent configurations and instructions', async t => {
  const dir = await temp(t);
  const changes = await setup({project:dir});
  assert.equal(changes.length,5);
  const conf = JSON.parse(await read(dir,'.claude/settings.json'));
  assert.ok(conf.permissions.deny.includes('Read(./.env)'));
  assert.match(await read(dir,'.codex/config.toml'), /approval_policy = "on-request"/);
  assert.match(await read(dir,'.codex/rules/balanced.rules'), /decision="forbidden"/);
  assert.match(await read(dir,'CLAUDE.md'), /Agent working agreement/);
  assert.match(await read(dir,'AGENTS.md'), /Agent working agreement/);
  const again = await setup({project:dir});
  assert.ok(again.every(x => x.action === 'unchanged'));
});
test('merges existing Claude settings, instructions, and Codex tables; backs up changed files', async t => {
  const dir = await temp(t);
  await fs.mkdir(path.join(dir,'.claude'));
  await fs.mkdir(path.join(dir,'.codex'));
  await fs.writeFile(path.join(dir,'.claude/settings.json'), JSON.stringify({model:'custom',permissions:{allow:['Bash(custom)'],deny:['Read(secret.txt)']}}));
  await fs.writeFile(path.join(dir,'.codex/config.toml'), 'model = "my-model"\n[features]\nsome_feature = true\n');
  await fs.writeFile(path.join(dir,'AGENTS.md'),'# Team guidelines\nKeep this.\n');
  const changed = await setup({project:dir});
  assert.equal(changed.filter(x=>x.backup).length,3);
  const claude = JSON.parse(await read(dir,'.claude/settings.json'));
  assert.equal(claude.model,'custom');
  assert.ok(claude.permissions.allow.includes('Bash(custom)'));
  assert.ok(claude.permissions.deny.includes('Read(secret.txt)'));
  const toml = await read(dir,'.codex/config.toml');
  assert.match(toml,/model = "my-model"/);
  assert.match(toml,/some_feature = true/);
  assert.match(await read(dir,'AGENTS.md'), /Keep this/);
  assert.equal(await read(dir,changed.find(x => x.file==='AGENTS.md').backup),'# Team guidelines\nKeep this.\n');
});
test('dry-run changes nothing', async t => {
  const dir = await temp(t);
  const changes = await setup({project:dir,dryRun:true});
  assert.ok(changes.every(x=>x.action==='create'));
  assert.deepEqual(await fs.readdir(dir),[]);
});
test('invalid existing JSON rejects before writing other files', async t => {
  const dir = await temp(t);
  await fs.mkdir(path.join(dir,'.claude'));
  await fs.writeFile(path.join(dir,'.claude/settings.json'),'{broken');
  await assert.rejects(setup({project:dir}),/Invalid JSON/);
  assert.deepEqual(await fs.readdir(dir),['.claude']);
});
test('symlink config cannot be overwritten', async t => {
  const dir = await temp(t);
  await fs.mkdir(path.join(dir,'.claude'));
  await fs.writeFile(path.join(dir,'target.json'),'{}');
  await fs.symlink(path.join(dir,'target.json'),path.join(dir,'.claude/settings.json'));
  await assert.rejects(setup({project:dir}), /Not a regular file/);
  assert.equal(await read(dir,'target.json'),'{}');
});
test('existing sandbox table gets missing network policy only, and preserves explicit setting', async t => {
  const dir = await temp(t);
  await fs.mkdir(path.join(dir,'.codex'));
  await fs.writeFile(path.join(dir,'.codex/config.toml'),'[sandbox_workspace_write]\nwritable_roots = ["/tmp"]\n');
  await setup({project:dir,agents:['codex']});
  let s = await read(dir,'.codex/config.toml');
  assert.equal((s.match(/network_access/g)||[]).length,1);
  assert.match(s,/writable_roots/);
  await fs.writeFile(path.join(dir,'.codex/config.toml'),'[sandbox_workspace_write]\nnetwork_access = true\n');
  await setup({project:dir,agents:['codex']});
  s = await read(dir,'.codex/config.toml');
  assert.match(s,/network_access = true/);
});
test("creates React repository guidelines when the react tag is selected", async t => {
  const dir = await temp(t);
  await setup({project:dir,agents:["codex"],tags:["react"]});
  const agents = await read(dir,"AGENTS.md");
  assert.match(agents, /^# Repository Guidelines/);
  assert.match(agents, /Vite-powered React dashboard built with Material UI/);
  assert.match(agents, /Use Node 24/);
  assert.match(agents, /<!-- dev-agent-setup:begin -->/);
  assert.match(agents, /<!-- dev-agent-setup:end -->/);
});
test("upgrades an untouched generated AGENTS.md when the react tag is added", async t => {
  const dir = await temp(t);
  await setup({project:dir,agents:["codex"]});
  const changed = await setup({project:dir,agents:["codex"],tags:["react"]});
  assert.equal(changed.find(x => x.file === "AGENTS.md").action,"update");
  assert.match(await read(dir,"AGENTS.md"), /^# Repository Guidelines/);
});
