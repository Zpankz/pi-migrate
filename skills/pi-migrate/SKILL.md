---
name: pi-migrate
description: Convert Claude Code plugin repositories into native Pi packages with deterministic MCP-to-CLI bridges, migration reports, and verification prompts.
---

# pi-migrate

Use this skill to migrate a Claude Code plugin, and later Codex/Gemini/OpenCode-style agent extensions, into Pi.

## Progressive workflow

1. Inspect source progressively:
   ```bash
   pi-migrate inspect <gh-repo|url|local> --name <pkg>
   ```
2. Migrate:
   ```bash
   pi-migrate <gh-repo|url|local> --name <pkg> --force
   ```
3. Verify package shape:
   ```bash
   pi-migrate verify ~/.pi/agent/packages/<pkg>
   ```
4. Read `MIGRATION_REPORT.md`.
5. Use `VERIFY_WITH_AGENT.md` as the prompt for a fresh verification/repair agent.
6. Require the verifier to extract learnings, update `MIGRATOR_LEARNINGS.md`, improve pi-migrate when the learning is reusable, rerun verification, and commit/push when the migrator is in a git repo with a remote.

## Rules

- If source has `.mcp.json`, convert each MCP server with `mcporter generate-cli`.
- Pi skills must call generated CLI bridges, not native MCP tools.
- Any resource that cannot be fully translated must be flagged in `MIGRATION_REPORT.md` as partial or failed.
- Non-Claude hook manifests (for example `.github/hooks/*.json`, `.codex/hooks.json`, `.cursor/hooks.json`, `.gemini/settings.json`) must be preserved and flagged for explicit native-Pi behavior verification if they are not automatically translated.
- If verification discovers a reusable failure pattern, improve `pi-migrate` itself and append the compact learning to `MIGRATOR_LEARNINGS.md`.
- After improving `pi-migrate`, run `git status`; if the migrator root is inside a git repository with a remote, commit and push. If no git remote exists, report the exact commands needed instead.
