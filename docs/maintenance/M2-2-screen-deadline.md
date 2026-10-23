# M2-2：概览屏幕查询接入有限传输

2026-10-23 / Codex。初始基线 `8d1cfabbc683a2664fd5f12d2ce89bb61e47f6a8`，分支 `codex/m2-screen-deadline`；恢复任务时普通 merge 同步 master `19c0d2b6df25c2b2ffe7fb4d03363bf90824bf9e`，保留已合并 #39 的协议修复及文档。本轮是[内存查询](M2-2-memory-deadline.md)之后第二个有限只读接入；M2-2 仍进行中，未证明长期空闲卡死的根因或修复。

## 行为与范围

仅 `hdc.ts/getScreen` 的固定 `hidumper -s RenderService -a screen` 从 base.shell 改走已有 runFiniteShell，单次总预算 **15 秒**，覆盖连接、握手、ready、写入与读取。RenderService 查询涉及服务处理，预算比简单内存文件读取多留 5 秒；这是保守设计值，**未经设备性能测量或真机校准**。

正常响应继续兼容 `physical screen resolution: 1080x1920` 和 OpenHarmony 6.x 的 `physical resolution=2560x1440`；未识别但不含明确错误标记的文本仍返回空分辨率。行首 `[Fail]`、`[E` 加六位数字 `]`、`error:` 明确错误改为拒绝，错误信息不带原始输出。不声称取得 shell exit status。

超时/协议/网络错误拒绝 getOverview，适配器在结算前销毁并等待本次 socket 关闭；不返回部分屏幕数据、不回退旧 shell、不自动重发用户命令。现有 Overview.refresh 的清空/提示错误/可重试路径不变。ready 的 E000004 探针重试仍受同一截止约束。

内存 10 秒和屏幕 15 秒分别从各自调用开始计时，**不是整个 getOverview 的 25 秒上限**。前序 param get、SP_daemon/uname 和其他 base.shell 消费者仍无总截止；原有前序 hdckit 服务启动语义保留。本轮不启动/kill 服务，不迁移写操作、终端、HiLog、投屏或前序查询，不修改 IPC/公共 API、renderer、锁文件或 CI。

内存、屏幕和 Hdc.createClient 复用同一 HDC_ENDPOINT。host=127.0.0.1，端口按锁定 hdckit 0.12.1 factory 的 OHOS_HDC_SERVER_PORT 规则解析一次；空/非数字回退、数字前缀及非法范围拒绝策略均未改，不读取依赖私有字段。继承 #39 [握手兼容修复](M2-2-handshake-compat.md)的 16/44 字节 hello 白名单、32 UTF-8 字节目标和 16 MiB 输出限额；未知长度/截断拒绝，回复不回显尾部。更多服务变体仍需独立验证。

## 失败证据与验证

新增 `test/screen-deadline.test.cjs`，与既有内存测试共用抽取到 `test/helpers/overview-fixture.cjs` 的真实路径夹具：实际 hdc.ts/getOverview、base、parameters、finiteShell、锁定 Hdc.createClient/Client/Connection/Target 均执行。只隔离 Electron 注册、无关模块初始化、tracker 和进程启动边界；生产端点先断言，再映射到随机 IPv4 回环端口。runFiniteShell 未被 mock。

- 改生产代码前屏幕专项 **13 失败、1 通过**。两种格式及空值原本解析兼容，但没有屏幕有限传输预算；connect/handshake/ready/send/read 均缺失截止，明确错误被当空值，半帧 EOF 被接受。原有 TCP reset 拒绝已通过。
- 修复后屏幕 **14/14**、原内存 **23/23**，联合 **37/37**。内存用例保留 10 秒实钟、错误/恢复、React 概览清空和环境端口兼容；只调整成功概览现在使用两个有限命令的连接数/预算断言。
- 屏幕覆盖两种分辨率格式、空值兼容、非默认端口、五阶段截止、迟到数据/错误写回调、socket 在拒绝前关闭、不自动重试、再次刷新恢复、明确错误、TCP reset、截断帧。
- connect 停滞和 send 回调通过 Socket/Writable 边界确定性注入，send 断言确实持有写回调；握手/ready/read 用真实 TCP peer 保持静默或发送部分响应。大多数停滞将计时器边界加速至 100ms，但断言生产预算为 15000ms；另一个不加速用例实测约 **15021ms** 后拒绝并关闭 socket。测试看门狗仅证明旧无界等待，不参与生产取消。
- teardown 在初始化前注册，先停监听，再销毁已有和迟到连接；无真实设备、HDC 服务或 HAP 操作，全部为合成样本，不采集应用信息。

