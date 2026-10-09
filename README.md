# dev-agent-setup

A lightweight CLI that sets up a balanced, project-scoped configuration for Claude Code and OpenAI Codex in the current repository.

## What it does

This package adds developer-agent setup files that help guide how Claude Code and Codex work inside your project, including:

- Claude Code permissions and project guidance
- Codex project settings and approval/sandbox rules
- A balanced rule preset for common safe project workflows

It is designed to be run directly against a target project folder without changing your global agent configuration.

## Usage

Run it with npx in one step:

```bash
npx dev-agent-setup init --path /path/to/your/project --agents claude,codex --preset balanced --tag react
```

Optional preview mode:

```bash
npx dev-agent-setup init --path /path/to/your/project --agents claude,codex --preset balanced --tag react --dry-run
```

## Files created

The CLI generates project-scoped configuration files such as:

- `.claude/settings.json`
- `CLAUDE.md`
- `.codex/config.toml`
- `.codex/rules/balanced.rules`
- `AGENTS.md`

These files are added to the target repository so the project has its own agent instructions and safe defaults.
When no tag is selected, `AGENTS.md` includes default pnpm setup commands and TypeScript style guidance. `CLAUDE.md` references `AGENTS.md` so both agents share the same project instructions.

## Notes

- The command updates the selected repository rather than your global setup.
- Existing project files are merged carefully, and backups are created for modified files.
- Review the generated configuration before relying on it in a real project.
