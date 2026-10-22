# M2-5：设备读取失败提示修复

日期：2026-10-22。分支：`codex/m2-5-refresh-failure`。修复来源为 [PR #23](https://github.com/MonsterXia/scrcpy-harmony/pull/23) 的第一项失败回归；本 PR 独立基于 master，不修改 #23 分支，也不依赖参数错误修复。

## 所有权与范围

实施前读取其他活跃任务的状态并核对实际文件差异。应用刷新、投屏、窗口、资源脚本和 WebView 的其他任务文件未改动；M2-2 的 `hdc/base.ts` 未改动。使用独立 worktree、node_modules、dist、resources 和 Electron profile。此次只修改设备枚举错误契约、主 store、设备工具栏、对应文案和验证资料；RUNBOOK 与架构导航仅更新本项。

## 行为

之前 `listTargets` 异常被转换为空数组，工具栏无条件提示“设备已刷新”。现在枚举失败或非空列表中全部设备读取失败时拒绝 IPC；store 捕获失败，清空旧列表与选择并记录失败状态。手动刷新显示错误通知，空选择器也显示读取失败。初始化和设备事件仍能完成，后续刷新成功时恢复设备选择。正常无设备仍是成功结果，部分设备可读仍保留正常设备。

成功 IPC 类型保持 `ITarget[]`，新增失败拒绝语义已在公共类型及架构导航记录。并发刷新先后次序与共享 shell 超时不在本次范围。

## 验证

- TDD：新增协议到 UI 的回归在修复前为 4 通过、1 失败，失败断言为枚举失败却发送 success；修复后通过。另补正常空列表、启动失败完成初始化及设备事件恢复。
- 协议测试运行真实 hdckit、本地 HDC 帧服务、真实处理器、MobX store 与工具栏代码。禁止测试启动 HDC；网络 key 只作为合成标识。
- 更新到 master `769d24b` 后完整 `npm test` 为 87/87；`npm run lint` 和 `npm run build` 均通过。与参数修复临时组合后完整测试 95/95，未将组合代码提交到任一独立分支。
- 真机：Windows x64 / Electron 45 / HDC 客户端与服务端 3.1.0e；一台已授权 USB 鸿蒙设备，系统 7.0.0.109、API 26。实际生产构建的 preload、IPC、store、下拉框和通知路径通过正常读取、手动刷新、故障状态、恢复重选；页面错误数 0，应用正常退出。
- 复现命令：构建后执行 `node script/check-target-refresh-live.mjs docs/maintenance/evidence/M2-5-refresh`。脱敏结果见 [report.json](evidence/M2-5-refresh/report.json)，包含设备版本、源码 SHA-256、允许命令计数及断言结果。

故障仅由本地代理关闭本次应用的一条枚举连接注入；真实设备保持连接，HDC tracker 保持运行。代理只允许握手、alive、list targets、shell echo ready 与 shell param get，不执行应用枚举、安装、配对、网络设置或 HDC 服务启停。报告不保存设备 key、IP、参数原文或应用列表。验收脚本曾因退出后再读取 process 和异步等待过早失败；修正脚本后完整重跑通过，不将失败运行记为通过。

## 审查与交接

独立审查员未发现阻断代码问题；指出的诊断日志级别文档已改正。审查员初次全套测试缺少新主分支引入的 jsdom；重新 npm ci 后完整测试通过。最终 PR 的全部必需 CI（test、lint、Windows、macOS arm64/x64 打包）必须通过后保留待审查，不自动合并；链接与最终检查状态记录在 PR 正文。

M2-5 保持进行中。本项通过不代表无线真机、授权失败或物理断连重连已验收；下一步按 M2-5 网络连接矩阵补测。同步已合入的 #23 后，枚举失败提示对应 TODO 已转为普通回归，参数错误 TODO 仍保留至 #27 修复合入。

合并审查补充：测试 fixture 同样存在清理快照后晚到 accept 使 server.close 等待的缺口；加入停止保护、初始化前清理登记及真实回环延迟 accept 回归。修复仅影响测试清理，未修改已验证的生产行为。与 #23 网络证据测试合跑为 12 通过、1 个执行失败的参数错误 TODO；原真机结果未重新执行，不把该测试修订算作额外设备验收。
