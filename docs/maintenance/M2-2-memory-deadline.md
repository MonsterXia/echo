# M2-2：概览内存查询首次接入有限传输

2026-10-22 / Codex。基线 `8f1becb2d1a20a07ef9a9084071a121687cafcf5`，分支 `codex/m2-memory-deadline`；最终以普通 merge 同步 master `bd3e3c914905e440c1b4f6897013873eb918cba9`（#31 已合并）。M2-2 保持进行中；本轮仅无设备接入，未证明上游长期空闲卡死的根因或修复。

## 触发与结果

概览读取 `cat /proc/meminfo` 的握手、ready 或输出停滞时，旧 `base.shell` 可无限等待。现仅该固定只读命令调用已合并的 `runFiniteShell`，10 秒总截止覆盖该次 connect/握手/ready/写入/读取。截止拒绝前销毁独占 socket 并等待本地 close，不返回部分内存数据，也不回退到旧 shell。

拒绝沿现有 `getOverview` → IPC Promise → `Overview.refresh()` 传播，概览清空旧详情、提示错误、恢复刷新按钮；无需新增 IPC 类型或 renderer 状态。明确的 `[Fail]`、`[E` 加六位数字 `]`、`error:` 行首错误也拒绝，错误中不包含原始输出。正常解析仍优先 MemAvailable、缺失时用 MemFree，kB 换算字节；未识别但无明确错误标记的文本保留原零值行为，不声称验证了 shell exit status。

10 秒是对小型 `/proc/meminfo` 读取的保守初值，避免短预算误伤负载较高设备；**尚未经真机校准，不是性能测量结论**。没有用户命令自动重试；适配器原有 E000004 ready 探针重试仍受同一总截止约束。

## 端点及服务边界

锁定 hdckit 0.12.1 的 `dist/Hdc.js/createClient` 在未显式给定端口时读取 `OHOS_HDC_SERVER_PORT`，使用 `parseInt(value || '8710', 10)`；解析结果为 NaN 时不给 Client 端口，由 `dist/hdc/Client.js` 回退 8710。host 默认 `127.0.0.1`。因此 `createClient({ bin })` 并非无条件固定 8710；Client 构造函数也不能代替 factory 的行为核对。

`hdc.ts` 在模块初始化时按上述公开语义解析一次环境端口，使用同一 `HDC_ENDPOINT` 配置 `Hdc.createClient` 和内存 `runFiniteShell`，不读取 client 字段。保留空值/非数字回退，以及数字前缀与空格的 parseInt 行为；0、负数或超过 65535 的数字现在明确抛出 `Invalid OHOS_HDC_SERVER_PORT`，在连接前拒绝，而非尝试无效端口。bin/hdcPath 选择不变。初始化 tracker、前序参数查询和 SP_daemon/uname 仍由 hdckit 执行，服务启动路径保留；适配器遇到拒连直接拒绝，不自行 start/kill 或降级重试。

**这不是整个 getOverview 的 10 秒上限。** 前序 `param get`、SP_daemon/uname、后续屏幕查询和其他 base.shell 消费者仍可能等待；终端、HiLog、投屏和写操作未迁移。设备切换不会取消已发 IPC，本轮仅使用适配器截止能力，未新增 UI AbortSignal 桥接。

适配器的严格 hello 长度（16 字节）、目标最长 32 UTF-8 字节、单帧/累计输出 16 MiB 限额继承自[前轮协议合约](M2-2-cancellable-transport.md)。内存输出预期很小，但真实 HDC 版本/目标标识兼容仍待验收。没有真实设备/HDC/HAP/用户数据访问。

## 失败先行与回归

`test/memory-deadline.test.cjs` 加载实际 hdc.ts 处理器、base.ts、parameters.ts、finiteShell.ts 和安装的 hdckit Hdc.createClient/Client/Connection/Target。Electron 注册、无关模块 init 与 tracker 长连接是隔离边界；真实 socket 的连接统一校验所选生产端点后映射到随机回环端口，任何 HDC 进程启动/kill 被禁止。没有 mock 掉 runFiniteShell。

- 改实现前首批 13 项：**9 失败、4 通过**。三阶段缺失截止、未选用有限路径、截断输出被接受、明确命令错误变零值、真实 10 秒截止缺失均实际失败；正常字段兼容及已有 reset 拒绝原本通过。
- 初轮专项 14 项包含新增真实 React/MobX Overview → 实际 handler → 实际有限模块 → TCP 的成功/超时清空/重试恢复验证。不是只对 UI 注入 Error。
- 超时阶段覆盖握手、ready、read；检查 socket closed、迟到数据不启动后续屏幕查询、不重发内存命令、再次调用恢复。协议半帧、TCP reset 和明确错误文本拒绝也检查不重试。
- 端点通过实际 createClient 入参和两个传输分支的 socket 连接参数验证；正常请求按原顺序执行参数、设备信息、内存、屏幕。inputKey 仍走旧 base/hdckit，枚举回归禁止误调用有限内存传输。
- 大多数停滞用例只在计时器边界将真实模块传入的 10000ms 加速到 100ms，以缩短套件；另有不加速用例实测约 10 秒后拒绝且关闭 socket。测试看门狗仅用于报告旧无界等待，不用于生产取消。
- teardown 在初始化前注册，先停止监听，销毁已有与迟到 socket；仅回环数据，全部样本为合成数据。

首次全量 178/198 通过，其余 20 项是三个既有枚举夹具的严格 import 表不认识 finiteShell；先补两处后余 7 项，再补 `target-parameters`。三处仅加入禁止调用有限内存传输的 stub，不改变原枚举断言。此夹具兼容失败与生产缺口分别记录。

主对话独立审查发现初稿硬编码 8710 覆盖环境端口（P2）；初稿夹具直接构造 Client，漏过 factory 行为。改为真实 Hdc.createClient，新增 9 项环境端口回归先 **6 失败/3 通过**；共享解析修复后专项合计 **23/23**。覆盖非默认端口、带空格/后缀、空/非数字回退和 0/负数/超范围拒绝。三个枚举夹具同时允许读取 node:process；无生产网络副作用。

## 验证与交接

- Node 22.21.1 / Windows x64：初轮专项 14/14、全量 199/199；端口修订专项 **23/23**、全量 **208/208**；合入 #31 后组合全量 **221/221**，无跳过/取消/TODO。`npm run lint`、`npm run build:main` 再次通过。主进程构建现在实际包含 finiteShell，但 Vite 转译不等于全仓库 TypeScript 检查。最终独立 review 增量复核由主对话完成。
- 交付 [PR #32](https://github.com/MonsterXia/scrcpy-harmony/pull/32)；主对话对 `2e7cd3e` 的[独立审查](https://github.com/MonsterXia/scrcpy-harmony/pull/32#pullrequestreview-5615722771)确认端口 P2 已修复，独立 45/45 通过，无剩余阻断。最终组合 SHA 与[五项必需 CI](https://github.com/MonsterXia/scrcpy-harmony/pull/32/checks)由最终交付核验，主对话统一合并，本分支不自行合并。
- 下一步：在授权设备上校准 10 秒预算，核对内存字段和 HDC 协议兼容、断连恢复，再选择后续有限只读调用逐项接入。前后未限时调用、长期空闲原时长及 CPU/内存/监听释放仍待验证；M2-2 不标完成。
