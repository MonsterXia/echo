# M2-2：逐设备枚举参数读取的有限等待

2026-10-23 / Codex。基线 `0bcbcca71a59b1b52b6f1e60e154ae51338f126e`，分支 `codex/m2-target-parameter-deadline`。本轮仅迁移 getTargets 的逐设备 `param get`，不改 host 枚举协议，不宣称整个枚举或长期空闲问题已有统一截止。

## 触发与行为

getTargets 先等待 `client.listTargets()`，再通过 Promise.all 并发读取每台设备的参数。原逐设备 try/catch 只能隔离已拒绝的请求；一个设备的 ready/read 永远不返回时，即使其他设备已响应，Promise.all 仍不能完成。

现在每个 `param get` 使用真实 finiteShell、共享 HDC_ENDPOINT 和已有 **10 秒 PARAMETERS_TIMEOUT_MS**。预算覆盖该设备 connect、握手、ready、发送和读取；超时销毁独占 socket 并等待本地 close 后，沿原逐设备 catch 记录失败并返回 null。正常设备按 listTargets 的原顺序保留，全部失败仍抛原聚合错误，空列表仍返回空数组，下一次刷新重新读取。仍然一次性返回列表，不是逐设备流式更新；有停滞设备时会等待其有限预算结束。

参数使用已共用的 `parseTargetParameters`，明确错误拒绝，版本、名称、API 字段及缺失字段兼容逻辑不变；错误不包含原始响应。没有业务命令自动重试或无界 shell 回退，不用外层 Promise.race 假装取消。

## 服务与协议边界

- `listTargets()` 和初始化 `trackTargets()` 均保持原 hdckit 路径及服务启动行为。核对锁定 0.12.1：Client.listTargets → connection → Connection.connect，拒连仍按原路径处理；本轮未修改这些源码或调用顺序。
- host 枚举的连接、握手、读取及服务启动本身仍可能等待，没有统一枚举截止。若 host 枚举成功后服务退出，后续有限参数读取直接拒绝并隔离，不在每设备请求中重新启动服务；下次 host 枚举仍走原启动路径。未发现需要修改初始化契约的证据。
- 继承有限适配器的 16/44 字节 hello、目标最长 32 UTF-8 字节及 16 MiB 单帧/累计输出限制；无效目标标识会按单设备失败隔离。真实设备版本、目标标识与负载预算仍需授权验证。
- 概览、base.shell、写入、HiLog、终端和投屏实现均未改。`parameters.ts` 的旧 reader 导出保留，本轮只更换 getTargets 调用点。

## 无设备失败复现与验证

新增 `test/target-deadline.test.cjs` 运行真实 hdc.ts/getTargets、共用 parser、finiteShell 和锁定 hdckit 的 host 枚举。所有网络通过 Socket 边界限制为随机 IPv4 回环端口；tracker/其他模块初始化及 Electron 注册隔离，禁止 HDC 进程启动。AsyncLocalStorage 仅把请求 key 传到故障注入 socket，不替换生产返回值或选用预算。

- 修复前筛选 ready/read 停滞用例，**2/2 失败**：合成 peer 保持不结束，1200ms 测试看门狗到期仍拿不到健康设备列表。看门狗仅用于失败报告，生产取消由 finiteShell 完成。
- 新专项 **13/13**：五阶段停滞的单设备隔离、健康结果顺序、关闭 socket/清除截止 timer、迟到数据与写回调不继续、下次刷新恢复；三种明确错误不泄露响应；reset/截断隔离；全部超时聚合拒绝；空 host 列表不发参数请求、host 失败与恢复。
- 多数故障用例仅在 timer 边界加速为 100ms，并断言各设备实际选择的预算为 10000ms；另一个不加速用例实测约 **10026ms** 后返回健康设备，失败设备连接已关闭。不是将 10 秒预算写进测试替身来替代真实调用。
- 既有 network-targets、target-parameters、target-refresh 夹具由禁止 finiteShell 改为加载真实模块，仅允许各自随机回环端点；不接真实 HDC。targets 单测继续只验证字段投影/错误隔离，协议与取消交给真实回环套件。

Windows x64 / Node 22.21.1：

| 验证 | 结果 |
| --- | --- |
| 新专项（以下组合运行内） | 13/13 |
| `node --test test/target-deadline.test.cjs test/targets.test.cjs test/network-targets.test.cjs test/target-parameters.test.cjs test/target-refresh.test.cjs` | 54/54 |
| `npm test` | 374/374，无跳过/取消/TODO |
| `npm run lint` | 通过 |
| `npm run build:main` | 通过，非全仓库类型检查 |

另将代码候选 `800226c469d930a5e36f9247ab5e0ee447c16a86` 的 tracked src/test/package.json 用 git archive 提取到独立临时目录，确认没有 src/share 子模块源文件，仅链接本工作树已有 node_modules，再运行同一组合：**54/54**。临时目录已清理；证明这些测试无需子模块检出，不以本机已初始化的 share 掩盖 CI 依赖。

## 交接与下一步

已通过普通 merge 同步 master `b918e2b93826310c2ee6f28ceac709a49826649a`（已合并 #45 端口弹窗生命周期），保留双方 RUNBOOK 和架构记录，无 rebase/force push。合并提交 `04d1dd26c9878f10da9264e3b0bd7bbf33cb5ea3` 的组合全量 **393/393**，lint、build:main、build:renderer 通过；renderer 仅有既有 Vite/Sass 弃用、依赖 eval 和大 chunk 提示。本轮枚举实现及专项测试相对 `5ea31ec` 未改，主对话独立手机基线保持 `0bcbcca`，不能把其重连现象归因于本次迁移或认作组合真机验收。

本轮没有实际 HDC/手机交互、物理拔插、应用信息采集或设备写入。主对话独占真机的物理断连及十分钟概览空闲验证；这些其他工作结果不能直接归属本候选的枚举参数传输。

最终 PR/SHA、署名独立审查及五项必需 CI 由主对话核验后合并，本分支不自行合并或发布。下一步对正式候选验证多设备/单设备无响应时的刷新、真实断连恢复及 10 秒负载预算；host 枚举及初始化等待仍为独立后续范围。M2-2 保持进行中，M1-1 的历史已完成验收不扩大为本次新传输的真机通过。
