# 开发、构建与验证

路径相对仓库根目录。命令依据 `package.json`、`vite*.ts`、`script/*.mjs` 与 `.github/workflows/`；运行前以这些文件的当前内容为准。

## README 语言约定

仓库默认入口 `README.md` 为英文，`README_ZH.md` 为简体中文，两份文件顶部互相链接。修改功能说明、安装要求、命令或发行限制时同步更新两种语言，保持徽章、下载入口与命令一致。英文操作说明保留必要的中文界面标签，便于对应当前 UI；其余用户、构建和维护文档暂以中文为主。

## 先检查环境

修改用户可见文案或 UI 时，同时遵循[国际化流程](internationalization.md)。`npm run check:i18n` 检查中英文词典、占位符、引用和常见硬编码；已接入 lint 和应用测试。语言选择/第三方弹窗/启动顺序回归在 `test/i18n.test.cjs`，检查器回归在 `test/i18n-check.test.cjs`；静态通过不能代替双语布局验收。

```powershell
git status --short
node --version
npm --version
Test-Path node_modules
Test-Path resources/hdc
Test-Path resources/uitestkit_sdk
```

`src/share` 与 `src/renderer/icon` 已由固定上游快照转为普通跟踪目录；来源见 `vendor/manifest.json`。只有检出 v1.0.3 或更早 tag 才需要按该版本指南初始化子模块。

仓库要求 Node >=22.12.0，CI 使用 Node 22。`package-lock.json` 随仓库跟踪，日常安装使用 `npm ci`，postinstall 自动编译本地 HDC/Licia/Luna；更改依赖时使用 `npm install` 并同时提交锁文件。Electron 固定为 45.0.0，标题栏依赖使用兼容它的 4.4.1 系列。

## 首次准备与启动

需要实际启动/构建时，在仓库根目录执行：

```powershell
npm ci
npm run init
```

`init` 是 `resources` 的别名，会下载 HDC 和 uitestkit；只读分析或文档修改无需为此安装依赖。`script/resources.mjs` 使用外部 `curl`、`unzip`，Windows 环境需确认这些命令可用（如 Git Bash 工具链）；不能假设只有 PowerShell 和 Node 就够。资源脚本按 Windows/非 Windows 分支选取 win/mac 包，没有 Linux 资源分支。

Windows 上若 zx 误选了不可用的 WSL Bash，可显式使用 Git Bash，例如 `npx zx --shell "C:/Program Files/Git/bin/bash.exe" script/resources.mjs`。

开发需要两个终端：

```powershell
# 终端 1：编译并监听本地依赖、main/preload，启动 renderer Vite 服务
npm run dev
```

```powershell
# 终端 2：等本地依赖、main/preload 编译完成及 Vite 就绪后启动 Electron
npm start
```

`dev` 不负责启动 Electron；renderer 服务端口为 8080，Vite 配置关闭 HMR。`start` 加载 `dist/main/index.js` 并打开 9229 inspector。本地依赖成功重编译会触发 Vite 重启并更新依赖预打包；等待就绪后手动刷新 renderer。主进程、preload 或其依赖改动后需要重启 Electron 才能载入新的构建。不要在同一检出并行运行会重写生成目录的 build/test/dev。

实际设备操作需要可用 HDC、已允许调试且可连接的鸿蒙设备；投屏/布局额外依赖匹配的 uitestkit 资源。HDC 默认使用内置资源；设置中的 `hdcPath` 可指定存在的可执行文件路径或字面值 `hdc`，后者依赖 PATH。选择逻辑在 `src/main/lib/hdc.ts`。

## 命令与作用

