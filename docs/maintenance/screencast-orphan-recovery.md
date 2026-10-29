# 桌面残留会话导致投屏无法启动（2026-10-29）

状态：源码修复、本地回归、开发构建及最终安装路径真机恢复通过，已更新本机应用。基线为 master `153304c`（PR #71 已合入），交付 [PR #72](https://github.com/MonsterXia/scrcpy-harmony/pull/72)，最终审查/CI 与合入状态以该 PR 为准，未发布 Release。

## 现场与根因

用户的已安装 `1.0.4-dev.1` 投屏窗口一直显示 “Screen mirroring could not start”。在同一安装程序与当前 nova 15（`const.ohos.fullname` 为 `OpenHarmony-7.0.0.105`，应用概览显示 `OpenHarmony 7.0.0.109 / API 26`） 上复现，真实 IPC 连续报 `Control recovery blocked by another native capture`，没有绘制帧。旧 app.asar SHA-256 为 `639ca7efafcc55f4cc57dfcbd8dc8b41428fddf9a81bff111fef5461faeff2ef`。

手机上留有一个随机 `scrcpy_harmony_<token>.so` 扩展进程，桌面应用退出后仍占据固定 Unix socket；控制 daemon 也不再响应。旧 NativeVideo 只在内存保存本次扩展名，新桌面进程无法确认旧扩展归属，因而拒绝控制恢复。重新打开和手动重试都会再次撞到同一保护条件。

本次旧进程没有持久记录，不能宣称新自动恢复机制回收了它。现场先核对记录的 PID/starttime、完整 ps 启动命令及已知库 SHA-256，再在 kill 前用 shell 再次校验 starttime，精确停止该进程并确认其消失、删除该副本；没有使用 killall 或批量终止 UITest。最初尝试使用设备 `tr` 读取 cmdline，被设备命令缺失拒绝，尚未执行 kill；最终处理使用 ps 与 stat，生产逻辑也不依赖 tr。随后开发构建首轮约 7.7 秒绘图，后续两轮约 0.35 秒，三轮都有真实 H.264 绘制。

## 修复

- 按 HDC endpoint/target 隔离持久会话归属，记录桌面 PID、设备 PID/starttime、随机扩展名和端口；监听确认后保存，创建转发前补端口。
- 前台初始化/重试可原子认领已退出桌面进程的记录。活跃 owner/claimant 不回收；未知远端名称不构成归属证明。后台不恢复旧会话。
- 恢复时要求完整进程清单、设备 PID/starttime 一致，并在 kill 前重新核验 starttime。转发要匹配设备、端口及 socket；删除前还要完整 Unix socket 表确认无其他 native listener。
- 未确认进程/转发/副本清理时保留记录。正常结束只在全部确认后删除记录；认领者中断后，后续进程仍可重试。
- 真机探针等待主窗口 ready 日志才连接 inspector，避免 Node bootstrap 期间 Electron 模块尚未就绪和文档加载竞态；新增同 profile 的真实强制退出/恢复两阶段验收。

独立新上下文复审先通过 journal/接入，随后发现新增 forward 保护把空/截断 socket 清单误认为空闲。现要求合法表头、每行格式和完成标记，三类回归及复审原始复现均通过。这个发现已关闭。

## 验证与边界

