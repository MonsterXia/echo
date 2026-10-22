# M2-3：无设备异常恢复与资源释放

日期：2026-10-22（Asia/Hong_Kong）。执行：Codex。M2-3 整体保持**进行中**；本子任务仅验证 renderer 客户端生命周期。

## 来源与隔离

- 现场读取 [上游 Issue #12](https://github.com/liriliri/echo/issues/12) 及评论：标题为“投不了抖音，投抖音会卡死闪退”，正文为空、评论为零，未提供系统/应用版本或日志。不能据此认定捕获接口、客户端或受保护内容中的哪一层导致原报告。
- 开始时 fetch 确认 `origin/master` 为 `9e944ae27ad7cc4c656467257e3e84d8067dc2f8`；独立 worktree 分支 `codex/m2-3-recovery`。共享主目录三处未提交修改未触碰、未携带；依赖和 dist 均位于独立检出。
- 本地 Windows x64、Node 22.21.1、npm 10.9.4；按锁文件独立 `npm ci`，构建使用固定子模块提交。没有启动或停止 HDC，没有连接/操作真机，没有读取应用列表或私人日志。

## 可重复缺陷与修复

测试入口为 `test/screencast-lifecycle.test.cjs`。esbuild 打包实际 `ScreencastClient.ts`、`util.ts` 和 Licia Readiness，通过实际注册的 `captureScreen` 回调送入合成字节。仅控制 Electron bridge、store、Canvas、Image 的 load/error 回调以及计时器；不替换客户端的 start/draw/destroy 实现。

初始 11 项回归在基线运行：**10 失败、1 通过**，包括停止失败产生未处理拒绝。失败证据对应以下行为：

| 边界 | 基线结果 | 修订行为 |
| --- | --- | --- |
| 销毁及重复销毁后推进计时器 | 仍可重新 stop/start，多次停止，指针监听未解除 | 销毁幂等，清除重试并退订 bridge/指针事件 |
| 初始 stop 尚未完成时销毁 | stop 迟到后仍 start | 每个异步边界核对客户端状态/启动代次 |
| start 尚未完成时销毁 | final stop 先于 start 完成，可留下捕获 | stop/start 串行，final stop 等待正在进行的 start |
| 重叠缩放启动 | 并行发出多个 start | 过期启动跳过，最新缩放在先前操作完成后启动 |
| stop/start 拒绝 | 拒绝向调用者泄漏，销毁产生未处理拒绝 | 记录错误；活跃启动在五秒后重试，销毁不重试 |
| 图片加载失败 | Blob URL 未释放 | URL 在 finally 中释放，后续正常帧可 ready |
| 销毁时 Image 尚未回调 | URL 保留，迟到帧继续绘制 | AbortSignal 取消 Image 加载、清理处理器并释放 URL |
| 尺寸查询尚未完成时销毁 | 迟到结果继续更新/绘制/ready | 迟到结果丢弃 |
| 尺寸查询拒绝后下一帧 | 原实现已可恢复 | 保留该行为作为回归，不声称是新修复 |

额外回归覆盖重启使旧帧失效、已 ready 后的启动失败仍可重试、连续三次无帧重试只保留一个 bridge 监听，以及销毁后显式 start 无效。`ready` 仍表示首次成功绘制，不改为每次重启重新创建；重试判断单独使用本次启动的出帧状态。

独立审查又复现了同设备新旧实例队列相互打断、停止期间旧帧压制失败重试，以及 `destroy()` 返回 Promise 不符合 React effect 清理类型三个问题。新增三项测试先得到 14 通过/3 失败，再修订为 renderer 内按设备共享队列（完成后移除队列条目）、停止完成前拒收帧、启动失败强制重试，以及保持 `destroy(): void`。原坐标测试仅补齐 AbortController/clearTimeout 环境，并等待启动完成后送帧；坐标断言未改。

## 验证与审查

- `node --test test/screencast-lifecycle.test.cjs test/screencast.test.cjs`：25/25 通过（17 项生命周期、原有八项坐标回归）。
- `npm test`：83/83 通过。
- `npm run lint`：通过。
- `npm run build:renderer`：通过；现有 Vite CJS/Sass 弃用、Licia eval 和 chunk 大小警告仍存在。
- 额外 `node node_modules/typescript/bin/tsc --noEmit --pretty false --ignoreDeprecations 6.0` **未通过**：28 条诊断。使用 TypeScript compiler host 仅在内存用 `git show 9e944ae` 替换本次两份生产源码，对比基线与修订后的文件名/诊断码/消息：两侧均为相同 28 条，新增 0。包含 CSS 模块声明、DataGridNode 联合类型、Blob/Uint8Array 类型和共享子模块可选依赖；本次 React effect 清理类型错误已消除，不把现有类型债务标为通过。
- 独立审查后复核：上述三项问题均已解决，25 项相关测试通过，未发现新的范围内阻断问题；审查者额外在内存验证不同设备队列互不阻塞/完成后移除，以及启动拒绝时取消解码并允许下一代恢复。这是限定范围的代码审查，不是真机验收或合并批准。
- 交付 [PR #22](https://github.com/MonsterXia/scrcpy-harmony/pull/22)，保留待审查，不自动合并或发布。五项必需 CI（test、lint、Windows、macOS arm64/x64 打包安装启动）的最终提交结果以 [检查页](https://github.com/MonsterXia/scrcpy-harmony/pull/22/checks)及 PR 验证说明为准；这些 CI 不证明真机投屏通过。

## 验证边界与下一步

1. **未复现原报告的特定应用问题，未验证受保护内容或真机行为。** Image 回调受控，未证明真实 JPEG 解码、GPU/Canvas、IPC、HDC/UiDriver 或系统捕获兼容性；无设备测试不能替代原应用/系统组合回归。
2. 此处“关闭”是调用 `ScreencastClient.destroy()` 的生命周期边界。操作系统销毁 renderer 后仍在主进程执行的 IPC、主进程窗口清理不在本次改动范围；未进行真实关窗验收。
3. 已发出的 bridge 请求不能在 renderer 撤销。若 stop/start/getDisplaySize 永不 settle，renderer 不能保证设备端停止；有序 final stop 和同设备后续客户端也可能等待未完成的 start。此事实可供 M2-2 参考，本任务不更改其 `hdc/base.ts` 等待实现或 `uitest.ts`。跨 renderer 的所有权、首帧后流静默健康监测、触控手势取消不在本子任务内；当前帧事件只有 connectKey，没有捕获 session ID，无法区分开始新捕获后才送达的旧流帧。
4. 本次不是持续运行内存/CPU 验收，也没有证明 M2-2 长时间空闲报告已修复。可复用的证据仅限客户端销毁后的计时器、监听及图片 URL 清理。
5. 后续在明确授权的测试设备上记录系统/应用/HDC 版本，对比正常捕获与原报告场景并采集脱敏错误；区分捕获失败、客户端解码异常与受保护内容限制。当前不安装或操作任何应用；后续侧载仍仅限获准的 bilibili，缺本地 HAP 不得绕过。
