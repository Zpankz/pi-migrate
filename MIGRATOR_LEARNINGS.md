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
