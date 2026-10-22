# 开发、构建与验证

路径相对仓库根目录。命令依据 `package.json`、`vite*.ts`、`script/*.mjs` 与 `.github/workflows/`；运行前以这些文件的当前内容为准。

## 先检查环境

```powershell
git status --short
git submodule status
node --version
npm --version
Test-Path node_modules
Test-Path resources/hdc
Test-Path resources/uitestkit_sdk
```

两个子模块由 `.gitmodules` 声明：`src/share`（electron-share）、`src/renderer/icon`（icon-share）。`git submodule status` 行首 `-` 表示未初始化；目录存在也可能是空目录。完整应用构建需要共享代码，重新生成图标需要图标源。

仓库要求 Node >=22.12.0，CI 使用 Node 22。`package-lock.json` 随仓库跟踪，日常安装使用 `npm ci`；更改依赖时使用 `npm install` 并同时提交锁文件。Electron 固定为 45.0.0，标题栏依赖使用兼容它的 4.4.1 系列。

## 首次准备与启动

需要实际启动/构建时，在仓库根目录执行：

```powershell
git submodule update --init --recursive
npm ci
npm run init
```

`init` 是 `resources` 的别名，会下载 HDC 和 uitestkit；只读分析或文档修改无需为此安装依赖。`script/resources.mjs` 使用外部 `curl`、`unzip`，Windows 环境需确认这些命令可用（如 Git Bash 工具链）；不能假设只有 PowerShell 和 Node 就够。资源脚本按 Windows/非 Windows 分支选取 win/mac 包，没有 Linux 资源分支。

Windows 上若 zx 误选了不可用的 WSL Bash，可显式使用 Git Bash，例如 `npx zx --shell "C:/Program Files/Git/bin/bash.exe" script/resources.mjs`。

开发需要两个终端：

```powershell
# 终端 1：同时监听 main/preload 并启动 renderer Vite 服务
npm run dev
```

```powershell
# 终端 2：等 main/preload 首次编译完成后启动 Electron
npm start
```

`dev` 不负责启动 Electron；renderer 服务端口为 8080，Vite 配置关闭 HMR。`start` 加载 `dist/main/index.js` 并打开 9229 inspector。主进程或 preload 改动后需要重启 Electron 才能载入新的构建。

实际设备操作需要可用 HDC、已允许调试且可连接的鸿蒙设备；投屏/布局额外依赖匹配的 uitestkit 资源。HDC 默认使用内置资源；设置中的 `hdcPath` 可指定存在的可执行文件路径或字面值 `hdc`，后者依赖 PATH。选择逻辑在 `src/main/lib/hdc.ts`。

## 命令与作用

| 命令 | 作用 / 前提 |
| --- | --- |
| `npm test` | Node test runner 执行 `test/*.test.cjs`，需要已安装 npm 依赖 |
| `npm run lint` | ESLint 检查 `src` 下 ts/tsx；可能包含已初始化的共享子模块 |
| `npm run build:main` | Vite 将主进程打为 `dist/main/index.js`，需要共享子模块 |
| `npm run build:preload` | Vite 将 preload 打为 `dist/preload/index.js`，需要共享子模块 |
| `npm run build:renderer` | Vite 编译 UI 到 `dist/renderer`，需要共享子模块 |
| `npm run build` | 顺序执行以上三项，再复制图标及设备资源，生成发行目录内的 package.json，并在 dist 内执行 npm 安装 |
| `npm run pack -- --no-publish` | 使用已经准备好的 dist，经 electron-builder 输出安装包到 `release/<version>/`，用于本地和 CI 验证并禁止发布 |
| `npm run gen:theme` / `npm run gen:icon` | 重新生成主题或图标；详见架构参考的生成文件说明 |

完整 `build` 会在生成的 dist 内执行安装命令，不能当作纯离线编译。三个 `build:*` 不负责下载或复制设备资源。Electron 45 的 npm 包在首次调用运行时按需下载二进制，单测和 lint 不触发下载；需要预先下载时运行 `node node_modules/electron/install.js`。

`build` 通过 Node 直接调用 npm 的 JavaScript 入口，不依赖 Bash；需通过 `npm run build` 启动以提供 `npm_execpath`。Windows 重建前应退出之前启动的应用，并检查其内置 HDC 服务是否仍占用 dist 中的可执行文件；必要时使用对应的 `hdc.exe kill` 停止该服务，避免复制资源时报 EPERM。

`npm run format` 会广泛改写文件，只在确实需要整体格式化时使用。`format` / `gen:*` 调用 `lsla`，当前 `package.json` 没有直接声明该工具；使用前检查工具来源和可用性，不假设 `npm install` 后一定具备。