| 命令 | 作用 / 前提 |
| --- | --- |
| `npm run build:vendor` | 从本仓源码编译 HDC/Licia/Luna；不联网、不运行上游安装脚本；不等于完整类型检查 |
| `npm test` | 预先编译本地包，执行 `test/*.test.cjs` 应用回归，再运行 Licia 生产和隔离 fallback 两种 Node 测试模式 |
| `npm run test:licia -- cloneDeep` | 预先编译本地包，再运行指定 Licia 模块测试；省略模块名运行全部可用 Node 测试 |
| `npm run test:licia -- --fallback cloneDeep` | 在临时目录生成并验证指定模块的兼容实现，不改生产产物 |
| `npm run lint` | ESLint 检查 `src` 下 ts/tsx；包括内置共享代码 |
| `npm run build:main` | Vite 将主进程打为 `dist/main/index.js`，预先编译本地依赖并使用内置共享源码 |
| `npm run build:preload` | Vite 将 preload 打为 `dist/preload/index.js`，预先编译本地依赖并使用内置共享源码 |
| `npm run build:renderer` | Vite 编译 UI 到 `dist/renderer`，预先编译本地依赖并使用内置共享源码 |
| `npm run build` | 顺序执行三个应用构建，再复制图标、设备资源及许可证，生成发行目录内的 package.json，并在 dist 内执行 npm 安装 |
| `npm run pack -- --no-publish` | 使用已经准备好的 dist，经 electron-builder 输出安装包到 `release/<version>/`，用于本地和 CI 验证并禁止发布 |
| `npm run gen:theme` / `npm run gen:icon` | 重新生成主题或图标；详见架构参考的生成文件说明 |

完整 `build` 会在生成的 dist 内执行安装命令，不能当作纯离线编译。三个 `build:*` 不负责下载或复制设备资源。Electron 45 的 npm 包在首次调用运行时按需下载二进制，单测和 lint 不触发下载；需要预先下载时运行 `node node_modules/electron/install.js`。

`build` 通过 Node 直接调用 npm 的 JavaScript 入口，不依赖 Bash；需通过 `npm run build` 启动以提供 `npm_execpath`。Windows 重建前应退出之前启动的应用，并检查其内置 HDC 服务是否仍占用 dist 中的可执行文件；必要时使用对应的 `hdc.exe kill` 停止该服务，避免复制资源时报 EPERM。

`npm run format` 会广泛改写文件，只在确实需要整体格式化时使用。`format` / `gen:*` 调用 `lsla`，当前 `package.json` 没有直接声明该工具；使用前检查工具来源和可用性，不假设 `npm install` 后一定具备。

没有独立的 `typecheck` script；Vite 构建也不能替代完整 TypeScript 类型检查。需要类型验证时先检查 TypeScript 工具是否可用及现有 tsconfig，再选择检查命令，报告具体结果，不将转译成功称为类型检查通过。

## 测试范围与验收

投屏性能验证脚本：`node script/check-native-video.cjs <报告.json>` 在真实 Electron 中使用生产 CaptureUiDriver/ScreencastClient 测量 H.264 输入/绘制，验证缩放重启和重开；`node script/check-screencast-stream.cjs <报告.json>` 对照 JPEG 原/修复 TCP 解析器。关闭主应用、只连接一台手机并保持动态画面；先运行 `npm run resources` 准备原生资源，H.264 探针与应用一样自动部署。可追加 `--without-preinstalled` 临时移走原有库以验证独立部署，脚本先写恢复记录，子进程 finally 与父进程超时恢复共用校验逻辑；恢复失败保留记录并报错。普通运行不移动原有库。两者只保存统计，不保存屏幕帧；复用的 HDC 转发不可被探针删除。无设备回归包括 native-video-protocol、native-video-stream、native-video-resources、native-video-archive、native-video-deployment、native-video-command、probe-backup、h264-decoder、uitest-stream、capture-sessions 和 screencast-lifecycle。实时采样不能替代长期性能/旋转/拔插验收，资源来源和兼容范围见 `docs/maintenance/native-video-deployment.md`，早期流接入记录见 `docs/maintenance/screencast-video-design.md`。

