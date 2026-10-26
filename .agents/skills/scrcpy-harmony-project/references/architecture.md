# 架构与代码导航

本文路径均相对仓库根目录。范围：应用结构、IPC、功能路由、状态、投屏、UI 约定。构建与测试见 [开发与验证](development.md)。

## 项目身份与目录

`package.json` 的包名为 `scrcpy-harmony`、产品名为 `Scrcpy Harmony`，仓库目录名为 `scrcpy-harmony`。项目基于上游 `liriliri/echo`，由 MonsterXia 独立维护，2026-10-21 已解除 GitHub fork 关系；仓库、反馈和发布入口指向 `MonsterXia/scrcpy-harmony`。保留原作者和许可证；应用 ID 为 `io.github.monsterxia.scrcpyharmony`，与上游 ECHO 分开安装，用户数据采用新的产品名目录，旧配置保留且不自动迁移。操作当前 Git 远端时仍使用 `git remote -v` 核对。

共享模块在 ready 时初始化更新监听并设置上游源；`src/main/index.ts` 随后调用本项目 `src/main/lib/updater.ts`，覆盖为本仓库 GitHub Releases 源。Windows / macOS arm64 使用 `latest`，macOS x64 使用 `latest-x64`，与 `script/pack.mjs` 保持一致。更新源覆盖仍由本项目 `updater.ts` 负责。检查更新仍由共享模块发起：显式启用本地构建的元数据检查，固定稳定发布选择并禁用降级、自动下载及退出安装。共享模块合并在途请求、消费检查异常并将结果通过系统对话框附着于当前窗口（包括置顶投屏窗口）；用户确认后打开本仓库 Releases 页面。菜单检查期间禁用并显示进度，renderer 不再承载更新结果弹窗。

| 路径 | 职责 |
| --- | --- |
| `src/main/` | Electron 主进程：启动、窗口、设备操作、持久化 |
| `src/preload/` | `contextBridge`、类型化 IPC 调用封装 |
| `src/renderer/main/` | 主窗口的设备管理面板 |
| `src/renderer/screencast/` | 独立投屏窗口、Canvas 和输入控制 |
| `src/renderer/lib/` | 跨业务窗口辅助方法，如 HAP 安装、store 序列化 |
| `src/common/` | 应用类型、国际化和主题 |
| `src/share/` | 由固定 `electron-share` 快照内置：窗口、IPC、日志、公共页面及组件 |
| `src/renderer/icon/` | 由固定 `icon-share` 快照内置：图标生成源 |
| `vendor/packages/` | 本地维护的 HDC/Licia/Luna 源码；npm file 依赖，编译入口 `script/build-vendor.mjs` |
| `script/` | 本地依赖生成、上游测试适配、资源下载、发行构建与验收 |
| `build/` | 已跟踪的应用图标资源；不是可随意删除的构建产物 |
| `test/` | Node 应用回归：设备与窗口生命周期、IPC、构建、更新及依赖生成；Licia 上游测试另在其包内 |
| `RUNBOOK.md`、`docs/maintenance/` | 分阶段维护、验收与来源索引 |
| `dist/`、`release/`、`resources/` | 被忽略的编译输出、安装包和下载资源 |

## 本地依赖与构建职责

应用仍使用原包名导入，根 `package.json` 通过 `file:vendor/packages/*` 指向 18 个本地包。`src/share` 和 `src/renderer/icon` 为普通跟踪目录；旧子模块初始化仅适用于 v1.0.3 及更早 tag。

- `script/build-vendor.mjs`：统一编译入口、源码监听与成功完成标记。
- `script/lib/vendor-build.mjs`：HDC/Luna TypeScript 转译、声明、Luna 样式及图标选择器前缀；调用 Licia 生成器。
- `script/lib/licia-build.mjs`：从原始模块提取依赖和类型，生成 CommonJS、声明及环境入口。
- `script/lib/vendor-vite.mjs`：本地 CommonJS 支持、Licia 浏览器预打包及依赖重编译后的 Vite 重启。
- `script/lib/vendor-notices.mjs`：汇总来源和许可证；`script/build.mjs` 将其与应用 LICENSE 放入发行目录。
- `script/test-licia.mjs`：原始 Node 用例选择、临时夹具及隔离 fallback 测试。