没有独立的 `typecheck` script；Vite 构建也不能替代完整 TypeScript 类型检查。需要类型验证时先检查 TypeScript 工具是否可用及现有 tsconfig，再选择检查命令，报告具体结果，不将转译成功称为类型检查通过。

## 测试范围与验收

`test/screencast.test.cjs` 使用 Node 内置 `node:test`、`esbuild` 和 `node:vm` 加载真实 `ScreencastClient`。仅替换 Electron bridge、store、DOM Canvas 和图像加载边界，不需要启动 Electron、连接设备或准备 HDC 资源，也不依赖共享子模块实现。

当前 8 个用例覆盖：半尺寸帧到全尺寸触摸、请求 scale 与流尺寸不一致、全尺寸帧、请求 scale 改变而画面尚未改变、横竖屏尺寸更新、边缘释放的坐标夹取、首帧前无触摸、无效设备尺寸无触摸。用例数量可能随源码变化，以实际测试输出为准。

`test/build.test.cjs` 在带空格及 `&` 的临时路径中运行真实构建脚本，以 npm 替身验证发行目录、资源复制、元数据和子构建失败时立即停止；它不替代实际 Vite 构建、安装包生成及安装启动检查。

`test/updater.test.cjs` 验证 Windows、macOS arm64/x64 的 GitHub 源和通道覆盖，包括清除共享更新器遗留通道的影响。它使用替身，不访问 GitHub、不验证线上 Release 元数据或下载。2026-10-21 基线共有 13 项测试（投屏 8、构建 2、更新配置 3）；此后数量以实际运行结果为准。

| 修改类别 | 有意义的验证 |
| --- | --- |
| 仅项目文档/skill | 检查 YAML、引用路径、源码事实和按任务检索是否充分；无需启动设备 |
| 投屏坐标或事件逻辑 | `npm test`；涉及显示与设备行为时再做 Electron/真机验证 |
| renderer / preload / main 修改 | 有关单测、lint、对应 `build:*`；跨进程改动检查两端并在 Electron 中走通 |
| 资源或打包修改 | 确认资源存在，完整 build、pack，并在目标平台检查安装包 |

单测没有验证真实 JPEG 解码、Canvas 渲染、IPC 传输、HDC 连接或 UiDriver 的设备兼容性。真机投屏验收可覆盖：首次出图、点击/拖动/边缘释放、缩放和旋转、切换/断开设备、关闭重开窗口。仅改其中一项时按影响范围选择验收。

依赖、子模块或设备不齐时，明确记录未能执行的检查及原因，避免把环境缺失归为业务代码失败，也不声称未运行的检查已通过。

## 打包与 CI

`.github/workflows/ci.yml` 对目标为 `master` 的所有 PR、master push 和手动触发运行独立的 `test`、`lint`、`windows-package`、`macos-package-arm64`、`macos-package-x64` 检查。`test`、`lint` 使用 Ubuntu、Node 22 和 `npm ci`，不下载 Electron 二进制或设备资源，也不需要初始化子模块。没有路径过滤，文档 PR 同样会产生检查结果；检查名用于 master 分支保护，重命名前需同步更新 GitHub 设置。

`windows-package` 使用标准 Windows runner 和 Node 22，初始化子模块并执行 npm ci → 下载设备资源（显式指定 Git Bash）→ build → pack → 验证非空的 NSIS x64 安装包、应用程序、app.asar、HDC 和 uitestkit 文件 → 安装与启动检查。通过 `npm run pack -- --no-publish` 禁止发布，不使用签名 secrets，也不上传安装包 artifact；任务超时为 20 分钟。

`script/check-windows-install.ps1` 仅允许在 GitHub 托管 Windows runner 上运行：静默安装到包含空格的临时目录（限时 120 秒），再执行 `script/smoke-app.mjs`。NSIS 可能替换同 app ID 的已有安装，因此不要在开发机上绕过此限制。启动脚本使用锁定版本的 `playwright-core` 驱动已安装的 Electron，无需下载额外浏览器；检查实际 exe/app.asar 路径、版本、隔离用户目录、主窗口可见性、React 初始化、preload/设备枚举 IPC、设置页、页面异常及正常退出。启动检查整体限时 90 秒，失败输出进程日志；CI 最后停止 HDC 服务。

本机已有安装时可单独运行 `node script/smoke-app.mjs "C:/path/to/Scrcpy Harmony.exe"`，它使用临时用户配置并关闭自己启动的进程，不执行安装。macOS 可传入已安装应用的 `"/path/to/Scrcpy Harmony.app/Contents/MacOS/Scrcpy Harmony"` 路径。启动自动化依赖 Electron 的调试接口，不修改发行程序或模拟 IPC；它不替代真实设备投屏、签名/SmartScreen 和人工视觉验收。