Windows x64 / Node 22.21.1，初轮命令结果：

| 验证 | 结果 |
| --- | --- |
| `node --test test/screen-deadline.test.cjs test/memory-deadline.test.cjs` | 37/37 通过 |
| `npm test` | 264/264 通过，无跳过/取消/TODO |
| `npm run lint` | 通过 |
| `npm run build:main` | 通过；Vite 转译不等于全仓库类型检查 |

## 合入 #39 后的组合复验

[PR #39](https://github.com/MonsterXia/scrcpy-harmony/pull/39) 最终 `3a08f8d` 已由主对话完成独立审查、正式候选三次内存真机复测及五项必需 CI 核验，合入 master `19c0d2b6df25c2b2ffe7fb4d03363bf90824bf9e` 后才恢复本任务。内存真机证据不外推为屏幕或整个概览验收。

普通 merge 解决架构、RUNBOOK 和内存测试夹具抽取冲突，同时保留两项工作记录。共享 `overview-fixture.cjs` 原 hello 仍是 16 字节，现同步为合成 **44 字节**，使内存与屏幕真实处理器链路均覆盖已观察到的服务格式；16 字节及异常长度边界仍由适配器专项覆盖。生产有限模块与 master 完全一致。

- 适配器 42 + 内存 23 + 屏幕 14，组合 **79/79** 通过；屏幕不加速截止约 **15020ms**。
- 全量 **279/279**，无跳过/取消/TODO；`npm run lint`、`npm run build:main` 通过。
- 本分支验证仅使用合成回环，不操作真实 HDC、手机/HAP 或采集内部应用信息。

## 同步后源码的手机读取证据

主对话在单台授权手机上，通过 TypeScript AST 提取当前 `hdc.ts` 中未修改的 `getScreen` 函数及 `configuredPort`、`HDC_ENDPOINT`、`SCREEN_TIMEOUT_MS` 声明，绑定真实 finiteShell 执行三次。三次均得到合法分辨率，耗时 **433/195/152ms**；未改写实现或 15 秒预算，未保存实际分辨率、设备 key 或原始输出。此证据仅为**源码函数提取 + 真实设备**，不是完整 getOverview handler 或 Electron IPC 验收，也不能校准负载下预算或替代长期空闲验收。

该次 `hdc.ts` 本地 SHA-256 为 `4d9744fa49c887154cf876adc9cf1e964deab95fca6791fa457206305d85a771`；finiteShell.ts 为 `bb43410b534eaad714e7afd9f775a5ac8b7a8a0a3d526e093bb4470b5fd82639`。已核对 #39 最终 `3a08f8d`、master `19c0d2b` 和本次合并索引中的 finiteShell Git blob 均为 `56c7072ee3ac197f3fde72a17ae8ebd5aef4b8aa`，源码及注释一致。本地文件含 206 处 CRLF，规范化为 LF 后与 #39 blob 逐字节相等，SHA-256 恢复为此前的 `77f3afca5beaf040c6d4f31de30d92cd2d5ad4130efe2ace334e285ba4ae43ea`；哈希差异仅来自检出行尾转换。

此后仅补报告和 RUNBOOK，测试及生产源码保持已验证版本，不重复已通过的组合或全量测试。

## 交接与下一步

[PR #35](https://github.com/MonsterXia/scrcpy-harmony/pull/35) 的最终 SHA、独立审查和[五项必需 CI](https://github.com/MonsterXia/scrcpy-harmony/pull/35/checks)由交付消息及 PR 页面核验；仅在最终提交独立审查无阻断且五项 CI 通过后由主对话合并，本聊天不自行合并或发布。

后续需授权设备验证两种屏幕格式/实际系统版本、协议与目标长度兼容、断连恢复，并校准 15 秒预算；再逐项评估前序有限只读命令。原长期空闲时长、CPU/内存变化、切换设备与关闭投屏的真实监听释放均未验收，不能以本轮回环测试标记 M2-2 完成。