本地依赖回归见 `test/vendor.test.cjs`；Licia 原始用例位于 `vendor/packages/licia/test/`，由 `script/test-licia.mjs` 选择 Node 适用模块，在临时目录运行。生产/fallback 两种模式均明确保留 4 项外部夹具测试为 pending；浏览器/manual 用例保留但不自动运行。修改流程、排除原因及生成器边界见 [Licia 维护说明](../../../../vendor/packages/licia/MAINTENANCE.md)，目录和构建职责见[仓库结构指南](../../../../docs/repository-guide.md)。

物理断连和空闲后概览验证使用 `node script/check-overview-physical-idle.mjs <证据目录> 600`（先完整 build）。按脚本阶段提示人工拔插 USB，检查真实 tracker/选择/详情清空与重连，再保持指定秒数无业务操作，记录正常 tracker 轮询及进程资源采样，最后验证 IPC 与实际刷新。报告分别标记自动恢复与一次手动刷新恢复；总通过不等于自动恢复稳定，必须并列保留失败轮次。脚本不模拟断连，不输出设备标识或原始日志；有限时长不替代原始长期空闲问题验收。边界与记录见 [物理断连及空闲报告](../../../../docs/maintenance/M2-2-physical-idle.md)。

该脚本同时记录阶段时序及最多 2000 条 shell 响应摘要，包含丢弃数、关闭和分类停用标志。响应观察器超限时仅停止分类，仍透传原始流；`output` 不是命令成功或退出码。USB 模式弹窗的人工等待须与实际命令耗时分开，见[重连诊断说明](../../../../docs/maintenance/M2-2-reconnect-diagnostics.md)。

完整概览真机验收可在完整 build 后运行 `node script/check-overview-live.mjs <证据目录> --all-stages`。它在隔离 Electron 配置中保留真实 preload/IPC/getOverview/UI，通过只读命令白名单代理分别注入五阶段明确错误和无回复，验证详情清空、连接关闭及下一次恢复。省略 `--all-stages` 仅检查内存/屏幕。脚本需要一台已授权设备和已有 HDC 服务，不启动/停止服务或写入设备；报告只保留布尔结果、计数、耗时、源码及实际构建资产哈希。受控故障不等于物理断连、授权失败、负载或长期空闲验收，详见 [完整概览记录](../../../../docs/maintenance/M2-2-overview-live.md)。

`test/targets.test.cjs` 通过现有 esbuild/VM 测试方式加载真实 `hdc.ts` 并调用其注册的 `getTargets` 处理器，只替换 HDC、Electron 和初始化副作用边界。覆盖逐设备失败、同步目标查找失败、版本格式/缺失值、显示字段归一化、空列表/全失败/枚举失败诊断及下一次刷新恢复。测试无需真机或真实共享模块初始化，不替代实际连接变化验证。

真机设备枚举可在完整 `npm run build` 后运行 `node script/check-targets-live.mjs <证据目录>`；加 `--reconnect` 后按输出提示拔出 USB，等待确认断开再接回。脚本使用隔离用户配置，观察真实 HDC → IPC → renderer 设备列表、当前选择、select 控件和 `changeTarget` 事件；不模拟连接事件，不停止开发机已有 HDC 服务。此脚本运行本地 dist，属于未发布源码构建验证；打包安装启动仍由 CI 验证。输出将已发现设备 key 替换为 `DEVICE_n`，公开归档前仍需检查日志。

`test/bundles.test.cjs` 同时加载真实 `hdc/bundle.ts` 与 `hdc/base.ts`，调用已注册的 getBundleInfos 处理器，仅替换 HDC transport、在线元数据与 Electron 注册边界。覆盖混合命令失败/错误文本/坏 JSON、缺失主模块、分隔符碰撞、包名对应关系、在线失败回退及下一次刷新。模拟删除/重装不等于真机安装/卸载验收。