原始文件、生成产物及命令的对应关系见[仓库结构指南](../../../../docs/repository-guide.md)，二次适配规则见 [vendor README](../../../../vendor/README.md)。原生 HDC/uitestkit 仍由资源脚本下载；内置 hdckit 源码不包含原生 HDC 的编译工程。

## 启动和页面

1. `share/main` 先注册 ready 处理并初始化共享语言、主题、IPC 和更新监听；`src/main/index.ts` 的 ready 处理随后覆盖本项目更新源，再初始化共享 terminal、HDC，显示主窗口并初始化菜单。
2. `src/main/window/main.ts` 创建名为 `main` 的窗口，注册主/设置 store IPC 和投屏窗口入口。
3. `src/preload/index.ts` 暴露全局 `main`、`preload`、`node`，并声明其 TypeScript 类型。其中 `main` 合并共享模块与本项目接口。
4. `index.html` 加载 `src/renderer/main.tsx`。该入口按 URL 的 `page` 参数懒加载页面：默认主窗口，`screencast` 是投屏，`terminal`、`process`、`about` 来自共享模块。这里没有 React Router。

主窗口关闭时，若投屏窗口可见则隐藏主窗口，否则退出应用。投屏窗口在 `close` 中销毁自身，在 `closed` 中释放单例引用并重新显示主窗口；close/closed 都会先失效捕获 owner、解除本地监听，覆盖 WebContents destroyed 晚于 closed 的真实事件顺序。设备停止仍需异步确认，见 [捕获会话所有权](../../../../docs/maintenance/M2-3-capture-ownership.md)。

## IPC 边界

```text
React 组件 / MobX store
  → 全局 main.someMethod(...)
  → src/preload/main.ts 的 invoke('channel')
  → 主进程 handleEvent('channel', handler)
  → hdckit Client / Target / UiDriver
  → 鸿蒙设备
```

请求类型集中在 `src/common/types.ts`。主进程设备处理器集中在 `src/main/lib/hdc/`，注册由 `src/main/lib/hdc.ts` 的 `init()` 串起；窗口类处理器在 `src/main/window/`。

捕获的 create/start/stop 和 retryCaptureVideo/finishCaptureVideo 通道由 `hdc/captureSessions.ts` 直接注册 `ipcMain.handle`，保留并验证 Electron sender/senderFrame；不能套用会丢弃 event 的共享 handleEvent。投屏窗口须在 loadPage 前注册到会话管理器。视频升档使用原 lease、generation 和独立 promotion ID，JPEG 持续显示至 renderer 确认实际绘制；启动等待不占设备输入队列，driver 负责关闭前等待尝试和清理完成。详见 [JPEG 恢复视频](../../../../docs/maintenance/screencast-video-upgrade.md)。

注意 API 名不一定等于 channel 名：renderer 的 `main.dumpLayout()` 使用 `dumpWindowHierarchy` channel。排错时核对桥接字符串，而不只搜方法名。

推送使用共享 `window.sendTo()` / `sendAll()`，renderer 通过 `main.on()` 订阅。常用事件：

| 事件 | 数据或用途 |
| --- | --- |
| `changeTarget` | HDC 设备增删后通知主窗口刷新设备列表 |
| `changeMainStore` | 主 store 的 name/value 变更，投屏用它同步当前设备 |
| `captureScreen` | 直发原 WebFrameMain 的 sessionId、generation、图像字节；H.264 附 codec/timestamp/config/keyFrame 元数据，运行错误用 codec=error |
| `shellData` | 发给主窗口的 sessionId 与终端文本 |
| `hilogEntry` | 发给主窗口的 hilogId 与日志条目 |

增加事件时检查订阅者按设备或会话 ID 过滤，以及退出/切换时的取消订阅。`share` 的 IPC 和窗口内部机制直接查看本仓源码，不能仅凭调用点推断。

## 功能定位

下表 UI 路径均以 `src/renderer/main/components/` 为前缀，设备路径均以 `src/main/lib/` 为前缀。