- 最终应用回归 722/722；Licia 生产/fallback 各 606 passing / 4 pending；lint/i18n、完整构建以及最后保护改动后的主进程重建通过。没有把 Vite 转译称为完整类型检查。
- journal 正式测试包括真实双进程争抢、认领者退出、失败保留/重试和活跃 owner 保护；设备交互测试含身份变化、清单不完整、其他 native listener 与转发处理。模拟测试不等同设备验收。
- 开发构建：真实 H.264 绘制后 SIGKILL 本次桌面进程，记录保留；同 profile 新进程自动回收旧会话，约 2.1 秒绘图，三轮重开均有 H.264；正常退出后记录为空。
- 旧安装包探针的主窗口超时属于真实故障；另外早期 inspector 过早连接导致的探针初始化失败单独记录，不混作产品故障。设备全程只保存计数和布尔断言，不保存屏幕、设备标识或 PID。
- 旧版本无记录、用户删除/切换 profile，以及启动到首次写入记录之前的崩溃仍无法自动确认归属；不会仅凭文件名前缀清理。桌面 PID 复用会保守延后恢复。
- HDC 转发只能确认 target/port/socket，不能跨重启证明同一元组的历史身份；已增加其他 listener/未知清单拒绝保护，仍不声称跨工具并发不存在所有竞态。Windows/macOS x64、其他固件、物理断连和长期运行未在本轮验收。

下一步：跟进本次修复 PR 的审查/CI；跨平台和上述未覆盖崩溃窗口分别验收，不扩大本次成功结论。


## 最终安装路径交付

已备份并替换 `/Applications/Scrcpy Harmony.app`，原配置保留。原版备份位于忽略目录 `release/mirroring-recovery-local/backup/Scrcpy Harmony.app`，新包位于 `release/mirroring-recovery-local/mac-arm64/Scrcpy Harmony.app`，ad-hoc 签名的 deep/strict 验证通过；未声称公证或发布。

最终 app.asar SHA-256 为 `75e106b6053b826e44368ee6b45d4405090252b5388c38d05a10c6d38ff9477d`。[本机交付统计](screencast-orphan-recovery/local-delivery.json)保存构建指纹和验证数量。

- [旧版失败](screencast-orphan-recovery/current4.json)、[旧残留精确清理](screencast-orphan-recovery/legacy-cleanup.json)、[开发构建三轮](screencast-orphan-recovery/fixed.json)。
- [开发构建强制退出](screencast-orphan-recovery/crash.json)及[三轮恢复](screencast-orphan-recovery/recover.json)。
- [最终安装包强制退出](screencast-orphan-recovery/packaged-crash.json)及[最终安装路径恢复](screencast-orphan-recovery/packaged-recover2.json)：约 1.778 秒实际 Canvas 首图、1.784 秒窗口可见，旧记录替换、H.264 绘制及正常退出清空记录均通过。
- [安装包首轮恢复探针失败](screencast-orphan-recovery/packaged-recover.json)发生于 inspector/主窗口初始化，尚未请求投屏，原记录被保留；等待主窗口 ready 后复测通过，不能隐去这轮失败。
- 安装包首次冷启动/静止画面曾出现候选扩展退出与首个视频帧超时，按既有机制转为 JPEG 后恢复 H.264。成功不意味着所有候选均兼容或静止画面永不等待。
- 最后通过原生 UI 从实际安装路径、用户原配置点击投屏，确认手机画面可见、无失败卡；应用保持运行供用户继续使用。截图仅用于当场观察，没有保存到证据或仓库。


## PR #72 合入复审（2026-10-29）

独立合入复审确认一项 P2：`fport ls` 同时列出正/反向转发，旧恢复校验只接受 `[Forward]`，任意正常 `rport` 都会阻止旧会话回收。已统一允许合法的 `[Forward]`/`[Reverse]` 清单，但只认领 `[Forward]` 且设备、端口、socket 匹配的映射；删除失败后的残留确认也使用同一方向与目标条件。未知方向仍保守拒绝。

新增五项模拟回归覆盖混合清单、只有相同元组的 Reverse、删除失败但 Forward 已消失、Forward 仍在和未知方向。修复前新增四项失败，修复后 105 项相关回归、lint/i18n 与主进程构建通过；独立复审重跑新增五项通过，finding 关闭。最终提交必须通过 PR 五项 CI 后再合入，不以旧 head 的结果代替。初轮 CI 的注释仅为 Actions Node 运行时弃用与 runner 镜像迁移提示，不是应用 lint 失败，本次不扩大为工作流升级。

