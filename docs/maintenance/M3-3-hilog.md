# M3-3 后续：HiLog 在途记录生命周期

日期：2026-10-22（Asia/Hong_Kong）；执行者：Codex。M3-3 总体状态仍为**待验收**，本项仅完成无设备生命周期修复，独立审查通过，PR 与最终 CI 见文末。

## 来源与基线

- [M3-3 文档报告](M3-3.md)与 [PR #19](https://github.com/MonsterXia/scrcpy-harmony/pull/19)在线审查指出：`hdc/hilog.ts` 的 entry 回调在等待 `getPidNames()` 后没有重新核对暂停状态；关闭也未让回调失效。公开发行版 1.0.2 不包含本修复。
- 基线 `9f8ddcb40c53a822614d8855e7f03901efaba904`，独立分支 `codex/hilog-inflight-lifecycle`。复用本对话干净 worktree，未使用共享主目录或 runbook-integration 检出；依赖、dist、资源均属于本检出。
- 按整合要求合入 master `ddc1df4b710bbb90a0c2cfbcc6c0949d2289e196`（PR #28），无冲突，保留双方 RUNBOOK 与架构参考内容；以下最终全量验证在该整合状态重新执行。
- 文件所有权：生产改动仅 `src/main/lib/hdc/hilog.ts`；不修改 `base.ts`、renderer、设备 store/toolbar、资源脚本、锁文件或工作流。

## 失败复现与修复

`test/hilog-lifecycle.test.cjs` 加载真实 `hilog.ts` 及 `base.ts`，通过实际注册的 open/pause/resume/close handler 驱动 HiLog。保留 Licia emitter、PID 解析、缓存与 singleton 查询合并；替换 HDC 传输、窗口发送和诊断日志边界。使用受控 Promise 延迟或拒绝合成的进程响应，只使用 `synthetic-target`、`synthetic.app` 等虚构样本，不接入 HDC 服务或真实设备。

测试 reader 等待生产 entry 回调的返回 Promise，使异步拒绝作为明确断言失败呈现，不用任意 sleep 猜测时序。

旧代码：[失败记录](m3-3-hilog/before-tests.log)，10 项中 **8 失败、2 通过、0 取消**。暂停、关闭、暂停→恢复后仍输出旧记录；PID 查询拒绝使 async listener 拒绝；关闭一个流后仍混入同目标另一活动流的输出。正常缓存/PID 0 路径与重复 resume 为通过的对照组。

最小修复：

- 每条流维护关闭状态和生命周期序号。暂停/关闭使旧 entry 的序号失效；恢复不重新接纳旧 entry。PID 查询完成后、更新缓存前和发送前核对有效性。
- 关闭先失效并解绑自身 entry 监听，再结束 reader；从 handler 表移除后，迟到或重复控制 IPC 无操作，不会复活流或重复 end。
- PID 查询异常在 entry 内捕获；活动记录保留原始内容并回退 `pid-<数字>`、输出诊断。失效记录的成功和失败结果均不输出；查询失败不写缓存，之后记录可重试恢复。

修复后首轮 10/10 通过；独立审查后补上“恢复后的新记录共享尚未结束的查询”用例及关闭不写缓存断言，最终[专项结果](m3-3-hilog/after-tests.log) **11/11 通过**。

## 验证

环境：Windows 11 x64；Node `22.21.1` / npm `10.9.4`。按当前锁文件重新执行 `npm ci --no-audit --no-fund`，安装 592 packages；未改变锁文件。复用本 worktree 已下载的设备资源，仅用于构建复制，没有执行 HDC。

| 检查 | 结果与覆盖 |
| --- | --- |
| `node --test test/hilog-lifecycle.test.cjs` | 11/11：正常 payload/cache/PID 0、暂停、关闭及监听清理、暂停→恢复、PID 失败及后续恢复、失效后的失败结果、重复恢复、同目标双流隔离、恢复后新记录共享在途查询 |
| `npm test` | 合入最新主干后 [158/158 通过](m3-3-hilog/full-tests.log)，0 失败/跳过/取消（整合前首轮 150/150）；包含已有有限命令缺口测试，不把它当作超时已修复 |
| `npm run lint` | 通过 |
| `npm run build` | [通过](m3-3-hilog/build.log)；main/preload/renderer、资源复制及 dist 安装完成。保留既有 Vite/Sass 弃用、Licia eval、大 chunk 警告 |

## 未覆盖与下一步

- 不取消底层 `getPidNames()`/共享 shell 命令；若它一直不结束，Promise 仍在等待，本项只阻止失效后的发送/缓存写入。可取消命令边界由其他任务处理。
- 不撤回已经发出的 IPC；“清除”只清空 renderer 本地数组，不建立主进程采集边界。用户指南保留时间戳裁剪与脱敏要求。
- 不改 renderer 的异步 open/卸载时序，不声称解决所有 HiLog 资源生命周期问题；不改变日志顺序、并发查询策略或设备缓存隔离设计。
- 未启动本地 Electron、未操作真机/HAP、未枚举应用、未安装卸载任何应用、未停止真实 HDC 服务；只有合成测试数据。真实暂停/恢复、关闭/重启、切设备、清除/导出与长时运行仍需授权后的目标设备验收。
- 本项不解除 M3-3 的真机用户流程及 macOS 人工走读待验收状态，不证明 M2-2 的原始长时间空闲报告已解决。

## 审查与 PR

独立审查通过，无 critical / important 或未解决 minor；独立重跑首批 10 项测试并核对真实 hdckit reader API。唯一排版意见已修正，非阻塞的共享查询测试盲点已补充回归。最终 PR CI 及 SHA 将记录在 PR 描述；不自行合并，由主对话整合。
