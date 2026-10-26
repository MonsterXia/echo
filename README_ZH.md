# Scrcpy Harmony

[![Version](https://img.shields.io/github/v/release/MonsterXia/scrcpy-harmony?color=blue&label=version)](https://github.com/MonsterXia/scrcpy-harmony/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey.svg)](https://github.com/MonsterXia/scrcpy-harmony/releases)
[![Downloads](https://img.shields.io/github/downloads/MonsterXia/scrcpy-harmony/total)](https://github.com/MonsterXia/scrcpy-harmony/releases/latest)

[English](README.md) | **中文**

Scrcpy Harmony 是面向鸿蒙设备的 HDC 图形化桌面工具，集成投屏控制、应用管理、日志查看和调试功能。

[下载应用](https://github.com/MonsterXia/scrcpy-harmony/releases/latest) · [更新日志](CHANGELOG.md) · [问题反馈](https://github.com/MonsterXia/scrcpy-harmony/issues)

## 功能

| 功能 | 说明 |
| --- | --- |
| 投屏与控制 | 查看设备画面，使用鼠标点击、拖动，通过工具栏输入文本、操作系统按键 |
| 设备概览 | 查看设备型号、系统版本和屏幕信息 |
| 截屏 | 捕获、查看并保存设备截图 |
| 应用管理 | 安装、卸载应用，查看应用信息，清理缓存或数据 |
| 进程与日志 | 查看进程、浏览和筛选 HiLog 日志、导出日志文件 |
| 调试工具 | 交互终端、布局查看、端口转发与 WebView 调试 |

## 下载安装

前往 [Releases](https://github.com/MonsterXia/scrcpy-harmony/releases/latest)，按电脑系统和处理器选择安装包：

| 平台 | 安装包后缀 | 安装方式 |
| --- | --- | --- |
| Windows x64 | `win-x64.exe` | 运行安装程序，按提示完成安装 |
| macOS Apple Silicon | `mac-arm64.dmg` | 打开镜像，将应用拖入“应用程序”目录 |
| macOS Intel | `mac-x64.dmg` | 打开镜像，将应用拖入“应用程序”目录 |

macOS 需要 **13 或更新版本**。当前未提供 Linux 安装包。

安装包已包含 HDC 和所需设备资源，日常使用无需安装 Node.js。详细安装与连接步骤见[用户指南](docs/user-guide.md)。

**1.0.3 安装包未做发行者签名或 macOS 公证，macOS Gatekeeper 检查未通过。** 各平台的安装启动结果、签名状态及校验文件见 [1.0.3 发布记录](docs/releases/1.0.3.md)。

从 ECHO 切换的用户需要重新配置设置：Scrcpy Harmony 使用独立的应用 ID 和用户配置目录，旧配置保留原处，不会自动迁移。

稳定版 **1.0.3** 包含截至基线 `8087ac8` 合入的设备、应用和投屏修复，继续保留为依赖源码迁移前的恢复版本。[**1.0.4-dev.0**](https://github.com/MonsterXia/scrcpy-harmony/releases/tag/v1.0.4-dev.0) 已作为开发预发布提供，包含 H.264 投屏与键盘/复制粘贴输入。反馈问题时请附版本和提交号。

## 快速上手

1.0.4-dev.0 开发预发布会向兼容手机自动部署内置原生采集库，使用 H.264 投屏，无需手机预装该库，也不需要 Java。设备不兼容时回退 JPEG；稳定版 1.0.3 尚不包含此能力。

当前预览版支持 JPEG 回退后，在画面再次变化时自动尝试一次恢复视频；也可在投屏工具栏点击“切换到视频”。尝试期间保持 JPEG，视频首帧真正显示后再交接，失败时继续使用 JPEG。2026-10-25 03:27（UTC+8）前下载的同版本安装包需重新下载并安装。

1. 在鸿蒙设备上开启开发者选项和 USB 调试，通过 USB 数据线连接电脑，并在设备端允许调试连接。具体设置入口以设备系统版本为准。
2. 启动 Scrcpy Harmony，在顶部设备列表中选择设备；未出现时点击旁边的“刷新”。
3. 点击“投屏”打开设备画面，使用鼠标点击、拖动；需要发送文本时，点击投屏工具栏的“输入文本”。
4. 在主窗口切换“应用”“终端”“日志”等面板使用对应工具。导出 HiLog 时，点击“日志”面板工具栏的“保存”。

应用默认使用内置 HDC。需要使用其他版本时，可在设置中的“HDC 位置”指定可执行文件路径。

当前源码已补齐简体中文和英文界面。在“设置 → 语言”选择“系统设置”“English”或“简体中文”，再重启应用，将语言应用到所有窗口和菜单。中文和英文的系统地区变体分别使用简体中文和英文，其他系统语言默认使用英文；此改动尚未包含在已发布安装包中。开发界面时请遵循[国际化流程](.agents/skills/scrcpy-harmony-project/references/internationalization.md)，并运行 `npm run check:i18n`。

### 常见问题

- **设备列表为空**：确认数据线支持数据传输、设备已允许调试连接，再刷新列表。使用自定义 HDC 时，检查“HDC 位置”是否有效。
- **能看到设备，但无法投屏或查看布局**：这些功能还依赖设备系统与 uitestkit 的兼容性。反馈时请附上设备型号、系统版本和具体错误信息。
- **检查更新后如何升级**：应用会提示打开本仓库的 Releases 页面，需要手动下载并安装新版本。

更多问题可通过 [Issues](https://github.com/MonsterXia/scrcpy-harmony/issues) 或应用菜单“帮助 → 报告问题”反馈。请提供应用版本、电脑系统、设备型号、HarmonyOS/HDC 版本、复现步骤及预期与实际结果；上传日志或截图前请移除设备标识和个人信息。

## 仓库结构

| 路径 | 维护内容 |
| --- | --- |
| `src/main/`、`src/preload/` | Electron 主进程、设备操作与 IPC 桥接 |
| `src/renderer/`、`src/common/` | React 窗口、应用类型、国际化和主题 |
| `src/share/`、`src/renderer/icon/` | 共享 Electron 代码与图标源，均为普通跟踪目录 |
| `vendor/packages/hdckit/src/` | HDC 客户端原始 TypeScript |
| `vendor/packages/licia/src/`、`vendor/packages/licia/test/` | Licia 原始模块、内嵌类型及上游测试 |
| `vendor/packages/luna-*/src/` | Luna 组件 TypeScript、React 包装、样式与各版本共享代码 |
| `script/`、`test/`、`.github/workflows/` | 本地生成器、应用回归、构建与 CI |
| `build/`、`docs/` | 已跟踪的应用图标和项目文档 |

`dist/`、`release/`、`resources/` 及依赖编译产物由构建或下载生成。应修改原始源码，不要修改 `node_modules` 或生成文件。源码与产物对应关系、构建流程见[仓库结构指南](docs/repository-guide.md)。

## 本地开发

项目使用 Electron、React 和 TypeScript，需要 **Node.js 22.12.0 或更新版本**及 Git。资源下载脚本需要 `curl` 和 `unzip`；Windows 可使用 Git Bash 提供这些工具。

```sh
git clone https://github.com/MonsterXia/scrcpy-harmony.git
cd scrcpy-harmony
npm ci
npm run init
```

`npm ci` 安装工具链并编译本地 HDC/Licia/Luna 包。Licia、HDC、Luna、共享 Electron 代码及图标源已纳入本仓库，当前源码无需初始化子模块。`npm run init` 仍下载 HDC 和 uitestkit 设备资源；源码修改与重编译见[本地依赖维护](vendor/README.md)。已发布的 v1.0.3 恢复 tag 保留旧依赖及子模块结构。

在第一个终端启动开发构建：

```sh
npm run dev
```

等待本地依赖、主进程和 preload 首次编译完成且 Vite 就绪后，在第二个终端启动应用：

```sh
npm start
```

应用功能依赖 Electron 主进程，Vite 页面不能独立作为浏览器版使用。依赖源码改动会自动编译；等待编译和 Vite 重启就绪后手动刷新 renderer（HMR 已关闭）。修改主进程、preload 或它们使用的依赖后需重启 Electron。

### 修改本地依赖

HDC/Luna 从原始 TypeScript/样式编译；Licia 从包含依赖与类型定义的原始 JavaScript 模块生成，修改时一并维护对应上游测试。应用仍使用 `hdckit`、`licia/trim`、`luna-setting` 等导入，通过 `file:` 依赖解析到本仓源码。

```sh
npm run build:vendor
npm run test:licia -- cloneDeep
npm run test:licia -- --fallback cloneDeep
```

第一条命令重建全部 18 个本地包，不下载它们的源码；后两条分别测试单个 Licia 模块的生产实现和兼容分支。源码归属、生成文件与上游更新规则见[本地依赖维护](vendor/README.md)和 [Licia 工作流](vendor/packages/licia/MAINTENANCE.md)。

常用验证与打包命令：

```sh
npm test
npm run lint
npm run build
npm run pack -- --no-publish
```

`npm test` 执行应用回归和 Licia 两种 Node 测试模式；每种模式明确跳过 4 项依赖外部夹具的用例。上游浏览器/manual 测试、完整类型检查和真机验收分别处理。安装包输出到 `release/<version>/`，包含许可证声明；通用工具链和设备/打包原生资源仍需安装或下载。

干净检出准备、Windows Shell 配置和排错见[构建指南](docs/build-guide.md)，验证脚本和 CI 细节见[维护者参考](.agents/skills/scrcpy-harmony-project/references/development.md)。

## 项目来源与维护

本项目基于 [liriliri/echo](https://github.com/liriliri/echo)，由 MonsterXia 独立维护，保留原作者 surunzi 的署名与上游提交历史，遵循 [AGPL-3.0 许可证](LICENSE)。

核心依赖包括 [hdckit](https://github.com/liriliri/hdckit)（HDC 客户端）、[Luna](https://github.com/liriliri/luna)（UI 组件）和 [Licia](https://github.com/liriliri/licia)（工具库）。

- [用户指南](docs/user-guide.md)：安装、调试授权、设备选择、投屏与输入、日志导出。
- [构建指南](docs/build-guide.md)：从干净检出准备依赖，在 Windows/macOS 构建与启动 Electron。
- [仓库结构指南](docs/repository-guide.md)：源码布局、生成产物与本地构建流程。
- [本地依赖维护](vendor/README.md)：修改本地包、保留来源与更新上游快照。
- [维护计划](RUNBOOK.md)：当前进度、验收条件和后续工作。
- [维护来源记录](docs/maintenance/SOURCES.md)：上游 Issue、PR 与归档索引。
- [更新日志](CHANGELOG.md)：发行改动与历史版本。