拖入专项：`node script/check-hap-drop-live.cjs <基础hap> <升级hap> <证据目录> --disposable [--executable <打包应用二进制>] [--language en-US]`。仅允许 `com.example.testhap` 专用样本，检查两包版本，先移除已有测试包以验证首次安装，最后保留升级版。使用真实 OS 文件支持的 Chromium 拖放、preload/IPC/HDC；覆盖主窗口内容/工具栏/概览、投屏普通/全屏、大小写/特殊路径、多文件部分失败、刷新期间及双窗口并发。无设备/不可读取文件由单测覆盖，物理断连和跨平台另验。仅保存统计与本地通知裁剪图，不保存手机画面；详见[拖入记录](../../../../docs/maintenance/hap-drop.md)。

拖入报告 `evidenceVersion: 2` 要求每次成功后发起并完成新的主窗口应用列表查询，逐条检查成功/失败/不支持通知插入时的显示样式、有效尺寸、窗口边界与全屏归属。刷新重叠场景暂扣一次真实清单响应，安装结束后释放并核对再次查询；不替换 HDC 返回值。`--negative-control-stale-refresh` 在已有升级包后屏蔽安装广播，预期退出非零且报告“no fresh list request”；不能把这轮 `passed: false` 计为业务验收失败。打包哈希从运行应用的 `app.getAppPath()` 读取，不假设 macOS 目录结构。Windows 路径样本避开非法尖括号，转义由 renderer mock 测试补齐。

安装/升级验收：完整 build 后运行 `node script/check-hap-install-live.mjs <hap> <bundleName> <证据目录> --disposable --upgrade-hap <较新hap>`（需要 `unzip`）。仅用于用户授权的可卸载测试包，真实执行双语首次安装、升级、同版本覆盖与卸载，验证成功通知、自动刷新和其他应用集合；默认拒绝已有测试包，显式 `--reset-existing-test-app` 才允许先卸载。文件选择及原生菜单选择由探针代选，设备/IPC 不替换。成功最终卸载测试包，失败可能保留已安装包；时间戳核对不等于数据内容保持验收。见[证据与边界](../../../../docs/maintenance/hap-install.md)。

完整 build 后可运行 `node script/check-bundles-live.mjs <证据目录>`：需要一台已授权鸿蒙设备，使用隔离配置验证真实正常包与不存在包混合查询、应用面板加载与手动刷新。脚本只读设备，不安装/卸载；保存运行与页面错误记录，并脱敏设备标识及非抽样包名。主模块源码 SHA-256 随报告保存，公开归档前仍需检查日志。

图标专项验证使用 `node script/check-bundle-icon-live.mjs <证据目录> [offline]`。启动时不挂载功能面板，再将应用选择范围限制为 bilibili；真实元数据处理器、HDC 与 renderer 保留。离线模式同时拒绝 Node HTTP(S) 和 Chromium 联网，并验证探针确实经过代理；检查两种视图的图片解码/哈希和真实刷新完成。报告中的 `verificationPassed` 与 `offlineIconAcceptancePassed` 分别表示验证步骤完成和离线应用图标通过，不能混同。只保存指定应用字段与裁剪面板，不收集完整应用列表、设备 key 或原始日志；不执行安装、卸载、提权。全新配置的冷启动结果不代表进程内热缓存切换已验收。

`test/screencast.test.cjs` 使用 Node 内置 `node:test`、`esbuild` 和 `node:vm` 加载真实 `ScreencastClient`。仅替换 Electron bridge、store、DOM Canvas 和图像加载边界，不需要启动 Electron、连接设备或准备 HDC 资源，也不依赖真实共享模块初始化。

`test/screencast-window-lifecycle.test.cjs` 验证真实主进程窗口模块关闭、直接销毁和重开；`test/capture-sessions.test.cjs` 验证 sender/frame/session 隔离、主进程每设备队列、本地精确退订、迟到 start 补偿、stop 拒绝及初始化去重，保留真实 hdckit 捕获方法。`node script/audit-capture-close.cjs` 已升级为当前合成本地释放探针，要求关窗等边界监听及旧帧投递为 0；其成功不代表设备端停止。上述测试不依赖 `src/share`、Electron runtime 或设备。真实 Electron 无设备脚本、源码哈希与边界见 [Electron 验收](../../../../docs/maintenance/M2-3-capture-electron.md)，设计和剩余限制见 [捕获会话报告](../../../../docs/maintenance/M2-3-capture-ownership.md)。

