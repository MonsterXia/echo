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
| `npm run pack` | 使用已经准备好的 dist，经 electron-builder 输出安装包到 `release/<version>/` |
| `npm run gen:theme` / `npm run gen:icon` | 重新生成主题或图标；详见架构参考的生成文件说明 |

完整 `build` 会在生成的 dist 内执行安装命令，不能当作纯离线编译。三个 `build:*` 不负责下载或复制设备资源。Electron 45 的 npm 包在首次调用运行时按需下载二进制，单测和 lint 不触发下载；需要预先下载时运行 `node node_modules/electron/install.js`。

`build` 通过 Node 直接调用 npm 的 JavaScript 入口，不依赖 Bash；需通过 `npm run build` 启动以提供 `npm_execpath`。Windows 重建前应退出之前启动的应用，并检查其内置 HDC 服务是否仍占用 dist 中的可执行文件；必要时使用对应的 `hdc.exe kill` 停止该服务，避免复制资源时报 EPERM。

`npm run format` 会广泛改写文件，只在确实需要整体格式化时使用。`format` / `gen:*` 调用 `lsla`，当前 `package.json` 没有直接声明该工具；使用前检查工具来源和可用性，不假设 `npm install` 后一定具备。

没有独立的 `typecheck` script；Vite 构建也不能替代完整 TypeScript 类型检查。需要类型验证时先检查 TypeScript 工具是否可用及现有 tsconfig，再选择检查命令，报告具体结果，不将转译成功称为类型检查通过。

## 测试范围与验收

`test/screencast.test.cjs` 使用 Node 内置 `node:test`、`esbuild` 和 `node:vm` 加载真实 `ScreencastClient`。仅替换 Electron bridge、store、DOM Canvas 和图像加载边界，不需要启动 Electron、连接设备或准备 HDC 资源，也不依赖共享子模块实现。

当前 8 个用例覆盖：半尺寸帧到全尺寸触摸、请求 scale 与流尺寸不一致、全尺寸帧、请求 scale 改变而画面尚未改变、横竖屏尺寸更新、边缘释放的坐标夹取、首帧前无触摸、无效设备尺寸无触摸。用例数量可能随源码变化，以实际测试输出为准。

`test/build.test.cjs` 在带空格及 `&` 的临时路径中运行真实构建脚本，以 npm 替身验证发行目录、资源复制、元数据和子构建失败时立即停止；它不替代实际 Vite 构建、安装包生成及安装启动检查。

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

本机已有安装时可单独运行 `node script/smoke-app.mjs "C:/path/to/ECHO.exe"`，它使用临时用户配置并关闭自己启动的进程，不执行安装。macOS 可传入已安装应用的 `ECHO.app/Contents/MacOS/ECHO` 路径。启动自动化依赖 Electron 的调试接口，不修改发行程序或模拟 IPC；它不替代真实设备投屏、签名/SmartScreen 和人工视觉验收。

`macos-package-arm64` 和 `macos-package-x64` 使用标准 `macos-15` 与 `macos-15-intel` runner，分别在原生架构上完成依赖安装、资源下载、build 和 DMG 打包。两个任务固定相同系统版本，避免 latest 标签自动切换系统。`script/check-macos-install.mjs` 挂载 DMG，将 `.app` 复制到临时目录后卸载镜像，验证包内资源和可执行权限，再运行共享的启动检查。此检查校验实际架构，使用隔离用户配置并在退出后清理配置及 HDC 服务；只读仓库权限、不发布、不上传 artifact、不使用签名或公证 secrets。它不验证 Developer ID 签名、公证或从互联网下载后的 Gatekeeper 放行。

`script/pack.mjs` 配置 Windows NSIS exe 和 macOS dmg；读取 dist 内的包元数据及资源。`.github/workflows/build.yml` 仍为手动发行构建，矩阵含 Windows、macOS arm64 与 macOS 15 Intel runner，顺序为 checkout（含子模块）→ npm ci → init → build → pack → 上传产物。

Electron 45 的 macOS 最低系统要求为 macOS 13；升级后需在目标平台验证安装包及设备功能，单测和 lint 不代表完整运行兼容性。

签名环境变量来自 CI secrets。理解打包时查看配置即可，不需要为项目分析读取或配置真实签名凭据。
