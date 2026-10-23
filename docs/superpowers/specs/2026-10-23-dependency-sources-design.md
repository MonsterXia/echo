# Dependency source migration design

User intent: publish 1.0.3 from baseline 8087ac8 first, then bring hdckit, Licia, all used Luna packages (including transitive luna-drag-selector), electron-share and icon-share into this repository. Preserve current behavior and enable local adaptations without fetching those packages/submodules.

## Release gate

No migration changes until the three-platform 1.0.3 Release is publicly available and all asset digests match the validated Build 39978114409. Its source is 417e78ff9a4f99bc0d3a68080b9ceb11810d1d09. Existing packages and source are unchanged in that Release. Work then starts on codex/vendor-dependencies from master; v1.0.3 remains immutable. No migration release is requested.

## Approaches

The user selected source ownership for HDC, Licia, Luna and shared submodules, while keeping the general Electron/React/Vite toolchain external. A registry mirror/cache alone does not support maintained local adaptations. Vendoring all of npm/Electron is excessive and outside scope. Use ordinary npm file dependencies instead of adding another workspace/package manager; this also keeps the generated dist package simple.

## Sources and layout

- vendor/packages/hdckit: exact npm 0.12.1 provenance plus TypeScript src from its published gitHead. Compile src into the existing dist layout; preserve private dist paths used by current tests, public exports and execa dependency. Do not silently upgrade behavior.
- vendor/packages/licia: original 1.49.0 modules, embedded types/docs and tests from the published gitHead, plus upstream generator references and MIT license. The user explicitly selected long-term adaptations on October 24: source modules are authoritative; a local generator implements the necessary CommonJS/type/index steps with standard pinned Babel transforms. Do not execute upstream install/publish/cloud-test workflows or introduce eustia. Generated root JS/declarations are ignored outputs. Preserve npm output hashes as historical comparison evidence.
- vendor/packages/luna-*: each of the 16 currently locked package versions gets its own original component TS/TSX, shared sources and SCSS/icon CSS from its individual published gitHead. Do not deduplicate shared snapshots across different versions. Keep the application's root/react/css entry points and relative CommonJS/ESM layouts. Unused prebuilt browser UMD files are not part of the local package contract.
- src/share and src/renderer/icon stay in place with exactly their current tracked content, but become ordinary tracked directories. Preserve original README and provenance; upstream snapshots have no LICENSE file, so do not fabricate MIT attribution for them. Remove .gitmodules and active nested .git pointers only after saving their bundles; keep Git's archived module object stores intact for old-tag recovery.
- vendor/manifest.json records package name/version, npm integrity, gitHead, source repository/archive SHA-256, imported file hashes and local adaptation notes. License files and original manifests remain available. A vendor README describes updating sources and review requirements.

## Build behavior

Use explicit root dev dependencies on all 18 local packages, including luna-drag-selector, with file:vendor/packages/name. Check lockfile and installed realpaths so transitive/peer dependencies cannot silently fetch another Luna/Licia copy. Keep ordinary execa/micromark/React dependencies managed normally.

A root build:vendor script compiles hdckit and Luna from local TypeScript into ignored outputs and emits declarations (transpilation/declaration generation is not full type checking). Use a direct pinned TypeScript tool dependency, existing Sass, and explicit PostCSS/autoprefixer/selector-parser dependencies for CSS. Match upstream class/ID prefixing, ignore luna- prefixes, and include icon CSS. Build both CJS and ESM entry points as needed. Keep generated output separate from authoritative sources.

npm ci postinstall prepares local packages; test/build/dev entry points also prepare them so --ignore-scripts installations remain recoverable and source changes cannot silently use old outputs. Development watch must rebuild changed vendor sources. Build should not download source or run upstream install scripts. Retain current HDC/uitestkit external resource setup and Electron/toolchain downloads; do not call this a fully offline application build.

## Verification and handoff

Add tests for local dependency closure and build behavior: no remote selected-package lock entries, realpaths inside vendor, generated private HDC and public Luna/react/css imports, class/icon scoping, edit-and-rebuild effect, build failure propagation and no package fetch during vendor build. Run all existing tests/lint, full local build, Windows package and isolated runtime smoke. Use fresh npm ci in an isolated checkout/cache validation, then required Windows/macOS CI through a PR. No new device behavior is intentionally introduced; retain true device acceptance limitations.

Update RUNBOOK/SOURCES, English/Chinese README, build guide, project skill references and release evidence. Keep release evidence and migration changes as separate commits. Complete review before marking migration done. If upstream source and npm source maps materially differ, investigate instead of treating gitHead alone as proof of equivalence. The builder decides implementation helpers and narrow test fixture structure.