当前 8 个用例覆盖：半尺寸帧到全尺寸触摸、请求 scale 与流尺寸不一致、全尺寸帧、请求 scale 改变而画面尚未改变、横竖屏尺寸更新、边缘释放的坐标夹取、首帧前无触摸、无效设备尺寸无触摸。用例数量可能随源码变化，以实际测试输出为准。

`test/build.test.cjs` 在带空格及 `&` 的临时路径中运行真实构建脚本，以 npm 替身验证发行目录、资源复制、元数据和子构建失败时立即停止；它不替代实际 Vite 构建、安装包生成及安装启动检查。

`test/updater.test.cjs` 验证三平台元数据通道、真实 AppUpdater 的自定义 Provider/不降级行为及 FileStore 写盘重读。`test/release-provider.test.cjs`、`test/release-page.test.cjs` 验证正式/预发布筛选、SemVer 顺序、完整分页、限流备用路径、取消和元数据 tag 一致性。`test/update-check.test.cjs` 验证即时进度、重复检查、初始化前取消/迟到结果/排空后重试、错误和不可适用版本。`test/update-window.test.cjs` 验证父窗口恢复、尺寸及 IPC frame 权限；`test/update-view.test.cjs` 验证 React 初始状态竞态、键盘操作和退订；`test/update-menu.test.cjs` 验证 Windows 菜单刷新及 Beta 勾选状态。网络与窗口替身不能冒充实机/实际网络验收；隔离 Electron 在线与样式验证见 `docs/maintenance/beta-update-ui.md`。早期更新修复证据仍保留在 `update-check-recovery.md`。

| 修改类别 | 有意义的验证 |
| --- | --- |
| 仅项目文档/skill | 检查 YAML、引用路径、源码事实和按任务检索是否充分；无需启动设备 |
| 投屏坐标或事件逻辑 | `npm test`；涉及显示与设备行为时再做 Electron/真机验证 |
| renderer / preload / main 修改 | 有关单测、lint、对应 `build:*`；跨进程改动检查两端并在 Electron 中走通 |
| 资源或打包修改 | 确认资源存在，完整 build、pack，并在目标平台检查安装包 |

单测没有验证真实 JPEG 解码、Canvas 渲染、IPC 传输、HDC 连接或 UiDriver 的设备兼容性。真机投屏验收可覆盖：首次出图、点击/拖动/边缘释放、缩放和旋转、切换/断开设备、关闭重开窗口。仅改其中一项时按影响范围选择验收。

依赖、共享源码或设备不齐时，明确记录未能执行的检查及原因，避免把环境缺失归为业务代码失败，也不声称未运行的检查已通过。

## 投屏键盘验证

定向回归：`node --test test/screencast-input.test.cjs test/screencast-input-main.test.cjs test/screencast-fit.test.cjs`。覆盖 IME 提交、局部焦点、纯文本粘贴、快捷键、自动粘贴来源切换、异步快照取消、会话与排队取消、文本安全编码和全屏尺寸；属于 JSDOM/模拟 HDC 检查。真机验收使用无提交副作用的输入框及合成文本，另验证普通 Ctrl+C/X→Ctrl+V、电脑复制新文本、电脑空剪贴板和右键显式来源。Electron 45 剪贴板备份若用于测试，需读取各 MIME 的内容并构造新的 ClipboardItem 才能 write；不能将 read 返回的对象直接交回 write。验收边界见 `docs/maintenance/screencast-input.md`。

## 打包与 CI

