#!/usr/bin/env node
import { resolve } from 'node:path';
import { setup } from '../src/setup.js';

function help() {
  console.log(`dev-agent-setup v0.1.0

Usage:
  dev-agent-setup init [--path DIR] [--agents claude,codex] [--preset balanced] [--dry-run]
  dev-agent-setup --help

Options:
  --path DIR         Target project directory (default: current directory)
  --agents NAMES     claude, codex, or claude,codex (default: both)
  --preset balanced  Balanced permission preset (the only supported preset)
  --dry-run          Show file changes without writing
  --help             Print help

Important: Doesn't change global settings or trust the project automatically.`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) return help();
  if (args[0] !== 'init') throw new Error('Expected `init`. See --help.');
  const opts = { project: process.cwd(), agents: ['claude', 'codex'], preset: 'balanced', dryRun: false };
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (['--path','--agents','--preset'].includes(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${arg}`);
      const value = args[++i];
      if (arg === '--path') opts.project = resolve(value);
      if (arg === '--agents') opts.agents = [...new Set(value.split(',').map(x => x.trim()))];
      if (arg === '--preset') opts.preset = value;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (opts.preset !== 'balanced') throw new Error('Only --preset balanced is supported.');
  if (!opts.agents.length || opts.agents.some(x => !['claude', 'codex'].includes(x))) throw new Error('Agents must be claude and/or codex.');
  const changes = await setup(opts);
  console.log(`Project: ${opts.project}${opts.dryRun ? ' (dry-run)' : ''}`);
  for (const change of changes) console.log(`  ${change.action.padEnd(9)} ${change.file}${change.backup ? ` (backup: ${change.backup})` : ''}`);
  console.log('Codex: open this project and explicitly accept the trust prompt; project config/rules are ignored until trusted.');
  console.log('Review generated permissions before running agents. No preset replaces OS security or an isolated sandbox.');
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exitCode = 1; });
