# M2-2：概览内存查询首次接入有限传输

2026-10-22 / Codex。基线 `8f1becb2d1a20a07ef9a9084071a121687cafcf5`，分支 `codex/m2-memory-deadline`。M2-2 保持进行中；本轮仅无设备接入，未证明上游长期空闲卡死的根因或修复。

## 触发与结果

概览读取 `cat /proc/meminfo` 的握手、ready 或输出停滞时，旧 `base.shell` 可无限等待。现仅该固定只读命令调用已合并的 `runFiniteShell`，10 秒总截止覆盖该次 connect/握手/ready/写入/读取。截止拒绝前销毁独占 socket 并等待本地 close，不返回部分内存数据，也不回退到旧 shell。

拒绝沿现有 `getOverview` → IPC Promise → `Overview.refresh()` 传播，概览清空旧详情、提示错误、恢复刷新按钮；无需新增 IPC 类型或 renderer 状态。明确的 `[Fail]`、`[E` 加六位数字 `]`、`error:` 行首错误也拒绝，错误中不包含原始输出。正常解析仍优先 MemAvailable、缺失时用 MemFree，kB 换算字节；未识别但无明确错误标记的文本保留原零值行为，不声称验证了 shell exit status。

10 秒是对小型 `/proc/meminfo` 读取的保守初值，避免短预算误伤负载较高设备；**尚未经真机校准，不是性能测量结论**。没有用户命令自动重试；适配器原有 E000004 ready 探针重试仍受同一总截止约束。

## 端点及服务边界

锁定 hdckit 0.12.1 的 `dist/hdc/Client.js` 构造函数在本项目 `createClient({ bin })` 调用下默认 host=`127.0.0.1`、port=`8710`。构造函数无参数时另有对象默认值，不能混同；本项目始终传 options 对象。

`hdc.ts` 使用同一 `HDC_ENDPOINT` 显式配置 `Hdc.createClient` 和内存 `runFiniteShell`，不读取 client 私有字段。bin/hdcPath 的选择保持原逻辑。初始化 tracker、前序参数查询和 SP_daemon/uname 仍由 hdckit 执行，因此原有服务启动路径保留；适配器遇到拒连直接拒绝，不自行 start/kill 或降级重试。

**这不是整个 getOverview 的 10 秒上限。** 前序 `param get`、SP_daemon/uname、后续屏幕查询和其他 base.shell 消费者仍可能等待；终端、HiLog、投屏和写操作未迁移。设备切换不会取消已发 IPC，本轮仅使用适配器截止能力，未新增 UI AbortSignal 桥接。

适配器的严格 hello 长度（16 字节）、目标最长 32 UTF-8 字节、单帧/累计输出 16 MiB 限额继承自[前轮协议合约](M2-2-cancellable-transport.md)。内存输出预期很小，但真实 HDC 版本/目标标识兼容仍待验收。没有真实设备/HDC/HAP/用户数据访问。

## 失败先行与回归

`test/memory-deadline.test.cjs` 加载实际 hdc.ts 处理器、base.ts、parameters.ts、finiteShell.ts 和安装的 hdckit Client/Connection/Target。Electron 注册、无关模块 init 与 tracker 长连接是隔离边界；真实 socket 的连接统一校验生产端点后映射到随机回环端口，任何 HDC 进程启动/kill 被禁止。没有 mock 掉 runFiniteShell。

- 改实现前首批 13 项：**9 失败、4 通过**。三阶段缺失截止、未选用有限路径、截断输出被接受、明确命令错误变零值、真实 10 秒截止缺失均实际失败；正常字段兼容及已有 reset 拒绝原本通过。
- 最终专项 14 项包含新增真实 React/MobX Overview → 实际 handler → 实际有限模块 → TCP 的成功/超时清空/重试恢复验证。不是只对 UI 注入 Error。
- 超时阶段覆盖握手、ready、read；检查 socket closed、迟到数据不启动后续屏幕查询、不重发内存命令、再次调用恢复。协议半帧、TCP reset 和明确错误文本拒绝也检查不重试。
- 端点通过实际 createClient 入参和两个传输分支的 socket 连接参数验证；正常请求按原顺序执行参数、设备信息、内存、屏幕。inputKey 仍走旧 base/hdckit，枚举回归禁止误调用有限内存传输。
- 大多数停滞用例只在计时器边界将真实模块传入的 10000ms 加速到 100ms，以缩短套件；另有不加速用例实测约 10 秒后拒绝且关闭 socket。测试看门狗仅用于报告旧无界等待，不用于生产取消。
- teardown 在初始化前注册，先停止监听，销毁已有与迟到 socket；仅回环数据，全部样本为合成数据。

首次全量 178/198 通过，其余 20 项是三个既有枚举夹具的严格 import 表不认识 finiteShell；先补两处后余 7 项，再补 `target-parameters`。三处仅加入禁止调用有限内存传输的 stub，不改变原枚举断言。此夹具兼容失败与生产缺口分别记录。

## 验证与交接

- Node 22.21.1 / Windows x64：`node --test test/memory-deadline.test.cjs` **14/14**；`npm test` **199/199**，无取消/跳过/TODO；`npm run lint`、`npm run build:main` 均通过。主进程构建现在实际包含 finiteShell，但 Vite 转译不等于全仓库 TypeScript 检查。内部只读复核无阻断，最终独立 review 由主对话另行发布。
- 最终 PR 链接、SHA 和五项必需 CI 由 PR 正文与交付消息记录，避免为补链接反复推送使 CI 取消。主对话负责最终独立审查、发布 review 和统一合并，本分支不自行合并。
- 下一步：在授权设备上校准 10 秒预算，核对内存字段和 HDC 协议兼容、断连恢复，再选择后续有限只读调用逐项接入。前后未限时调用、长期空闲原时长及 CPU/内存/监听释放仍待验证；M2-2 不标完成。
