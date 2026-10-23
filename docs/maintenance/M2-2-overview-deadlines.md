# M2-2：概览剩余元数据读取接入有限传输

2026-10-23 / Codex。基线 `a2ed5f8eeb45e027f639e92d12f9b0140cfdff7d`（包含指定的 `427e255`），分支 `codex/m2-overview-deadlines`。本轮补齐概览的三个剩余无截止读取；不将此标为长期空闲问题根因或 M2-2 完成。

## 契约与实现

此前 `getOverview` 的 `param get` 调用 `getTargetParameters(target)`，使用 hdckit 的 shell/readAll；`SP_daemon -deviceinfo` 和 `uname -a` 经 base.shell 拼成含 echo_separator 的单条命令。这些连接没有适配器的总截止或销毁所有权，前置查询停滞会阻止已限时的内存和屏幕查询开始；设备信息/内核命令的明确错误也可能被解析成不完整概览。

现在三个固定只读命令分别调用已合并的 finiteShell，保留同一 HDC_ENDPOINT 和 16/44 字节协议处理。执行顺序与预算如下，每次预算包括该命令的 connect、握手、ready、发送和读取：

| 查询 | 总预算 | 解析与错误 |
| --- | --- | --- |
| `param get` | 10 秒 | 复用原参数解析，明确错误拒绝 |
| `SP_daemon -deviceinfo` | 15 秒 | 保留 sn/deviceTypeName 提取，明确错误拒绝 |
| `uname -a` | 10 秒 | 保留 trim 和 `#` 前内核文本提取，明确错误拒绝 |
| `cat /proc/meminfo` | 10 秒，未改 | 既有内存行为 |
| `hidumper -s RenderService -a screen` | 15 秒，未改 | 既有屏幕行为 |

前三项为未经真机负载校准的保守初值；设备信息命令涉及服务工作，额外留 5 秒余量。SP_daemon 与 uname 独立执行，移除本调用点对旧 echo_separator 分隔的依赖，正常返回字段不变。`[Fail]`、`[E` 加六位数字 `]`、`error:` 的行首错误拒绝；错误信息不包含原始输出。未识别但没有这些错误标记的输出保持原解析行为，不声称能取得 shell exit status。

`parameters.ts` 仅抽取同步 `parseTargetParameters(output)`。`getTargets` 仍调用原 `getTargetParameters` → `Target.shell` → readAll → finally end；没有迁移枚举传输或改变逐设备失败策略。写入、终端、HiLog、投屏及其他 base.shell 消费者保持原行为。

## 截止与生命周期边界

五个概览设备读取均有独立预算，按顺序执行，预算相加为 60 秒；**没有新增贯穿 getOverview 的统一截止**，不将这个相加值描述为包括事件循环阻塞、同步解析、IPC 调度在内的严格端到端墙钟保证。任一命令失败立即拒绝，后续读取不开始；复用适配器销毁独占 socket 并等待本地 close 的行为，不用外层 Promise.race 假装取消，不回退旧 shell，不自动重发业务命令。

此前概览的前置 hdckit 查询可能自动启动 HDC 服务；迁移后概览只访问已运行服务，拒连直接报错。应用初始化 tracker 和设备枚举仍持有原 hdckit 服务启动路径；本轮不新增服务生命周期代码，也不改变它们的等待边界。设备切换不会取消已发 IPC，本轮没有新增 UI AbortSignal 桥接。

## 失败复现与本地验证

`test/overview-deadline.test.cjs` 使用真实 getOverview、base、参数解析、finiteShell 和锁定 hdckit；仅 Electron 注册、tracker/init、进程启动和 TCP 端点边界隔离。真实 TCP remap 到随机回环端口，HDC start/kill 被禁止，全部样本为合成内容。