`.github/workflows/ci.yml` 对目标为 `master` 的所有 PR、master push 和手动触发运行独立的 `test`、`lint`、`windows-package`、`macos-package-arm64`、`macos-package-x64` 检查。`test`、`lint` 使用 Ubuntu、Node 22 和 `npm ci`，不下载 Electron 二进制或设备资源，也不需要初始化子模块。没有路径过滤，文档 PR 同样会产生检查结果；检查名用于 master 分支保护，重命名前需同步更新 GitHub 设置。

`windows-package` 使用标准 Windows runner 和 Node 22，执行 npm ci（含本地依赖编译） → 下载设备资源（显式指定 Git Bash）→ build → pack → 验证非空的 NSIS x64 安装包、应用程序、app.asar、HDC 和 uitestkit 文件 → 安装与启动检查。通过 `npm run pack -- --no-publish` 禁止发布，不使用签名 secrets，也不上传安装包 artifact；任务超时为 20 分钟。

`script/check-windows-install.ps1` 仅允许在 GitHub 托管 Windows runner 上运行：静默安装到包含空格的临时目录（限时 120 秒），再执行 `script/smoke-app.mjs`。NSIS 可能替换同 app ID 的已有安装，因此不要在开发机上绕过此限制。启动脚本使用锁定版本的 `playwright-core` 驱动已安装的 Electron，无需下载额外浏览器；检查实际 exe/app.asar 路径、版本、隔离用户目录、主窗口可见性、React 初始化、preload/设备枚举 IPC、设置页、页面异常及正常退出。启动检查整体限时 90 秒，失败输出进程日志；CI 最后停止 HDC 服务。

本机已有安装时可单独运行 `node script/smoke-app.mjs "C:/path/to/Scrcpy Harmony.exe"`，它使用临时用户配置并关闭自己启动的进程，不执行安装。macOS 可传入已安装应用的 `"/path/to/Scrcpy Harmony.app/Contents/MacOS/Scrcpy Harmony"` 路径。启动自动化依赖 Electron 的调试接口，不修改发行程序或模拟 IPC；它不替代真实设备投屏、签名/SmartScreen 和人工视觉验收。

`macos-package-arm64` 和 `macos-package-x64` 使用标准 `macos-15` 与 `macos-15-intel` runner，分别在原生架构上完成依赖安装、资源下载、build 和 DMG 打包。两个任务固定相同系统版本，避免 latest 标签自动切换系统。`script/check-macos-install.mjs` 挂载 DMG，将 `.app` 复制到临时目录后卸载镜像，验证包内资源和可执行权限，再运行共享的启动检查。此检查校验实际架构，使用隔离用户配置并在退出后清理配置及 HDC 服务；只读仓库权限、不发布、不上传 artifact、不使用签名或公证 secrets。它不验证 Developer ID 签名、公证或从互联网下载后的 Gatekeeper 放行。

`script/pack.mjs` 配置 Windows NSIS exe 和 macOS dmg；读取 dist 内的包元数据及资源。`.github/workflows/build.yml` 是手动产物构建（workflow_dispatch），矩阵与 CI 对齐为 `windows-latest` x64、`macos-15` arm64、`macos-15-intel` x64，并核验 Node 实际架构。顺序为 checkout → npm ci（含本地依赖编译） → 下载资源（Windows 显式 Git Bash）→ build → pack --no-publish → 使用现有安装脚本验收实际安装包 → 记录签名和 SHA-256 → 上传 artifact。任一安装启动检查失败时不上传该平台 artifact。产物附带 `verification-win-x64.json` 或 `verification-mac-<arch>.txt`，记录源 SHA、运行链接、安装启动结果和系统签名检查；macOS 另外记录 Gatekeeper 与 stapler 退出码。信任检查失败如实记录，不把未签名包可启动等同于签名/公证通过。该 workflow 不创建 GitHub Release，真机及用户从互联网下载后的信任体验仍需单独验收。

Electron 45 的 macOS 最低系统要求为 macOS 13；升级后需在目标平台验证安装包及设备功能，单测和 lint 不代表完整运行兼容性。