| 功能 | UI 入口 | 设备实现 |
| --- | --- | --- |
| 设备选择、概览、按键、截图 | `toolbar/Target.tsx`、`overview/`、`screenshot/` | `hdc.ts` |
| 应用安装、启停、卸载、信息 | `application/`，安装公共方法在 `src/renderer/lib/util.ts` | `hdc/bundle.ts` |
| 进程列表 | `process/Process.tsx` | `hdc/base.ts` 的 `getProcesses` |
| 交互 shell | `shell/Shell.tsx`、`shell/Term.tsx` | `hdc/shell.ts` 的 HdcPty/sessionId |
| 布局树、属性与截图 | `layout/`，XML 工具在 `src/renderer/main/lib/util.ts` | `hdc/uitest.ts` 的 `captureLayout` 与 XML 转换 |
| 端口转发 | `overview/PortMappingModal.tsx` | `hdc/port.ts`，通用 `forwardTcp` 在 `hdc/base.ts` |
| WebView 调试 | `webview/Webview.tsx` | `hdc/webview.ts` 查 unix socket、建立转发并取 `/json` |
| HiLog | `hilog/Hilog.tsx` | `hdc/hilog.ts`，pid 名称缓存依赖 `hdc/base.ts` |
| 设置 | `toolbar/SettingsModal.tsx`、`src/renderer/main/store/settings.ts` | `src/main/lib/store.ts` 和 `src/main/window/main.ts` |

`hdc/hilog.ts` 在暂停或关闭时使当前流的在途 PID 名称补全失效；恢复只接受恢复后的记录。关闭解除 reader 的 entry 监听并结束 reader，迟到的暂停/恢复/关闭 IPC 为无操作。PID 查询失败时保留活动记录，以 `pid-<数字>` 回退并记警告；已失效回调不更新缓存或发送记录。此边界不取消共享 PID 查询，也不撤回已发送 IPC；renderer 的“清除”仅清空本地记录。

设备参数统一使用 `connectKey`（来自 `ITarget.key`）。`hdc/base.ts` 提供 shell、端口与按设备分组的运行时缓存；不要误认为它是持久化 store。

`hdc/finiteShell.ts` 是有限命令适配器：调用方显式提供服务 IP/端口、总截止和可选 AbortSignal；模块独占 TCP socket，取消后 destroy 并等待本地 close，不管理共享 HDC 服务。`getOverview` 按顺序执行五条固定只读命令：`param get` 10 秒、`SP_daemon -deviceinfo` 15 秒、`uname -a` 10 秒、`cat /proc/meminfo` 10 秒、`hidumper -s RenderService -a screen` 15 秒。每条独立计时，没有统一概览截止；失败立即拒绝且不启动后续读取、不回退旧 shell。它们与 Hdc.createClient 共用显式端点：host 为 `127.0.0.1`，port 按锁定 factory 的规则从 `OHOS_HDC_SERVER_PORT` 解析一次，空值/非数字回退 8710，非法范围明确拒绝。概览不再自动启动 HDC 服务；初始化 tracker、getTargets 的 host listTargets 及其他 hdckit 调用保留原服务启动路径。getTargets 在 host 列举完成后，对每设备 param get 并发使用同一有限模块和 10 秒预算；失败独立过滤，保留健康设备及原顺序，全部失败仍拒绝。整个枚举没有统一截止，host 列举及初始化本身仍未限时，详见 `docs/maintenance/M2-2-target-deadlines.md`。base.shell、终端、HiLog 和投屏的一般准备未迁移；控制服务恢复检查单独使用 finiteShell。hello 仅接受 16 或已观察到的 44 字节，首八字节匹配 OHOS HDC，尾部不回显，回复为原 banner 12 字节及目标 32 字节。未知长度、截断和 16 MiB 输出超限继续拒绝；更多协议变体与预算校准仍需验证。详见 `docs/maintenance/M2-2-overview-deadlines.md`、`docs/maintenance/M2-2-handshake-compat.md` 及内存/屏幕历史报告。

`hdc/parameters.ts` 的同步 `parseTargetParameters` 供枚举及概览有限读取共用；旧 `getTargetParameters` reader 导出保留，但这两个处理器不再经其读取。解析前拒绝行首 `[Fail]`、`[E` 加六位数字 `]`、`error:` 等明确命令错误；合法参数值中的同名文本不算错误，缺少可选字段仍交给上层兼容处理。解析层不修改服务生命周期或共享 shell。

概览 `Overview.refresh()` 在读取失败后清空旧概览并提示错误，释放加载状态后允许再次刷新，避免将上次数据呈现为当前结果。

