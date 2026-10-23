# Dependency sources implementation plan

> **For agentic workers:** Use superpowers:executing-plans; implement in this session and obtain one fresh whole-branch review.

**Goal:** Maintain the selected dependencies locally after publishing the immutable 1.0.3 recovery Release.
**Architecture:** npm file dependencies retain package imports; local TS/SCSS builds prepare HDC/Luna, while Licia is maintained as unminified JS. Shared submodules become tracked source at their existing paths.
**Tech Stack:** Node 22, npm, TypeScript, Sass/PostCSS, existing Vite/Electron.
**Spec:** ../specs/2026-10-23-dependency-sources-design.md

## Global constraints

- 1.0.3 must be public and verified before migration; completed at source `417e78f`.
- Keep exact locked package versions and both submodule revisions; no behavior upgrade.
- Do not claim fully offline builds or full TypeScript/device validation.
- Preserve source/license provenance; keep tag immutable and work on `codex/vendor-dependencies`.

## Review focus

Transitive package resolution must stay local; stale compiled output must not mask edits; CSS classes/icons must retain scope; CI must work without submodules; old-tag recovery and dist packaging must remain valid.

### Task 1: Import and local build

- [x] Add failing `test/vendor.test.cjs` for dependency closure and actual local build outputs.
- [x] Import `vendor/packages/*`, manifest and source hashes from the fixed upstream snapshots and installed baseline package contents. Convert the two submodules without deleting their archived Git histories.
- [x] Add `script/build-vendor.mjs` and `script/lib/vendor-build.mjs`: compile TS/declarations, prefix SCSS/icons, watch only source inputs; fail on invalid inputs.
- [x] Switch package/lockfile to file dependencies, add compiler dependencies and build/test/dev preparation hooks.
- [x] Prove real imports, private HDC paths, CSS scoping and source edit/rebuild behavior; run existing tests/lint/build and commit.

### Task 2: Validation and documentation

- [ ] Run clean npm ci, verify local resolution and no selected package registry URLs; package and smoke-test Windows, then required three-platform CI.
- [x] Update README languages, user/build guides, project skill references and workflows to remove submodule setup; document remaining binary/toolchain network requirements.
- [x] Record release/migration evidence, source ownership and next steps in RUNBOOK/SOURCES and vendor README.
- [ ] Request fresh whole-branch review, resolve findings, publish PR and record actual CI results without marking missing device checks complete.

## Ledger

- Release gate: complete. PR #54 merged; five CI checks and Build 39978114409 passed; all 14 Release assets matched SHA-256. v1.0.3 is public and immutable.
- Design builder check: no important unanswered questions. User selected suggested scope; native implementation follows existing authorization.
- Source preflight: all compared Luna runtime TS from npm source maps match published gitHead sources. CSS maps contain processed CSS despite SCSS labels; compare generated styles separately.
- Independent whole-branch review: all 1,155 imported hashes and 16 normalized CSS selector sets verified against originals. Fixed icon font attribute prefixes; fixed watch-time missing output by publishing successful compiler output without deleting the entire directory. No unresolved important findings.
- Local verification: 456 tests, lint, full build, Windows packaging/runtime/metadata smoke, and an actual Luna SCSS edit observed in the live development renderer. A clean independent clone completed npm ci --offline --no-audit using the existing npm cache, rebuilt all local packages and passed all five migration tests. Required PR CI remains pending.
