# M2-2 / M2-3：主进程关窗与捕获监听审计

日期：2026-10-23（Asia/Hong_Kong）。基线 `4f514989ac2e7e2a0f03788286bd2441fb386e5b`，独立分支 `codex/capture-close-lifecycle`。本轮仅修复窗口引用释放；**捕获监听及设备停止问题仍未修复，M2-2/M2-3 保持进行中**。

## 范围与环境

- 先核对 [M2-3 原报告](M2-3-recovery.md) 中的边界：renderer `destroy()` 不等于操作系统关窗；已发出的 IPC 不能由 renderer 撤销，跨 renderer 所有权此前不在范围内。
- 独立 worktree、独立 `npm ci --ignore-scripts` 和 dist。Windows x64、Node 22.21.1、npm 10.9.4、锁定 hdckit 0.12.1。构建使用固定 share 子模块 `f9898acb070bbadb7d9b9ea2b72ec2e40c26e943`。
- 没有启动应用入口、Electron 或 HDC，没有访问手机、应用清单、用户配置或私人日志；所有 key、session 和帧字节均为合成样本。
- 下述窗口事件由替身发出，**不是实际 Electron 窗口、renderer 进程销毁或真机验收**。真实执行的是 `screencast.ts`、`uitest.ts` 注册处理器和 hdckit 的异步 start/stop/Emitter；仅替换 Electron/共享窗口工厂、缓存驱动查询和 transport。测试不读取 `src/share`。

## 独立可修复的问题：窗口引用

原 `src/main/window/screencast.ts` 只在 `close` 回调清空模块级 `win` 并显示主窗口。`BrowserWindow.destroy()` 绕过 `close`、发出 `closed`，因此这一边界留下已销毁窗口引用；随后 `showWin()` 会调用旧窗口的 `focus()`，`closeWin()` 也可能调用旧窗口。

`test/screencast-window-lifecycle.test.cjs` 在改代码前得到 **2 通过 / 3 失败**：普通显示/关闭通过，直接销毁后的主窗恢复、重开和重复关闭失败。替身在已销毁对象上调用 focus/close 会断言失败，避免将无效调用误判为正常。

最小改动仅把 `win = null` 与主窗口恢复移到 `closed` 回调；原 `close` 的强制 destroy 行为保持不变。修复后 **5/5**，加原布局回归 **8/8**。这只释放应用窗口引用，不取消 IPC，不发送 stop，也不释放捕获监听。

## 尚未修复的捕获生命周期

可重复入口：

```sh
node script/audit-capture-close.cjs
```

该命令是诊断探针，输出观测值；退出成功表示完成探测，**不表示捕获停止验收通过**。它在每个样本结束时通过合成成功 stop 清理自身；不会连接设备。控制组要求真实 UiDriver 已注册一个监听，且成功 stop 能解除它。

本轮输出：

| 场景 | 观测结果 | 结论范围 |
| --- | --- | --- |
| 完成 start 后普通关窗 | 残留 1 个 message 监听；关窗新增 transport 调用 0；合成帧仍触发 sendTo 1 次，无窗口投递 0 | 主进程没有关窗捕获清理路径；无窗口时共享发送边界丢弃帧，不等于监听释放 |
| 重开窗口、尚未开始新捕获 | 旧会话合成帧向新窗口投递 1 次 | 回调按固定窗口名路由，未绑定原窗口身份；未证明新 renderer 一定绘制此帧 |
| start transport 尚未完成时关窗，随后成功回复 | 回复前监听 0，回复后监听 1，合成帧触发 sendTo 1 次 | start 的后续逻辑可在 renderer 消失后继续注册监听 |
| stop 明确拒绝后关窗 | 残留 1 个监听 | hdckit 在 await stop 成功后才 off；单纯调用 stop 不能保证释放 |
| 直接 destroy，发出 webContents destroyed / window closed | 残留 1 个监听；销毁新增 transport 调用 0 | 窗口引用的小修复不覆盖捕获清理 |
| 成功 stop 对照 | 剩余监听 0 | 夹具执行真实 hdckit 清理，未将 start/stop/Emitter 替换成空方法 |

## 根因与禁止外推的结论

1. `uitest.ts` 通过设备 key 缓存 UiDriver。start 的闭包仅保留 key、按 `sendTo('screencast', ...)` 路由，没有 BrowserWindow/webContents owner；它并非通过闭包直接保留整个窗口。此次证据证明的是 **UiDriver 捕获回调残留和路由缺少身份**，不能称为已测量的窗口堆内存泄漏或持续增长。
2. `ScreencastClient.captureTasks` 是 renderer 内静态 Map；窗口销毁后，不能为另一个 renderer 提供顺序约束。main handler 本身未维护跨 renderer 队列。`close` 中立即调用 stop 可能先于正在等待的 start 完成；start 随后仍注册回调。
3. hdckit 的 stop 只按设备操作，不接收捕获 owner/session。旧窗口清理若延迟到新窗口启动之后执行，可能停止新捕获。无回复、明确拒绝和成功是不同状态；无设备证据不能认定设备已经停止，也不能为了测试通过清空其内部字段。
4. 当前仅一个合成捕获即可复现监听残留。没有执行多小时资源采样、真实 IPC、JPEG/GPU 或设备传输，不证明上游特定应用问题、长期空闲报告或设备端资源泄漏的根因。

## 验证与交接

- 窗口生命周期回归：基线 2/5，最小修复后 5/5；与布局组合 8/8。
- `npm test`：398/398；`npm run lint`：通过。新增夹具的依赖由 VM 明确列举，不读取共享子模块。
- 额外在 Node `fs.readFileSync` 边界禁止 `src/share` 读取后，窗口/handler/renderer 生命周期组合 29/29，诊断探针输出保持一致；此检查不替代最终 CI。
- `npm run build:main`：通过；保留现有 Vite CJS API 弃用警告。未声称完整类型检查或安装打包通过。
- 本轮未修改 `uitest.ts`、HDC/finiteShell、Overview、renderer 生命周期、依赖和物理设备验收脚本。最终提交独立审查及五项必需 CI 由主对话核验后决定合并；本分支不合并或发布。

下一步应另立主进程捕获所有权设计：确定 owner 与窗口代次、同设备请求顺序、销毁时的本地退订、迟到 start 的补偿以及 stop 拒绝/无回复的状态。设计必须证明旧 owner 不能停止或向新 owner 投帧，并区分本地回调解除与设备停止确认。然后补实际 Electron 关窗/崩溃/重开无设备检查及授权设备停止验收。本报告不自动启动这项协议改造。