上述转发兼容修正尚未单独进行真机反向转发验收；先前安装包/截图/哈希证据继续对应 `664365f` 的生产实现。本轮不打断用户正在使用的应用，也不将旧本机包称为包含最新转发修正。


### Sourcery 七条意见的核验与处置

| 审查意见 | 结论与依据 |
| --- | --- |
| [数字 PID TOCTOU](https://github.com/MonsterXia/scrcpy-harmony/pull/72#discussion_r4412142131) | 原理成立，现有 HDC shell 无法提供 pidfd 级原子终止；随机名称、PID/starttime 及同一远端 shell 临杀前重读缩小而不消除窗口。独立复审认为应明确记录限制，本轮不临时部署未经固件验证的原生 helper。下一步若要求严格原子身份，单独设计/验证 pidfd_open + 身份检查 + pidfd_send_signal 及内核/权限支持。 |
| [转发清单成功但漏整行](https://github.com/MonsterXia/scrcpy-harmony/pull/72#discussion_r4412142138) | 未找到该成功截断场景。HDC 上游 `CMD_FORWARD_LIST` 整体构造字符串并一次发送长度帧，客户端收满帧才写 stdout；本仓 hdckit `ListForwardsCommand` 同样通过 `readValue/readBytes` 按长度读满。CLI 超时/进程错误/缓冲上限会拒绝，空或格式不完整清单也拒绝。不能用本地 echo 或重复读取伪造服务器完整性证明；若存在特定固件复现需另查。此依据不声称已证明现场二进制与上游 master 完全一致。 |
| [损坏 journal 阻塞后续记录](https://github.com/MonsterXia/scrcpy-harmony/pull/72#discussion_r4412142147) | 已修复：JSON/字段损坏原子改名为随机 `.invalid`，保留原字节并报告，不据此清理远端；继续处理合法记录。读取/隔离 I/O 错误仍失败。 |
| [进程改名后丢失归属](https://github.com/MonsterXia/scrcpy-harmony/pull/72#discussion_r4412142154) | 已修复：完整 ps 中记录 PID 仍在但随机名称不再匹配时读取 stat，starttime 相同则拒绝清理/保留记录；只有不同 starttime 才判原进程不在。 |
| [另一桌面进程与认领者竞争](https://github.com/MonsterXia/scrcpy-harmony/pull/72#discussion_r4412142162) | 正常产品入口不可达：`src/share/main/index.ts` 在 HDC 初始化前获取 Electron single-instance lock，同 profile 第二进程立即退出；不同 profile 不共享 journal。目录别名/符号链接绕过单实例路径不属于当前支持范围。原子认领及真实多进程单测仍保留。 |
| [后台缓存绕过前台恢复](https://github.com/MonsterXia/scrcpy-harmony/pull/72#discussion_r4412142182) | 已修复：前台复用 cached/pending driver 仍执行回收；后台只读发现其他进程/待恢复记录时不创建新 standby，避免新 listener 遮蔽旧 forward。当前进程正常会话记录不妨碍自己预热，已认领但未完成的旧记录仍阻止预热。 |
| [测试没有执行 starttime guard](https://github.com/MonsterXia/scrcpy-harmony/pull/72#discussion_r4412142189) | 已补实际 sh/Git Bash 执行生成脚本，cat/kill 被函数替身截获，不读/杀真实进程；初查后 starttime 改变时 shell 在 kill 之前失败。此测试不宣称消除了校验之后的极短 TOCTOU。 |

新增损坏 JSON、后台准备、改名 PID、cached foreground 用例在修复前共五项失败。修复后投屏相关 114/114、lint/i18n、主进程构建通过；独立复审重跑 ownership/deployment/capture-sessions 三文件 92/92，通过并关闭 3/4/6/7。完整 `npm test` 通过：736 项应用回归，Licia 两模式各 606 passing / 4 pending。全部处置保留上述适用范围；最后完整 CI 必须针对推送后的新 head 验证。