`hdc.ts` 的 `getTargets` 对每个设备单独读取参数并隔离失败，保留可读取设备的原始顺序。版本从可识别的点分数字字段提取；缺失或未知版本返回空字符串并记警告，名称缺失回退到 connectKey，API 字段缺失返回空字符串。`listTargets` 失败记录 error，非空设备列表全部读取失败记录 warn，两者均拒绝 IPC；正常无设备记录 info 并返回空数组；部分设备失败仍返回其余设备。成功返回类型仍为 `ITarget[]`。主窗口 `refreshTargets()` 捕获失败、清空列表和选择、设置 `targetsError` 并返回 false；初始化和设备事件刷新也使用此路径。工具栏区分读取失败与正常无设备，手动刷新按布尔结果提示成功或错误。

并发设备刷新按发起顺序分配序号，只有最新请求可以发布列表、选择、错误状态及持久化写入。已被后续请求取代的调用返回 `undefined`，工具栏不显示这次调用的通知；有效调用继续返回成功/失败布尔值。此保护不取消已发送 IPC，也不限制 HDC 等待时间。

`hdc/bundle.ts` 的 `getBundleInfos` 逐应用执行单条 `bm dump -n`，将命令、解析、结果与 bundleName 绑定；不再使用共享 shell 的字符串分隔符拆分批量结果。失败项带 connectKey / bundleName / 原因日志并跳过，其余结果保持请求顺序。缺失主模块或启动能力时保留应用并省略 mainAbility；在线名称/图标失败保留本地字段。IPC 仍返回 `IBundleInfo[]`，renderer 仍每五个包刷新一批。Application.tsx 用面板生命周期内的同步引用串行处理刷新，将在途期间的安装/卸载刷新请求合并为后续一轮，重新读取系统应用选项；卸载或设备切换后忽略旧结果并停止后续批次，查询失败释放加载状态。此处不取消已发送 IPC，也不设置 HDC 命令超时。

应用名称优先取本地有效明文 label；否则在设备 `bm dump -h` 声明 `-l, --label` 时使用 `bm dump -n <bundle> -l` 解析资源名称。能力探测限定在单批请求，名称也不跨请求缓存；不支持或失败时保留原在线/包名回退。不能将应用的 apiTargetVersion 当设备版本。图标仍使用原在线策略，`$media:` 资源引用不能直接作为图片路径；当前未实现 HAP 资源解析。Application.tsx 列表插入名称与图片 URL 时做 HTML 转义。

## 状态与面板生命周期

- `src/renderer/main/store/index.ts` 是主窗口 MobX store，持有 targets、target、panel，以及 settings/application/process/layout 子 store。
- `src/main/lib/store.ts` 通过 Licia `FileStore` 存储用户数据目录下的 `data/main.json`、`settings.json`、`screencast.json`；目录路径由共享 `getUserDataPath()` 决定。
- `src/renderer/lib/util.ts` 的 `setMainStore()` 将 MobX observable 转为普通 JS 值后传过 IPC。
- `src/renderer/main/App.tsx` 的 `Panel` 第一次访问后一直保留子组件，通过透明度和 pointer-events 控制显示。隐藏不等于卸载；轮询等需检查是否在隐藏状态继续运行。
- 主面板容器和投屏组件都使用设备 key 参与重建。投屏 store 监听 `changeMainStore`：target 为 null 时关窗，换设备时销毁旧客户端并创建新客户端。
- `overview/PortMappingModal.tsx` 只在弹窗可见且有目标时读取映射；关闭/目标变更使旧读取失效，同一会话仅接受最后发起的当前方向结果。读取失败清空列表和选择并提示，恢复依赖手动刷新或重开；写入成功后的读取绑定原可见期，不取消已发送 IPC。
- 新增主面板通常需要同时修改 `App.tsx`、`components/toolbar/Tabs.tsx`、语言字典，状态逻辑按需要放入 `store/`。

## 投屏与输入链路

