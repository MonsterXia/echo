# M2-4：WebView 调试目标发现

日期：2026-10-22。基线：`8f1becb2d1a20a07ef9a9084071a121687cafcf5`。分支：`codex/m2-4-webview-discovery`。状态：进行中，合成回归已验证，真机仍待验收。

## 来源与边界

- [上游 Issue #19](https://github.com/liriliri/echo/issues/19) 仍开放：报告 Pura 70 Pro / 5.1.0.150 API 17 在应用列表为空，但官方 Chrome 方法可用。维护者于 2025-12-01 表示同机型未复现，2026-06-11 另有 6.1.0.117 API 23 的同类报告。讨论没有证明本次缺陷就是原机型问题的根因。
- Issue 引用的[华为 V5 教程](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/web-debugging-with-devtools-V5) 本次抓取超时；实际核对了 [OpenHarmony 官方 DevTools 指南固定版本](https://github.com/openharmony/docs/blob/2f68f726a9523b709f49354f76865c5c2d74da28/zh-cn/application-dev/web/web-debugging-with-devtools.md)。该文档说明应用需开启 Web 调试，USB 路径查询 `/proc/net/unix`，将 `webview_devtools_remote_<pid>` 转发到本地 TCP，再检查 `/json`；socket 的 PID 必须与应用进程一致。未运行教程中的设备命令。
- 工作树独立复用本聊天已清洁的 checkout，并从最新 master 创建新分支。只写 `src/main/lib/hdc/webview.ts`、专属测试/报告和 M2-4 RUNBOOK 状态。不修改其他线程负责的 `base.ts`、`hdc.ts`，不修改共享目录的资源脚本、主窗口和 renderer Webview.tsx 未提交工作。
- 本轮不运行 Electron、HDC、设备命令或 HAP；数据均为合成值，不收集内部应用信息。

## 已复现的缺陷与修复

1. 旧扫描循环即使没有匹配仍保留最后一行，末尾恰好是另一 PID 的 socket 且无换行时，会错误转发。substring 匹配还会令 PID 12 选中 123，异常匹配行可能遮蔽后续合法行。现在校验 `/proc/net/unix` 的八列结构，仅匹配完整抽象 socket 路径；无目标和非法 PID 返回空列表且不转发。
2. 锁定依赖 licia/singleton 默认用 `JSON.stringify.apply(this, arguments)` 求键，实际上只按第一个 connectKey 合并请求。同设备不同 PID 并发查询会串结果。现在显式使用 `[connectKey, pid]` 元组键；相同参数仍合并在途请求，完成后重新读取，失败后也可重试。
3. 旧实现将错误 JSON/对象/非对象条目交给 each，可能当作目标返回。现在要求 JSON 对象数组；HTTP、JSON 或响应结构错误均拒绝，成功的空数组仍返回空结果。目标对象字段原样保留。
4. 旧 `/json` 请求无等待上限。一次中间验证发现仅设置 axios 空闲超时仍会被持续分块流延长；最终实现以 AbortController 的 5 秒总截止取消整个本地 HTTP 阶段，finally 清理计时器。禁用代理及重定向，查询只到转发得到的 loopback `/json`。

HTTP 总截止从 forwardTcp 成功之后开始，**不代表整个 getWebviews 有总截止**。共享 shell/forward 等待治理仍由 M2-2 负责。renderer 的错误提示、旧列表清理与调试窗口生命周期未在此 PR 改动；无线 TCP 调试和未证实的 socket 命名变体也不在本次范围。

## 验证证据

`test/webviews.test.cjs` 通过 esbuild/VM 加载真实 webview.ts，捕获并调用真实注册的 getWebviews handler。shell、forwardTcp 和 Electron 注册边界受控；axios、singleton 与 OS 分配端口的 loopback HTTP 服务是真实实现。不会加载 base.ts、创建真实设备转发或启动 HDC。

- 首轮 TDD：11 项在旧实现上 3 通过、8 失败；失败覆盖精确 PID、无目标、异常行、非法 PID、并发隔离、错误响应和静默 HTTP。修复后 11/11。
- 额外持续分块回归在仅有 socket 空闲超时的中间实现上，于 6.5 秒观察窗仍 pending，退出码 1；加入总截止后通过。不是用模拟计时器证明真实 HTTP 超时。
- 最终专项 13/13：含多行/重复行与多个 JSON 目标、空结果、成功/失败后重试、同参数去重、不同 PID 并发、HTTP 状态/JSON/形状错误、静默/持续分块截止，以及不跟随重定向。
- 测试服务在监听前注册清理，停止时先禁止新连接并关闭 listener，再销毁已登记连接；迟到 connection 立即销毁。分块响应的 interval 在 response close 时清理。回归失败也能正常退出。
- 本地全量 `npm test` 为 198/198，`npm run lint` 与 `npm run build:main` 通过；build 仅有既有 Vite CJS API 弃用提示。独立审查及五项必需 CI 的最终结果由 PR 正文记录，不以旧提交绿灯代替最终 head 验证。不自行合并。

## 下一步真机验收

需在已授权测试应用开启 Web 调试后，对照官方 Chrome 方法与应用中的同 PID 列表，验证空目标、进程重启、断连重连、转发失效和调试页面打开。优先复核原报告系统与机型，但本轮没有证据断言它们已修复。M2-4 保持进行中。
