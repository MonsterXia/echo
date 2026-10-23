# 架构与代码导航

本文路径均相对仓库根目录。范围：应用结构、IPC、功能路由、状态、投屏、UI 约定。构建与测试见 [开发与验证](development.md)。

## 项目身份与目录

`package.json` 的包名为 `scrcpy-harmony`、产品名为 `Scrcpy Harmony`，仓库目录名为 `scrcpy-harmony`。项目基于上游 `liriliri/echo`，由 MonsterXia 独立维护，2026-10-21 已解除 GitHub fork 关系；仓库、反馈和发布入口指向 `MonsterXia/scrcpy-harmony`。保留原作者和许可证；应用 ID 为 `io.github.monsterxia.scrcpyharmony`，与上游 ECHO 分开安装，用户数据采用新的产品名目录，旧配置保留且不自动迁移。操作当前 Git 远端时仍使用 `git remote -v` 核对。

共享子模块在 ready 时初始化更新监听并设置上游源；`src/main/index.ts` 随后调用本项目 `src/main/lib/updater.ts`，覆盖为本仓库 GitHub Releases 源。Windows / macOS arm64 使用 `latest`，macOS x64 使用 `latest-x64`，与 `script/pack.mjs` 保持一致。不要直接修改子模块内的更新器。检查更新仍由共享模块发起；发现更新后 renderer 提示并打开本仓库 Releases 页面，不自动下载或安装。

| 路径 | 职责 |
| --- | --- |
| `src/main/` | Electron 主进程：启动、窗口、设备操作、持久化 |
| `src/preload/` | `contextBridge`、类型化 IPC 调用封装 |
| `src/renderer/main/` | 主窗口的设备管理面板 |
| `src/renderer/screencast/` | 独立投屏窗口、Canvas 和输入控制 |
| `src/renderer/lib/` | 跨业务窗口辅助方法，如 HAP 安装、store 序列化 |
| `src/common/` | 应用类型、国际化和主题 |
| `src/share/` | `electron-share` 子模块：窗口、IPC、日志、公共页面及组件 |
| `src/renderer/icon/` | `icon-share` 子模块：图标生成源 |
| `script/` | 下载运行资源、构建发行目录和打安装包 |
| `build/` | 已跟踪的应用图标资源；不是可随意删除的构建产物 |
| `test/` | Node 内置测试：投屏坐标、构建编排、更新源与设备枚举隔离/字段兼容 |
| `RUNBOOK.md`、`docs/maintenance/` | 分阶段维护、验收与来源索引 |
| `dist/`、`release/`、`resources/` | 被忽略的编译输出、安装包和下载资源 |

## 启动和页面

1. `share/main` 先注册 ready 处理并初始化共享语言、主题、IPC 和更新监听；`src/main/index.ts` 的 ready 处理随后覆盖本项目更新源，再初始化共享 terminal、HDC，显示主窗口并初始化菜单。
2. `src/main/window/main.ts` 创建名为 `main` 的窗口，注册主/设置 store IPC 和投屏窗口入口。
3. `src/preload/index.ts` 暴露全局 `main`、`preload`、`node`，并声明其 TypeScript 类型。其中 `main` 合并共享模块与本项目接口。
4. `index.html` 加载 `src/renderer/main.tsx`。该入口按 URL 的 `page` 参数懒加载页面：默认主窗口，`screencast` 是投屏，`terminal`、`process`、`about` 来自共享子模块。这里没有 React Router。

主窗口关闭时，若投屏窗口可见则隐藏主窗口，否则退出应用。投屏窗口关闭会销毁自身并重新显示主窗口；相关代码在 `src/main/window/screencast.ts`。

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

注意 API 名不一定等于 channel 名：renderer 的 `main.dumpLayout()` 使用 `dumpWindowHierarchy` channel。排错时核对桥接字符串，而不只搜方法名。

推送使用共享 `window.sendTo()` / `sendAll()`，renderer 通过 `main.on()` 订阅。常用事件：

| 事件 | 数据或用途 |
| --- | --- |
| `changeTarget` | HDC 设备增删后通知主窗口刷新设备列表 |
| `changeMainStore` | 主 store 的 name/value 变更，投屏用它同步当前设备 |
| `captureScreen` | 发给投屏窗口的 connectKey 与图像字节 |
| `shellData` | 发给主窗口的 sessionId 与终端文本 |
| `hilogEntry` | 发给主窗口的 hilogId 与日志条目 |

增加事件时检查订阅者按设备或会话 ID 过滤，以及退出/切换时的取消订阅。`share` 的 IPC 和窗口内部机制需在子模块初始化后查看，不能仅凭调用点推断。

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

