# Scrcpy Harmony

[![Version](https://img.shields.io/github/v/release/MonsterXia/scrcpy-harmony?color=blue&label=version)](https://github.com/MonsterXia/scrcpy-harmony/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey.svg)](https://github.com/MonsterXia/scrcpy-harmony/releases)
[![Downloads](https://img.shields.io/github/downloads/MonsterXia/scrcpy-harmony/total)](https://github.com/MonsterXia/scrcpy-harmony/releases/latest)

**English** | [中文](README_ZH.md)

Scrcpy Harmony is a graphical HDC desktop tool for HarmonyOS devices, bringing together screen mirroring, device control, app management, logs, and debugging tools.

[Download](https://github.com/MonsterXia/scrcpy-harmony/releases/latest) · [Changelog](CHANGELOG.md) · [Report an issue](https://github.com/MonsterXia/scrcpy-harmony/issues)

## Features

| Feature | Description |
| --- | --- |
| Screen mirroring and control | View the device screen, click and drag with your mouse, and send text or device key events |
| Device overview | View the device model, system version, and display information |
| Screenshots | Capture, view, and save device screenshots |
| App management | Install and uninstall apps, inspect app details, and clear app cache or data |
| Processes and logs | View processes, browse and filter HiLog output, and export logs |
| Debugging tools | Interactive terminal, layout inspector, port forwarding, and WebView debugging |

## Download and installation

Visit [Releases](https://github.com/MonsterXia/scrcpy-harmony/releases/latest) and choose the installer for your operating system and processor:

| Platform | Installer suffix | Installation |
| --- | --- | --- |
| Windows x64 | `win-x64.exe` | Run the installer and follow the prompts |
| macOS Apple Silicon | `mac-arm64.dmg` | Open the disk image and drag the app into Applications |
| macOS Intel | `mac-x64.dmg` | Open the disk image and drag the app into Applications |

macOS requires **version 13 or later**. Linux installers are not currently available.

Installers include HDC and the required device resources; Node.js is not needed for normal use. See the [user guide](docs/user-guide.md) for detailed installation and connection steps.

**Windows packages are unsigned. macOS packages use ad-hoc signing, without Developer ID or notarization.** System installation warnings may still appear. Verify the download source and checksums; see the [1.0.4 release report](docs/releases/1.0.4.md) for publication status and actual validation results.

**[1.0.4 is now available as the stable Latest release](https://github.com/MonsterXia/scrcpy-harmony/releases/tag/v1.0.4).** Three-platform installation and direct upgrade/update checks passed; signing and device-validation limitations remain documented in the release report.

Current source targets **1.0.4**: H.264 mirroring with JPEG fallback, keyboard/IME and clipboard input, HAP drag-and-drop installation, guarded recovery of idle mirroring sessions, bounded app-store requests, English/Chinese language selection, and visible **Beta Update: On/Off** state with aligned menu labels. Download the installer from [Releases](https://github.com/MonsterXia/scrcpy-harmony/releases/latest) to upgrade; settings use the same application directory. Beta Update is in the application menu, defaults to off and is not needed for stable releases.

Version **1.0.3** remains available as the recovery version before dependency source migration. If switching from ECHO, configure settings again: its separate configuration directory is not migrated automatically. Device compatibility and pending validation are listed in the release report; include your version and commit when reporting a problem.

## Quick start

Version 1.0.4 automatically deploys bundled native capture libraries to compatible phones for H.264 mirroring; no preinstalled phone library or Java runtime is required. Unsupported devices fall back to JPEG.

Version 1.0.4 retries video once when the picture changes after JPEG fallback. You can also click **Switch to video** (切换到视频) in the screencast toolbar. JPEG stays active until the first decoded video frame is displayed; a failed attempt keeps JPEG running.

1. Enable developer options and USB debugging on your HarmonyOS device. Connect it to your computer with a USB data cable and authorize the debugging connection on the device. The settings location varies by system version.
2. Launch Scrcpy Harmony and select your device from the list at the top. If it does not appear, click **Refresh** (刷新) beside the list.
3. Click **Screencast** (投屏) to open the device screen, then click or drag with your mouse. Focus a phone text field and type or paste from your keyboard.
4. Switch between the **Apps** (应用), **Terminal** (终端), and **Logs** (日志) panels in the main window. To export HiLog output, click **Save** (保存) in the Logs toolbar.

The app uses its bundled HDC by default. To use another version, specify the executable path in **HDC location** (HDC 位置) in settings.

Version 1.0.4 supports English and Simplified Chinese throughout the app. In **Settings → Language** (设置 → 语言), choose **System Preference**, **English**, or **简体中文**, then restart the app to apply the choice to all windows and menus. Regional English and Chinese system locales use English and Simplified Chinese respectively; other system languages fall back to English. When developing UI, follow the [internationalization workflow](.agents/skills/scrcpy-harmony-project/references/internationalization.md) and run `npm run check:i18n`.

### Common questions

- **The device list is empty:** Make sure your cable supports data transfer and debugging is authorized on the device, then refresh the list. If you use a custom HDC, check that its configured path is valid.
- **The device appears, but screencasting or layout inspection fails:** These features also depend on compatibility between the device system and uitestkit. Include your device model, system version, and the exact error when reporting a problem.
- **How do I install an update?** The app prompts you to open this repository's Releases page. Download and install the new version manually.

Report other problems through [Issues](https://github.com/MonsterXia/scrcpy-harmony/issues) or **Help → Report Issue** (帮助 → 报告问题) in the app menu. Include the app version, desktop operating system, device model, HarmonyOS/HDC versions, reproduction steps, and expected and actual behavior. Remove device identifiers and personal information before uploading logs or screenshots.

## Repository structure

| Path | Maintained content |
| --- | --- |
| `src/main/`, `src/preload/` | Electron main process, device operations and IPC bridge |
| `src/renderer/`, `src/common/` | React windows, shared application types, translations and themes |
| `src/share/`, `src/renderer/icon/` | Shared Electron code and icon sources, tracked as ordinary directories |
| `vendor/packages/hdckit/src/` | Original HDC client TypeScript |
| `vendor/packages/licia/src/`, `vendor/packages/licia/test/` | Original Licia modules, embedded types and upstream tests |
| `vendor/packages/luna-*/src/` | Luna component TypeScript/React wrappers, styles and per-version shared code |
| `script/`, `test/`, `.github/workflows/` | Local generators, application regression tests, builds and CI |
| `build/`, `docs/` | Tracked application icons and project documentation |

`dist/`, `release/`, `resources/` and dependency build outputs are generated or downloaded. Edit the original sources rather than `node_modules` or generated files. See the [repository guide](docs/repository-guide.md) for the source/output map and build flow.

## Local development

The project uses Electron, React, and TypeScript. You need **Node.js 22.12.0 or later** and Git. The resource download script also requires `curl` and `unzip`; on Windows, these tools can be provided by Git Bash.

```sh
git clone https://github.com/MonsterXia/scrcpy-harmony.git
cd scrcpy-harmony
npm ci
npm run init
```

`npm ci` installs the toolchain and compiles local HDC/Licia/Luna packages. Licia, HDC, Luna, shared Electron code and icon sources are tracked in this repository; current source builds need no submodule checkout. `npm run init` still downloads HDC and uitestkit device resources. See [local dependency maintenance](vendor/README.md) to edit and rebuild these sources. The published v1.0.3 recovery tag retains the old dependency/submodule structure.

Start the development build in one terminal:

```sh
npm run dev
```

Once local dependencies, the main process and preload have compiled and Vite is ready, launch the app in a second terminal:

```sh
npm start
```

The app depends on the Electron main process; the Vite page cannot run as a standalone browser app. Dependency source changes are compiled automatically. Wait for compilation and any Vite restart, then reload the renderer manually (HMR is disabled). Restart Electron after changing main-process or preload code, including dependencies they use.

### Editing local dependencies

HDC and Luna are compiled from their original TypeScript/styles. Licia is generated from original JavaScript modules containing dependency and type definitions; edit its matching upstream tests as well. Existing package imports such as `hdckit`, `licia/trim` and `luna-setting` resolve to local `file:` dependencies.

```sh
npm run build:vendor
npm run test:licia -- cloneDeep
npm run test:licia -- --fallback cloneDeep
```

The first command rebuilds all 18 local packages without fetching their sources. The other commands test one Licia module against production and fallback implementations. See [dependency maintenance](vendor/README.md) and the [Licia workflow](vendor/packages/licia/MAINTENANCE.md) for source ownership, generated files and upstream updates.

Common validation and packaging commands:

```sh
npm test
npm run lint
npm run build
npm run pack -- --no-publish
```

`npm test` runs application regressions and both Licia Node test modes; four fixture-dependent Licia cases are explicitly skipped in each mode. Browser-only/manual upstream tests, full type checking and real-device acceptance remain separate. Installers are written to `release/<version>/`, with license notices included. The general toolchain and native device/packaging resources still require installation or download.

See the [build guide](docs/build-guide.md) for a clean checkout, Windows shell configuration and troubleshooting, and the [maintainer reference](.agents/skills/scrcpy-harmony-project/references/development.md) for validation scripts and CI details.

## Origins and maintenance

This project is based on [liriliri/echo](https://github.com/liriliri/echo) and is independently maintained by MonsterXia. It retains attribution to the original author, surunzi, and the upstream commit history, and is licensed under [AGPL-3.0](LICENSE).

Core dependencies include [hdckit](https://github.com/liriliri/hdckit) (HDC client), [Luna](https://github.com/liriliri/luna) (UI components), and [Licia](https://github.com/liriliri/licia) (utilities).

- [User guide](docs/user-guide.md): Installation, debugging authorization, device selection, screencasting, text input, and log export.
- [Build guide](docs/build-guide.md): Set up a clean checkout, build, and launch Electron on Windows/macOS.
- [Repository guide](docs/repository-guide.md): Source layout, generated outputs and the local build flow.
- [Dependency maintenance](vendor/README.md): Modify local packages, preserve provenance and update upstream snapshots.
- [Maintenance plan](RUNBOOK.md): Progress, acceptance criteria, and next steps.
- [Maintenance sources](docs/maintenance/SOURCES.md): Upstream issues, pull requests, and archive index.
- [Changelog](CHANGELOG.md): Release changes and version history.

The linked user guide, build guide, maintainer reference, maintenance documents, and release report are currently available in Chinese.
