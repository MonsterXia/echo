# M2-2：有限命令可取消传输基础

日期：2026-10-22。分支 `codex/m2-cancellable-transport`，起点 `9f8ddcb`；最终同步 master `5dcc7bd71842fba746523fa82998b935e25ca6fb`（包含 #28/#29）。M2-2 仍进行中。

## 本轮交付及接入边界

新增 `src/main/lib/hdc/finiteShell.ts` 的 `runFiniteShell(connectKey, command, options)`，直接拥有本次 TCP socket，建立可实际执行、可取消的有限 shell 合约。没有生产调用者，未接入 `base.shell`、IPC 或 renderer；现有应用命令仍走 hdckit，不能把本轮记为应用卡死已修复。

旧依赖的握手前连接所有权和取消缺口见[前轮调查](M2-2-command-timeout.md)。不读取 hdckit 私有 socket、不改 node_modules、不以 Promise.race 代替取消，不启动/停止/kill 共享 HDC 服务。终端、HiLog、投屏路径没有导入本模块。

本轮选择独立适配器，因为公共 hdckit 接口不能提供握手前取消，直接替换 base.shell 还会改变自动启动服务和兼容行为；未经设备验证时不全局替换所有读写命令。调用方必须显式提供已启动服务的数字 IP、端口、正整数 timeoutMs，可选 AbortSignal；无产品默认超时。

## 合约与实现

- 一次总截止覆盖 connect、握手、ready 探针/重试等待、命令写入和输出读取。计时器之外在 await 续接处检查单调时钟，避免事件循环延迟时继续发送下一帧；这不承诺阻塞事件循环下的实时期限。
- 取消以首个原因固定 `HDC_COMMAND_TIMEOUT` 或 `HDC_COMMAND_ABORTED`，附阶段 `connect/handshake/ready/send/read`。不包含命令、设备 key 或外部 abort reason。协议异常为 `HDC_COMMAND_PROTOCOL`，原始网络错误（例如 ECONNREFUSED/ECONNRESET）继续传播。
- 每个 exchange 创建独占 socket。取消 destroy(error)；finally 销毁并等待本地 close、结束迭代器、移除监听，最外层清理计时器及外部 abort listener 后才向调用者结算。无需对端 FIN，也不关闭其他请求/长连接。
- ready 探针使用单独通道；只对响应包含 E000004 的 ready 重试（间隔 1000ms，仍共享总截止），用户命令最多发送一次。成功保持原始 UTF-8 文本；不做 trim，不把完整帧中的命令错误文字解释为传输错误。
- 取消后不继续本地协议步骤，也不把晚到 EOF/回调当成功。**命令一旦发送，关闭连接不保证撤销设备端进程或已发生的副作用**；不能自动重试安装、卸载等操作。