```text
src/renderer/screencast/store.ts 创建 ScreencastClient(connectKey)
  → main.createCaptureSession(connectKey) 获取主进程生成的 token
  → main.startCaptureScreen(sessionId, scale, generation, preferVideo)
  → captureSessions.ts 校验原文档、按设备串行真实 stop/start
  → uitest.ts 单次初始化并缓存 CaptureUiDriver
  → CaptureUiDriver 优先 NativeVideo；不可用则 UiDriver JPEG
  → 回调经可释放 CaptureScope
  → 原 frame.send('captureScreen', sessionId, generation, image, metadata?)
  → H264Decoder/WebCodecs 或 JPEG loadImage → 共用 Canvas paint()

Canvas pointer 事件
  → getPointer() 计算设备坐标
  → main.touchDown / touchMove / touchUp
  → src/main/lib/hdc/uitest.ts → UiDriver
```

`getUiDriver()` 将资源 `uitestkit_sdk/uitest_agent_v1.1.0.so` 和版本 `1.1.0` 传给 CaptureUiDriver（继承真实 UiDriver）构造器，按设备缓存并合并并发初始化。资源版本与调用参数需要保持匹配。

`captureSessions.ts` 的每设备队列等待真实 UiDriver 操作完成，不因 renderer 消失或超时 race 提前放行。`CaptureUiDriver` 通过公共 on/off 精确管理自身捕获监听；关闭、导航、崩溃和 stop 请求立即本地退订，迟到启动完成后再补偿停止。stop 拒绝保留待确认 lease；前台下一 start 遇到明确控制传输错误时可尝试一次受限恢复，其他错误继续保留 lease。stop 的 stopped/released/obsolete 分别表示本 lease 停止已确认、仅释放无 lease token、旧 token 已失效，不能混称设备已停。`test/capture-sessions.test.cjs` 与 handler 回归保留真实依赖方法验证这些边界。

`hdc/controlRecovery.ts` 记录普通控制 daemon 的 PID 和 `/proc` starttime，恢复前先结束本应用原生流和控制连接；拒绝替换后的进程、其他原生捕获或 TCP 8012 活跃连接。只终止仍匹配的单个控制进程，并确认消失后才由 `UiDriver.clearStoppedCapture` 清除私有捕获回调，再重新初始化。每条恢复检查通过 `finiteShell` 限制为 5 秒；ps 及独立 IPv4/IPv6 表要求命令完成标记并校验数据行，部分读取不能证明无其他客户端。后台准备、普通输入、关闭窗口均不主动重置控制服务，未知结果输入不重放。SDK 检查结果必须有明确标记，错误或空输出不能被当作 SDK 缺失。初始 HDC shell/转发仍无统一截止，不能将上述预算外推为完整启动期限。

`ScreencastClient.subscribeState` 提供 loading/ready/failed；连续三次已结算启动仍无首图时停止自动重试，界面显示错误和“重试投屏”。手动重试重新计数，真实画面绘制才进入 ready；只有启动成功结算且已绘图才清零失败次数，预览后的启动拒绝仍计入失败并恢复 loading。组件销毁退订状态；此上限不能处理底层 Promise 永不结算的 HDC 准备阶段。验证见 `docs/maintenance/screencast-control-timeout.md`。

`CaptureUiDriver` 先用只读 `getDisplaySize` 准备控制服务，再启动本会话的实时 JPEG 预览，原生取流成功后才停止该 JPEG。首帧静止沉默继续沿用 JPEG；不会发送无归属的 JPEG stop。JPEG 尝试发出即标记可能活动，stop 失败继续保留状态；原生与 JPEG 的停止独立尝试。`hdckit/UiDriver` 控制 RPC 默认 10 秒、JPEG stop 回复 3 秒、TCP 连接 3 秒、Driver.create 1 秒截止；断开/超时/主动关闭拒绝全部等待、销毁旧 socket，下次调用重新握手。未知结果命令不自动重发，不把超时当作停止确认。HDC shell/SDK 准备尚未全部有限化，不能将 RPC 截止外推为整个启动链路的总时限。证据见 `docs/maintenance/screencast-first-frame-recovery.md` 和 `docs/maintenance/screencast-static-start.md`。

原生首帧判定排除配置包。首帧 5 秒沉默使用专门错误，先尝试有 2 秒截止的 onEnd，随后按原有所有权规则确认清理；本次直接沿用 JPEG，不再扫描其余库，也不删除已成功的兼容提示。renderer 在收到非配置视频但尚未绘制 H.264 时保留独立的 5 秒恢复条件，JPEG 预览不取消该等待；真实 H.264 绘制后丢弃迟到 JPEG。此策略保障首图，不保证静止固件能输出原生视频。