打包更新元数据使用 `MonsterXia/scrcpy-harmony` 的 GitHub Releases 源。Windows / macOS arm64 使用 `latest`，macOS x64 使用 `latest-x64`；手动构建 workflow 显式 `--no-publish`，仅上传安装包、YAML 更新元数据和 blockmap 为 artifact，不创建 Release。正式发布时需将各平台安装包及配套更新文件放入本仓库相应版本的 Release。electron-builder 的 GitHub 更新 YAML 使用安全文件名（例如 `Scrcpy-Harmony-...`），可能不同于本地带空格的安装包名；上传前按 YAML 的 URL 命名安装包和配套 blockmap，保持字节不变，并核对 size、SHA-512 和远端 SHA-256。无 Release 时检查更新可能报错，不能回退到上游。

## 实际打包应用的更新验收

M0-3 的 `.github/workflows/update-acceptance.yml` 是固定版本的实际更新验收：在三个原生 runner 上从固定提交打包 1.0.1，下载并核对公开 1.0.2 安装包 SHA-256，再使用 `script/install-update-check.mjs` 安装两版。安装器包装只允许 GitHub 托管临时 runner，不能在开发机绕过限制。该 workflow 可手动运行，也在修改验收脚本/自身的 PR 上运行，不改变五项必需 CI 检查名称。

`script/check-packaged-update.mjs <已安装程序路径> <1.0.1或1.0.2> <证据目录>` 使用隔离配置启动真实 app.asar，通过实际菜单回调触发检查；记录 `electron-updater` 网络会话的请求、重定向和最终响应，检查真实 IPC 驱动的提示并截图。网络错误通过取消该会话请求注入，之后恢复网络再检查；不替换更新器结果或应用版本。确认有更新时包装 `shell.openExternal` 记录 URL 并调用原方法，验收操作系统是否接受 Releases 跳转；不声称检查了默认浏览器页面内容。报告包含安装包哈希、运行版本/架构、JSON 和应用日志，CDN 临时签名查询参数不写入网络记录。本验收固定目标为 v1.0.2；发布后续版本后须显式更新对照版本、预期提示和安装包哈希，不能将旧断言继续用于新 Release。

## 当前验证基线与后续维护