协议依据锁定 hdckit 0.12.1 的 Connection/ChannelHandShake/ShellCommand/Target 源码：4 字节大端长度、16 字节服务端 hello、44 字节客户端应答（12 字节原 banner + 32 字节目标字段），shell 输出帧直到 EOF。Node 公共 API 依据 [net.Socket.destroy](https://nodejs.org/docs/latest-v22.x/api/net.html#socketdestroyerror) 与 [Readable 异步迭代](https://nodejs.org/docs/latest-v22.x/api/stream.html#readablesymbolasynciterator)。

收紧的契约必须在后续接入时单独验收：

- hello 要求恰为 16 字节且前 8 字节为 OHOS HDC；旧依赖解析时仅读前 16 字节，可忽略额外字节。
- 目标限 1–32 UTF-8 字节且无 NUL，超长拒绝，避免旧实现静默截断。
- 单帧与累计命令输出各限 16 MiB，命令加 shell 前缀也受该限额；这是新增资源边界，非已证明的设备协议上限。帧不完整时 EOF 拒绝，不能返回部分结果。
- 仅数字 IP，无 DNS、服务自动启动或服务生命周期管理。IPv4 回环已验证，IPv6/真实 HDC 版本兼容未验收。

## 回归与验证证据

`test/finite-shell.test.cjs` 在随机回环端口使用真实 net.Socket，禁止越出 fixture 地址；握手与命令帧实际解析，只有明确的停滞注入使用 Socket/Writable 边界。所有 teardown 先停止监听，再清理已有与迟到连接；不调用 HDC 可执行文件。

旧路径失败可复现：设置 `HDC_FINITE_BASELINE=1`，运行 `node --test --test-name-pattern='deadline destroys a silent handshake' test/finite-shell.test.cjs`。此模式加载实际 base.ts + hdckit 0.12.1，拦截进程启动。预期失败已观察：1500ms 测试看门狗到达后旧 Promise 仍 pending，缺失 HDC_COMMAND_TIMEOUT；fixture 最终清理连接。测试看门狗的 Promise.race 仅用于证明旧实现失败，不是生产取消实现。

专项 27/27 通过，包含：

- 握手/ready/read 截止和外部取消，connect/握手写入/命令写入的确定性停滞与截止/取消，迟到成功数据及错误写回调；取消后新请求恢复。
- 预取消和无效输入不创建 socket；ready 重试/截止/取消；真实拒连及 TCP reset；无完整 hello、非法 hello、半帧 EOF、单帧/累计输出限额。
- 原始输出与非零 banner/channel 字节、在迭代器边界确定性拆分帧头（不依赖 TCP 是否合并两个 write）；并发请求隔离和另一 TCP 长连接存活。
- 连续 20 次成功/取消交替调用后，全部本地 socket 已 closed、socket 事件列表为空、外部/内部 abort listener 与截止计时器为零。

独立只读审查未发现生产阻断问题，额外内存用例覆盖命令写入截止/取消、迟到错误、错误握手但 peer 不关闭、半帧取消；父线程的另一审查也核对了非零 banner/channel 应答与 reset。测试审查曾发现 write() 注入会被 Node 连接过程替换，改为 `_write` 并增加到达屏障；握手 abort 测试也等待客户端 connect 后才注入，避免错把 connect 阶段算作 handshake。拆包测试按审查建议改为迭代器边界确定性拆分。修正前的失败属于夹具时序/覆盖问题，不冒充生产修复证据。

本机 Node 22.21.1 / Windows x64。首次全量因独立检出未同步 jsdom 依赖失败（156 通过、2 失败）；已执行锁文件 `npm ci --ignore-scripts`，不修改依赖清单。最终组合验证结果与 PR/CI 见下方交付记录。适配器未被主进程入口引用，故 build:main 通过不单独证明它能编译；另执行该模块严格 TypeScript 检查及真实源码转译测试。

## 下一步

维护者先复核独立适配器，再选择一个有限、只读命令接入并设计端点/服务启动交接、超时值和错误展示；逐项验证上述兼容差异。随后才扩展 base.shell 消费者。长期空闲的原复现时长、CPU/内存、切换设备/关投屏后的真实监听释放，以及真实 HDC/设备效果均未验证。未触碰真机、HAP、设备应用或共享用户数据，未发布版本。

## 交付验证

- 合入 `5dcc7bd` 后，`npm test`：185/185，通过，无 TODO/跳过/取消；`npm run lint` 和 `npm run build:main` 通过。
- `node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --strict --types node --target ES2022 --module node16 --moduleResolution node16 --skipLibCheck src/main/lib/hdc/finiteShell.ts` 通过，仅此模块，不宣称全仓库类型检查通过。
- 旧路径截止用例再次运行：退出码 1，预期失败 1/1；新适配器专项 27/27。
- 交付：[PR #30](https://github.com/MonsterXia/scrcpy-harmony/pull/30)，[五项必需 CI 检查页](https://github.com/MonsterXia/scrcpy-harmony/pull/30/checks)。实现提交 `f7872e6`，后续仅补本交付链接；最终 SHA 与 CI 结果由检查页及交付消息核验，不自动合并或发布。