`nativeVideo.ts` 用现有 HDC 命令创建会话独占的原生扩展副本/进程/转发，以 Node 内置 HTTP/2 读 gRPC；`nativeVideoProtocol.ts` 负责 8 MiB 上限的消息拆包和 protobuf 字段。正式应用传入 `resources/native-video`，由 `nativeVideoResources.ts` 检查设备 ABI/UITest 版本及本地 ELF/SHA-256，再按清单上传候选库到随机会话名称、核对手机端 SHA-256 并启动；失败后确认清理才试下一个，通过 nativeVideoPreference.ts 在桌面持久化已成功候选提示，按设备、ABI、UITest、固件及资源清单隔离；缓存命中仍校验 ELF/哈希和实际握手，失效时清除并重探。不依赖或覆盖手机预装库，手机端不保留永久库缓存；仅未传资源目录的旧调用兼容原有库路径。停止优先调用 onEnd，再终止并核对本会话随机扩展名的进程，最后移除自己的转发和副本；HDC 错误或清理不确认时保留 lease。桌面无 Java 运行时。`H264Decoder.ts` 缓存 SPS/PPS、等待关键帧，解码队列积压时重建并等待下一关键帧；Canvas 只保留一个待绘制最新 VideoFrame，并关闭被替换的帧。缺失 WebCodecs 时请求 JPEG；视频流中断时每个 ScreencastClient 经原设备队列重连一次 H.264，再次流错误才单向回退 JPEG；真正解码失败仍立即回退，旧 generation 的错误被忽略。原生服务请求帧率为 120，实际速率受设备/内容限制，不能当作实际 120 FPS 承诺；同分辨率的当前设备帧率与中断恢复证据见 `docs/maintenance/screencast-fps-tuning.md`。准备、候选探测与流错误在主进程保留原因日志。新 driver 先用 initializeControl 验证和复用健康控制服务；生产 CaptureUiDriver 始终禁止 UiDriver 广域停止，初始恢复和 SDK 更新统一通过已记录 PID/starttime 的受限恢复。后台初始化及缓存 driver 准备重连不重置已有 daemon。自己的新 daemon 启动不再固定 sleep，而以 3 秒预算尝试初始握手，普通输入不重放。连续两次确认候选扩展已退出时快速结束套接字等待，活进程继续等待。设备版本查询必须排在控制准备之后，以免短暂 uitest --version 进程干扰 pidof 判断。详见 docs/maintenance/screencast-start-latency.md。

`vendor/native-video/manifest.json` 固定官方 SDK 归档和六个 ARM64 候选库的版本、大小及哈希；`script/native-video-resources.mjs` 使用 Node 解压指定条目，`script/build.mjs` 只复制清单内原生库和来源/许可文件。构建和运行均不执行 Java，归档 JAR 不进入应用包。兼容范围与验收见 `docs/maintenance/native-video-deployment.md`。

定位投屏问题时：