- 首批 33 项在旧实现 **32 失败、1 通过**：包含缺少截止、仍走旧传输、设备信息/内核明确错误未拒绝、echo_separator 碰撞；参数值中的错误标签与缺失字段兼容原本通过。参数明确错误和部分 reset 原已拒绝，但旧连接路径不满足新的有限传输/关闭断言，不把这些既有行为误称为新增修复。
- 接入后三条命令各覆盖 connect/handshake/ready/send/read 截止、socket 在拒绝前关闭、迟到响应/写回调不继续、后续命令不启动、下一次概览恢复。还覆盖各自三种明确错误、reset、截断，以及正常字段、非默认端点、写入仍走旧传输。
- 加入服务拒连直接失败、无进程启动、服务恢复后下一次请求成功，专项合计 **34/34**。阶段用例在计时器边界加速为 100ms，生产传入预算另行断言；不是生产实现缩短预算。已有内存/屏幕不加速实钟用例继续验证 10/15 秒。
- 共享概览夹具因 SP_daemon/uname 拆分，从四个命令调整为五个，保留 44 字节 hello。内存、屏幕测试同步连接索引/预算/命令次序断言；枚举测试继续执行真实旧传输，禁止误用 finiteShell。

Windows x64 / Node 22.21.1 验证：

| 命令 | 结果 |
| --- | --- |
| `test/overview-deadline.test.cjs`（下列组合运行） | 34/34 |
| `node --test test/overview-deadline.test.cjs test/memory-deadline.test.cjs test/screen-deadline.test.cjs test/target-parameters.test.cjs test/targets.test.cjs` | 99/99 |
| `npm test` | 347/347，无跳过/取消/TODO |
| `npm run lint` | 通过 |
| `npm run build:main` | 通过，非全仓库类型检查 |

代码与测试候选为 `f48256a11a4d5d6fb9d79bce0134c71469166e70`。主对话独占手机及 `script/check-overview-live.mjs`；本分支不运行 HDC/手机命令、不触碰该脚本，不采集应用清单或用户数据。本地回环不能代替真实 Electron/preload/IPC 验收；基线 `427e255` 的主对话真机结果也不能直接归属本候选。

## 正式候选完整 IPC 与真机验证

主对话在隔离完整 build 上，以 Electron 45.0.0 / Windows x64 运行候选 `f48256a` 的真实 preload → IPC → getOverview → UI；本分支只读核对其脱敏 `overview-candidate/report.json`。报告 sourceCommit 与候选相同，hdc.ts SHA-256 为 `1b58619612063375a363918ee722ae89d9277a9fe7ce1fb1b9691d129abb443d`，parameters.ts 为 `b9319755450d0166398e8dcf9729e7c7b0abe67601352e6c3a9b87134a989cb9`，与本地已测试源码一致。报告还记录了实际 main/preload/renderer 构建与验证脚本哈希；脚本及完整 JSON 由主对话后续独立 PR 归档，本分支不复制这些文件。

- 完整 IPC 正常读取 **13 次成功，1421–1719ms**；预期字段、描述字段、分辨率、内存合法性布尔校验均通过，初始 UI 有效。主对话的脚本独立复核补强了九字段 UI 对比。
- 五条查询各注入明确错误和无响应，共 **10 个场景**全部通过：旧详情清空、spinner 结束、故障命令仅发送一次、后续查询不启动、生产 socket 关闭；下一次 UI 刷新及完整 IPC 均恢复。
- 无响应场景从刷新开始的总耗时分别为参数 **10035ms**、设备信息 **15608ms**、内核 **11045ms**、内存 **11604ms**、屏幕 **16657ms**。这些值包含前序查询和 UI/IPC 开销，不能当作单条传输预算变更。
- 页面错误 **0**、越界命令 **0**。代理仅放行授权只读概览及所需发现/端口列表命令；隐藏 PortMappingModal 挂载产生一次 `fport ls`。设备交互只读，未进行物理拔插、写入或内部应用信息采集。

这批证据覆盖真实应用链路与手机；错误/无响应由 transport 代理合成注入，**不等同物理断连或设备自身故障复现**。运行未打包，不代表发布安装包、负载预算校准或长期空闲验收。候选之后只补维护文档，生产代码和测试不变，不重复已通过的全量验证。

## 交接与下一步

最终 SHA、独立审查和五项必需 CI 按 PR 页面及交付记录核验后由主对话合并；本分支不自行合并或发布。下一步独立归档完整验证脚本及 JSON，并继续真实负载预算、物理断连恢复与长期空闲原复现时长/资源释放验收。M2-2 保持进行中。