`macos-package-arm64` 和 `macos-package-x64` 使用标准 `macos-15` 与 `macos-15-intel` runner，分别在原生架构上完成依赖安装、资源下载、build 和 DMG 打包。两个任务固定相同系统版本，避免 latest 标签自动切换系统。`script/check-macos-install.mjs` 挂载 DMG，将 `.app` 复制到临时目录后卸载镜像，验证包内资源和可执行权限，再运行共享的启动检查。此检查校验实际架构，使用隔离用户配置并在退出后清理配置及 HDC 服务；只读仓库权限、不发布、不上传 artifact、不使用签名或公证 secrets。它不验证 Developer ID 签名、公证或从互联网下载后的 Gatekeeper 放行。

`script/pack.mjs` 配置 Windows NSIS exe 和 macOS dmg；读取 dist 内的包元数据及资源。`.github/workflows/build.yml` 是手动产物构建（workflow_dispatch），矩阵与 CI 对齐为 `windows-latest` x64、`macos-15` arm64、`macos-15-intel` x64，并核验 Node 实际架构。顺序为 checkout（含子模块）→ npm ci → 下载资源（Windows 显式 Git Bash）→ build → pack --no-publish → 使用现有安装脚本验收实际安装包 → 记录签名和 SHA-256 → 上传 artifact。任一安装启动检查失败时不上传该平台 artifact。产物附带 `verification-win-x64.json` 或 `verification-mac-<arch>.txt`，记录源 SHA、运行链接、安装启动结果和系统签名检查；macOS 另外记录 Gatekeeper 与 stapler 退出码。信任检查失败如实记录，不把未签名包可启动等同于签名/公证通过。该 workflow 不创建 GitHub Release，真机及用户从互联网下载后的信任体验仍需单独验收。

Electron 45 的 macOS 最低系统要求为 macOS 13；升级后需在目标平台验证安装包及设备功能，单测和 lint 不代表完整运行兼容性。

打包更新元数据使用 `MonsterXia/scrcpy-harmony` 的 GitHub Releases 源。Windows / macOS arm64 使用 `latest`，macOS x64 使用 `latest-x64`；手动构建 workflow 显式 `--no-publish`，仅上传安装包、YAML 更新元数据和 blockmap 为 artifact，不创建 Release。正式发布时需将各平台安装包及配套更新文件放入本仓库相应版本的 Release。electron-builder 的 GitHub 更新 YAML 使用安全文件名（例如 `Scrcpy-Harmony-...`），可能不同于本地带空格的安装包名；上传前按 YAML 的 URL 命名安装包和配套 blockmap，保持字节不变，并核对 size、SHA-512 和远端 SHA-256。无 Release 时检查更新可能报错，不能回退到上游。

## 实际打包应用的更新验收

M0-3 的 `.github/workflows/update-acceptance.yml` 是固定版本的实际更新验收：在三个原生 runner 上从固定提交打包 1.0.1，下载并核对公开 1.0.2 安装包 SHA-256，再使用 `script/install-update-check.mjs` 安装两版。安装器包装只允许 GitHub 托管临时 runner，不能在开发机绕过限制。该 workflow 可手动运行，也在修改验收脚本/自身的 PR 上运行，不改变五项必需 CI 检查名称。

`script/check-packaged-update.mjs <已安装程序路径> <1.0.1或1.0.2> <证据目录>` 使用隔离配置启动真实 app.asar，通过实际菜单回调触发检查；记录 `electron-updater` 网络会话的请求、重定向和最终响应，检查真实 IPC 驱动的提示并截图。网络错误通过取消该会话请求注入，之后恢复网络再检查；不替换更新器结果或应用版本。确认有更新时包装 `shell.openExternal` 记录 URL 并调用原方法，验收操作系统是否接受 Releases 跳转；不声称检查了默认浏览器页面内容。报告包含安装包哈希、运行版本/架构、JSON 和应用日志，CDN 临时签名查询参数不写入网络记录。本验收固定目标为 v1.0.2；发布后续版本后须显式更新对照版本、预期提示和安装包哈希，不能将旧断言继续用于新 Release。

## 当前验证基线与后续维护

2026-10-21 的 [PR #8 CI](https://github.com/MonsterXia/scrcpy-harmony/actions/runs/39611929271) 已通过 test、lint 及 Windows/macOS arm64/macOS x64 的安装包、安装和启动检查；这是该提交的历史结果，后续改动仍需自己的检查。真实设备、签名/公证、线上更新检查及普通用户操作文档的待办见 [RUNBOOK](../../../../RUNBOOK.md)。

签名环境变量来自 CI secrets；手动 Build 在打包前移除空值，防止缺失的 `CSC_LINK` 被当作证书路径，非空凭据保留。理解打包时查看配置即可，不需要为项目分析读取或配置真实签名凭据。