- 帧解码入口：`ScreencastClient.ts` 的 `videoFrame()` / `draw()`，共同进入 `paint()`；JPEG 只保留一张待解码最新帧。图像加载辅助在同目录 `util.ts`，视频解码在 `H264Decoder.ts`。性能与部署边界见 `docs/maintenance/screencast-video-design.md`。
- 触摸映射：`getPointer()` 先按帧宽高比算 CSS 容器内的实际图像区域，再按百分比映射到 `getDisplaySize()` 返回的设备尺寸。请求 `scale` 与实际流缩放可能不同。
- 首帧或帧尺寸变化时重新查询设备尺寸；尺寸必须是正整数。坐标上限为 width/height 减一。没有有效尺寸时不发送触摸。
- `isDrawing` 让绘制和尺寸查询串行进行，期间新帧会跳过；它不是帧队列。改动时注意异步旧帧覆盖新状态。
- 客户端用局部队列合并缩放，主进程提供跨 renderer 的设备顺序；帧须同时匹配 sessionId 与启动 generation。本次启动未出图或创建/start 拒绝后五秒重试，`ready` 只代表首次成功绘制。`destroy(): void` 清除重试、退订帧/指针监听、取消图片加载，并立即发送 session stop 以便主进程本地失效；创建回复迟到时也释放 token。不能撤销已发送的设备请求，永不返回时仍不能确认远端停止。
- `loadImage(url, signal?)` 清理图片处理器并支持取消；客户端在 finally 中释放 Blob URL。无设备生命周期回归见 `test/screencast-lifecycle.test.cjs`，真实捕获和原应用问题的验收边界见 `docs/maintenance/M2-3-recovery.md`。
- `src/renderer/screencast/components/Screencast.tsx` 等首帧 ready 后挂载 Canvas，并处理拖入 HAP；`lib/fitWindow.ts` 观察实际帧比例和容器尺寸，首帧/比例变化时通过 preload 的 `fitScreencast` 报告尺寸及实测窗口界面占用。主进程 `window/screencast.ts` 只接受当前投屏主文档，按当前窗口面积、画面比例和显示器可用 DIP 空间调整窗口；最大化/全屏保持不动。相同比例的帧、分辨率档位和普通手动缩放不反复调整窗口。Canvas 的 CSS 尺寸始终按比例计算，低分辨率画面也可填满适配后的窗口，触摸仍使用真实画面矩形。卸载时取消尺寸观察与待执行回调。同目录的 `Toolbar.tsx` 提供缩放、按键、PNG 导出、置顶和全屏；文本输入由画面键盘与粘贴处理。
- 工具栏默认隐藏，通过标题栏左侧「⋯」展开左对齐毛玻璃面板，点击「×」或工具区 Escape 收起并恢复入口焦点。入口经 React portal 挂到 body，避开视频容器裁剪；44×30 的 no-drag 唤起区域仅在标题栏内，macOS 向右避开交通灯。鼠标离开 2 秒后自动收起，返回取消计时；入口再空闲 2 秒隐藏，移入标题栏入口区域或键盘聚焦时显示。通过 portal 的 React 事件保持共同悬停/焦点逻辑，不再监听 document mousemove，不遮挡手机输入。键盘操作和选择框编辑期间暂停，操作结束后重新计时，卸载清理计时器及 portal。视频不为工具栏留空，面板展开/换行不改变视频容器尺寸；浮层空白处不拦截 Canvas 输入。面板保留挂载。
- 工具栏面板与入口使用 160ms opacity 过渡；面板收起时立即设 inert/aria-hidden 并禁用指针，淡出结束后 CSS visibility 隐藏，不用 display:none 截断动画。快速反向切换由 CSS 接续当前透明度，减少动态效果偏好下取消过渡。
- 画质只提供原画（scale=1）和流畅（scale=0.5），不承诺固定FPS；选择框保留原生语义，使用可样式化picker统一毛玻璃外观。screencast/store.ts在初始化捕获前按原生整数缩放档位兼容旧比例（0.5/0.6→0.5，0.7～1→1），非法值默认原画；切换只保存规范值，同档位不重启。
- ScreencastClient.getCaptureStats返回当前generation的成功Canvas绘制计数和实际格式，start/destroy清空。Toolbar仅展开时按1秒interval与performance.now差值计算FPS，generation改变/未出帧显示等待或破折号，无新增帧归零；收起/卸载清理interval。它不是编码目标或显示器呈现速率，无额外设备采集/IPC或逐帧React更新。状态和画质成组换行，控件统一28px垂直居中；选择框禁用Luna旧三角，仅使用单个可样式化picker箭头。
- 工具栏已移除 T 文本输入按钮、prompt 和等待状态，专用 `inputText` IPC/类型/preload 桥接也已删除；文本统一由局部键盘与 `screencastInput` 会话接口发送。`test/text-input-toolbar.test.cjs` 保留工具栏显隐、焦点和 FPS 回归，原弹窗相关用例随已删除功能移除。
- `ScreencastInput.ts` 在 Canvas 同容器挂载局部 textarea，获得焦点后接收 IME/键盘及原生 paste 事件，失焦、重新点击、失败和销毁时清理待发送内容。`ScreencastClient.input` 经 `screencastInput(sessionId, action)` 桥接；`captureSessions.withCaptureInput/withCaptureTouch` 校验当前文档与会话，触摸和文本串行，关闭/重启中止有限 shell 等待。输入队列上限 64，释放触摸不因满队列丢弃。`hdc/screencastInput.ts` 安全编码文本（UTF-8 64 KiB 上限、拒绝 NUL），按键校验后用 `uinput -K`，10 秒截止/错误检测且不重放。输入 IPC 直接注册以避免通用参数日志记录文本。
- Ctrl/Cmd+C/X 在手机内复制/剪切时只读电脑剪贴板快照，设备操作成功后标记手机来源；Ctrl/Cmd+V 在同一队列中自动选择手机内容，电脑剪贴板文本与快照不同则切回电脑文本。快照读取有 1.5 秒截止，焦点代次失效立即结束等待，迟到结果不改变路由。原生 paste 事件共用逻辑，键盘快捷键直接读取以支持电脑空剪贴板。右键菜单可复制、剪切、自动粘贴或显式选择电脑/手机来源；右键按下保留 textarea 焦点，取消菜单后仍可打字。旧 Shift+V 保留为手机粘贴兼容入口。没有后台轮询、桌面剪贴板写入或跨会话持久化；实体手机复制、电脑重复复制相同文本无法从快照检测，菜单可手动选择。当前仍不支持手机到电脑复制。
- 捕获 lease 记录已派发触摸的最后位置；关闭或换代时即使普通队列中的 touchUp 已失效，仍在真实 stop 前补发释放。释放失败保留 lease 并阻止替换捕获，后续清理可重试。`screencastEdit.ts` 将原生菜单的 selectAll/delete 通过主进程→renderer `screencastEdit` 事件交给投屏处理；键盘接管焦点时转发到手机，否则保留本地输入框编辑。其他窗口仍用 Electron 原生编辑。
- 全屏请求作用于 Canvas 的父容器，以保留 textarea 输入焦点；全屏只跳过窗口尺寸适配，仍更新 Canvas CSS 尺寸。验收与限制见 `docs/maintenance/screencast-input.md`。

