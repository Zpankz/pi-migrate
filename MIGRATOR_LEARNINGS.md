# Migrator Learnings

Persistent learnings extracted from pi-migrate verification and repair passes. New verification agents must append compact, generalizable observations here and update the CLI when the observation is reusable.

## 2026-04-28 — Verification mandate

- Every generated `VERIFY_WITH_AGENT.md` now explicitly tells the verifier to extract learnings, update this file, improve `pi-migrate.mjs` / docs / skill instructions when generalizable, rerun verification, and commit/push when the migrator root is in a git repository.
- Verification must compare preserved non-Claude hook manifests against native Pi behavior, not assume copied skills/prompts are full-feature migrations.
- Native Pi extension commands can shadow prompt templates; prompt-compatible slash UX should remain in prompts, while native convenience commands should use a prefix or be documented as intentional shadowing.

## 2026-04-28 — planning-with-files hook manifests

- Surprising failure mode: `planning-with-files` advertised full hook support, but the initial migration copied only skills/prompts because hooks lived in `.github/hooks/planning-with-files.json` rather than `.claude/settings.json`.
- Likely cause: detection was Claude-settings-centric and ignored non-Claude plugin hook manifests.
- Generalizable fix: detect and preserve hook manifests from `.github/hooks/*.json`, `.codex/hooks.json`, `.cursor/hooks.json`, `.gemini/settings.json`, and similar paths; flag them as partial until native Pi behavior is verified or implemented.
- Exact CLI improvement made: `discoverHookManifests()` plus `copyHookManifestsForAudit()` now copy those manifests into `docs/source-hooks/` and add a migration-report partial requiring native-Pi verification.
- Git commit/push status: no git repository was present at `/Users/mikhail/.pi/agent/extensions/pi-migrate`; run `git init`, add a remote, commit, and push if this package should be versioned independently.

## 2026-05-01 — GEPA library-to-harness migration

- Surprising failure mode: GEPA repository is a Python optimization library with CLAUDE.md delegating to AGENTS.md, not a Claude Code plugin; raw pi-migrate produced only an inert AGENTS.md package and a false provider-adapter partial.
- Likely cause: migrator assumes agent plugin resources are primary and treats any provider/LM text as a Pi provider-adapter gap.
- Generalizable fix: for library/framework repos with no package.json, no skills/prompts/agents/hooks, and pyproject metadata, generate a Pi harness package: skill, prompt templates, helper scripts, and package manifest resources instead of only copying context docs.
- Exact CLI improvement proposed: add a framework detector for pyproject repos mentioning prompt/agent optimization; synthesize Pi wrapper resources and mark Python runtime installation as external.
- Git commit/push status: no git repository was present at /Users/mikhail/.pi/agent/extensions/pi-migrate; version manually if desired.

## 2026-05-01 — Extension event API verification

- Surprising failure mode: migrated ypi extension loaded as a Pi package but TypeScript compilation failed because it subscribed to unsupported event `session_switch`.
- Likely cause: package-shape verification only checked manifest paths and did not type-check migrated TypeScript extensions against Pi's current `ExtensionAPI` event union.
- Generalizable fix: `pi-migrate verify` should compile migrated `.ts` extension resources with `tsc --noEmit --skipLibCheck` so unsupported events/resources fail before install validation is considered complete.
- Exact CLI improvement made: verifier now scans `pi.extensions` resources for `.ts` files and runs `npx --yes tsc --noEmit --skipLibCheck --moduleResolution node --module esnext --target es2022 --types node <file>` per file.
- Git commit/push status: no git repository was present at /Users/mikhail/.pi/agent/extensions/pi-migrate; version manually if desired.