`hdc/finiteShell.ts` 是有限命令适配器：调用方显式提供服务 IP/端口、总截止和可选 AbortSignal；模块独占 TCP socket，取消后 destroy 并等待本地 close，不管理共享 HDC 服务。`getOverview` 按顺序执行五条固定只读命令：`param get` 10 秒、`SP_daemon -deviceinfo` 15 秒、`uname -a` 10 秒、`cat /proc/meminfo` 10 秒、`hidumper -s RenderService -a screen` 15 秒。每条独立计时，没有统一概览截止；失败立即拒绝且不启动后续读取、不回退旧 shell。它们与 Hdc.createClient 共用显式端点：host 为 `127.0.0.1`，port 按锁定 factory 的规则从 `OHOS_HDC_SERVER_PORT` 解析一次，空值/非数字回退 8710，非法范围明确拒绝。概览不再自动启动 HDC 服务；初始化 tracker、getTargets 及其他 hdckit 调用保留原服务启动路径。base.shell、枚举、终端、HiLog、投屏未迁移。hello 仅接受 16 或已观察到的 44 字节，首八字节匹配 OHOS HDC，尾部不回显，回复为原 banner 12 字节及目标 32 字节。未知长度、截断和 16 MiB 输出超限继续拒绝；更多协议变体与预算校准仍需验证。详见 `docs/maintenance/M2-2-overview-deadlines.md`、`docs/maintenance/M2-2-handshake-compat.md` 及内存/屏幕历史报告。

`hdc/parameters.ts` 的 `getTargetParameters` 为设备枚举保留 hdckit 的公开 `Target.shell('param get')` / readAll / finally end 路径；同步 `parseTargetParameters` 供它和概览有限读取共用。解析前拒绝行首 `[Fail]`、`[E` 加六位数字 `]`、`error:` 等明确命令错误；合法参数值中的同名文本不算错误，缺少可选字段仍交给上层兼容处理。此层不修改服务生命周期，也没有限时化枚举或共享 shell。

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
- 新增主面板通常需要同时修改 `App.tsx`、`components/toolbar/Tabs.tsx`、语言字典，状态逻辑按需要放入 `store/`。

## 投屏与输入链路

```text
src/renderer/screencast/store.ts 创建 ScreencastClient(connectKey)
  → main.startCaptureScreen(connectKey, scale)
  → src/main/lib/hdc/uitest.ts 获取并按设备缓存 UiDriver
  → UiDriver.startCaptureScreen 回调
  → sendTo('screencast', 'captureScreen', connectKey, image)
  → ScreencastClient.draw() 将 JPEG 解码绘制到 Canvas

Canvas pointer 事件
  → getPointer() 计算设备坐标
  → main.touchDown / touchMove / touchUp
  → src/main/lib/hdc/uitest.ts → UiDriver
```

`getUiDriver()` 加载资源 `uitestkit_sdk/uitest_agent_v1.1.0.so`，传给 `target.createUiDriver(..., '1.1.0')`。资源版本与调用参数需要保持匹配。

`uitest.ts` 的 start/stop 捕获处理器必须等待 UiDriver 的异步方法完成，再结束 IPC；启动还须等待前置停止完成。否则 renderer 的串行队列只能等待提前完成的 handler，底层错误也不会传播给调用者。`test/capture-handlers.test.cjs` 保留实际 handler 和 UiDriver 方法，在传输边界验证完成时序及拒绝传播。

定位投屏问题时：

- 帧解码入口：`src/renderer/screencast/lib/ScreencastClient.ts` 的 `draw()`；图像加载辅助在同目录 `util.ts`。实现使用 JPEG Blob 和 Canvas，不是 H.264/WebCodecs 管线。
- 触摸映射：`getPointer()` 先按帧宽高比算 CSS 容器内的实际图像区域，再按百分比映射到 `getDisplaySize()` 返回的设备尺寸。请求 `scale` 与实际流缩放可能不同。
- 首帧或帧尺寸变化时重新查询设备尺寸；尺寸必须是正整数。坐标上限为 width/height 减一。没有有效尺寸时不发送触摸。
- `isDrawing` 让绘制和尺寸查询串行进行，期间新帧会跳过；它不是帧队列。改动时注意异步旧帧覆盖新状态。
- 客户端在同一 renderer 内按设备将 stop/start 串行化（包含旧客户端销毁与新客户端启动），并用启动代次丢弃迟到结果；本次启动未出图时五秒重试（包括 stop/start 拒绝），停止阶段不接收帧。`ready` 仍只代表首次成功绘制。`destroy(): void` 清除重试、退订帧/指针监听、取消图片加载，再排队停止捕获；已发出的 IPC 不能撤销，若 bridge 请求不返回，设备端清理仍不能保证。
- `loadImage(url, signal?)` 清理图片处理器并支持取消；客户端在 finally 中释放 Blob URL。无设备生命周期回归见 `test/screencast-lifecycle.test.cjs`，真实捕获和原应用问题的验收边界见 `docs/maintenance/M2-3-recovery.md`。
- `src/renderer/screencast/components/Screencast.tsx` 等首帧 ready 后挂载 Canvas，并处理拖入 HAP；同目录的 `Toolbar.tsx` 提供缩放、按键、文本输入、PNG 导出、置顶和全屏。

## UI 和生成文件

- 使用 React 函数组件、`mobx-react-lite` 的 `observer`、Luna React 封装和局部 `.module.scss`；CSS Modules 配置为 `camelCaseOnly`。
- `src/common/util.ts` 初始化国际化；目前 `en-US` 与 `zh-CN` 都指向同一中文字典，不应假设已有独立英文翻译文件。
- 主题源是 `src/common/theme.json`，`npm run gen:theme` 生成 `src/renderer/theme.scss` 与 `src/common/theme.ts`。
- 图标配置是 `src/renderer/icon.json`，图标源在 icon 子模块，`npm run gen:icon` 生成 `src/renderer/icon.css`。
- Prettier 配置为无分号、单引号、80 列；避免为局部任务运行全仓库重写格式。