2026-10-21 的 [PR #8 CI](https://github.com/MonsterXia/scrcpy-harmony/actions/runs/39611929271) 已通过 test、lint 及 Windows/macOS arm64/macOS x64 的安装包、安装和启动检查；这是该提交的历史结果，后续改动仍需自己的检查。真实设备、签名/公证、线上更新检查及普通用户操作文档的待办见 [RUNBOOK](../../../../RUNBOOK.md)。

签名环境变量来自 CI secrets；手动 Build 在打包前移除空值，防止缺失的 `CSC_LINK` 被当作证书路径，非空凭据保留。理解打包时查看配置即可，不需要为项目分析读取或配置真实签名凭据。

## Sourcery 超额度评论清理

`.github/workflows/sourcery-quota-comments.yml` 在默认分支监听 PR 顶层评论的 `issue_comment.created/edited`。只有 `sourcery-ai[bot]`（Bot 类型）且整段正文匹配已确认的限制提示模板时才删除：一类是额度耗尽，限定本仓库账号、Sourcery billing 链接和 `rate_limit_hit`，字符额度与等待时长可变；另一类是 `Sorry @MonsterXia, your pull request is larger than the review limit of <数字> diff characters`，允许字符上限数值变化。普通审查、指南、混合正文、其他作者、Issue 和未知模板均保留。

工作流不 checkout、不执行 PR 代码，只授予任务 `pull-requests: write`；通过 `context.payload` 读取正文，删除前重新读取并核对作者、正文、评论 ID 和所属 PR。PR 评论删除需要 PR 写权限；仅有 `issues: write` 的旧配置曾在实际运行中返回 403。404 视为已删除，权限/其他错误使任务失败。自动事件只检查触发它的单条评论，不扫描全库。

历史提示可在默认分支手动运行同一 workflow，输入单个 `comment_id`。入口校验 ID、所属仓库与 PR，再执行相同的完整模板匹配及删除前复核；不会因手动触发而放宽删除规则。使用 `gh workflow run sourcery-quota-comments.yml --ref master -f comment_id=<ID>` 或 Actions 页面运行。未知新模板需先确认再更新；GET 与 DELETE 之间仍存在 GitHub API 不提供条件删除导致的短暂竞态。

`node --test test/sourcery-quota-comments.test.cjs` 直接执行 workflow 中的真实 JavaScript，只替换 GitHub I/O，覆盖事件/手动入口、删除、保留、陈旧事件与错误处理。测试不发布模拟评论，也不冒充机器人。上线状态查看 Actions 的 `Remove Sourcery quota notices`；权限验收须使用实际 Actions 运行及评论不存在的证据，不能仅以单测通过或 workflow active 代替。

## 投屏启动分段计时

关闭现有投屏后运行 `node script/profile-screencast-start.cjs <report.json>`。探针调用生产控制/视频模块，`firstFrameMs/firstFrameCodec` 记录首张非配置图片（可能为 JPEG 预览），`readyMs` 记录 start 与编码选择结算时间；不含窗口加载和解码，真实 UI 首帧需另测。`SCREENCAST_PROBE_CACHE` 指向独立临时目录以检查跨进程兼容提示；`--reset-control` 主动重建控制服务，只在关闭其他 UITest 工具后使用。脚本遇到已有视频套接字拒绝执行；结束清理自己的副本、进程和新增转发。数据不保存屏幕及设备标识，证据见 `docs/maintenance/screencast-start-latency.md` 和 `docs/maintenance/screencast-static-start.md`。

静止场景实际窗口用 `node script/check-static-screencast-start.cjs <报告.json> [已安装程序路径]` 对照。默认测试本地 dist 三次打开，传入安装程序则测一次；使用临时配置和主进程 inspector，不保存屏幕。要求一台已解锁静止手机并退出其他投屏，明确断言 VideoDecoder 存在。浏览器自动化在本轮 Electron 环境改变了其可用性，不能将该条件下的纯 JPEG 样本当作原生对照。完全静止时 JPEG 也可能只发一张，持续更新需另做受控屏幕变化测试。

投屏准备探针支持 `--prepare`：仅建立待用服务，记录 `preparationReadyMs`、点击前取流次数、约 2 秒 CPU ticks，再记录请求至首个编码包时间。`--reset-control` 和独立 `SCREENCAST_PROBE_CACHE` 可测完全重建/无兼容记录路径；实际应用会对选中设备自动预热，需先等待其清理，避免争用。实际窗口首帧、60 秒 TTL、退出/重启及物理断连仍需分开验证。

## 控制超时恢复回归

`test/control-recovery.test.cjs` 验证记录进程身份、PID 复用、其他 TCP 客户端、未知清单及停止后确认；`test/capture-sessions.test.cjs` 验证旧 lease 失败后的单次前台恢复、拒绝恢复后继续保留 lease，以及初始化失败关闭连接；`test/uitest-connection.test.cjs` 验证安全 API 标签及 SDK 检查失败不更新。`test/screencast-lifecycle.test.cjs` 验证三次失败上限、无首图、手动重试及状态退订。上述为模拟边界测试；USB 实机和真实 Canvas/UI 证据单独见 [控制超时记录](../../../../docs/maintenance/screencast-control-timeout.md)。

安装探针最终化由 `script/lib/hap-report.cjs` 独立执行关闭、清理与设备查询；任何阶段失败仍尽力保存报告，状态查询异常写 `finallyInstalled: null`，保留原错误。仅明确的包不存在响应判为未安装，断连/非 JSON 响应不能推断卸载成功。`test/hap-acceptance.test.cjs` 覆盖这些故障及拖入验收断言。
