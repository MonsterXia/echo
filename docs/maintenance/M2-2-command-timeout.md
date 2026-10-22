# M2-2：有限 shell 命令等待与取消边界调查

状态：**进行中，提交证据与接口方案；未实现生产超时，未完成 M2-2 验收**。

2026-10-22 / Codex。基线 `9e944ae27ad7cc4c656467257e3e84d8067dc2f8`（PR #18），分支 `codex/m2-command-timeout`。独立 worktree、独立 npm 依赖与构建输出；Windows x64，Node 22.21.1 / npm 10.9.4，锁文件实际安装 hdckit 0.12.1。本轮没有连接真机、枚举设备应用或安装/卸载应用，也没有停止共享 HDC 服务。

## 结论与来源

[上游 Issue #22](https://github.com/liriliri/echo/issues/22) 在本次读取时开放，标题为“启动后静默不操作较长一段时间会出现卡死！”，正文为空、评论数为 0。没有原始等待时长、面板状态、设备版本或诊断日志。[来源索引](SOURCES.md)保留该报告；[PR #18](https://github.com/MonsterXia/scrcpy-harmony/pull/18) 后续风险涉及共享 shell 无期限等待。

**已证明的是有限命令调用链缺少可靠截止与取消边界，不是 Issue #22 的长期空闲卡死根因。** 不能从本地模拟服务的挂起推出实际设备或 Electron 已发生同一故障。

当前公开 API 无法在 `target.shell()` 返回前取得其内部连接，也没有按请求取消入口。在 `base.ts` 外层加 `Promise.race` 只能停止调用方等待，不能释放握手/ready 连接；仅在拿到连接后超时则仍遗漏最早的挂起点。因此本轮保持生产代码不变，提交可重复的缺口用例及下一步接口要求。未采用依赖私有字段改写、全局 monkey patch、共享 Client 替换或停止 HDC 服务来制造“已修复”。

## 核对过的实际实现

依据是本工作树 `npm ci` 安装的锁定包源码，而非对最新版本的假设。相对 `node_modules/hdckit/dist/`：

| 入口 | 实际行为 / 等待边界 |
| --- | --- |
| `hdc/Client.js` 的 `getTarget` | 同步校验 connectKey 并构造 Target，不打开 socket。`base.ts` 的 `await getTarget()` 本身不是当前库的异步网络等待点。 |
| `hdc/Target.js` 的 `transport` / `checkReady` | 先 `client.connection()` 握手，再发送 `shell echo ready\n` 并 `readAll()`；ready 后才打开实际命令的另一条连接。 |
| `licia/waitUntil.js` | `transport()` 的 10000 ms 仅在异步条件结束后检查；若条件永久 pending，不会触发截止。条件迟到返回 true 也直接成功。 |
| `hdc/Client.js` 的 `connection` | 局部创建 Connection，只返回 `connection.connect()` 的 Promise；握手完成前不向调用方暴露连接句柄。 |
| `hdc/Connection.js` 的 `connect` | TCP connect 后等待握手 `readValue()`，无期限、无 AbortSignal；ECONNREFUSED 还可能调用 `startServer()` 后重连。 |
| `hdc/command/ShellCommand.js`、`hdc/Command.js` | 命令发送未向上传播/等待 `connection.send()` 的 Promise；取消期间的发送失败也必须在后续方案中处理，不能只处理读取。 |
| `hdc/Connection.js` 的 `readBytes` / `readAll` | readBytes 监听 readable/error/end，不监听 close；readAll 在 `ended` 为 true 时返回累积字节。无结束帧/EOF便继续等待。 |
| `Connection.end()` / 类型声明 | 仅调用 `socket.end()`；不是强制关闭，不提供完成 Promise。公开 `socket` 可 destroy，但 target.shell 完成前无法从业务层获得它。 |
| `Client.kill()` | 杀 HDC 进程，影响共享使用者；不是单条命令取消接口，本轮未调用。 |

## 受控真实调用链证据

新增 [test/shell-timeout.test.cjs](../../test/shell-timeout.test.cjs)。用 VM 加载真实 `base.ts`、已安装的 Client/Connection，Target、协议解析及 Licia 等仍是实际代码。只有日志/IPC 注册被替换，`net.connect` 边界校验只允许本 fixture 的 `127.0.0.1` 随机端口，创建连接时记录句柄以便断言与清理；任何启动 HDC 子进程的尝试直接失败。

模拟服务实际使用 Node TCP socket 与 HDC 长度帧/握手，控制停止应答、迟到发送、错误握手和 EOF，不返回预制的 `getTarget` / `shell` / `readAll` Promise。`SYNTHETIC_TARGET` 仅是测试常量。测试结束只清理 fixture 的 socket、监听和 server，不访问 8710 或现有服务。

| 用例 | 观察结果 |
| --- | --- |
| 同步目标构造 / 空 key | 不创建 transport；空 key 的拒绝保留。 |
| 延迟完成、数组输出 | 挂起观察窗后释放响应，原始字符串分隔与 trim 保持；新单条请求返回正常字符串。 |
| 握手永不响应 | shell 保持 pending，内部 socket/readable 监听仍在；实际命令未发送。随后故意提供错误 banner，真实解析器拒绝 `Channel Hello failed`。 |
| ready 永不结束 | 收到 ready 命令后再观察 10100 ms，超过库内 10000 ms 仍 pending；随后提供 ready/EOF，原请求继续成功。 |
| readAll 永不结束 / 外层截止 | 已收到部分输出但不发 EOF；测试拥有的 80 ms 观察截止结束后旧请求及 socket 仍在。新请求独立成功，旧请求仍 pending；再发送迟到输出，旧请求最终成功。 |
| `end()` 与不配合关闭的 peer | peer 使用 allowHalfOpen，观察到 FIN 后仍不结束响应；调用方继续 pending、读取监听保留。peer 后来 EOF，部分数据被作为成功结果返回。 |
| `socket.destroy()` 无 error | TCP 已关闭，但 readAll 仍 pending、readable 监听保留；close 不会触发 readBytes 的拒绝。 |
| `socket.destroy(error)` | 真实 readBytes/readAll 拒绝，读取器添加的监听移除，socket 关闭；下一条独立请求恢复。此处测试拥有内部句柄，**不是 base.ts 已有的取消能力**。 |

这些是**现状特征测试**：通过表示缺口及协议行为被稳定复现，不表示超时已修复。80 ms 是受控状态的观察窗口，不能当作产品期限；有限观察配合源码说明无截止机制，不能宣称真的“等待了无穷时间”。10.1 秒测试验证库的名义超时未生效，不是 Issue #22 原复现时长。未测试实际网络断连、真机监听释放或设备端命令终止。

首次专测为 7 通过、1 失败：测试错误地固定 Node 内部 end 监听总数。改为比较故障前后读取器自身移除的一个监听，随后 8/8 通过。该修正仅涉及测试断言，不是生产缺陷修复。

## 命令调用范围

当前 `base.shell` 由下列有限命令使用；超时会涉及只读操作与有副作用操作，不能统一自动重试：

| 调用方 | 命令 / 注意事项 |
| --- | --- |
| `hdc.ts` | 概览 `SP_daemon -deviceinfo`、`uname -a`、屏幕 `hidumper`、内存读取、按键 `uinput`、截图前清理及 `snapshot_display`。 |
| `hdc/base.ts` | `top -b -n 1`；getProcesses/getPidNames 使用 singleton，同一 key 的 pending 请求未结束时会被复用。 |
| `hdc/bundle.ts` | 应用列表/信息/标签 `bm dump`，启动/停止 `aa`，清理数据/缓存 `bm clean`，前台应用 `aa dump -a`。 |
| `hdc/webview.ts` | `cat /proc/net/unix`。后续 forward 与 HTTP 请求是另外的等待边界。 |

安装/卸载走 `target.install/uninstall`，截图文件获取走 `target.recvFile`；不在 base.shell 的期限范围。`hdc/shell.ts` 交互终端直接 `target.transport()`，HiLog 为 `openHilog()`，投屏使用 UiDriver；不得在共享 Client/Connection 全局添加默认固定期限。设备枚举的 `listTargets/getParameters`、端口转发等也不会因 base.shell 修改而自动获得保护。

## 下一步接口方案与准入条件

应先在 hdckit 或明确维护的 transport 适配层建立按请求的取消能力，再接入 base.shell；需要单独评审依赖范围，本轮不修改 bundle.ts、Application.tsx 或其他并行责任区域。

1. 给有限命令链传递可选 AbortSignal（示意：`target.shell(cmd, { signal })`，**不是当前存在的 API**）。同一个请求上下文必须覆盖 ready 重试、TCP connect、两次握手、发送及 readAll；调用前已取消也立即拒绝。取消必须禁止后续 ready 轮询、重连和迟到命令发送。
2. 连接由上下文在创建时登记，取消先锁定唯一失败状态，再销毁该请求拥有的 socket；error/close/end 都应结束待处理的 read/write，并清理 signal/计时器/监听。readAll 必须区分取消与正常 EOF，不能因并发 ended 标记返回部分成功。迟到结果不得改变取消状态。
3. `startServer()` 的子进程等待是另一个边界：明确启动所有权、取消启动等待/回调及禁止取消后重连；不把终止全局 HDC 服务当作清理。不应仅调用 socket.destroy(error) 就宣称覆盖了连接创建与自动启动。
4. base.shell 才能安全地使用一个覆盖全链的有限命令总预算，在 finally 清理 timer；期限数值需结合实际命令耗时验证，当前不猜定。超时错误包含阶段/错误类别，避免将完整命令、设备标识、应用列表写入新增证据。保持现有 string/string[] 返回和分隔行为。
5. 对按键、启动、清理等有副作用命令，超时后设备端结果可能未知，关闭 socket 不等于远端回滚或停止执行；不自动重试。UI 的加载/失败恢复由各责任模块另行确认，不从底层超时推断已通过。
6. 把本次缺口用例改为截止前后行为断言，新增“取消发生在 connect/write/ready 重试/自动启动等待”以及并发请求隔离、迟到拒绝无 unhandledRejection、计时器与监听回落、终端/HiLog/投屏不受默认期限影响的验证。随后才能进行有限命令真机验收。

## 验证与交接

- 已执行：独立 `npm ci`；首轮专测 8/8、全套 74/74 通过。下述审查补充后 `npm test` 75/75 通过（含 9 项 shell/fixture 专测），0 失败/跳过/取消；lint 与 diff --check 再次通过。
- `npm run lint`、`npm run build:main`、`git diff --check` 通过。构建保留现有 Vite CJS API 弃用提示；没有声称完整类型检查、打包或设备验收通过。本地未运行完整发行构建，三个平台的完整构建/打包/安装启动由该 PR 的 CI 验证。
- 独立审查指出 fixture 在模块初始化失败时可能遗漏清理；已将清理登记提前到 listen/模块加载前，并禁止清理期间新增连接。子进程内存注入初始化异常（不改源码文件）：8 项预期失败，进程以 1 自行退出、无终止信号、未触发 5 秒兜底期限；正常全套复测仍为 74/74。独立审查已复核该修正，无新增发现。首次注入命令因引号错误未命中预期路径，修正脚本后取得上述结果。
- PR CI 的 test、lint、Windows/macOS arm64/macOS x64 打包安装启动结果见 PR 检查页；[PR #20 检查页](https://github.com/MonsterXia/scrcpy-harmony/pull/20/checks)对应最终提交的状态为准。CI 无设备启动不代替本项真机验收。
- 未验证：Issue #22 的长期空闲复现、CPU/内存趋势、至少原复现时长的运行、切换设备/关闭投屏后的真机监听与定时器释放。没有原报告时长，也未操作真机。
- 下一步：评审取消接口方案，独立推进可取消 transport，完成有限命令全链截止后，再按 RUNBOOK 的 M2-2 原始验收条件补充真实复现与回归。M2-2 保持进行中。

### 审查补充：teardown 期间迟到的 accept

2026-10-22 继续处理 [PR #20 的清理讨论](https://github.com/MonsterXia/scrcpy-harmony/pull/20#discussion_r4348010157)。先 fetch/merge 最新 master；期间 master 更新到 `ea53accac62de2551af78b4043595d9a385aa500`，已合入，RUNBOOK 尾部冲突保留 M2-2 与 M4-1 的双方记录。

- 新增确定性回归：使用真实 loopback TCP，在服务端已接受并计数连接后暂缓 `connection` 事件分发，启动真实 fixture 清理、取完 socket 快照，再释放 accept 回调。不靠反复运行碰撞网络时序。旧实现断言失败：清理仍为 `pending`，未快照的 peer 使 `server.close` 等待；回归自身的 finally/after 兜底销毁测试 socket，避免失败把测试进程挂住。
- 最小修复：teardown 设置 stopping 后立即停止监听，再等待连接关闭；迟到 accept 在读取或握手前检查 stopping 并立即 destroy。客户端的停止保护仍保留。此处只修复测试 fixture，不改变 base.ts 或 hdckit 生产行为。
- 验证命令：`node --test --test-name-pattern='fixture teardown' test/shell-timeout.test.cjs`，修复前 1 项失败，修复后 1/1 通过，确认 peer 已销毁、server 不再监听、未执行命令。有限观察窗只用于检测清理是否完成，不代表产品命令期限。
- 独立审查进一步指出新增回归在 `await fixture` 失败时的兜底登记过晚；已前移到初始化前。对子进程内存中的 `base.init` 注入异常，修复前 9 项预期错误后进程仍不退出、3 秒兜底触发 ETIMEDOUT；修复后同样 9 项预期错误、进程自行以 1 退出、无终止信号。兜底仅终止自己启动的测试子进程。独立审查最终复核无新增问题。
- 完整复测 75/75、lint、diff --check 通过；更新后的最终 SHA 与五项必需 CI 记录在 PR 描述及检查页，不沿用先前提交的通过状态。仍未操作真机、未认定空闲卡死根因，M2-2 保持进行中。
