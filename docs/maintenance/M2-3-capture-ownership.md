# M2-3：主进程捕获会话所有权与本地释放

日期：2026-10-23（Asia/Hong_Kong）。起始基线 `e52021a`，分支 `codex/capture-session-ownership`，复用干净的独立 worktree；依赖和 dist 独立。用户授权从[前轮审计](M2-3-main-capture-close.md)继续修复，而非仅记录缺口。M2-2/M2-3 整体仍进行中，设备端停止和长期空闲仍需验收。

## 设计及实现

捕获现在由主进程管理，每设备一个真实操作队列；本地退订与设备停止确认是两个独立阶段。

1. `window/screencast.ts` 在 `loadPage` 之前注册可信 WebContents。`captureSessions.ts` 直接通过 `ipcMain.handle` 接收可信 sender，校验当前投屏窗口及非空主框架 senderFrame。共享 `handleEvent` 会丢弃 event，因此捕获通道不再经该包装。
2. `createCaptureSession(connectKey)` 由主进程生成随机 token，绑定窗口当前文档与设备。主框架跨文档导航开始即作废全部旧 token，并阻止正在离开的文档取得新 token；主框架 `did-navigate` 提交后才重新开放。崩溃、窗口 close/closed、WebContents destroyed 同样立即失效；同文档和子框架导航不影响主会话。
3. `startCaptureScreen(sessionId, scale, generation)` 验证 token、sender、合法缩放及严格递增代次；队列原子执行真实前置 stop/start。帧发送到保存的原 WebFrameMain，携带 sessionId 和 generation；renderer 同时过滤两者。旧 stop/token 不能向新捕获发送停止命令。
4. `CaptureUiDriver` 继承真实 hdckit UiDriver，借助 AsyncLocalStorage 只标记捕获启动异步链，通过公共 `on/off` 精确记录/解除该链注册的 message listener；不读取、改写 UiDriver 私有 callback/send/connection，不清空其他监听。仅测试夹具替换私有 send 作为传输边界。失效先清空转发 relay 和解除监听；迟到 start 的注册若已失效则不订阅，之后等待真实 start 完成再补偿 stop。
5. `stopCaptureScreen(sessionId)` 在等待设备回复之前即作废 token、清本地转发/监听。返回 `stopped` 表示该 token 对应 lease 的真实 stop 已确认；`released` 仅表示尚无自身 lease 的 token 已释放；`obsolete` 表示 token 已失效。后两者不能表述为设备停止，且已确认旧捕获停止后仍可能有新会话启动。明确 stop 拒绝沿 IPC 传播，后台失效清理失败只记录固定消息，并保留待确认 lease。
6. 停止失败后，新启动必须先成功 stop 旧 lease；不因本地退订就跳过设备状态。start/stop/初始化不返回时不使用 Promise.race 或强制放行，后续同设备任务保持等待，其他设备不受队列阻塞。没有自动无限后台重试。
7. 共享 `getUiDriver` 增加按设备的初始化 singleflight，避免并发捕获/尺寸/布局查询创建多个驱动并重复首次 stop。继续沿用原首次初始化 stop 语义；关窗或会话清理绝不调用 `driver.stop()` 杀共享 agent。共享驱动连接与缓存继续供触摸、布局、尺寸查询使用。
8. renderer 每客户端获取一次 session，局部队列合并缩放；跨实例、跨 renderer 顺序由主进程负责。`destroy(): void` 仍同步清定时器、图片 URL 和事件，已取得 token 时立即发送 stop，即使 start 还在等待；创建回复迟到时也释放 token。创建拒绝会清空 rejected Promise，五秒重试仍可重新获取。

失效操作清空 Session 的 owner/frame，CaptureScope 清空 receive；队列及设备 lease 只保留完成真实清理所需状态，帧回调不再直接捕获旧 Owner。未完成底层 Promise、待确认 lease 与共享连接仍可保留，不能声称进行了全堆内存回收或强制取消传输。

## 测试证据

- 在改动前，新增四条用实际窗口模块/uitest/hdckit 方法的回归全部失败：关窗仍留 1 个监听、旧帧进入新窗口、迟到 start 注册 1 个监听、stop 拒绝后监听仍为 1。修复后上述四条均为 0。
- `test/capture-sessions.test.cjs` 覆盖延迟/拒绝/不结算传输、旧 stop、导航期间拒绝建 owner、主/子框架隔离、崩溃、非法参数、不同设备独立执行、精确保留其他监听，以及初始化并发去重和失败重试。执行真实注册的 IPC handler、CaptureUiDriver 和 hdckit 捕获方法，仅控制 Electron/缓存查询和传输；不读取 `src/share`。
- 原 handler、坐标、renderer 生命周期回归按新协议调整；原先 renderer 本地静态队列的跨实例断言改为贯通真实主进程队列。新增 renderer 创建失败恢复和 session/generation 双过滤。React 清理签名、URL/图片取消、拒绝消费、重试、触摸坐标边界继续覆盖。
- `script/audit-capture-close.cjs` 已升级为当前本地释放回归探针：关窗/迟到/stop 拒绝/直接销毁监听均为 0，旧会话帧进入新窗口为 0。成功只证明合成边界；旧审计报告中的非零结果属于其基线历史。
- 父对话独立实施[真实 Electron 无设备验收](M2-3-capture-electron.md)。初版暴露真实事件顺序为 BrowserWindow closed 先于 WebContents destroyed，closed 时尚有监听；已在原 destroy 处理器之前绑定 close 退订，并用 closed 覆盖直接 destroy，保留 WebContents destroyed 兜底。替身事件顺序随真实证据修正。真实验收的源码哈希、结果及边界见该报告和 JSON，不把先前版本的哈希作为最终候选。

整合 master `913cd7f` 后，本地全量 **451/451**；禁止 Node `fs.readFileSync` 读取 `src/share` 后，窗口/会话/handler/renderer/坐标/布局专项 **60/60**，合成探针输出保持全 0。lint、main/preload/renderer 三个构建通过；保留既有 Vite CJS/Sass 弃用、Licia eval 和 chunk 大小警告，不等同于全项目类型检查。实际 Electron 45.0.0 的八项也在格式化后的最终生产源码上重跑通过，归档 JSON 中四个源文件哈希经现场核对。

## 未验证与下一步

- 本任务作者没有访问手机、HAP、应用清单、HDC 资源或设备日志；所有 key、帧、session 和传输结果均为合成数据。父对话的 Electron 检查也使用合成 transport，不连接 HDC。
- 不声称设备在拒绝或无回复时停止；不修改 hdckit 自有传输/超时恢复策略，不替代真机 UiDriver/SDK 兼容性或受保护内容验证。无回复时同设备队列不保证恢复，属于明确保留的安全边界。
- shared UiDriver 私有 callback 可能在失败后仍存在，但其公共 message 订阅已解除、转发 relay 已清空。待成功 stop 由依赖自己复位 callback 后才能开始新捕获，不使用私有字段强制归零。
- 原始特定应用报告、长期空闲资源趋势、首帧后的流静默健康检测、触控手势取消和物理断连仍未验收。后续授权设备验证须分别记录本地退订、真实 stop 返回及重新捕获；不得将本地 0 监听等同于远端 agent 已停。
- 最终提交由主对话独立审查并核验五项必需 CI 后决定合并，本分支不合并或发布。
