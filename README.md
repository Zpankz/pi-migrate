# pi-migrate

`pi-migrate` converts Claude Code plugin repositories into native [Pi](https://github.com/badlogic/pi-mono) packages.

It is designed for agent-native migration work: it copies compatible resources, converts MCP servers into deterministic CLI bridges, writes package-level instructions, flags partial/failed migrations, and generates a verification prompt for a follow-up agent.

## Install

Local development:

```bash
npm link
pi install /path/to/pi-migrate
```

Or run directly:

```bash
node ./bin/pi-migrate.mjs --help
```

## Usage

Default command migrates the source:

```bash
pi-migrate {gh-repo|url|local} [--name <pkg>] [--out <dir>] [--install] [--force]
```

Examples:

```bash
pi-migrate tirth8205/code-review-graph --name code-review-graph-pi --force
pi-migrate https://github.com/tirth8205/code-review-graph --install
pi-migrate ./local-claude-plugin --name local-plugin-pi
pi-migrate verify ~/.pi/agent/packages/code-review-graph-pi
```

## What migrates now

- `skills/`, `.claude/skills/` → `pi.skills`
- `commands/`, `.claude/commands/`, `prompts/` → `pi.prompts`
- `agents/`, `.claude/agents/` → `pi.agents` (via `@fractary/pi-claude-code` and `pi-subagents`), with Claude Code model aliases translated to Pi-available models (`opus` → `gpt-5.5`, `sonnet` → `deepseek-v4-pro`, `haiku` → `deepseek-v4-flash`)
- `extensions/` → `pi.extensions`
- `CLAUDE.md`, `.claude/CLAUDE.md`, `AGENTS.md` → package `AGENTS.md`
- `.mcp.json` → `mcporter` generated CLI bridges in package `bin/`, plus `docs/MCP_CLI_FALLBACK.md` for direct `mcp` CLI discovery/debugging
- safe Claude Code command hooks from settings → Pi extension hooks, including lifecycle mappings for `SessionEnd`, `UserPromptSubmit`, and `PostToolUseFailure`
- non-Claude hook manifests (`.github/hooks/*.json`, `.codex/hooks.json`, `.cursor/hooks.json`, `.gemini/settings.json`, etc.) → preserved under `docs/source-hooks/` and flagged for explicit native-Pi behavior verification
- migration status → `MIGRATION_REPORT.md`
- follow-up verification/repair prompt → `VERIFY_WITH_AGENT.md`

## MCP policy

Pi does not expose MCP tools natively. `pi-migrate` therefore converts MCP servers with:

```bash
mcporter generate-cli --server <server> --compile <package>/bin/<server>-mcp
```

Migrated skills are patched with deterministic CLI bridge instructions. When bridge generation fails, or when you need to explore a server before hardening a bridge, the generated package includes `docs/MCP_CLI_FALLBACK.md` with `mcp tools`, `mcp tools --format json`, and `mcp call <tool> --params '<json>'` examples derived from `.mcp.json`.

## Hook migration notes

Claude Code hooks that map cleanly to Pi are translated into TypeScript extensions:

| Claude event | Pi event |
| --- | --- |
| `SessionStart` | `session_start` |
| `PreToolUse` | `tool_call` |
| `PostToolUse` | `tool_result` |
| `PostToolUseFailure` | `tool_result` with failure detection |
| `UserPromptSubmit` | `before_agent_start` |
| `SessionEnd` / `Stop` | `session_shutdown` |

Hooks that call project-local agent scripts such as `.claude/hooks/*` or `.cursor/*` are skipped and reported as partial because packaged Pi extensions should not depend on source-repo-local hook paths.

## Functional migration requirement

A successful migration means the plugin's *normal behavior* works for Pi, not merely that Pi can load copied resources. `pi-migrate` therefore flags source-level gaps when it detects provider/model layers, CLI binaries, or per-agent config generators. It must not assume Claude Code model aliases, tool names, hook events, slash-command semantics, or other bespoke Claude Code functions are available in Pi. These require runtime adaptation, for example:

- provider adapters should inherit Pi's default provider/model/auth instead of requiring separate API keys;
- agent frontmatter should use Pi-available model identifiers, not raw Claude aliases;
- setup/init flows should accept `pi` where they accept other agent targets;
- generated outputs should land in Pi-compatible locations such as global `~/.pi/agent` package resources or project `AGENTS.md` / `.agents/skills/`.

Known adapter: Caliber (`caliber-ai-org/ai-setup`) receives `bin/caliber-pi`, `bin/pi`, and `bin/opencode` shims so `caliber status` reports provider `pi` and `caliber init --agent pi` maps to Pi-compatible output.

## Progressive disclosure and learning loop

The generated `VERIFY_WITH_AGENT.md` instructs a follow-up agent to inspect the report first, test only generated bridges and partial failures, repair in-place, and abduct reusable improvements back into the CLI.

Every verification pass is also instructed to:

1. Extract compact learnings from migration surprises.
2. Append them to `MIGRATOR_LEARNINGS.md` in the pi-migrate package.
3. Update `pi-migrate.mjs`, `README.md`, or `skills/pi-migrate/SKILL.md` when the learning is generalizable.
4. Rerun `pi-migrate verify`.
5. Commit and push if the migrator root is in a git repository with a configured remote; otherwise report the exact git commands needed.

This keeps the migrator self-improving instead of only fixing the one generated package.

## Roadmap

The command is named generically because future versions should migrate additional agent ecosystems:

- Codex `AGENTS.md` packages
- Gemini CLI extensions
- OpenCode plugins
- Cursor/Windsurf rules
- other agent apps and extension bundles

## Requirements

- Node.js 20+
- `git`
- `pi`
- `mcporter` for MCP bridge generation
- recommended: `@fractary/pi-claude-code`, `pi-subagents`
