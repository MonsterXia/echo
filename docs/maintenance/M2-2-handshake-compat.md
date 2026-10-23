# M2-2：有限传输的 44 字节 hello 兼容修复

2026-10-23 / Codex。独立基线 `8d1cfabbc683a2664fd5f12d2ce89bb61e47f6a8`，分支 `codex/m2-handshake-compat`。本轮修复已接入内存读取的握手回归；屏幕截止 PR #35 曾暂停，待本修复合入后恢复，组合复验见[屏幕报告](M2-2-screen-deadline.md)。M2-2 仍进行中。

## 触发与定位

主对话在授权手机上运行主干有限传输的 `cat /proc/meminfo` 三次，均在握手阶段报 `HDC_COMMAND_PROTOCOL`，耗时 4/2/2ms；同机 CLI 读取成功。脱敏观察仅保留服务 hello payload 长度 **44**、首八字节匹配 `OHOS HDC` 为 true、内存字段存在为 true。未保存设备标识、原始 payload、内存数值或应用列表。

旧源码 SHA-256 为 `ac382c0e344b96276880e657d42bbc09512fe48495521203a466239ae726e7cf`（主对话现场文件哈希）。旧适配器把 hello 限为恰好 16 字节，因此在发送 ready 前拒绝真实服务。此前只有 16 字节合成 fixture，未暴露这项兼容性错误；内存查询首次接入报告的“协议待真机验证”在本轮得到具体反例。

锁定 `hdckit@0.12.1` 的 `dist/hdc/Connection.js` 先读取完整长度帧，再调用 `ChannelHandShake.deserialize`。后者取前 12 字节 banner、在偏移 12 读取 uint32-BE channelId，忽略余下字节；序列化回复为 banner 12 字节和补零的 connectKey 32 字节。最低解析长度为 16 并不代表服务只发送 16 字节，也不证明任意更长帧都应被允许。

## 修复边界

`finiteShell.ts` 仅将 hello 长度白名单扩为 **16 或 44**，首八字节 banner 校验不变。完整接收长度帧后才判断；44 字节中的尾部不解释、不回显，回复仍严格使用前 12 字节 banner 加调用方 connectKey，和锁定 hdckit 序列化逐字节一致。截断帧、错误 banner 和其他长度继续拒绝。

总截止、AbortSignal、独占 socket 销毁并等待本地 close、ready 重试、单次业务命令及 16 MiB 限额均不变。不改变端点、启动共享服务、base.shell、IPC 或内存字段解析；概览其他命令仍无总截止。

## 证据与验证

- 失败先行：只运行新增 16/44 字节接受用例，修复前 **1 通过、1 失败**；44 字节实际报 `HDC_COMMAND_PROTOCOL` / handshake。没有用替身绕过生产有限模块。
- 适配器专项新增 15 项，合计 **42/42**：16/44 字节确定性拆包、与锁定 hdckit 回复对照、拒绝 0/8/15/17/43/45/64 字节、44 字节截断及错误 banner、44 字节 ready/read 的 abort/timeout 与资源释放。所有网络均为随机端口回环，内容为合成数据。
- 内存真实 handler/base/parameters/hdckit/finiteShell/React fixture 改为合成 44 字节 hello，原 **23/23** 通过；包含端点、解析、三阶段截止、迟到响应、重试恢复及不加速的 10 秒截止。组合专项 **65/65**。
- Windows / Node 22.21.1：全量 **265/265**，无跳过/取消/TODO；`npm run lint`、`npm run build:main` 和单模块 strict TypeScript 检查通过。Vite 构建不等于全仓库类型检查。

复现命令：

```powershell
node --test test/finite-shell.test.cjs test/memory-deadline.test.cjs
npm test
npm run lint
node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --strict --types node --target ES2022 --module node16 --moduleResolution node16 --skipLibCheck src/main/lib/hdc/finiteShell.ts
npm run build:main
```

主对话另在 OS 临时目录编译诊断副本，仅把条件改为接受 16/44，未改仓库源码。同机同命令三次成功，耗时 **162/158/162ms**；`MemTotal > 0` 为 true，MemAvailable 或 MemFree 存在且不超过 total 为 true。临时输出已清理。这是定位用诊断副本证据，**不是最终候选 SHA 验收，也不是完整 Electron 概览验收**。

正式候选真机复测由主对话完成：工作树 clean，提交 `f2e2f5ae091f28832fa642caacc39ea2f796a87a`，finiteShell.ts SHA-256 为 `77f3afca5beaf040c6d4f31de30d92cd2d5ad4130efe2ace334e285ba4ae43ea`。未修改源码，直接编译真实有限模块，连接单台已授权手机执行 `cat /proc/meminfo` 三次，全部成功，耗时 **170/159/178ms**；字段存在、total > 0、free <= total 为 true，无明确错误。未记录应用清单、原始 payload 或设备标识。这验证了该候选有限模块与真实手机的读取兼容，**不代表整个 getOverview、Electron IPC 或长期空闲验收**。现场文件哈希标识本地字节，Git 换行转换可能改变文件字节。

后续仅补本次正式证据的文档提交，生产源码不变，不重复无关全量测试；[PR #39](https://github.com/MonsterXia/scrcpy-harmony/pull/39) 的最终 SHA、独立审查及[五项必需 CI](https://github.com/MonsterXia/scrcpy-harmony/pull/39/checks)以 PR 页面为准。

## 下一步与验收限制

主对话已完成最终 `3a08f8d58a5612e8bf78892c342f1dad614e865d` 的独立审查、正式候选手机复测和五项必需 CI 核验，PR #39 合入 master `19c0d2b6df25c2b2ffe7fb4d03363bf90824bf9e`。此后才同步并恢复屏幕 PR #35；本分支未执行设备/HAP/应用数据操作或自行合并发布，手机仍由主对话独占。16/44 白名单以现有兼容证据为边界，其他服务变体仍需独立证据；10 秒预算在设备负载下的校准、真实断连恢复、完整概览及长期空闲原时长/资源释放仍未验收，不能将本修复称为上游空闲卡死已解决。
