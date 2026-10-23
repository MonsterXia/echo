# Scrcpy Harmony 构建指南

[返回中文 README](../README_ZH.md) · [用户指南](user-guide.md) · [维护者开发与验证参考](../.agents/skills/scrcpy-harmony-project/references/development.md)

## 范围与准备

本指南于 2026-10-23 对照 master `1f05c37` 核对。公开发行版仍为 [v1.0.2](https://github.com/MonsterXia/scrcpy-harmony/releases/tag/v1.0.2)，tag 固定到 `1c545a7702547d8c53e31bcbfe7d76febc326cba`；master 的包版本同为 1.0.2，但包含[未发行的功能修复](user-guide.md#版本与支持范围)。构建时应记录完整提交号。

Windows x64 的历史干净构建、打包证据见 [M3-3](maintenance/M3-3.md)；同步主干前独立检出的依赖安装、全量测试、lint、三个模块构建，以及同步后的文档核对见[复核记录](maintenance/M3-3-release-guide.md)，没有重复下载设备资源或重做完整打包。macOS 命令仍与工作流一致，但没有 macOS 本机人工走读；[1.0.2 发行 Build](https://github.com/MonsterXia/scrcpy-harmony/actions/runs/39723571596)中两个原生 macOS runner 的构建、打包及安装启动结果是历史自动化证据。

准备 Git、Node.js **22.12.0 或更新版本**及 npm（CI 使用 Node 22）。Windows 需 Git for Windows 提供的 Git Bash、curl、unzip；macOS 需可用的 Bash、curl、unzip。构建需要联网获取 npm 依赖、子模块、HDC/uitestkit 和打包所需 Electron 资源。资源脚本只有 Windows/macOS 分支，没有 Linux 设备资源流程；Linux 上的 test/lint CI 不等于支持 Linux 桌面安装包。

在独立目录执行以下操作，保留本仓库锁文件和固定子模块提交。不要共用其他任务的可写 `node_modules`、`dist` 或 `release`。

## 获取源码与锁定依赖

以下命令适用于 PowerShell 或 macOS 终端，每条成功后再继续：

```text
git clone https://github.com/MonsterXia/scrcpy-harmony.git
cd scrcpy-harmony
git rev-parse HEAD
git submodule update --init --recursive
git submodule status
node --version
npm --version
npm ci --no-audit --no-fund
```

`src/share` 是必需的共享 Electron 代码；`src/renderer/icon` 提供图标源。子模块状态行首 `-` 表示尚未初始化，`+` 表示与仓库固定提交不同。GitHub 的源码 ZIP 不包含子模块内容，建议使用 Git clone。若需要基于公开 1.0.2 的源码构建，在子模块初始化和安装前执行 `git checkout v1.0.2`，再用 `git rev-parse HEAD` 核对上述源提交；master 含未发行改动，即使包版本仍显示 1.0.2 也不等于发行版。切回旧 tag 不保证重新构建的安装包与已发布文件逐字节相同，设备资源来源限制见下一节。

使用 `npm ci` 按 `package-lock.json` 安装；不要为了绕过安装错误删除锁文件或运行依赖升级命令。

## 准备设备资源

Windows PowerShell 中显式选择 Git Bash，避免 zx 调用不可用的 WSL Bash。以下路径适用于默认 Git for Windows 安装目录，安装在别处时替换路径：

```powershell
& 'C:/Program Files/Git/bin/bash.exe' -c 'command -v curl; command -v unzip'
npx --no-install zx --shell "C:/Program Files/Git/bin/bash.exe" script/resources.mjs
Get-Item resources/hdc/hdc.exe, resources/hdc/libusb_shared.dll, resources/uitestkit_sdk/uitest_agent_v1.1.0.so
```

macOS 终端执行：

```bash
command -v bash curl unzip
npm run init
ls -l resources/hdc/hdc resources/uitestkit_sdk/uitest_agent_v1.1.0.so
```

`init` 是 `resources` 的别名，资源落在本检出的 `resources/`。目前资源下载来自上游 `electron-resources/master`，不是锁文件管理的固定快照；脚本使用 `curl -Lk` 且没有资源哈希校验。本指南记录现状，不将锁文件安装称为整个构建链完全可复现，也不建议进一步关闭系统证书检查。

若下载报 TLS、连接或 ZIP 错误，停止后续构建，检查网络、代理及命令实际来源，网络恢复后重新运行同一资源命令。Windows 可用 `Get-Command curl.exe` 和上面的 Bash `command -v` 对照工具路径；仅指定 Bash 不代表 curl 一定来自 Git。不要把空目录或残留 ZIP 当作下载成功，也不要将另一任务的设备资源目录链接进来。

## 编译、检查与打包

在仓库根目录依次执行（Windows PowerShell、macOS 终端相同）：

```text
npm test
npm run lint
npm run build
npm run pack -- --no-publish
```

`build` 顺序编译 main、preload、renderer，复制设备资源与图标到 `dist`，写入发行包元数据，再在 `dist` 中执行 npm 安装；它不是纯离线编译。不要单独运行 `node script/build.mjs`，脚本需要 `npm run build` 提供的 npm 入口。三个 `build:*` 命令只转译对应模块，不完成资源复制和发行目录准备。

预期输出：

| 路径 | 用途 |
| --- | --- |
| `dist/main/index.js` | Electron 主进程 |
| `dist/preload/index.js`、`dist/renderer/index.html` | 桥接与 UI |
| `dist/resources/hdc/`、`dist/resources/uitestkit_sdk/` | 本机设备资源 |
| `release/<版本>/Scrcpy Harmony-<版本>-win-x64.exe` | Windows NSIS 安装包 |
| `release/<版本>/Scrcpy Harmony-<版本>-mac-<架构>.dmg` | macOS 原生架构安装包 |

本地文件名含空格，公开 v1.0.2 的安装包名使用连字符；不要据此误判缺包。该 Release 的 `latest.yml`、`latest-mac.yml`、`latest-x64-mac.yml` 分别对应 Windows x64、macOS arm64、macOS x64；`release-validation.json` 与 `SHA256SUMS.txt` 记录已发布文件的名称、大小或校验值，不应拿它们校验不同提交生成的本地包。打包按当前系统/Node 架构生成，请在目标平台的原生架构环境执行。`--no-publish` 禁止发布，打包完成不等于已经签名、公证或通过真机验收。

未配置签名凭据的本地验证可先设置 `CSC_IDENTITY_AUTO_DISCOVERY=false`（PowerShell：`$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'`；macOS：`export CSC_IDENTITY_AUTO_DISCOVERY=false`）。不要把空字符串设为 `CSC_LINK`：它可能被解释为证书路径。正式签名/公证和发布另按[发行记录](releases/1.0.2.md)处理。

## 开发启动

先完成依赖、子模块和设备资源准备。**先正常退出已安装的 Scrcpy Harmony 和其他使用同一配置的开发实例**，再在仓库根目录打开两个终端，避免同时写入相同配置文件；不需要为此终止共享 HDC 服务。

```text
# 终端 1：监听 main/preload 构建，启动 renderer 开发服务
npm run dev
```

```text
# 终端 2：等 main/preload 首次编译完成、Vite 服务就绪后启动桌面程序
npm start
```

`dev` 不会启动 Electron。Vite 端口配置为 **8080**，主进程开发加载地址也固定使用 8080；若 Vite 因占用转到 8081，请先解决端口冲突，不能直接继续。`start` 加载 `dist/main/index.js` 并打开 9229 inspector。HMR 已关闭，renderer 改动后需重新加载页面；main/preload 改动后退出并重启 Electron。

Electron 45 的运行时按需下载；如提示缺少 Electron 二进制，可先执行 `node node_modules/electron/install.js`，完成后再启动。主进程诊断保留终端 2 的相关输出，页面错误可在“帮助 → 切换开发人员工具”的 Console 查看；分享前脱敏。开发构建仍可能使用与已安装 Scrcpy Harmony 相同的配置目录，即使错开运行也可能改变该配置；启动会初始化真实 HDC。若当前禁止设备访问，不要运行 `npm start` 或设备验收脚本。

### 为什么不能直接在浏览器运行

React 页面使用 preload 注入的全局 `main`，经 Electron IPC 调用主进程，由主进程访问 HDC、文件系统和原生窗口。普通浏览器打开 `http://localhost:8080` 或 `dist/renderer/index.html` 没有这个桥接，不能单独作为 Web 版运行。`npm run dev:renderer` 也只启动 UI 开发服务。要支持真正浏览器客户端需要另行设计后端/通信与权限边界，当前仓库没有这一部署方式。

## 常见构建问题与验证边界

| 失败 | 检查方式 |
| --- | --- |
| Node engine 不符合要求 | 检查实际 `node --version` 与 npm 所在终端的 PATH，使用满足要求的 Node 22 环境 |
| 找不到 `share/*` | `git submodule update --init --recursive`，检查固定提交是否检出，不能靠创建空目录解决 |
| Windows 找不到 Bash / curl / unzip | 使用上方显式 Git Bash 命令并核对工具路径；PowerShell 自带的命令不能代替脚本所需的全部工具 |
| 资源复制失败或 EPERM | 停止重建，退出本检出启动的应用并确认资源是否被占用；共享 HDC 服务可能仍在使用文件，先协调占用方，不要批量杀 HDC 或其他任务进程 |
| `npm start` 缺少 main 文件 / 开发页面空白 | 等待 `npm run dev` 首次编译成功，检查 8080 端口、preload 编译和终端错误 |
| macOS 打包证书路径错误 | 检查是否遗留空 `CSC_LINK`；没有凭据的验证不要填写空证书路径，非空真实签名配置按自身发布流程保留 |

`npm test` 使用无设备替身，lint 检查源码，Vite 成功只表示构建通过，均不能替代真机投屏、输入和连接验收；项目没有独立 `typecheck` script。

CI 的五项检查为 `test`、`lint`、`windows-package`、`macos-package-arm64`、`macos-package-x64`。打包检查会在临时 runner 中安装并启动应用；不要在开发机绕过 `script/check-windows-install.ps1` 的 CI 限制，它可能替换已有安装。macOS 安装检查也只应在隔离环境运行，会启动设备层并清理 HDC。手动 Build 工作流验收安装包后上传 artifacts，不创建 Release；签名、公证、互联网下载后的信任提示和真机功能分别验收。更多脚本与 CI 说明见[维护者参考](../.agents/skills/scrcpy-harmony-project/references/development.md)。