## UI 和生成文件

- 使用 React 函数组件、`mobx-react-lite` 的 `observer`、Luna React 封装和局部 `.module.scss`；CSS Modules 配置为 `camelCaseOnly`。
- `src/common/util.ts` 初始化国际化；目前 `en-US` 与 `zh-CN` 都指向同一中文字典，不应假设已有独立英文翻译文件。
- 主题源是 `src/common/theme.json`，`npm run gen:theme` 生成 `src/renderer/theme.scss` 与 `src/common/theme.ts`。
- 图标配置是 `src/renderer/icon.json`，图标源在本仓 `src/renderer/icon`，`npm run gen:icon` 生成 `src/renderer/icon.css`。
- Prettier 配置为无分号、单引号、80 列；避免为局部任务运行全仓库重写格式。

## 投屏后台准备与退出

`main/index.ts` 在 HDC 初始化后启动 `lib/screencastPreparation.ts`，监听已有主窗口/投屏 store 和 HDC 的内部 `deviceEvents`（列举、add/remove）。`hdc/captureWarmup.ts` 只对选中且在线设备每代准备一次，待用服务 TTL 为 60 秒；选择变化、断连和退出使代次失效，不循环预热，无新增 renderer IPC。

`captureSessions.prepareCapture` 与前台 start/stop 共用设备队列，记录待用资源的 owner/ready 状态；点击在准备后原子转移到 capture lease，取消/过期不得停止已接管的流，清理未确认则阻止再启动。`NativeVideo.prepare` 只校验/上传/加载候选和建立转发，不发 onStart；每个候选部署前重新核对 socket 占用，监听就绪、准备完成和正式 start 均核对本会话扩展进程仍存在后取流，尺寸不匹配重建。监听成功只记内存提示，真实流成功才持久化兼容提示。控制初始化必须先于 UITest 版本探测。

退出处理立即取消预热并调用 shutdownCaptures 撤销帧路由，等待两者全部结算后允许可选 HDC shutdown。共享 relaunch 使用 app.quit 参与清理，主窗口 before-quit 后不因投屏可见而隐藏阻断退出。控制 HDC 准备尚无统一总截止，因此退出最多等待 10 秒，超时记录清理未确认并 app.exit 真正终止进程，避免迟到任务继续部署；远端资源或外部 HDC 子进程可能遗留，不宣称清理成功。证据见 docs/maintenance/screencast-pr56-review.md。
