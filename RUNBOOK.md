# Scrcpy Harmony 分阶段维护 RUNBOOK

## 本轮 PR #56 审查状态

投屏、初始化和工具栏变更已整理至 [PR #56](https://github.com/MonsterXia/scrcpy-harmony/pull/56)。独立审查发现的服务争用、退出无界等待、后台破坏控制会话三项已修复并经只读复审；首轮跨平台 CI 暴露的许可烟测期望遗漏也已修复。修复后本地应用 558/558、Licia 两模式各 606 passing / 4 pending、lint、Electron 8/8 通过。合入必须以最终 SHA 的独立复核及全部五项 CI 成功为前提，实时结果留在 PR；不发布版本。详见[审查与修复记录](docs/maintenance/screencast-pr56-review.md)。下一步仍为固件矩阵、物理拔插、长期性能验收，M2 其余状态不变。

本文件是后续维护的执行入口。初始基线为 2026-10-21 合入 PR #8 后的 `d672f8954d96ad3511527d074d312077fa8e4eee`；日期按 Asia/Hong_Kong。来源状态是当日快照，完整条目索引见 [维护来源记录](docs/maintenance/SOURCES.md)。

## 使用方式与完成标准

1. 从最早未完成阶段选择一项，在下方记录负责人、分支、基线提交和复现环境。没有目标设备时，可先做无设备验证，将真机验收保留为待办。
2. 读取来源正文/讨论并核对当前代码。上游开放 Issue 是报告，上游开放 PR 是候选方案；先复现或建立失败用例，再决定适配方式，不直接批量合入。
3. 每个独立问题使用小范围 PR。实现后执行与改动相关的检查，并等待该 PR 的必需 CI 检查通过；流程见 [开发与验证](.agents/skills/scrcpy-harmony-project/references/development.md)。
4. 在本文件更新任务状态、证据链接和剩余限制。只有满足该项验收条件才标记完成；PR 合并但缺少设备回归时，标为“待验收”。
5. 若无法复现，记录版本、步骤、持续时间和观察结果；若缺少设备/权限，记录阻塞条件及下次动作。不要以“未复现”直接代替“已修复”。

状态采用：**待开始 / 进行中 / 待验收 / 已完成 / 阻塞 / 暂缓**。阶段可以按依赖拆分推进；阶段 4 的功能须单独确定范围。以下验收要求是待执行计划，不是已有测试结果。

## 当前已完成基线

当前恢复节点：**1.0.3 已发布**，以 `8087ac8` 为依赖源码迁移前功能基线，tag 固定至实际构建提交 `417e78f`。三平台发行已完成，源码迁移在独立分支进行；状态、证据和下一步见 [1.0.3 发布记录](docs/releases/1.0.3.md)。本次发布不改变下列真机待验收项的状态。

2026-10-24：[依赖源码迁移](docs/maintenance/dependency-sources.md)实现与验证完成，交付 [PR #55](https://github.com/MonsterXia/scrcpy-harmony/pull/55)，开发版 1.0.4-dev.0。18 个本地包及共享源码可在本仓修改和编译；按用户长期二次适配要求补齐 Licia 原始源码、测试及本地生成链。最终源码五项 CI、干净安装、Windows 打包启动、源码修改后的开发验证均通过，独立复核无阻塞发现。应用 author/EXE CompanyName 为 MonsterXia，第三方署名保留。应用 457 项回归通过，Licia 两种模式各 606 项通过、同样 4 项外部夹具测试 pending；下一步按二次适配需求补回归及既有真机验收，本轮不发布迁移版。

- [x] 触控坐标映射修复已通过 [本仓库 PR #1](https://github.com/MonsterXia/scrcpy-harmony/pull/1) 合入；对应 [上游 PR #33](https://github.com/liriliri/echo/pull/33)。报告机型的剩余回归见阶段 2。
- [x] 项目导航、锁文件、Electron 45、Windows 构建及三个平台 CI 已通过本仓库 PR #2–#7 合入，详情见来源索引。
- [x] [PR #8](https://github.com/MonsterXia/scrcpy-harmony/pull/8) 完成 Scrcpy Harmony 更名、独立应用 ID、仓库链接和更新源配置。
- [x] PR #8 的 [CI 运行](https://github.com/MonsterXia/scrcpy-harmony/actions/runs/39611929271) 中，test、lint、Windows、macOS arm64/x64 打包安装启动检查全部通过。这不代表签名、公证、真机兼容性或线上更新已验收。
- [x] 2026-10-21 备份 PR、Issue、讨论、附件与 Git 历史后解除 fork。仓库仍为 `MonsterXia/scrcpy-harmony`，现有 8 个 PR 在解除后保留；原作者与 AGPL-3.0 许可证保留。

2026-10-24 文档同步：按当前源码更新中英文 README、构建指南、项目 skill 与维护参考，新增[仓库结构指南](docs/repository-guide.md)，明确原始源码、生成产物及 Licia 两种测试模式。文档相对链接和 npm 命令引用已核对，验证范围见[迁移记录](docs/maintenance/dependency-sources.md)；历史发行记录保留原版本布局。后续修改构建入口或依赖源码职责时同步这些入口，真机待验收状态不变。

## 阶段 0：维护入口与首次独立发布

目标：确保反馈入口可用，并建立可验证的独立发行流程。当前阶段状态：**已完成**。

| ID | 状态 | 工作项 | 验收条件 |
| --- | --- | --- | --- |
| M0-1 | 已完成 | 启用本仓库 Issues，核对 About、主页和反馈入口 | Issues 和新建反馈页面可访问；应用反馈菜单指向本仓库；GitHub About 的主页已改为本仓库 README。见 [验收记录](#m0-1-验收记录)。 |
| M0-2 | 已完成 | 准备首次独立 Release，确定新版本号 | 包元数据、锁文件、CHANGELOG 和 tag 一致；三个平台安装与启动检查通过；逐项说明签名、公证及真机验证状态；向用户说明旧 ECHO 配置不自动迁移。 |
| M0-3 | 已完成 | 验证实际更新检查与下载入口 | 使用两个明确版本的已打包应用和本仓库 Release，验证“有更新 / 无更新 / 网络或元数据错误”；Windows、macOS arm64、macOS x64 读取各自元数据并跳转本仓库 Releases。记录具体文件名和日志，不能只凭单测通过勾选。见 [实际验收记录](docs/maintenance/M0-3.md)。 |

操作入口：`package.json`、`script/pack.mjs`、`.github/workflows/build.yml`、`src/main/lib/updater.ts`、`src/renderer/main/App.tsx`。手动 Build workflow 只生成并上传 artifact，不创建 Release。更新功能当前提示用户打开 Releases 下载，不执行自动下载安装。

退出条件：反馈入口和首个独立发行版可用，线上更新检查有实际验证记录。发布前出现问题时保留诊断，修复后用新版本重新验收。

## 阶段 1：设备与应用数据读取健壮性

目标：单个异常设备或应用不会使整个列表消失。当前阶段状态：**进行中**。

| ID | 状态 | 来源与工作项 | 验收条件 |
| --- | --- | --- | --- |
| M1-1 | 已完成 | [Issue #21](https://github.com/liriliri/echo/issues/21)、[PR #30](https://github.com/liriliri/echo/pull/30)：设备枚举异常隔离及版本字段兼容 | 同时存在有效设备和读取失败设备时，有效设备仍显示；缺失/不同格式版本字段不使整个列表失败；空列表与全部失败可诊断；连接、断开、重连通过目标设备验证。见 [验收报告](docs/maintenance/M1-1.md)及 [PR #16](https://github.com/MonsterXia/scrcpy-harmony/pull/16)。 |
| M1-2 | 待验收 | [PR #31](https://github.com/liriliri/echo/pull/31)：逐应用处理 `bm dump` 失败 | 有效 JSON、错误文本、缺失主模块、命令失败混合输入时正常应用仍可见，结果与 bundleName 不错位；失败项有可定位日志；安装/卸载后的列表刷新正常。代码与只读验证见 [M1-2 报告](docs/maintenance/M1-2.md)；本轮仅补[并发刷新回归](docs/maintenance/M1-2-refresh.md)，缺专用 bilibili HAP，真实安装/卸载验收仍待办。 |
| M1-3 | 进行中 | [Issue #24](https://github.com/liriliri/echo/issues/24)、[PR #29](https://github.com/liriliri/echo/pull/29)：侧载应用名称与图标 | [PR #18](https://github.com/MonsterXia/scrcpy-harmony/pull/18) 仅使用 bilibili 验证名称与图标，见 [名称报告](docs/maintenance/M1-3.md)及[离线图标专项报告](docs/maintenance/M1-3-icons.md)。已补齐 Node/Chromium 双侧断网、两种视图、解码/哈希与刷新验证，但离线仍显示默认图标；HAP/资源索引读取被拒绝，无本地测试 HAP，不能标为完成。 |

代码入口：M1-1 为 `src/main/lib/hdc.ts` 的 `getTargets`；M1-2/3 为 `src/main/lib/hdc/bundle.ts` 的 `getBundleInfos`，UI 为 `src/renderer/main/components/application/`。

初始基线的 `getTargets` 使用整体 `Promise.all(...).catch(() => [])`；M1-1 的修订与验证见下方记录。M1-2 已将 `getBundleInfos` 改为逐应用命令和解析边界，安装/卸载验收仍待补。其代码已合并，M1-3 在该基线上独立推进名称读取，保留 M1-2 待验收状态；图标仍依赖线上信息。

退出条件：每项有真实代码路径的无设备回归测试、对应设备验收、通过的 CI 和合并 PR；若设备暂缺，停留在“待验收”。

## 阶段 2：投屏、长时间运行与连接回归

目标：补足实际设备和长时间运行证据。当前阶段状态：**进行中**。

| ID | 状态 | 来源与工作项 | 验收条件 |
| --- | --- | --- | --- |
| M2-1 | 待验收 | [#26](https://github.com/liriliri/echo/issues/26)、[#27](https://github.com/liriliri/echo/issues/27)：触控坐标修复后的机型回归 | 记录 Mate 80 / HarmonyOS 6.1.0.117 或实际替代版本，以及 1920×1080 横屏设备；验证四角、中心、拖动、缩放、旋转和断开重连。已有修复不等于这些机型已通过。 |
| M2-2 | 进行中 | [#22](https://github.com/liriliri/echo/issues/22)：长时间空闲后卡死 | 先记录可复现的等待时间、设备和访问过的面板；采集主进程/renderer 日志、CPU/内存变化；修复后运行至少原复现时长，并检查切换设备、关闭投屏后的监听/定时器释放。[适配器](docs/maintenance/M2-2-cancellable-transport.md)和[握手修复](docs/maintenance/M2-2-handshake-compat.md)后，概览内存/屏幕已有截止；[剩余元数据读取](docs/maintenance/M2-2-overview-deadlines.md)把 param/SP_daemon/uname 分别接入 10/15/10 秒预算，五条读取分别计时，没有统一概览截止。[完整 IPC 与恢复验收](docs/maintenance/M2-2-overview-live.md)已通过手机读取及 10 个合成故障场景；[枚举参数读取](docs/maintenance/M2-2-target-deadlines.md)接入逐设备 10 秒预算，host listTargets/初始化仍未限时，没有整个枚举统一截止。[物理断连及空闲记录](docs/maintenance/M2-2-physical-idle.md)保留三轮结果：第三轮自动恢复及 10 分钟空闲后读取通过，前两轮失败原因未定位。其他 base.shell/流式命令、原复现时长、负载和释放趋势仍待验收。 |
| M2-3 | 进行中 | [#12](https://github.com/liriliri/echo/issues/12)：特定应用投屏卡死或闪退 | 对比普通应用与抖音，记录应用/系统版本及捕获日志；区分捕获接口错误、客户端异常和受保护内容限制；错误时界面可恢复，正常投屏不回退。无设备生命周期复现、修复及边界见 [恢复报告](docs/maintenance/M2-3-recovery.md)；原应用问题与真机行为未验证。 |
| M2-4 | 进行中 | [#19](https://github.com/liriliri/echo/issues/19)：WebView 调试目标为空 | 精确 PID/socket 发现、并发隔离和 HTTP 失败边界见[发现专项](docs/maintenance/M2-4-webview-discovery.md)；renderer 卸载/隐藏后的迟到结果、失败恢复及选中目标更新已补[真实组件回归](docs/maintenance/M2-4-webview-lifecycle.md)。Pura 70 Pro / 5.1.0.150（API 17）及官方 Chrome 对照、空目标/断连恢复仍需真机验收。 |
| M2-5 | 进行中 | [#13](https://github.com/liriliri/echo/issues/13)：网络调试连接 | 明确系统版本、HDC 版本、配对与连接前提，比较命令行和应用设备列表；验证 USB/网络连接、断连重连及失败提示，记录不支持的系统范围。[基线证据与步骤](docs/maintenance/M2-5.md)、[刷新失败修复与 USB 故障注入记录](docs/maintenance/M2-5-refresh-failure.md)已归档；[端口弹窗读取生命周期](docs/maintenance/M2-5-port-mapping-lifecycle.md)已补隐藏读取、拒绝与迟到结果的真实组件回归。[物理 USB 三轮记录](docs/maintenance/M2-2-physical-idle.md)中断开清空均通过，第三轮概览自动恢复，前两轮失败仍待诊断；无线真机与授权失败仍待验收。 |

入口：`src/renderer/screencast/lib/ScreencastClient.ts`、`src/main/lib/hdc/uitest.ts`、`src/renderer/main/App.tsx`、`src/main/lib/hdc/webview.ts`、`src/main/lib/hdc.ts`。M2-4/5 应在 M1-1 后复验，避免把设备枚举失败误判为调试协议问题。

退出条件：每项具有复现和修复后证据，或明确的支持范围/无法复现记录与后续动作。CI 无设备启动检查不能替代本阶段。

最新补充：[重连分阶段诊断](docs/maintenance/M2-2-reconnect-diagnostics.md)在 `4f51498` 捕获到初次 ready 未就绪、约 1 秒后成功，自动恢复及 60 秒后读取通过。用户确认设备检测发生在 USB 弹窗选择“传输文件”之后，人工选择时间不计为概览命令阻塞；前两轮根因仍未确定，不能将一次未就绪或并行修复认定为原因。

## 阶段 3：显示适配与用户文档

目标：改善小屏显示并提供可照做的操作说明。当前阶段状态：**进行中**。

| ID | 状态 | 来源与工作项 | 验收条件 |
| --- | --- | --- | --- |
| M3-1 | 待验收 | [#28](https://github.com/liriliri/echo/issues/28)：小分辨率窗口和黑边 | 记录桌面分辨率、DPI、设备方向与窗口尺寸；检查最小窗口、工具栏、纵横比例和输入坐标；调整布局后重跑投屏坐标回归。 |
| M3-2 | 进行中 | [#32](https://github.com/liriliri/echo/issues/32)：中文字体锯齿 | 分开采集应用 UI 与设备投屏文字，记录系统缩放和显示器；确认问题发生于字体渲染还是捕获缩放，提供同条件前后截图。息屏诉求见 M4-4。 |
| M3-3 | 待验收 | [#14](https://github.com/liriliri/echo/issues/14)、[#20](https://github.com/liriliri/echo/issues/20)：用户与构建说明 | 已补[用户指南](docs/user-guide.md)和[构建指南](docs/build-guide.md)，区分 1.0.2 与 master、HiLog 保存与桌面诊断；Windows 干净构建及边界见 [M3-3 报告](docs/maintenance/M3-3.md)。[HiLog 在途记录后续](docs/maintenance/M3-3-hilog.md)补充暂停/关闭失效与查询失败恢复的无设备回归。[2026-10-23 发行版复核](docs/maintenance/M3-3-release-guide.md)确认 v1.0.2 与同步后 master `1f05c37` 的差异并更新指南。Electron 主进程必需；真机用户流程与 macOS 人工走读未验收，保留待验收。 |

入口：`src/main/window/screencast.ts`、`src/renderer/screencast/components/`、`src/renderer/main.tsx`、`README.md` 与开发指南。开发指南已经存在，但不能据此将普通用户操作文档标为完成。

退出条件：约定的分辨率/DPI 组合有验收记录，文档命令和截图与当期发行版一致。

## 阶段 4：新功能逐项评估

此阶段初始状态均为**待评估**，不因列入清单而自动承诺实现。每项先记录能力验证、权限、支持版本和最小范围，再安排独立实现与验收；无法支持时记录依据。

| ID | 来源 | 评估与验收方向 |
| --- | --- | --- |
| M4-1 | [#25](https://github.com/liriliri/echo/issues/25)：音频转发 | **暂缓（评估已记录，能力待验证）**：官方 AVScreenCapture 与 HarmonyOS API 26.0.0 新内录接口是候选，尚未建立普通调试授权下可分发的实际链路；权限/版本矩阵、架构缺口、同步/延迟/恢复范围及解除条件见 [能力评估](docs/maintenance/M4-1-audio.md)。未操作设备、未实现功能。 |
| M4-2 | [#23](https://github.com/liriliri/echo/issues/23)：电脑复制文本到设备 | 整体能力待验证、未验收；直接粘贴继续暂缓，固定坐标/单行入口不变。仅现有按钮等待、拒绝反馈、防重入及旧结果隔离已完成无设备回归、待最终审查，见[修复记录](docs/maintenance/M4-2-text-input-lifecycle.md)和[能力评估](docs/maintenance/M4-2-text-input.md)。 |
| M4-3 | [#15](https://github.com/liriliri/echo/issues/15)：文件下载 | **暂缓（评估已记录，路径权限与传输生命周期待验证）**：官方 file recv 与现有截图接收可作基础，日志路径仍受设备策略限制；文件选择、取消、同名保护、完整性与恢复缺口及解除条件见 [能力评估](docs/maintenance/M4-3-file-download.md)。未连接设备、未收取文件、未实现功能。 |
| M4-4 | [#32](https://github.com/liriliri/echo/issues/32)：连接后手机息屏 | 验证息屏后捕获与输入是否继续可用；区分熄屏、锁屏和黑屏效果，确定用户唤醒及断连恢复行为。 |
| M4-5 | [#16](https://github.com/liriliri/echo/issues/16)：与 AYA 合并、跨平台及多实例 | 先分别确定产品范围、平台和多设备需求；当前共享启动模块有单实例限制，不能将移除该限制视为完整多实例支持。 |

退出条件：每项有独立的“实施 / 暂缓 / 不支持”决定及依据；选择实施的项目另列验收条件和 PR，不与阶段 1 的缺陷修复混合。

## 历史事项与关闭复核

上游已关闭的 Issue #1–#11、#18 及 PR #17 保留在 [来源记录](docs/maintenance/SOURCES.md)，不自动加入当前缺陷队列，也不代表本项目已复测。出现相同症状时建立上述任务的新记录，并注明原条目。修复本仓库不等于关闭上游 Issue，不代替上游维护者修改其状态。

## 进度与交接记录

每次推进先更新阶段表中的状态，再在这里追加一条记录；证据优先链接到本仓库 PR、CI、可访问日志或仓库文件，避免只有个人电脑绝对路径。

### 2026-10-22 并行任务合入复核

以下为本轮最新交接；后文初轮测试数量和待审查说明保留为过程记录，当前集成结果以本节及各 PR 最终提交检查为准。

| 交付 | 独立审查与合入情况 | 剩余任务 |
| --- | --- | --- |
| [#19 用户与构建指南](https://github.com/MonsterXia/scrcpy-harmony/pull/19) | 独立复核与五项必需 CI 通过，已合并 | M3-3 待验收：真机用户流程与 macOS 人工走读；资源下载校验、HiLog 停止后的迟到日志属于后续生产改进。 |
| [#20 有限命令等待调查](https://github.com/MonsterXia/scrcpy-harmony/pull/20) | 独立复核与五项必需 CI 通过，已合并 | M2-2 进行中：先设计可取消 transport，再推进有限命令截止；生产超时及长期空闲真机验证未完成。 |
| [#21 应用并发刷新](https://github.com/MonsterXia/scrcpy-harmony/pull/21) | 独立复核与五项必需 CI 通过，已合并 | M1-2 待验收：缺可用于授权验证的 bilibili HAP，安装/卸载后的真机刷新未完成。 |
| [#22 投屏生命周期](https://github.com/MonsterXia/scrcpy-harmony/pull/22) | 独立复核与五项必需 CI 通过，已合并；补齐真实 UiDriver 异步 start/stop 等待及跨层回归 | M2-3 进行中：原报告场景、真实捕获异常与窗口关闭行为待验收。 |
| [#23 网络调试证据](https://github.com/MonsterXia/scrcpy-harmony/pull/23) | 独立复核与五项必需 CI 通过，已合并 | 两项失败 TODO 由 #26/#27 修复并转为正式断言；无线连接验收仍待办。 |
| [#24 音频评估](https://github.com/MonsterXia/scrcpy-harmony/pull/24) | 独立复核与五项必需 CI 通过，已合并 | M4-1 暂缓：产品范围、部署授权、SDK/设备能力与普通签名可分发性待确定。 |
| [#25 窗口与显示](https://github.com/MonsterXia/scrcpy-harmony/pull/25) | 独立复核与五项必需 CI 通过，已合并；104 个合成显示样本复核通过 | M3-1 待验收、M3-2 进行中：实际 DPI、多显示器、标题栏与设备字体仍需实测。 |
| [#26 刷新失败提示](https://github.com/MonsterXia/scrcpy-harmony/pull/26) | 独立复核与五项必需 CI 通过，已合并 | M2-5 进行中：受控 USB 故障注入不代替物理断连、无线连接或授权失败验收。 |
| [#27 参数错误识别](https://github.com/MonsterXia/scrcpy-harmony/pull/27) | 本次集成交付；按最终提交独立复核并通过五项必需 CI 后合并，状态见 PR 页面 | 与 #26 组合时保留部分成功、正常空列表和失败清理语义；概览共用读取器。 |

- 本地完整组合回归 **140/140 通过、0 TODO**，lint 通过。网络回归实际经过 hdckit、共享参数读取器及处理器，保留实际参数命令请求断言；没有用替身绕过新增读取器。参数修复及设备证据见 [专项报告](docs/maintenance/M2-5-parameter-errors.md)。
- 审查还修复了 TCP 测试夹具清理时的迟到连接竞态；持久回归、旧实现反向验证及初始化故障注入均已复核。显示验证补齐水平方向可见性断言。上述修订均在最终 CI 范围内。
- #27 合并前追加修复：概览读取明确失败时清空旧概览，避免加载结束后重新显示旧数据；真实 React 回归覆盖成功、失败清空、错误通知及再次恢复，先失败后通过。此修订必须重新通过最终 CI。
- M2-5 审查发现的既有 P2：`Store.refreshTargets()` 缺少刷新顺序保护。独立审查在 #27 前主干 `b1659ac` 与 #27 代码均复现“新请求清空后旧成功重新填回设备”和“新请求恢复后旧失败清空设备”；当轮未修复。后续请求序号修复与持久回归见下方推进记录。
- M1-3 仍进行中：bilibili 离线图标仍是默认图标，资源不可读且无本地 HAP。后续应用验证仅使用 bilibili，不记录内部应用信息。本轮整合未新增设备操作，也未发布新版本。
- 下一步优先补 M1-3 的授权资源读取路径；可并行推进 M2-2 可取消 transport 设计和剩余设备/显示验收。M2-4 及 M4 的其他条目维持原状态，不因本轮合并自动完成。

### 2026-10-22 无设备任务继续推进

- 用户指定优先修复设备刷新竞争。基线 `9f8ddcb`，分支 `codex/target-refresh-order`；按最后发起请求的序号阻止旧结果写入状态/选择/持久化，并抑制过期手动刷新通知。7 项真实 Store/工具栏回归先全部失败、修复后全部通过；完整测试 147/147、lint 通过，详见[专项报告](docs/maintenance/M2-5-refresh-order.md)。最终独立审查和五项 CI 通过后合并；M2-5 的真机验收仍未完成。
- 回收状态：[设备刷新 PR #28](https://github.com/MonsterXia/scrcpy-harmony/pull/28) 与 [HiLog PR #29](https://github.com/MonsterXia/scrcpy-harmony/pull/29) 均经独立审查、五项必需 CI 通过后合并，最新整合基线 `5dcc7bd`。HiLog 代次隔离修复暂停/关闭后的迟到记录，见[专项报告](docs/maintenance/M3-3-hilog.md)。
- M2-2 [有限命令可取消模块基础](docs/maintenance/M2-2-cancellable-transport.md)已由 PR #30 合并；[PR #32 概览内存查询接入](https://github.com/MonsterXia/scrcpy-harmony/pull/32)端口修订后专项 23/23，合入 master `bd3e3c9` 后组合全量 221/221、lint 和 build:main 通过。[独立审查](https://github.com/MonsterXia/scrcpy-harmony/pull/32#pullrequestreview-5615722771)已确认端口问题修复；最终组合审查、SHA 和合并状态见 PR 页面，[五项 CI](https://github.com/MonsterXia/scrcpy-harmony/pull/32/checks)按最终提交核验。仅在最终提交独立审查无阻断且五项 CI 通过后合并。base.shell 未全局迁移，M2-2 仍进行中，不以此替代真机或长期空闲验收。
- M2-4 [WebView PR #31](https://github.com/MonsterXia/scrcpy-harmony/pull/31) 经[独立审查](https://github.com/MonsterXia/scrcpy-harmony/pull/31#pullrequestreview-5615622602)及[五项必需 CI](https://github.com/MonsterXia/scrcpy-harmony/actions/runs/39793778948)全部成功后合并为 `bd3e3c914905e440c1b4f6897013873eb918cba9`。完整保留其精确 PID 匹配、请求隔离和 HTTP 总截止；M2-4 仍进行中，原机型、真实 socket/端口转发和实际调试页面仍待验收，见[专项报告](docs/maintenance/M2-4-webview-discovery.md)。
- 本轮不操作真机、不安装应用；侧载验证仍仅限 bilibili，离线图标及 HAP 缺失保持原有边界。

```text
日期 / 负责人：
任务 ID / 当前状态：
基线提交 / 工作分支：
设备、系统、HDC、桌面平台及版本：
复现步骤 / 预期 / 实际：
根因或评估结论：
改动与 PR：
验证命令、结果、CI 和设备证据：
未验证内容 / 阻塞条件：
下一步 / 验收人：
```

| 日期 | 任务 | 结果与证据 | 下一步 |
| --- | --- | --- | --- |
| 2026-10-21 | 维护基线 | PR #1–#8 已合并；PR #8 五项 CI 通过；fork 已解除；来源归档已核验 | 从 M0-1 或 M1-1 开始，更新此文件记录执行结果 |
| 2026-10-21 | M0-1：已完成 | Issues 已启用，About/主页已修正，Windows 应用反馈与关于窗口已核验；见下方记录 | M0-2：确定版本号并准备首次独立 Release |
| 2026-10-22 | M0-2 前置验证修复 | Codex 在基线 `5a1660a`、分支 `codex/macos-build-test-realpath` 上复现 macOS 临时目录路径别名导致构建测试误报：Node 22.22.3 / npm 10.9.8，`npm test` 为 12 通过、1 失败。测试 fixture 统一为真实路径；不改构建脚本和应用行为。修复后本地 13 项测试及 lint 通过；[PR #11](https://github.com/MonsterXia/scrcpy-harmony/pull/11) 的 [五项 CI](https://github.com/MonsterXia/scrcpy-harmony/actions/runs/39716524966) 全部通过，已合入 `b81c656` | 前置测试问题已完成；继续 1.0.2 发布准备。安装、真机及线上更新不由本地单测覆盖 |

### M0-1 验收记录

- 日期 / 执行者：2026-10-21 / Codex（按 MonsterXia 指令）。基线为 PR #9 合并提交 `be4b7d08f03c2e473f0949ab3222c578315e2b53`，工作分支为 `codex/m0-1-maintenance-entry`。
- 根因：应用反馈 URL 和包元数据已在 PR #8 切换到本仓库，但 GitHub Issues 仍关闭，About 的 Website 仍为上游站点。
- GitHub 设置已实际保存：[仓库 API](https://api.github.com/repos/MonsterXia/scrcpy-harmony) 核验 `has_issues: true`；About 描述为“Scrcpy Harmony：独立维护的鸿蒙 HDC 桌面工具，支持投屏、设备与应用管理。”；Website 为 `https://github.com/MonsterXia/scrcpy-harmony#readme`，与 `package.json` 的 homepage 一致。
- 浏览器验收：[Issues](https://github.com/MonsterXia/scrcpy-harmony/issues) 正常显示，新建反馈入口可访问。未为验证创建测试 Issue。
- 应用验收：Windows x64 本地打包的 Scrcpy Harmony 1.0.1（PR #8 应用代码，PR #9 仅改文档），使用隔离临时配置，通过 Playwright Electron 调用实际菜单回调。在 `shell.openExternal` 边界捕获到 `https://github.com/MonsterXia/scrcpy-harmony/issues`，并单独在浏览器验证目标可访问。“关于”窗口显示 `Scrcpy Harmony / Version 1.0.1`，无外链。临时配置已清理。
- 仓库改动：README 增加主页、反馈链接及反馈所需信息；来源记录保留历史快照并标明当前状态。本项无需修改已正确的应用 URL，也不涉及设备调用或共享子模块。
- 验证边界：菜单验证未调用操作系统默认浏览器；macOS 未在本次重新运行。此项不代表首次 Release、线上更新或设备功能已验收，M0-2、M0-3 仍待开始。

### M0-2 发布准备记录

- 日期 / 执行者：2026-10-22 / Codex（按 MonsterXia 指令）。基线 `5a1660ab585f6689e4de62eec4314b0768edf021`，工作分支 `codex/m0-2-first-release`。
- 开始时现场核验：本地与远端 master 一致、工作区干净；本仓库无 Release、无开放 PR，远端不存在 `v1.0.2`。本地 macOS 27.0 arm64、Node 22.22.3、npm 10.9.8；依赖、共享代码子模块和设备资源尚未准备。随后按锁文件安装、初始化固定子模块并下载构建资源。
- 版本选择：首次独立发行使用 `1.0.2`，接续继承的 `1.0.1`；同步 package.json、package-lock.json 和 CHANGELOG，计划 tag 为 `v1.0.2`。尚未创建 tag，不能将计划版本一致视为实际 tag 已验收。
- 发布材料：[1.0.2 发布清单与说明](docs/releases/1.0.2.md) 包含三个平台产物、更新元数据、旧 ECHO 配置边界及签名/公证/真机状态。保持现有手动 Build 只上传 artifact、不自动发布的行为。
- 改动与证据：[PR #12](https://github.com/MonsterXia/scrcpy-harmony/pull/12) 准备首次独立版本；版本一致性检查、lint、完整 build 通过，提交 `9a0b681` 的 [五项 CI](https://github.com/MonsterXia/scrcpy-harmony/actions/runs/39716730594) 全部通过（含三个平台安装与启动）。默认 macOS 临时目录下的测试误报由独立 PR #11 修复并合入 `b81c656`，本分支已同步；直接 npm test 为 13/13 通过，无需 TMPDIR 规避。本次边界及最终提交的 CI 入口见发布清单。
- 未验证 / 下一步：等待本次 PR 的全部必需 CI，通过后将合入提交作为候选发布源，运行 Build 并验收实际待上传产物，核对元数据及校验值后创建同源 tag 和 Release。签名、公证及真机状态逐项如实披露；M0-3 另行使用两个明确版本验证线上更新。M0-2 保持进行中，不提前标记完成。

### M0-2 实际发行产物验证推进

- 日期 / 执行者：2026-10-22 / Codex。基线 `e04942cc6d3cf776dfdd52891fc88e8997c83a61`，分支 `codex/m0-2-verified-release-artifacts`，M0-2 保持进行中。
- 核验：本仓库仍无 Release、无手动 Build 运行，远端不存在 `v1.0.2`。旧 Build 直接上传包，无法证明实际发行 artifact 已安装启动；PR CI 验证的是另一批构建。
- 改动：Build 对齐 CI 的三个 runner/架构，复用现有 Windows/macOS 安装启动脚本，通过后才上传本批安装包；同时上传源提交、安装包 SHA-256 与签名报告。macOS Gatekeeper、公证票据校验退出码如实保留；未签名不被记为通过。
- 首次实际验证：[Build 39723428883](https://github.com/MonsterXia/scrcpy-harmony/actions/runs/39723428883) 的 macOS 打包因空 `CSC_LINK` 被当作证书路径而未生成 DMG，新增安装检查正确失败、阻止上传。打包前移除未配置的空签名环境变量，非空配置保留；重新运行验证，不将首次失败当作通过。
- 验证与下一步：通过独立 PR 和必需 CI 后，从合入提交执行 Build；下载本次已验收产物核对版本、YAML、哈希和签名报告，再准备同源 tag 与 Release。实际 Build 结果和公开发布状态后续补入 [1.0.2 发布记录](docs/releases/1.0.2.md)。不把 workflow 配置完成视为发行产物已经验收。

### M0-2 首次发行验收记录

- 日期 / 执行者：2026-10-22 / Codex。基线 `51cc610a17e5c4d977da282c87496b5d4366eb75`；证据归档分支 `codex/m0-2-release-evidence`。M0-2 **已完成**，阶段 0 仍进行中，M0-3 尚待实际应用验收。
- 流程修复：[PR #13](https://github.com/MonsterXia/scrcpy-harmony/pull/13) 已合入；最终源提交 `1c545a7702547d8c53e31bcbfe7d76febc326cba` 的 [五项必需 CI](https://github.com/MonsterXia/scrcpy-harmony/actions/runs/39723562359) 与 [实际发行 Build](https://github.com/MonsterXia/scrcpy-harmony/actions/runs/39723571596) 全部通过。Build 在 Windows x64、macOS arm64 / x64 托管 runner 上安装并启动了随后上传的同一批安装包。
- 版本与发布：[Scrcpy Harmony 1.0.2](https://github.com/MonsterXia/scrcpy-harmony/releases/tag/v1.0.2) 于 2026-10-22 12:47（UTC+8）公开发布；实际 `v1.0.2` tag 解析为上述构建源提交，该提交已位于 master 历史中。package.json、锁文件两处根版本、CHANGELOG 版本章节一致。源码 tag 保留当时的准备记录，本节为发布后证据更新。
- 产物核验：三个 Actions artifact ZIP 的 SHA-256 与 GitHub digest 一致；三个 YAML 的版本、文件名、size、SHA-512 与安装包一致。按 YAML 指定名称将安装包和 blockmap 的空格改为连字符，未修改文件字节。Release 共 14 个文件，远端文件名、size、SHA-256 digest 全部与本地验收文件一致；公开下载检查见发布记录。
- 签名状态：Windows Authenticode `NotSigned`；macOS arm64 只有 linker ad-hoc 签名，严格签名校验及 Gatekeeper 均失败；macOS x64 未签名，Gatekeeper 拒绝。两种 macOS 均无 stapled 公证票据。已在 Release、README、CHANGELOG 与发布记录明确说明，未把安装启动成功当作系统信任通过。
- 配置边界：Release 明确旧 ECHO 配置保留原处、不自动迁移，Scrcpy Harmony 使用新的用户配置目录。
- 未验证 / 下一步：鸿蒙真机、长时间运行和用户从互联网下载后的系统信任体验未验收；M0-3 需要两个明确版本的已打包应用验证有更新、无更新、网络/元数据错误及 Releases 跳转。公开 YAML 可下载和哈希一致不能替代应用内更新验收。下一项为 M0-3。

### M0-3 实际更新检查推进

- 日期 / 执行者：2026-10-22 / Codex。基线 `b0bd16a9b05d10575065d4e3bf50f5336751c593`，分支 `codex/m0-3-packaged-update-check`。
- 方案：固定源码 `b81c6563e7502819142d651aad15a6b4d45f33bf` 的 Scrcpy Harmony 1.0.1 打包应用与公开 Release v1.0.2 原始安装包对照；原生 Windows x64、macOS arm64/x64 验证菜单、真实网络请求、IPC 提示和 Releases 外链。
- 错误场景在应用的更新网络会话中取消请求，不修改远端 Release、应用版本或更新结果；恢复网络后再次检查。现场结果待补，暂不标记完成。

### M0-3 验收记录

- 日期 / 执行者：2026-10-22 / Codex。基线 `b0bd16a`，分支 `codex/m0-3-packaged-update-check`；[PR #15](https://github.com/MonsterXia/scrcpy-harmony/pull/15)。M0-3 **已完成**，阶段 0 三项验收均完成。
- 版本：固定提交 `b81c656` 原样打包的 Scrcpy Harmony 1.0.1，与公开 v1.0.2 的三个原始安装包。每版实际 app.isPackaged、版本、原生架构和安装包 SHA-256 均已核验，未修改应用版本或替换更新器。
- 结果：验收提交 `2359c96` 的 [三平台实际运行](https://github.com/MonsterXia/scrcpy-harmony/actions/runs/39746252306) 全通过。Windows x64、macOS arm64/x64 各自读取正确的 YAML；1.0.1 检出 1.0.2 并经实际确认按钮调用系统 Releases 外链，1.0.2 提示无更新；两版均通过受控断网提示及恢复检查，共 18 个场景。
- 验证：同提交 [五项必需 CI](https://github.com/MonsterXia/scrcpy-harmony/actions/runs/39746252396) 全通过；本地 13 项单测、lint 和脚本语法检查通过。首轮 macOS x64 在卸载第二个 DMG 时失败，修订验收安装脚本后完整重跑；失败记录未被记为通过。
- 证据：[M0-3 报告](docs/maintenance/M0-3.md) 记录具体文件名、完整哈希、runner 环境、网络重定向、六份运行 JSON/应用日志及截图；原始 artifact ZIP digest 已复核。PR 最终提交检查结果见 PR 页面。
- 边界 / 下一步：系统外链调用成功，未检查默认浏览器页面内容；错误验收选择网络失败，未另测损坏 YAML。更新仍是提示用户手动下载；未扩大签名、公证、真机或长时间运行结论。下一项为 M1-1，按规则先核对上游报告和当前设备枚举路径。

### M1-1 推进记录

- 日期 / 执行者：2026-10-22 / Codex。基线 `e79de6e98c6cb81e9c1dba59578b63013ce34852`，分支 `codex/m1-1-target-isolation`。
- 来源核对：上游 Issue #21 与 PR #30 均仍开放，正文/讨论已读取（无评论）；PR 候选提交 `f8084bbb65eb63a0d759187882de155005936e36`。采用逐设备隔离方向，另补诊断和本仓库现有测试链，不直接合入上游测试脚本。
- 现场：macOS arm64，内置 HDC 3.1.0b；可枚举 nova 15 / PSN-AL00，软件版本 `PSN-AL00 7.0.0.109(SP6C00E105R3P3)`、API 26。设备标识不写入公开报告。
- 待执行：真实 getTargets 处理器失败回归 → 最小修复 → 单测/lint/build → Electron 与真机连接变化验证 → 五项必需 CI 和独立 PR。未验证前不标完成。

- 2026-10-22 初轮验证：新增 19 项真实 getTargets 处理器回归，修复前 16 失败、3 通过，确认异常设备会清空列表且 `OpenHarmony 4.1.0` 被截为 `4.1.`。逐设备隔离、字段防御解析与诊断加入后，完整 32 项测试、lint 和 build 通过。
- 真机已验证：本地 dist 在 Electron 45 启动，nova 15 的真实 HDC 参数、getTargets IPC、renderer 列表和当前选择一致，显示 `7.0.0.109 / API 26`；无页面异常并正常退出。USB 断开/重连仍待用户协助，不能用单测中的模拟状态替代该项。

### M1-1 验收记录

- 日期 / 执行者：2026-10-22 / Codex，用户协助 USB 拔插。基线 `e79de6e`，分支 `codex/m1-1-target-isolation`；[PR #16](https://github.com/MonsterXia/scrcpy-harmony/pull/16)。M1-1 验收已完成，本次归档提交须通过全部必需检查后合并；最终合并与检查状态见 PR 页面。
- 修订：真实 getTargets 处理器逐设备隔离失败，保留正常设备和顺序；兼容带/不带前缀及括号的点分版本，缺失/异常版本返回空字符串并记警告；空列表、枚举失败、逐设备失败和全部失败具有不同诊断。未改 IPC 契约或共享子模块。
- 回归：新增 19 项在原实现为 16 失败、3 通过，修复后全部通过；完整 32 项测试、lint、build 通过。应用代码提交 `3e7820b` 的 [五项 CI](https://github.com/MonsterXia/scrcpy-harmony/actions/runs/39750249252) 全部通过，最终归档提交检查见 PR。
- 真机：macOS arm64 / Electron 45 / HDC 3.1.0b / nova 15（PSN-AL00，7.0.0.109，API 26）。实际 USB 断开后 getTargets IPC、renderer 列表和选择清空，选择器禁用；重连自动恢复设备和选择，真实 changeTarget 计数递增，页面无异常，进程正常退出。见 [完整报告及证据](docs/maintenance/M1-1.md)。
- 验收脚本的异步等待与 Luna 禁用状态断言曾误判，已修正并保留失败记录；最终三阶段在同一应用运行中通过。设备标识已脱敏。
- 边界 / 下一步：真实异常设备混合、缺失和损坏字段由受控 HDC 回归覆盖；未宣称多台异常真机、Windows 真机或长期稳定性已验证。本次为未发布源码构建，公开 v1.0.2 未变。下一项 M1-2，先复现逐应用 bm dump 失败与结果错位问题，再做最小修复。

### M1-2 推进记录

- 2026-10-22 / Codex；基线 `b5759677bddcb812d9720bc452ead891c3dc0959`，分支 `codex/m1-2-bundle-isolation`。上游 PR #31 仍开放，候选提交 `9b7451d708257de1405033b9d9be0ef52d913ce5`，无评论或 review。
- 当前问题：整批 shell 和集中 JSON.parse 使单条失败阻断其他应用；批量输出分隔符也可能出现在合法字段中。采用逐应用命令与解析边界，结果始终绑定原包名；缺失主模块保留可展示数据并诊断。
- 先建立 19 项真实 bundle.ts + base.ts 路径的回归，旧实现 16 失败、3 通过；正在修复与验证。现场真机型号以最终运行报告为准；用户确认无现成测试 HAP，安装/卸载刷新验收保留待办。

- 最终验证：新增 21 项回归在固定旧实现为 18 失败、3 通过，修复后 21/21；完整 53 项测试、lint、完整 build 和最终主进程构建通过。
- 真机只读验收：实际 HUAWEI Mate 80 / VYG-AL30 / 7.0.0.109 / API 26、macOS arm64、Electron 45、HDC 3.1.0b。两个系统包与不存在包混合查询保留正确结果，后续查询恢复；应用面板加载与刷新均为 229 个应用，无页面异常、正常退出。见 [M1-2 报告](docs/maintenance/M1-2.md)及脱敏证据。
- 状态 / 下一步：M1-2 **待验收**；缺专用测试 HAP，尚未执行真实安装/卸载后的自动刷新。取得可移除测试包后按报告补测，再标记完成；本次只读刷新与模拟状态变化不能代替该项。公开 v1.0.2 未修改。

- 独立修复与证据归档：[PR #17](https://github.com/MonsterXia/scrcpy-harmony/pull/17)，最终提交的五项必需 CI 与合并状态见 PR 检查页。合并代码后仍保持 M1-2 待验收。

### M1-2 并发刷新补充

- 2026-10-22 / Codex；基线 `9e944ae27ad7cc4c656467257e3e84d8067dc2f8`，独立分支 `codex/m1-2-app-refresh`，[PR #21](https://github.com/MonsterXia/scrcpy-harmony/pull/21)。只修改应用面板刷新控制；不修改 HDC 命令层、不操作真机。
- 真实 React / MobX / Application / installBundles 路径的首批 12 项无设备回归：旧实现 11 失败、1 通过；独立审查后补充至 15/15，通过同步引用合并在途刷新请求、抑制重叠查询与失效结果，失败后恢复手动刷新。完整测试 81/81、lint 和完整 build 通过。独立审查、PR、CI 结果见[专项记录](docs/maintenance/M1-2-refresh.md)。
- M1-2 保持**待验收**。本轮仅补并发回归，不代表真实安装/卸载通过；仍缺可用于授权验证的专用 bilibili HAP。下一步由维护者审查 PR 并确认必需 CI，再准备测试 HAP 补真实操作与刷新验收；不自行合并或发布。

### M1-3 名称读取推进

- 2026-10-22 / Codex；从远端 master `009b3fb` 创建 `codex/m1-3-local-app-metadata`，上游 Issue #24 与 PR #29 正文、patch、讨论已读取。当前候选仅有模拟数据，不能直接证明资源可读。
- 按用户要求，本轮应用验证与归档仅使用 bilibili（`yylx.danmaku.bili`）。其 `label/iconPath` 为 `$string:app_name` / `$media:app_icon`，HAP 路径返回 Permission denied；`bm dump -n … -l` 实际返回“哔哩哔哩”。
- 最小修复：优先设备明文名称，资源引用通过设备支持的 `bm dump -l` 解析；旧系统、不合法输出和命令失败保留商店/包名回退。图标策略不变；列表按文本显示名称，避免 HTML 被解释。
- 验证：12 项新增回归在旧实现全部失败，修复后完整 66 项测试、lint、build 通过。Windows x64 / Electron 45 / HDC 3.1.0e / PSN-AL00 / 7.0.0.109 API 26，bilibili 在线与受控离线的真实 IPC、列表和刷新通过，页面无异常，正常退出。详见 [报告与证据](docs/maintenance/M1-3.md)。
- 独立提交与 CI：[PR #18](https://github.com/MonsterXia/scrcpy-harmony/pull/18)；应用代码 `b62b9a5` 的独立检出已重复完成上述本地与真机验证，最终五项必需 CI 见 [检查页](https://github.com/MonsterXia/scrcpy-harmony/pull/18/checks)。
- 边界 / 下一步：M1-3 保持进行中；线上商店本来就能识别本次样本，新增改善为离线设备名称。离线图标仍回退默认图标；设备返回发行属性 `app_gallery / release`，不能将本次样本当成 debug 签名侧载样本。继续研究无需提权的图标资源读取，另补非商店样本与旧系统真机验证；M1-2 仍需专用测试 HAP。
- 审查后续：共享 shell 的 `readAll` 无期限等待（包含新增名称命令）纳入 M2-2；安装完成但已有刷新未结束时，原 `refresh()` 会忽略新请求，纳入 M1-2 的并发安装/刷新回归。两项均未在本轮修复，不宣称覆盖。能力探测本批失败后回退、下批重试为刻意策略；搜索排除非匹配应用和在线图标仍被补全的断言已加强。

### M1-3 离线图标验证推进

- 2026-10-22 / Codex；同一分支继续推进，应用基线 `cccf486`。仅 bilibili；全新进程/配置的联网与受控离线对照、列表和图标视图、真实图片解码/哈希及刷新均已完成，见[专项报告](docs/maintenance/M1-3-icons.md)。
- Node HTTP(S) 与 Chromium 均经不转发流量的拒绝代理，分别确认探针失败和代理收到请求；离线图片哈希与默认资源一致。`verificationPassed=true` 仅代表验证完成，`offlineIconAcceptancePassed=false` 明确表示离线应用图标未通过。
- 实际 HDC 文件接收确认 HAP 与 resources.index 均无读取权限；设备帮助没有图标导出选项。用户确认没有本地 bilibili HAP。生产图标逻辑未改，M1-3 保持进行中；下一步需可读的该应用资源，或先验证有授权的设备图标接口。M1-2 保持待验收。
- 本地独立检出的 build、66 项测试、lint 通过；归档仅含指定应用字段和四张裁剪图，不保存设备 key、完整应用列表或原始运行日志。最终增量 CI 见 [PR #18 检查页](https://github.com/MonsterXia/scrcpy-harmony/pull/18/checks)。

### M3-1 / M3-2 合并显示工作线

- 2026-10-22 / Codex；基线 `9e944ae`，独立分支 `codex/m3-display`。来源 #28/#32 正文及评论已读取。M3-1 待验收、M3-2 进行中；见 [显示专项报告](docs/maintenance/M3-display.md)。
- 复现固定 500×640 最小窗口高于小工作区；限制创建/恢复后的边界，并允许 320×320，窄窗口使用两行工具栏。合成 Electron 最终 104 样本通过；窗口单测先失败后通过，完整 69 项测试及 lint、main/renderer 构建通过。原坐标测试和投屏客户端未修改。
- UI 字体与 JPEG 缩放链已区分，保留同条件前后截图，未开启未经证实的抗锯齿开关。没有真机、物理分辨率/DPI 修改或 HDC 操作。真实显示器、标题栏、原机型画面仍待验收；不把合成测试记作字体问题修复。见 [PR #25](https://github.com/MonsterXia/scrcpy-harmony/pull/25) 及[必需 CI 检查页](https://github.com/MonsterXia/scrcpy-harmony/pull/25/checks)；不自动合并或发布。
- 统一终审补验：fetch/merge 最新 master 仍为 `9e944ae`。增加 Canvas 左右边界（1px 容差），左右平移注入的 104 样本全部被拒绝；正常矩阵通过。280×400/100% 实测现有工具栏纵向 overflow 为 auto，滚轮至 scrollTop=28 后第三行缩放控件完整可达，10 控件逐个命中检查通过；因此未额外修改生产样式。跨显示器动态约束仍待验收，详见专项报告及更新后的脚本/证据哈希。
- 随后同步已推进的 master `92a0725`（合并提交 `e3fcac7`），保留并行任务全部状态与交接。按新锁文件安装后，完整 84 项测试、lint、main/renderer 构建、104 样本显示矩阵重新通过；最终显示证据更新为合并版本。
- #22 集成复验：按协调顺序固定同步 master `78f6057`（合并提交 `2ca4a0b`），完整保留 M2-3/M2-2 交接和架构记录。原显示脚本/fixture 无需修改，新客户端 104 样本全部通过；完整测试 117/117、lint、main/renderer 构建通过。最终显示归档替换为本次真实结果，客户端源码哈希更新；不以合成 transport 代表真实 IPC 或真机通过，未操作设备，不自行合并。

### M2-5 网络调试证据与验证准备

- 2026-10-22 / Codex；基线 `9e944ae27ad7cc4c656467257e3e84d8067dc2f8`；分支 `codex/m2-5-network-evidence`。M2-5 保持**进行中，真机待验收**。
- 已读取上游 #13、当前华为/OpenHarmony 官方文档和锁定 hdckit 0.12.1；具体来源、版本边界、应用链路和验收步骤见 [独立报告](docs/maintenance/M2-5.md)。
- 独立回环 fixture 使用实际 hdckit、getTargets、store 与工具栏代码：专项 3 通过、2 个执行失败的 TODO；全量 69 通过、2 TODO，lint 通过。严格模式复现两项失败：枚举失败仍提示成功、参数错误文本被视为空参数。生产代码未修改，修复方案留待协调独立任务。
- 无 HDC 可执行文件/真机操作；USB、网络授权/连接、自动恢复和投屏均未验收。[PR #23](https://github.com/MonsterXia/scrcpy-harmony/pull/23) 已进入合并审查；补充本次参数查询断言、初始化和晚到连接清理回归后，专项为 4 通过、2 TODO。[必需 CI](https://github.com/MonsterXia/scrcpy-harmony/pull/23/checks) 按最终提交核验；两项生产缺陷由独立 PR #26/#27 修复后再将对应 TODO 转为普通断言。

### M2-3 无设备恢复子任务

- 日期 / 执行者：2026-10-22 / Codex。基线 `9e944ae27ad7cc4c656467257e3e84d8067dc2f8`，分支 `codex/m2-3-recovery`，独立检出；M2-3 保持进行中。
- 读取上游 #12 正文/评论（均空）后核对源码；通过真实客户端事件路径复现销毁后重试、迟到启动/绘制、拒绝未处理和 URL 泄漏。范围及后续依赖见 [专项报告](docs/maintenance/M2-3-recovery.md)。
- 初始生命周期回归 10 失败/1 通过；修订及独立审查补充后 17 项生命周期、8 项坐标回归通过，全套 83/83、lint、renderer 构建通过。额外 TypeScript 检查与基线同为 28 条诊断，无新增；不得记为类型检查通过。
- 独立复审未发现新的范围内阻断问题。[PR #22](https://github.com/MonsterXia/scrcpy-harmony/pull/22) 保留待审查，五项必需 CI 的最终提交结果见 [检查页](https://github.com/MonsterXia/scrcpy-harmony/pull/22/checks)及 PR 验证说明。未连接真机、未操作应用，未验证原报告特定应用或受保护内容，不修改 M2-2 的 HDC 等待实现。
- 下一步：核对 PR 最终提交的必需 CI 后人工审查；后续按报告补真机捕获层/客户端层区分及窗口关闭验证，不能将本次受控测试作为 M2-3 整体验收。
- 合并前复审增量：确认 `uitest.ts` 未等待 hdckit 0.12.1 的异步 start/stop，原 bridge 替身没有覆盖此契约。获准后仅补两处 await；新增七项穿过真实 handler/UiDriver 方法的回归先全部失败、修复后通过，详见专项报告补充。此次增量等待重新 CI 和安排的独立复审；M2-3 仍进行中，未操作真机。

### M2-2 有限命令等待调查

- 2026-10-22 / Codex，基线 9e944ae，分支 codex/m2-command-timeout；独立 worktree。已核对 Issue #22 与锁定 hdckit 0.12.1，建立真实 base.ts → hdckit → 本地受控 TCP 的缺口用例。
- 结论：握手/ready 阶段缺少请求取消与连接所有权接口，外层 Promise.race 或 Connection.end 无法可靠清理；本轮 [PR #20](https://github.com/MonsterXia/scrcpy-harmony/pull/20) 提交测试与接口方案，生产代码不变；本地 74 项测试、lint、build:main 通过，独立审查问题已修正并复核，必需 CI 见 PR 检查页。详见[证据及交接](docs/maintenance/M2-2-command-timeout.md)。
- 下一步：独立评审可取消 transport 方案，再推进有限命令截止；长期空闲复现、CPU/内存、原复现时长与真机监听释放仍未验证，M2-2 保持进行中。
- 审查补充：已合入 master `ea53acc` 并保留 M4-1 交接；确定性复现 fixture 清理快照后的迟到 accept 会阻塞 server.close，先停监听并销毁迟到 peer，新增回归由失败转通过。初始化故障注入与独立复核通过；完整测试更新为 75/75，lint 通过，最终 CI 见 PR #20 检查页。只改测试清理，生产超时与真机验收仍未完成。

### M2-2 可取消适配器交接

- 2026-10-22 / Codex；分支 `codex/m2-cancellable-transport`，起点 `9f8ddcb`，已同步 master `5dcc7bd` 并保留 #28/#29 交接。新增独占 socket 的有限 shell 模块，显式总截止/AbortSignal，取消销毁并等待本地 close，不管理共享 HDC 服务。
- 旧 base.ts + hdckit 静默握手的截止断言确认失败；新模块专项 27/27、组合全量 185/185、lint、单模块 strict TypeScript 与 build:main 通过。独立审查无生产阻断，修正测试写入注入与握手阶段屏障并补确定性拆包。完整合约、验证命令和差异见[专项报告](docs/maintenance/M2-2-cancellable-transport.md)。
- 未接 base.shell/IPC，没有生产调用者；hello 恰为 16 字节、目标 32 字节及 16 MiB 限额等兼容性仍待真机验证。下一步选择有限只读调用接入并验证服务启动交接，再逐步扩展；M2-2 保持进行中，不宣称上游空闲卡死已修复。未操作设备/HAP、共享用户数据或发布版本；[PR #30](https://github.com/MonsterXia/scrcpy-harmony/pull/30) 保留待维护者审查，最终 CI 见[检查页](https://github.com/MonsterXia/scrcpy-harmony/pull/30/checks)。

### M2-2 内存查询首次生产接入

- 2026-10-22 / Codex；基线 `8f1becb`，分支 `codex/m2-memory-deadline`。仅 `hdc.ts/getMemory` 的 `cat /proc/meminfo` 改走已合并有限模块，与 Hdc.createClient 共用从 OHOS_HDC_SERVER_PORT 解析一次的端点，保留默认/非默认端口语义，非法范围明确拒绝；10 秒保守总截止尚未真机校准。失败拒绝，不回退无界 shell，不重试用户命令。
- 真实处理器/base/parameters/hdckit/finiteShell + 随机回环首批 13 项先 9 失败/4 通过，接入后通过；增加真实 React 概览超时清空及重试恢复后专项 14/14。真实时钟截止约 10 秒；最终全量 199/199、lint、build:main 通过。三个既有枚举夹具补新增 import 的禁止调用边界；过程失败与证据见[专项报告](docs/maintenance/M2-2-memory-deadline.md)。
- 主对话独立审查发现初稿固定 8710 覆盖环境端口（P2）。改为加载真实 Hdc.createClient 后新增 9 项端口回归先 6 失败/3 通过，修复共享解析后专项 23/23、全量 208/208、lint、build:main 通过；不把初轮内部复核视为最终审查结论。
- 交付 [PR #32](https://github.com/MonsterXia/scrcpy-harmony/pull/32)；主对话对 `2e7cd3e` 的[独立审查](https://github.com/MonsterXia/scrcpy-harmony/pull/32#pullrequestreview-5615722771)确认 P2 已修复，独立 45/45 通过，无剩余阻断；最终组合审查、SHA 和合并状态见 PR 页面，五项必需 CI 见[检查页](https://github.com/MonsterXia/scrcpy-harmony/pull/32/checks)。
- 最终组合：通过普通 merge 同步已合并 #31 的 master `bd3e3c9`，无 rebase/force push，两个工作项记录均保留；全量 **221/221**、lint、build:main 通过。此后仅更新交接文档；仅在最终提交独立审查无阻断且五项 CI 通过后合并。
- 前序参数/设备信息与后续屏幕查询仍未限时，服务启动保持原 hdckit 路径；终端/HiLog/投屏/写操作未迁移。协议严格度与预算需授权真机验收，M2-2 仍进行中。最终 SHA/PR/CI 由交付消息和 PR 正文承载，主对话完成独立 review、五项必需 CI 核验后统一合并；本分支不自行合并或操作设备。

### M2-2 握手兼容修复

- 2026-10-23 / Codex；基线 `8d1cfab`，独立分支 `codex/m2-handshake-compat`。主对话真机旧有限模块三次 4/2/2ms 在 handshake 拒绝，CLI 成功；脱敏 hello 长度 44、banner 匹配，定位为旧实现误限 16 字节。扩为仅 16/44，回复逐字节对齐锁定 hdckit，未知长度/截断仍拒绝，取消和端点不变；见[专报](docs/maintenance/M2-2-handshake-compat.md)。
- 新接受用例修复前 1 通过/1 失败；适配器 42/42、44 字节实际内存链路 23/23，组合 65/65、全量 265/265、lint、单模块 strict TypeScript、build:main 通过。所有本分支网络测试仅随机回环合成数据。
- 主对话 OS 临时诊断副本真机三次成功 162/158/162ms，仅作为诊断证据。正式候选 `f2e2f5ae091f28832fa642caacc39ea2f796a87a` 在 clean 工作树直接编译未修改的真实有限模块，单台授权手机内存读取三次成功 **170/159/178ms**；字段存在、total > 0、free <= total 且无明确错误，源码 SHA-256 见专报。未记录应用清单、原始 payload 或设备标识；仅验证有限模块与手机，不代表整个 getOverview、Electron IPC 或长期空闲验收。此次只补文档证据，不重复无关全量测试。
- 手机由主对话独占；[PR #39](https://github.com/MonsterXia/scrcpy-harmony/pull/39) 最终 `3a08f8d` 经独立审查、正式候选手机复测及[五项必需 CI](https://github.com/MonsterXia/scrcpy-harmony/pull/39/checks)核验，由主对话合入 master `19c0d2b6df25c2b2ffe7fb4d03363bf90824bf9e`，本分支未自行合并/发布。#35 此后才通过普通 merge 同步并恢复。
- 预算在负载下的校准、完整概览、断连恢复与长期空闲验收仍待办，M2-2 保持进行中。此前交接中的恰好 16 字节限制属于历史实现，以本轮源码和专报为准。

### M2-2 屏幕查询第二个有限接入

- 2026-10-23 / Codex；基线 `8d1cfabbc683a2664fd5f12d2ce89bb61e47f6a8`，分支 `codex/m2-screen-deadline`。仅 getScreen 固定 hidumper 命令接入 finiteShell，独立 15 秒总预算给 RenderService 查询留出余量，尚未真机校准；复用共享端点及原前序启动路径，不迁移参数/deviceinfo、写操作或长连接。
- 真实 getOverview/hdckit/finiteShell + 回环路径的屏幕专项先 13 失败/1 通过，接入后 14/14；抽取共用夹具，保留内存 23 项及环境端口语义，联合 37/37。五阶段截止、socket 释放、迟到输出、明确错误和再次刷新恢复通过；实际 15 秒截止约 15021ms。全量 264/264、lint、build:main 通过，详见[专项报告](docs/maintenance/M2-2-screen-deadline.md)。
- #39 合入后普通 merge 同步 master `19c0d2b`，保留握手协议及真机证据；共享 overview-fixture 从 16 改为合成 44 字节 hello。适配器/内存/屏幕组合 **79/79**、全量 **279/279**、lint、build:main 通过，实际屏幕截止约 15020ms；没有修改已合并的 finiteShell 生产实现。PR #39 内存真机结果不作为屏幕或完整概览验收。
- 主对话通过 TypeScript AST 提取未改 `getScreen` 及端点/预算声明，绑定真实 finiteShell 在单台授权手机读取三次，合法分辨率结果 **433/195/152ms**；未改实现或预算，未记录实际分辨率、设备 key 或原始输出。仅为源码函数提取+真机，不是完整 getOverview handler/Electron IPC 或长期空闲验收。源码哈希及 finiteShell 与 #39 同 Git blob、仅 CRLF/LF 导致本地哈希变化的证据见专报；此后只补文档，不重跑已通过的组合全量。
- 内存与屏幕预算分别计时，整个概览仍无总截止；协议兼容、预算、长期空闲及真机监听释放待验收，M2-2 保持进行中。最终 SHA/PR/审查/五项 CI 由交付消息和 PR 页面核验；仅在最终提交独立审查无阻断且五项 CI 通过后由主对话合并，不自行合并或发布。未操作真实 HDC、真机/HAP，不采集内部应用信息。

### M2-2 概览剩余元数据有限读取

- 2026-10-23 / Codex；基线 `a2ed5f8`（含 `427e255`），分支 `codex/m2-overview-deadlines`。仅概览 param get、SP_daemon -deviceinfo、uname -a 分别接入 10/15/10 秒截止，抽取共用参数解析；getTargets 保留旧传输。概览拒连直接失败，不再自动启动服务，初始化/枚举原启动路径不变；见[专报](docs/maintenance/M2-2-overview-deadlines.md)。
- 首批专项旧实现 32 失败/1 通过，接入后通过；补服务拒连/恢复后专项 34/34，含内存/屏幕/枚举组合 99/99，全量 347/347、lint、build:main 通过。合成回环覆盖三条命令五阶段截止、明确错误、截断/reset、socket 关闭及下一次恢复，不将基线真机结果直接归属本候选。
- 代码候选 `f48256a` 由主对话完成隔离完整 build / Electron45 / 真实 preload→IPC→getOverview→UI 真机复测：完整 IPC 13 次成功 1421–1719ms；五条查询明确错误/无响应共 10 场景均清空旧详情、结束 spinner、故障命令单次发送、后续查询不启动、socket 关闭并恢复 UI/IPC，页面错误和越界命令均 0。无响应总耗时 10035/15608/11045/11604/16657ms，含前置步骤。注入故障不等于物理断连；仅只读设备，无写入或内部应用采集，完整脚本/JSON 由主对话另立 PR 归档，见专报。
- 手机和 `script/check-overview-live.mjs` 由主对话独占，本分支未操作；候选后仅补文档。最终独立审查及五项必需 CI 按 PR 最终 SHA 核验后由主对话合并；预算校准、物理断连和长期空闲仍待验收，M2-2 保持进行中。

### M2-2 逐设备枚举参数有限读取

- 2026-10-23 / Codex；基线 `0bcbcca`，分支 `codex/m2-target-parameter-deadline`。仅 getTargets 的每设备 param get 复用 finiteShell、共享 parser/端点及 10 秒预算，保持并发、原列表顺序和单设备失败隔离；host listTargets、初始化和服务启动路径不变，没有整个枚举统一截止，见[专报](docs/maintenance/M2-2-target-deadlines.md)。
- 旧 ready/read 无响应回归 2/2 失败；新专项 13/13、枚举/刷新组合 54/54、全量 374/374、lint、build:main 通过。独立 git archive 无子模块检出中同组 54/54 通过。五阶段截止、socket/timer 释放、明确错误、截断/reset、全部失败及下次恢复均为合成回环验证。
- 普通 merge 同步已合并 #45 的 master `b918e2b`，保留端口弹窗生命周期与本轮枚举记录；组合全量 393/393、lint、build:main、build:renderer 通过。本轮枚举生产源码及专项测试未改，不将独立 `0bcbcca` 手机基线的重连现象归因于本次迁移。
- 无真机/HDC 操作；主对话独占的物理断连与十分钟概览空闲验证另行归档，不外推为本候选参数传输验收。最终 PR/SHA 由主对话独立审查并核验五项必需 CI 后合并，本分支不自行合并/发布；host 等待、多设备真机、负载预算仍待后续，M2-2 保持进行中。

### M3-3 用户与构建说明推进

- 2026-10-22 / Codex；基线 `9e944ae`，独立分支 `codex/m3-3-user-build-docs`。已读上游 #14/#20，并核对 v1.0.2、master、菜单与日志实现，补齐 README 导航、[用户指南](docs/user-guide.md)和[构建指南](docs/build-guide.md)。
- 独立 Windows x64 检出完成固定子模块初始化、锁文件安装、资源准备、66 项测试、lint、build 和 no-publish 打包；下载两次 TLS 失败及重试结果如实记录，见 [M3-3 报告](docs/maintenance/M3-3.md)。未修改生产代码、锁文件或工作流。
- M3-3 保持待验收：本轮不访问真机或设备应用，不安装/卸载应用；macOS 使用已核实历史 CI，未做本机人工走读。下一步按发行版指南验收授权、设备选择、投屏/输入及脱敏日志导出；PR 与 CI 结果集中记录在专项报告，不以文档或无设备测试替代这些验收。

### M3-3 HiLog 在途记录后续

- 2026-10-22 / Codex；基线 `9f8ddcb`，独立分支 `codex/hilog-inflight-lifecycle`。旧实现 10 项专项回归中 8 失败、2 通过，暂停/关闭或暂停→恢复后会发送旧记录，PID 查询拒绝未在 listener 内处理。
- 仅修改主进程 `hdc/hilog.ts` 的生命周期边界：旧回调失效、关闭解绑监听、迟到控制 IPC 无操作；当前记录的 PID 查询失败回退且后续可恢复。独立审查通过，合入 master `ddc1df4` 后专项 11/11、全量 158/158、lint、完整 build 通过，见[报告与证据](docs/maintenance/M3-3-hilog.md)。
- 不取消底层查询、不撤回已发送 IPC、不更改 renderer 清除边界；未访问设备/HAP，真机用户流程与长时行为仍待验收。独立审查、PR 和最终 CI 见专项报告，由主对话审查后整合。

### M3-3 发行版与用户 / 构建指南复核

- 2026-10-23 / Codex；基线 `8d1cfabbc683a2664fd5f12d2ce89bb61e47f6a8`，独立工作树与分支 `codex/m3-3-release-guide-audit`。只读 GitHub API 确认公开 Release 仍为 v1.0.2、tag 对应 `1c545a7`、14 个附件；未修改 README、代码、版本、Release、锁文件或 CI。
- 更新两份指南的核对基线、master 未发行行为、刷新失败反馈与 tag 构建说明；首次 M3-3 报告明确作为历史证据保留。源码及发行元数据核验、执行结果见[专项记录](docs/maintenance/M3-3-release-guide.md)。
- 独立依赖安装后全量 250/250、lint、main/preload/renderer 构建通过；本轮未重新下载设备资源或安装包，未执行完整资源复制 / 打包 / 安装启动，也未接触 HDC、真机或 HAP。M3-3 保持**待验收**。
- 同步 #39 / #35 / #37：普通 merge master `1f05c37a1b430673d53060dedd7f82442472b367`，无冲突，保留他项记录；指南增加屏幕读取截止及 WebView 刷新 / 选择生命周期边界。公开 Release 复核仍为 v1.0.2、14 附件。本轮仅文档增量核对，不重复全量测试或将其他任务的局部真机读取作为 M3-3 用户流程验收。
- 下一步：最终 SHA、增量独立审查、五项 CI 及合并状态以 [PR #36](https://github.com/MonsterXia/scrcpy-harmony/pull/36) 及其[检查页](https://github.com/MonsterXia/scrcpy-harmony/pull/36/checks)为准，由主对话核验；如期间发布新版本，先重新核对 Release/tag/资产及指南中的版本边界。真机用户流程和 macOS 本机人工走读仍需另行验收，不自行合并或发布。

### M4-1 音频能力评估交接

- 2026-10-22 / Codex；基线 `9e944ae27ad7cc4c656467257e3e84d8067dc2f8`，独立分支 `codex/m4-1-audio-assessment`。完成来源正文、当前官方 HarmonyOS/OpenHarmony/HDC 文档及锁定依赖/投屏路径的静态核对，见 [独立报告](docs/maintenance/M4-1-audio.md)。
- 结论为暂缓实现、待能力验证：存在经用户同意的设备端公共捕获候选，不等于现有 HDC/JPEG 投屏已具备音频；麦克风、内部音频、传输与系统/受限权限分别列明。API 26.0.0 新接口不推定兼容旧系统，未编造同步或延迟实测结果。
- 本轮仅本报告与本条记录，不修改生产代码/依赖；不连接真机、不安装 HAP、不录音、不访问媒体。普通签名部署、SDK/设备能力、应用捕获策略与分发仍待验证；当前仅 bilibili 后续侧载范围不能授权安装采集伴侣。
- 交付：[独立草稿 PR #24](https://github.com/MonsterXia/scrcpy-harmony/pull/24)，[CI 检查页](https://github.com/MonsterXia/scrcpy-harmony/pull/24/checks)。独立审查已完成，发现的官方链接问题已修正，评估文档无未解决阻断项；核验范围见报告，CI 以当前提交检查页为准。下一步：维护者先处理 G1/G2 的产品范围、授权部署、目标 API/SDK 条件；满足后另立探针与实现任务，不自动合并或发布。

### M4-2 文本输入能力评估交接

- 2026-10-23 / Codex；基线 `8d1cfabbc683a2664fd5f12d2ce89bb61e47f6a8`，独立分支 `codex/m4-2-text-input`。已读上游 #23（正文/评论为空）、真实工具栏/桥接/主进程与锁定 UiDriver，以及 Electron 45/OpenHarmony 官方资料，见[评估报告](docs/maintenance/M4-2-text-input.md)。
- 决定暂缓实现、先验证能力：现有路径使用 (0,0) 坐标，单行弹窗丢换行，toolbar 未等待/处理拒绝；主进程和 UiDriver 本身会等待并传播拒绝。七组合成文本通过真实封包保真检查；报告归档可重复脚本、版本和哈希，不将替身结果等同真实 IPC、剪贴板权限或设备通过。
- 本轮仅报告与本项 RUNBOOK 更新；没有生产代码修改、设备/HAP 操作、系统剪贴板访问或发布。M4-2 保持待能力验证、未验收。下一步先确认输入目标、结果未知与长度策略，再安排独立实现和授权真机验收。
- 初评提交 `aa8ab6e` 已由主对话以 OpenAI GPT-6 署名独立审查，无阻断；源码、primary 引用和附录哈希已核对，审查未重复探针。随后按队列普通 merge master `2465cb343e60a0e6059036b6962a776409e3f7fd`，完整保留 M4-3 及其他任务记录；核对文本工具栏、投屏客户端、类型/preload、uitest handler、share 子模块与依赖文件均未变。仅做文档差异/引用检查，未重复全量测试或探针。
- 最终 SHA、增量独立复审、五项必需 CI 与合并状态以 [PR #40](https://github.com/MonsterXia/scrcpy-harmony/pull/40)及其[检查页](https://github.com/MonsterXia/scrcpy-harmony/pull/40/checks)为准；初评审查不替代同步后的最终核验，由主对话统一审查整合，本分支不自行合并。

### M4-2 现有文本按钮异步修复

- 2026-10-23 / Codex；从包含指定 `427e255` 的最新 master `a2ed5f8eeb45e027f639e92d12f9b0140cfdff7d` 建立独立分支 `codex/text-input-lifecycle`，复用本任务隔离工作树及其独立依赖/输出。仅修复已有文本按钮，不新增剪贴板、多行或坐标功能，详见[修复报告](docs/maintenance/M4-2-text-input-lifecycle.md)。
- prompt/发送期间同步防重入并禁用按钮，await bridge、消费拒绝并显示通用错误；取消/空串不发送。target 对象替换和卸载使旧会话失效，旧 prompt 不发送、旧结果不通知或解锁当前操作；不自动重发，不声称取消已发写入。
- 真实组件/React/MobX/LunaToolbar 加受控桥接回归：旧实现 10 失败/4 通过，修复后 14/14；全量 327/327、lint、renderer 构建通过。首轮 CI 因未检出 share 子模块、夹具读取共享图标报 ENOENT；改为薄展示适配层连接真实 Luna 按钮，原候选无子模块快照先复现失败，再仅覆盖测试后专项 14/14、全量 327/327 通过，详见报告。生产代码与 CI 配置未改，不能将本地通过替代修订提交的最终 CI。未操作 Electron/HDC/手机或真实剪贴板，没有主进程、UiDriver、共享子模块或协议变更。
- `7f9e37e` 经主对话独立增量复审（专项及禁止 src/share 读取均 14/14），该提交五项 CI 全绿后，按队列普通 merge 已合入 #43 的 master `16449d83c75a3deb28e81877bd54fd607a031094`，无冲突并保留双方记录。文本生产代码/专项测试未变；合并后全量 **361/361**（文本 14 + overview 新 34 均在内）、lint、renderer 构建通过，未操作设备，未执行真机验证脚本。
- 整体 M4-2 保持待能力验证、未验收，直接粘贴仍暂缓；无回复时保持忙碌，目标语义、真实设备与跨平台反馈另行验收。最终 SHA、增量独审及五项 CI 见 [PR #42](https://github.com/MonsterXia/scrcpy-harmony/pull/42)及[检查页](https://github.com/MonsterXia/scrcpy-harmony/pull/42/checks)，旧 SHA 通过不代表本次合并提交通过；主对话 OpenAI（GPT-6）独审及最终五项必需 CI 通过后决定合并，本分支不合并或发布。

### M4-3 文件下载能力评估交接

- 2026-10-23 / Codex；fetch 后基线 `8d1cfabbc683a2664fd5f12d2ce89bb61e47f6a8`，独立分支 `codex/m4-3-file-download`。只读核对上游 #15、当前官方 HDC 文档、锁定 hdckit 0.12.1 发布包与现有 UI/IPC，见 [专项报告](docs/maintenance/M4-3-file-download.md)。
- 结论为暂缓：基础 file recv 存在，不等于 `/data/log/hilog` 普遍可读；官方 E005008 涉及敏感日志限制，沙箱 -b 也有调试签名/运行状态及版本条件。当前没有通用文件浏览/下载任务 IPC，接收包装未提供进度/取消/续传和完整性保证。
- 仅新增报告并更新本条目；未修改生产代码/依赖，未运行 HDC、连接设备、收取文件或安装 HAP，未发布版本。本地仅做文档和锁定源码核对；真机与跨平台下载验收均待办，M4-3 保持暂缓。
- 整合前普通 merge 同步 master `a8fea7c7831887e7072cb0a193edf31dba7a2f84`，保留其他工作项全部记录；复核截图接收、UI/IPC、锁定依赖和共享对话框未变。概览有限屏幕查询及握手兼容改进不覆盖 file recv 子进程，评估结论仍成立。仅做文档差异、引用和必要源码核验，未重复全量测试；最终 SHA 与五项 CI 见 [PR #38](https://github.com/MonsterXia/scrcpy-harmony/pull/38)。
- 下一步：主对话独立审查最终提交及五项必需 CI 后决定合入；PR/SHA/检查证据由交付消息与 PR 页面承载，本分支不自行合并。先确定 G1/G2 的授权路径和设备版本，再另行安排最小单文件范围及 G3–G5 验收，不自动启动 UI/传输实现或真机操作。

### Sourcery 超额度评论事件清理

- 2026-10-22 / Codex；用户授权仅删除 Sourcery 的超额度提示、保留正常审查，并明确使用 GitHub Actions 评论事件。独立分支 `codex/sourcery-quota-comments`；未创建定时任务。
- 新增 `issue_comment.created/edited` 工作流，按 Bot 作者、所属 PR 和完整额度通知模板筛选，删除前重新获取核对；无 checkout、无 PR 代码执行，仅任务级 `issues: write`。未知/混合正文保留，404 幂等，其他 API 错误可见失败。
- 本地专项 29/29 通过，直接执行实际 workflow 脚本，包含正常审查/指南/人类/其他机器人保留、正文追加意见、事件过期、错误传播。已核对 GitHub 官方事件和评论删除 API 文档；文档入口同步。
- 复核：对仓库实际 17 条 Sourcery 顶层评论只读执行相同脚本，仅匹配 PR #33 的 1 条新额度通知，16 条正常评论保留。提交 `804140a` 已获独立审查，无阻断；审查者复跑 29/29 并补验重复事件的 DELETE 成功/404 幂等。
- 状态 / 下一步：配置实现与本地验证已完成；默认分支上线及最终五项 CI 状态以 [PR #33](https://github.com/MonsterXia/scrcpy-harmony/pull/33) 为准。真实 Sourcery 评论事件删除尚未验收，后续以 [工作流运行记录](https://github.com/MonsterXia/scrcpy-harmony/actions/workflows/sourcery-quota-comments.yml) 和评论不存在为证据；不发布或伪造机器人测试评论。

### M3-3 中英文 README 整合

- 2026-10-22 / Codex；从最新 master `8de423e` 建立独立分支 `codex/readme-bilingual`，整合此前的 README 重写与双语改造。`README.md` 为英文入口，`README_ZH.md` 为中文，两者顶部互链；保留本仓库 Version、Platform、Downloads 徽章，移除上游 Logo 和展示图。
- 保留 master 已有的用户/构建指南、1.0.2 与源码构建边界、签名及旧配置说明；中文指南返回中文 README。维护者参考新增双语同步约定。本项不改变 M3-3 的待验收状态。
- 验证：独立检出使用 `npm ci` 安装锁定依赖，完整单测 250/250、lint 通过。两份 README 各 9 个本地引用目标存在，语言入口互通；命令块、外部 URL 和章节层级一致，npm 脚本名有效，Git 差异空白检查通过。独立只读审查无阻断发现，已采纳英文元数据表述修正。
- 合入方式：单独文档 PR，等待最终提交的 test、lint、Windows x64、macOS arm64/x64 五项必需 CI 通过并检查审查讨论后合入；PR 与最终 CI 证据以该 PR 页面为准。
- 下一步：按现有用户指南完成真机流程与 macOS 人工走读；本次不执行设备操作，也不将文档检查或无设备测试作为真机验收。
- 合入前按用户要求审查原工作区三处未提交代码：资源脚本只对常量路径增加白名单，未改变实际路径；主窗口全局阻断非白名单明文 WebSocket；WebView 点击处理强制将部分 WS 目标改为 WSS。独立审查及无联网路径/URL 复核确认这些补丁无需合并，后两者引入未经需求支持的连接策略变化。已按用户授权仅撤销这三处代码补丁，文档 PR 不包含它们。

### Sourcery 清理权限修复与真实运行验收

- 2026-10-23 / Codex；用户反馈新额度评论仍保留。[失败运行 39954302726](https://github.com/MonsterXia/scrcpy-harmony/actions/runs/39954302726) 已触发并匹配模板，DELETE 返回 403 `Resource not accessible by integration`；旧令牌只有 Issues 写权限，累计观察到 7 条未清理提示。
- 改为任务级 `pull-requests: write`，保持无 checkout、无 PR 代码执行和完整正文白名单。增加仅默认分支可用的单评论 ID 手动入口，用相同筛选规则补清历史记录并验证实际 Actions 令牌；自动事件仍只处理触发评论，没有定时或全量扫描任务。
- 回归测试先复现旧权限契约和缺失手动入口的失败，修复后专项 46/46 通过，涵盖正常/混合审查保留、跨仓库与普通 Issue 排除、非法 ID、非默认分支、过期正文及 403/404。
- 状态 / 下一步：本地实现与专项验证完成；本修复 PR 的最终 CI、合并和实际删除验收以 PR 页面及[运行记录](https://github.com/MonsterXia/scrcpy-harmony/actions/workflows/sourcery-quota-comments.yml)为准。合入后使用真实积压评论验证 Actions 删除和正常评论保持不变，未取得运行证据前不标记真实删除成功。

### 2026-10-23 本轮合入汇总

- 主对话已按顺序完成下列五个 PR 的最终提交独立审查（OpenAI GPT-6），并核验各自最终五项必需 CI：test、lint、windows-package、macos-package-arm64、macos-package-x64 全部成功后合并。以下为已交接证据汇总，未在 #40 重复运行测试或操作设备；最新主干为 `2465cb343e60a0e6059036b6962a776409e3f7fd`。

| 已合并 PR | 最终候选与 CI | 已验证范围及保留状态 |
| --- | --- | --- |
| [#39 握手兼容](https://github.com/MonsterXia/scrcpy-harmony/pull/39) | `3a08f8d`；[五项 CI 成功](https://github.com/MonsterXia/scrcpy-harmony/pull/39/checks) | 正式生产候选 `f2e2f5a` 的真实有限模块由主对话在授权手机读取内存三次，170/159/178ms；此后仅文档更新至最终候选。仅接受已核实的 16/44 字节 hello。M2-2 仍进行中，负载预算、断连恢复与长期空闲待验收。 |
| [#35 有限屏幕查询](https://github.com/MonsterXia/scrcpy-harmony/pull/35) | `26142da`；[五项 CI 成功](https://github.com/MonsterXia/scrcpy-harmony/pull/35/checks) | 主对话以 AST 原样提取 getScreen 及端点/预算声明，绑定真实 finiteShell，在授权手机三次成功，433/195/152ms。内存与屏幕预算分开，整个概览无总截止，M2-2 仍进行中。 |
| [#37 WebView 生命周期](https://github.com/MonsterXia/scrcpy-harmony/pull/37) | `4001f4a`；[五项 CI 成功](https://github.com/MonsterXia/scrcpy-harmony/pull/37/checks) | 同步 #39/#35 后组合全量 296/296，专项组合 109/109；隐藏/失败/切换与选择状态回归通过。M2-4 仍进行中，真实 WebView/Chrome 对照、断连恢复与 DevTools 加载待验收，现有 IPC 仍不可取消。 |
| [#36 发行版与指南](https://github.com/MonsterXia/scrcpy-harmony/pull/36) | `b6b0242`；[五项 CI 成功](https://github.com/MonsterXia/scrcpy-harmony/pull/36/checks) | 指南继续区分公开 v1.0.2 与 master，保留发行快照和构建边界；M3-3 仍待验收，真机用户流程与 macOS 人工走读另行安排。 |
| [#38 文件下载评估](https://github.com/MonsterXia/scrcpy-harmony/pull/38) | `25a8f1c`；[五项 CI 成功](https://github.com/MonsterXia/scrcpy-harmony/pull/38/checks) | M4-3 暂缓；基础 file recv 不证明日志路径可读，具体权限仍未知。先确定授权路径/版本，再另立传输与验收任务，未启动下载功能或设备操作。 |

- #39/#35 的手机证据严格限于有限模块内存读取、AST 原样屏幕函数读取；不外推为完整 Electron IPC、整个 getOverview、完整用户流程或长期空闲通过。归档不包含设备标识、原始设备内容或内部应用信息。
- [#40 文本输入评估](https://github.com/MonsterXia/scrcpy-harmony/pull/40)已完成最终 `800951e` 的 OpenAI GPT-6 独立审查和[五项 CI](https://github.com/MonsterXia/scrcpy-harmony/pull/40/checks)，合并为 `427e255`。这只完成能力评估；M4-2 的剪贴板、输入目标语义、结果未知处理、长度策略及授权真机验收仍待验证。

### 2026-10-23 完整概览验收与并行修复合入汇总

- [#43 概览剩余只读查询截止](https://github.com/MonsterXia/scrcpy-harmony/pull/43)最终候选 `b24597c` 已获 [OpenAI GPT-6 独立审查](https://github.com/MonsterXia/scrcpy-harmony/pull/43#pullrequestreview-5628639471)，[五项必需 CI](https://github.com/MonsterXia/scrcpy-harmony/pull/43/checks)成功后合并为 `16449d8`。独立回归 142/142，加三条新增命令的实钟超时/关闭/恢复 3/3；getTargets 和其他旧命令未迁移。
- 主对话独占手机，对正式生产候选 `f48256a` 完整构建执行真实 Electron preload/IPC/getOverview/UI 验收：完整读取 13 次成功、1421–1719ms；五阶段明确错误和无回复共 10 场景全部清空、关闭连接并恢复，页面错误与越界请求为 0。[完整报告、脚本与脱敏证据](docs/maintenance/M2-2-overview-live.md)随 [#44](https://github.com/MonsterXia/scrcpy-harmony/pull/44)归档，最终独立复审和 [CI](https://github.com/MonsterXia/scrcpy-harmony/pull/44/checks)以该提交检查页为准。错误由隔离代理合成，未做物理拔插；不采集应用清单、设备标识或原始日志。
- [#42 文本工具栏等待与结果隔离](https://github.com/MonsterXia/scrcpy-harmony/pull/42)最终候选 `3774ec4` 已获 [OpenAI GPT-6 独立审查](https://github.com/MonsterXia/scrcpy-harmony/pull/42#pullrequestreview-5628695843)，[五项必需 CI](https://github.com/MonsterXia/scrcpy-harmony/pull/42/checks)成功后合并为 `d2b4e93`。等待 IPC、通用失败反馈、防重入和旧目标结果隔离已修复；早期 CI 的无子模块夹具依赖已修正，独立专项及禁止共享源码读取的运行均 14/14，合并组合全量 361/361、lint、renderer 构建通过。未进行文本写入或剪贴板真机操作。
- 下一步：M2-2 保持进行中，补物理断连、负载预算与原复现时长的空闲/资源趋势；M4-2 完整输入目标语义和剪贴板能力仍暂缓。M1-2/M1-3 继续保留 bilibili HAP 缺失与图标权限边界。本轮不发布新版本，不将受控故障或无设备回归外推为这些待办已完成。

### 2026-10-23 物理恢复、10 分钟空闲与并行任务整合

- 主对话独占已授权 USB 手机，在生产基线 `0bcbcca` 完成三轮人工拔插；三轮断开均清空选择与旧详情，旧 key 概览在 10/9/11ms 拒绝。第一轮重连后的附加 IPC 失败，第二轮自动概览在脚本 25 秒窗口内未匹配，原因未定位。第三轮扩大观察窗口并等待自动页面读取后再探测，自动恢复通过、未使用手动刷新；实际空闲 600006ms，正常 tracker 轮询 594 次，业务命令未增长，之后概览 IPC 与实际页面刷新通过。21 组资源采样及全部失败记录见[报告和脱敏 JSON](docs/maintenance/M2-2-physical-idle.md)。这不是稳定性修复或长期无泄漏证明。
- [#45 端口弹窗生命周期](https://github.com/MonsterXia/scrcpy-harmony/pull/45)最终 `45ff5c1` 已获 [OpenAI（GPT-6）独立审查](https://github.com/MonsterXia/scrcpy-harmony/pull/45#pullrequestreview-5628971569)，[五项必需 CI](https://github.com/MonsterXia/scrcpy-harmony/pull/45/checks)通过后合并为 `b918e2b`。独立专项 19/19；隐藏不读、读取失败清空与迟到结果隔离得到真实组件验证，不改变端口写入语义。
- [#46 枚举参数有限读取](https://github.com/MonsterXia/scrcpy-harmony/pull/46)最终 `55f6679` 已获 [OpenAI（GPT-6）独立审查](https://github.com/MonsterXia/scrcpy-harmony/pull/46#pullrequestreview-5629063710)，[五项必需 CI](https://github.com/MonsterXia/scrcpy-harmony/pull/46/checks)通过后合并为 `e0c95ba`。独立相关回归 54/54、有限传输 42/42，无共享子模块快照 54/54；单条参数命令实际约 10013ms 截止并关闭连接，组合全量 393/393、lint 和构建通过。host listTargets/初始化仍无截止，不能声称整体枚举已限时。
- 合入上述两项后，生产源码等同 `e0c95ba` 的检出 `5e1b8ca` 重新构建并复测真实概览 IPC/UI：7 次成功、1522–1808ms，内存/屏幕四个受控故障均恢复；单独归档于上述报告。这轮未重复物理拔插与 10 分钟空闲，不能把旧基线证据自动外推到新提交。并行作者和独立审查均未操作手机。
- 下一步：优先定位物理重连前两轮的失败分类和累积等待；继续收集原复现时长及面板负载/监听释放证据。M2-2/M2-5 保持进行中，无线连接及授权失败待验收，M1-2/M1-3 仍受 bilibili HAP 缺失和图标权限边界限制。新增记录无设备标识、原始日志或内部应用信息，本轮不发布版本。

### M2-2 / M2-3 主进程关窗与捕获监听审计

- 2026-10-23 / Codex；基线 `4f514989`，独立分支 `codex/capture-close-lifecycle`。核对 renderer 销毁与真实窗口生命周期的既有边界，见[专项报告](docs/maintenance/M2-3-main-capture-close.md)。没有启动 Electron/HDC、连接设备或读取应用清单；所有传输和帧均为合成样本。
- 最小修复：直接 destroy 绕过 close 时，模块级窗口引用原先不清空，重开会访问已销毁窗口。把引用清理及主窗恢复移到 closed，保留原 close 销毁行为。回归先为 2 通过/3 失败，修复后 5/5；布局组合 8/8，全量 398/398、lint 和 build:main 通过。事件来自替身，不替代实际 Electron 验收。
- 捕获审计仍发现缺口：完成捕获关窗、迟到 start 回复和 stop 拒绝后均残留 1 个真实 UiDriver 监听；关窗未发 stop，重开可接收旧会话的合成帧。成功 stop 对照清零。`node script/audit-capture-close.cjs` 可重复观察；命令成功仅表示探测完成，不表示缺陷已修复。
- 状态 / 下一步：M2-2/M2-3 保持进行中。主进程没有跨 renderer 的 owner/session/顺序协议，不能直接在 close 增加 stop 并声称安全停止；须另行设计旧 owner 与新捕获隔离、迟到启动补偿和停止失败语义。本 PR 仅窗口引用修复、证据和文档，最终独立审查、五项必需 CI 与合并由主对话负责，不自行合并或发布。
- 整合前普通 merge 同步 #48 已合入的 master `ec1ab37`；仅 RUNBOOK 追加位置冲突，保留双方记录。投屏生产改动不变，组合专项 32/32、全量 407/407、lint 通过，合成捕获探针输出不变；最终候选的增量独审和五项 CI 见 [PR #49](https://github.com/MonsterXia/scrcpy-harmony/pull/49)。
- 最终 `d97ef0a` 已获 [OpenAI（GPT-6）独立审查](https://github.com/MonsterXia/scrcpy-harmony/pull/49#pullrequestreview-5629542447)，独立相关 40/40、无共享源码组合 29/29 和额外三项合成验证通过，基线回退再次复现 2 通过/3 失败；[五项 CI](https://github.com/MonsterXia/scrcpy-harmony/pull/49/checks)全绿后合并为 `12f714e`。下一步仍是捕获所有权与停止语义，不将窗口引用修复视为捕获清理完成。

### 2026-10-23 M2-2 概览 renderer 读取生命周期

- 真实 Overview/React/MobX/Luna 组件回归确认同 tick 重入重复请求、卸载/断连后旧失败通知，以及 StrictMode 废弃读取覆盖当前结果；新增 9 项在修复前全部按预期断言失败。仅修改 Overview 的请求会话和失效检查，当前失败继续清空详情、释放 loading 并允许手动重试。App 已有按 target key 重挂载保护；不把组件边界缺陷认定为前两轮物理重连失败的原因。
- 修复后专项 10/10（含既有失败刷新回归，运行时未初始化 src/share），全量 402/402，lint 和 renderer 构建通过；构建保留现有 Vite/Sass、licia eval 和 chunk 警告。[专项报告](docs/maintenance/M2-2-overview-lifecycle.md)记录复现、测试边界和下一步。全程合成数据，无 HDC/手机访问、设备应用清单采集或发布。
- 最终 `94d25c6` 已获 [OpenAI（GPT-6）独立审查](https://github.com/MonsterXia/scrcpy-harmony/pull/48#pullrequestreview-5629444647)，独立相关 44/44 和额外三项内存验证通过；[五项 CI](https://github.com/MonsterXia/scrcpy-harmony/pull/48/checks)全绿后合并为 `ec1ab37`。M2-2 继续进行中，原复现时长空闲、负载与物理失败根因仍待验证。

### 2026-10-23 物理重连诊断后续

- 主对话在 `4f51498` 使用新增的命令时序和固定响应分类完成一次人工拔插；自动恢复、断开后旧请求 10ms 拒绝、四次完整读取 2041/1424/1643/1650ms 均通过。观察 60012ms 后 IPC/UI 刷新正常。81 条 shell 记录均关闭，无部分帧、超限、记录丢弃或越界请求。实际就绪探针捕获一次目标未就绪，1016ms 后的下一次探针成功，后续五条概览命令完成。
- 用户补充接回时在手机 USB 模式弹窗选择“传输文件”，之后观察到应用检测设备，并确认前两轮失败时也一样；人工等待不应算作概览阻塞。没有精确选择时间；相同操作存在于成功和失败轮次，不能单凭此解释结果差异或作为设备通用前提。排查继续聚焦设备识别后的命令与页面时序，详见[诊断、脚本版本与原始脱敏 JSON](docs/maintenance/M2-2-reconnect-diagnostics.md)。
- 独立审查发现并修正诊断自身的两项问题：响应超限改为只停分类、继续透传；echo 的裸 `E000004` 分类与生产 ready 判定一致。分类与 framing 17/17，无原始响应或设备标识。实测仍对应保存的早期诊断脚本，最终修正仅无设备验证，不回填旧数据。
- 前两轮错误类别/阶段耗时未保存，不能事后确诊；此次未复现，M2-2/M2-5 继续进行中。下一次复现先核对人工 USB 模式选择、ready 与具体命令/页面阶段。并行 #48/#49 的修复有各自证据，不认定为物理失败修复；原复现时长、负载、捕获会话归属、无线与授权失败仍待推进。本轮不访问应用列表或 HAP，不发布版本。

### M2-3 捕获会话所有权与关闭释放

- 2026-10-23 / Codex；在用户授权下从 `e52021a` 继续修复前轮关窗审计缺口。主进程可信 sender/mainFrame 绑定随机 session、按设备串行真实 stop/start；帧含 sessionId/generation 直发原 frame。关闭、导航与崩溃立即失效并用公共 on/off 精确退订，迟到 start 在队列内补偿 stop，旧 token 不影响新会话。getUiDriver 同设备初始化合并，未用 driver.stop 冒充捕获清理。
- 四项新增缺陷回归先全部失败，修复后监听/旧帧投递均为 0；继续覆盖 stop 拒绝/不返回、跨 renderer/设备隔离、其他监听保持、非法 sender 和代次。方案、停止结果 stopped/released/obsolete 语义与边界见[实现报告](docs/maintenance/M2-3-capture-ownership.md)。原探针已升级为当前回归；报告不把本地释放当作远端停止。
- 父对话真实 Electron 无设备检查揭示 closed 早于 webContents destroyed，已按真实失败将释放提前到 BrowserWindow close/closed；[脚本、报告和哈希](docs/maintenance/M2-3-capture-electron.md)随本 PR 整合。未连接手机、读取 HAP/应用清单或运行 HDC，所有传输均为合成。
- 状态 / 下一步：仅完成局部无设备逻辑和 Electron 生命周期边界；M2-2/M2-3 保持进行中。无回复时同设备保持等待，不强制放行新捕获；真实手机停止/投屏、原始应用、长期资源趋势仍待验收。最终候选独立审查、五项必需 CI 与合并由父对话负责，本分支不合并或发布。
- 交付见 [PR #53](https://github.com/MonsterXia/scrcpy-harmony/pull/53)。实现候选 `4b62a1e` 已获 [OpenAI（GPT-6）独立审查](https://github.com/MonsterXia/scrcpy-harmony/pull/53#pullrequestreview-5630332932)，无阻塞发现；独立相关 60/60 与额外三项合成交错通过，整合全量 451/451、lint、三个构建及实际 Electron 8/8 均有归档证据。随后仅补本交接链接；最终提交仍须独立增量复审并通过[五项必需 CI](https://github.com/MonsterXia/scrcpy-harmony/pull/53/checks)才可合并，实际合入状态及提交以 PR 页面为准。此子项的实施和无设备验证完成，阶段的真机与长期验收边界不变。

### 2026-10-23 M2-4 WebView 目标元数据展示

- 真实组件及 Luna grid 回归确认带 favicon 的 title/faviconUrl 经 HTML 拼接解析，标题标签/实体改变显示且图标引号可产生额外属性。基线新增专项 1 通过/5 失败；只将 Webview 的该展示路径改为 DOM 元素、src 属性和文本节点分别构建，保留原图标 URL 语义，不扩展到浏览器 URL 安全策略。[专项报告](docs/maintenance/M2-4-webview-metadata.md)记录证据和边界。
- 修复后新增 6/6，生命周期组合 23/23，禁止共享源码读取时 23/23，全量 430/430、lint、renderer 构建通过；保留现有构建警告。全程合成标题/URL，无脚本执行、外部图片加载、设备/HAP 或真实应用信息访问。
- 下一步：最终提交独立 OpenAI（GPT-6）审查及五项必需 CI 后由主对话决定合并；M2-4 仍进行中，真实 WebView/Chrome 对照、断连恢复和 DevTools 加载未验收，不发布版本。
- [PR #51](https://github.com/MonsterXia/scrcpy-harmony/pull/51) 初始候选 `61026be` 已获 [OpenAI（GPT-6）独立审查](https://github.com/MonsterXia/scrcpy-harmony/pull/51#pullrequestreview-5629990151)，但早期 Ubuntu CI 被既有响应追踪 GC 测试阻塞，不能将本地通过写成首轮 CI 成功。[#52](https://github.com/MonsterXia/scrcpy-harmony/pull/52) 最终 `547147e` 已获 [OpenAI（GPT-6）独立审查](https://github.com/MonsterXia/scrcpy-harmony/pull/52#pullrequestreview-5630067210)，[五项 CI](https://github.com/MonsterXia/scrcpy-harmony/pull/52/checks)通过后合并为 `b755306eb4e388053a0eab2f8ee7321b316793dd`；本分支普通 merge 同步该修复，保留双方 RUNBOOK 记录，WebView 生产改动和专项测试不变。组合专项 41/41、全量 431/431、lint 通过；最终 head 的增量独审和五项 CI 待确认。

### 2026-10-23 响应追踪 GC 回归稳定性

- 基线 `e52021a`；[#51 的 Ubuntu Node 22.23.3 测试日志](https://github.com/MonsterXia/scrcpy-harmony/actions/runs/39972289079/job/120477822545)显示：响应追踪测试在 `disable()` 后单次 GC 的 `arrayBuffers < baseline + 1MiB` 断言失败。Windows Node 22.21.1 原测试 17/17 通过，未在本机复现该偶发失败。进程级 backing-store 计数不能独自证明解析器仍保留引用，没有证据要求修改生产模块。
- 仅调整测试：隔离子进程临时观察实际 16MiB 分配后立即恢复分配函数，分别记录 Buffer 与底层 ArrayBuffer 的 WeakRef；最多 20 轮事件循环/GC 检查两者可回收，跨轮次释放 `deref()` 的临时保活。停用后的 8 个 8MiB 输入亦验证对象和 backing storage 可回收，解析器仍保持存活。取消瞬时全局计数断言，没有扩大允许保留的数据量或删除释放覆盖。
- `node --test test/hdc-response-trace.test.cjs test/hdc-response-summary.test.cjs`：18/18；独立重复 30 轮全部通过（540 项测试）。故障注入分别强持有 partial Buffer、其 backing ArrayBuffer、后续输入 Buffer；三个子进程均在相应 20 轮回收断言以 exit 1 失败，30 轮共 90 次负对照均被捕获。`git diff --check` 通过；全程合成数据、Node 内置依赖，无设备/HDC/HAP 访问。
- 下一步：父对话补已有依赖环境的组合全量验证、独立审查和 Ubuntu CI。当前只证明对象引用可释放，不声称进程 RSS 立即下降、真机长期无泄漏或 M2-2/M2-5 完成；本分支不合并或发布。

### 2026-10-23 捕获修复整合与并行任务合入证据

- 捕获实现分支普通 merge `913cd7ff1996ca10dda740fca434a3e0416ae19f`，只在 RUNBOOK 追加位置冲突并完整保留双方记录；整合父对话真实 Electron 验收脚本。最终组合全量 **451/451**，禁止共享源码读取的捕获专项 **60/60**，lint 及 main/preload/renderer 构建通过；当前本地释放探针各监听/旧帧计数均 0。格式化后的生产源码在实际 Electron 45.0.0 八项检查全部通过，已更新脱敏 JSON 的实际源文件哈希。只验证无设备与 Electron 生命周期，不外推手机捕获停止，M2-2/M2-3 保持进行中。
- [#52 GC 回归稳定性](https://github.com/MonsterXia/scrcpy-harmony/pull/52)最终候选 `547147eff0466dd7cfc8c375fd1bc9ae09e4e417` 已获 [OpenAI（GPT-6）独立审查](https://github.com/MonsterXia/scrcpy-harmony/pull/52#pullrequestreview-5630067210)，[五项必需 CI](https://github.com/MonsterXia/scrcpy-harmony/pull/52/checks)成功后由主对话合并为 `b755306eb4e388053a0eab2f8ee7321b316793dd`。仅测试和记录变更，不证明 RSS 或真机长期无泄漏。
- [#51 WebView 元数据展示](https://github.com/MonsterXia/scrcpy-harmony/pull/51)同步 #52 后的最终 `9a1d726` 已获 [OpenAI（GPT-6）增量独立审查](https://github.com/MonsterXia/scrcpy-harmony/pull/51#pullrequestreview-5630129811)，[五项必需 CI](https://github.com/MonsterXia/scrcpy-harmony/pull/51/checks)全部成功，主对话合并为 `913cd7ff1996ca10dda740fca434a3e0416ae19f`。早期 CI 失败仍保留在原条目；M2-4 真机 WebView/Chrome 对照与断连恢复继续待验收。
- 捕获修复本身的最终独立审查与五项 CI 待 PR 核验，不沿用 #51/#52 的检查替代；本分支不自行合并或发布，未操作手机/HAP/应用清单。

### 2026-10-24 投屏帧率定位与无 Java 视频接入

- 用户反馈卡顿并明确选择 TypeScript/Node.js 复用现有运行时；分支 `codex/screencast-native-video`，基线 `1f0de37`。真机 JPEG 15 秒采样约 9.47–9.87 FPS，降低分辨率也未明显突破；独立发现并修复 UiDriver 合并缓冲区消费错误及 renderer 忙碌时丢弃最后一帧的问题，但这两处不能解释该轮持续约 10 FPS 的源端瓶颈。
- 增加 Node HTTP/2 + protobuf 有限解析的 H.264 通信和 Chromium WebCodecs 解码，复用原会话所有权、Canvas 与触控坐标。当前使用手机预先存在的兼容原生库，复制到随机会话名称启动，只清理自己的进程/转发/副本；无 Java/JAR/JRE，也未引入新的桌面依赖。资源缺失、运行/解码失败或只有配置没有可绘制帧时回退 JPEG。设计、证据与部署限制见[专项记录](docs/maintenance/screencast-video-design.md)。
- 最终真机使用生产 CaptureUiDriver/ScreencastClient：15013 ms 内输入/绘制均 516 帧，均为 **34.37 FPS**，无错误；缩放重启、新客户端重开和停止清理成功。约为早先 JPEG 的 3.5 倍，不能声称锁定 60 FPS或相同内容逐帧 A/B。只归档[统计 JSON](docs/maintenance/screencast-native-video.json)，不保存屏幕或设备标识。结束时本会话原生进程 0、fport 列表为空，手机原始库 MD5 保持不变。
- 新鲜上下文独立审查后修复三处重要异常边界：映射已消失仍阻塞清理、配置流没有首帧而反复启动、探针删除复用映射；补强探针明确验收原生流和缩放后的新帧。应用测试 **488/488**，lint 与 main/preload/renderer 构建通过，真实 Electron 合成生命周期 **8/8**。完整类型检查仍有既有依赖/CSS/Blob 声明错误，Vite 成功不等于类型检查通过；未运行五项远端 CI 或安装包验收。
- 状态/下一步：当前设备的流畅度改进已实测；M2-2/M2-3 的整体长期与重连验收保持进行中。兼容库的可追溯分发/干净设备安装、物理旋转和拔插、长期 CPU/内存/延迟以及跨平台包仍待验证。没有自动覆盖或下载手机库，其他设备缺少兼容库时保持 JPEG。源码和开发构建已更新；本轮不提交、推送、合并或发布版本。

### 2026-10-24 无 Java 原生库自动部署

- 用户要求继续支持没有预装库的手机。固定 HOScrcpy 官方 SDK 1.0.18-beta 归档和六个 ARM64 原生候选库的大小/SHA-256，Node 仅解压指定资源，构建只带 `.so` 与来源/许可文件，不带 JAR/JRE、不执行 Java。来源、流程与限制见[自动部署记录](docs/maintenance/native-video-deployment.md)。
- 正式应用检查 ABI/UITest 和本地资源，上传到独占会话名称并核验手机端哈希；候选失败确认清理后再尝试下一项。成功候选优先复用，停止后删除副本，不覆盖预装库。HDC 错误或进程/文件清理未知时保留 lease，不错误放行。全部不兼容时保留 JPEG 回退。
- 真机临时移走预装库后，自动选中 6.6-20260418 候选并得到 H.264：15004 ms 输入 34.19 FPS、绘制 **34.26 FPS**，无错误，缩放、重开、停止清理和原库恢复校验通过；见[脱敏统计](docs/maintenance/screencast-native-deployment.json)。此前含空格的资源路径亦通过。本测试不是恢复出厂，不等同于所有固件兼容。
- 新鲜独立审查的 HDC 错误误判、探针强制超时丢失恢复、残留 JAR 打包三项均修复并补先失败后通过的回归。应用 **501/501**，Licia 两模式各 **606 passing / 4 pending**，lint、完整 build、真实 Electron 合成生命周期 **8/8** 通过。资源在线下载和 dist 白名单核验通过；未运行远端 CI、安装包安装或 macOS 验收。
- 状态：本轮自动部署与当前设备验收完成，源码和开发构建已更新。下一步扩展固件矩阵，验证物理旋转/拔插、长期 CPU/内存/延迟与跨平台安装包；M2-2/M2-3 长期事项继续进行中。此前仅预装库可用的限制已解除，不将旧阶段描述当作当前行为。未提交、推送或发布版本。

### 2026-10-24 投屏默认窗口比例适配

- 用户反馈默认窗口黑边、需手动调整。根因是主进程固定/恢复窗口宽高，没有跟随实际视频比例；renderer 仅居中缩小 Canvas。新增首帧/比例变化的窗口适配 IPC，测量标题栏与工具栏占用，按当前窗口面积和显示器工作区计算尺寸；相同比例后续帧不反复调窗，保留最大化/全屏状态，低分辨率画面可按比例放大。
- 主进程三个回归与 HTML 全屏保护均先失败后通过；全量应用 **507/507**、lint、main/preload/renderer 构建通过，真实 Electron 合成生命周期 **8/8**。Windows 真机从 500×640 自动调整为 **803×422**，视频 803×360.875、容器 803×361，水平留白 0、垂直舍入差 0.125 像素；详见[验收与剩余边界](docs/maintenance/screencast-window-fit.md)。应用和投屏已为用户重新打开。
- 验收中旧 UITest stopCaptureScreen 回复挂起，使用驱动 stop 与应用 relaunch 后恢复；没有声称修复该独立连接问题。当前布局修复完成，物理旋转、多 DPI/跨显示器、macOS 与旧连接停止可靠性仍待验证。M2-2/M2-3 长期事项保持进行中，未提交或发布。

### 2026-10-24 首帧停止等待与控制连接恢复

- 用户要求修复前轮首帧挂起。运行态与源码确认：native 启动前发出 JPEG stop，普通 RPC 默认无截止，TCP end/error/close 和主动 end 均不拒绝等待者，因而阻塞设备队列。没有当时设备端日志，不声称已确定 SDK 丢失回复的内部原因。
- 配有 nativeVideo 且未尝试 JPEG 时跳过无关 stop，改用只读 getDisplaySize 显式准备控制服务；JPEG 尝试/停止未知继续保留状态。RPC 默认 10 秒、stop 回复 3 秒、TCP 连接 3 秒截止；断线/超时统一销毁旧连接、拒绝等待、清理计时器，下次重建握手。递增请求 ID 避免同一时刻相同命令覆盖；不自动重发结果未知的输入，不把超时视作设备已停。
- 定向 TCP 失败回归先失败后通过，真实静默 stop 约 3 秒结束，第二次重新握手成功；最终应用 **517/517**，Licia 两模式各 **606 passing / 4 pending**，lint、main 构建和真实 Electron 生命周期 **8/8** 通过。第一版省略 stop 后遗漏初始化、真机回退 JPEG 的失败记录保留；补准备后首次 **11.007 秒**、重开 **2.388/2.488 秒**均为 H.264，缩放重启约 **2.9/3.0 秒**成功。见[完整记录与脱敏统计](docs/maintenance/screencast-first-frame-recovery.md)。
- 状态：已修复本轮确认的停止无限等待和原生冷启动依赖，开发构建更新，应用/投屏保持打开并恢复原分辨率比例。首次初始化/兼容库探测仍较慢；HDC 准备总截止、物理拔插、跨平台与长期可靠性继续待验收。M2-2/M2-3 其余事项保持进行中，未提交或发布。

### 2026-10-24 初始化与兼容库探测提速

- 真机分段定位：10.933 秒链路中，控制准备 3.335 秒（含固定等待 2 秒），不兼容候选的无效轮询/清理约 4.234 秒。移除固定 sleep，自己的新 daemon 采用有限握手就绪重试；初始控制服务先验证并复用，失败才重建一次。退出候选连续确认后快速跳过；成功库提示按设备/ABI/UITest/固件/资源清单持久化，仍执行完整性校验与失败回退，无 Java。
- 最终应用 525/525，Licia 两模式各 606 passing / 4 pending，lint、main 构建和真实 Electron 生命周期 8/8 通过。完全重建且无兼容缓存的真机链路 5.591 秒；实际应用重启后可见首帧 2.334 秒、同进程重开 2.042 秒，均 H.264；最终 5 秒绘制约 38.98 FPS。版本查询与控制初始化并发试验曾导致误判，已撤回并保留失败证据。
- 状态：当前设备启动优化和开发构建验收完成，应用/投屏保持开启。新设备/新固件首次适配仍有探测成本，不能称所有场景秒开；首次安装控制 SDK、固件矩阵、物理拔插及长期可靠性待验证，M2-2/M2-3 其余事项保持进行中。详见[分段记录与真实应用验收](docs/maintenance/screencast-start-latency.md)。未提交、推送或发布。

### 2026-10-24 无缓存投屏后台准备

- 对当前选中且在线设备预先准备控制服务、探测并加载原生库；后台不请求视频帧。准备与前台捕获共用设备队列，点击途中复用待完成任务，成功后转移所有权。待用服务最多保留 60 秒，切换/断连/过期清理，不循环预热；接管前核对本会话进程，防止使用过期转发误连其他 socket 所有者。无新 renderer IPC，无 Java。
- 退出及应用重启等待准备和活动 capture 清理；共享 relaunch 改走 app.quit，主窗口真退出不再只隐藏。测试覆盖迟到准备、清理失败阻塞、接管后过期不误停、断连、退出等待和过期进程检查。
- 最终应用 538/538、lint、main 构建、真实 Electron 生命周期 8/8 通过；Licia 两模式本轮各 606 passing / 4 pending。真机强制重建且无缓存：后台 5.353 秒、接管至编码包 361 ms；最终实际应用无缓存预热后点击至可见画面 603 ms，H.264 约 38.59 FPS。60 秒过期后资源无残留，重开 2.048 秒；活动投屏中重启确认旧资源清理。见[完整记录与不同计时口径](docs/maintenance/screencast-preparation.md)。
- 状态：当前设备快开与资源生命周期验收完成，应用/投屏已打开；并非所有首次冷工作只需 0.6 秒。刚连接立即点击仍等剩余准备，其他固件、首次控制 SDK 安装、物理拔插、长期功耗及 HDC 准备总截止待验证。M2-2/M2-3 其他事项继续，未提交或发布。

### 2026-10-24 投屏工具栏默认隐藏

- 常驻工具栏改为右上角「⋯」按需展开，浮层不占画面高度、不引起窗口反复适配，窄窗口自动换行；保留原功能和异步文本输入保护。用户指出首版透明背景难辨，补充有底色的毛玻璃、清晰图标、边框和阴影。
- 定向测试 24/24、lint 与 renderer 构建通过；实际 Electron 验证 H.264、展开/收起画面矩形不变和 320px 窄窗口功能可见，开发构建更新。见[工具栏记录](docs/maintenance/screencast-toolbar.md)。当前 Windows 已验证；macOS、多 DPI 与 M2 长期事项仍待验证，未提交或发布。

- 同日工具栏视觉跟进：按用户进一步澄清，把整条面板作为统一毛玻璃表面，底色降低到浅色 64% / 深色 68%，模糊提高至 24px，内部工具栏透明、图标保持清晰。本轮 SCSS renderer 构建与实际 Electron 样式/截图检查通过，仍为 H.264；见上述工具栏记录补充，其他平台待验收。

### 2026-10-24 投屏工具栏延时收起

- 鼠标离开工具区 2 秒自动收起，返回取消；输入等待、选择框编辑、键盘操作保持展开，普通鼠标焦点不阻止收起，卸载清理计时器。
- 定向测试 28/28、lint、renderer 构建通过，实际 Electron H.264 验证收起不改变画面几何；移回取消经 DOM 事件和带事件追踪的原生输入复核通过。首轮原生输入未取消的差异保留在[记录](docs/maintenance/screencast-toolbar.md)，不外推为全平台验收。开发构建已打开，未提交或发布。

### 2026-10-24 投屏展开入口自动隐藏

- 面板收起后，右上角入口空闲 2 秒也隐藏，鼠标到右上角 48×48 区域时显示；保留键盘焦点入口。隐藏状态不接收指针，不用透明层遮住手机画面。
- 定向测试 30/30、lint、renderer 构建通过；实际 Electron 原生鼠标序列验证隐藏、角落唤起/停留、点击展开、两阶段收起与 Canvas 命中恢复。详见[交互记录](docs/maintenance/screencast-toolbar.md)。开发构建已打开，其他平台待验收，未提交或发布。

### 2026-10-24 投屏工具栏淡入淡出

- 工具栏和入口增加 160ms 淡入淡出；收起时立即禁用输入，面板完成淡出后隐藏；快速切换平滑反向，尊重减少动态效果设置。
- 定向测试 30/30、lint、renderer 构建通过；实际 Electron 采到两者淡入/淡出中间透明度，反向切换、inert、隐藏穿透和减少动态效果均验证。开发构建已打开；首帧探针超时后 Canvas 随后出现，本轮不作启动性能结论。详见[交互记录](docs/maintenance/screencast-toolbar.md)。未提交或发布。

### 2026-10-24 视频帧率提升与意外 JPEG 降级

- 原应用约 34 FPS，接收与绘制匹配且无解码积压；原生帧率请求从 60 调至 120，同分辨率实际应用 15 秒接收/绘制均 **60.12 FPS**，无流错误/解码重启。请求目标不代表实际 120 FPS，无 Java 或分辨率降低。
- 独立探针与用户打开应用时间重叠，实际出现 JPEG 约 10 FPS；最可能是固定视频 socket 争用，但旧日志丢失底层原因，不能声称已追溯确认。停止独立探针，后续只通过实际应用验证。修正一次流中断立即永久 JPEG 的逻辑：每客户端先重连一次 H.264，再次失败或真正解码不支持仍回退，并补原因日志。
- 定向回归 **80/80**、lint、main/renderer 构建和实际 Electron 合成生命周期 **8/8** 通过。实际应用中断自己的视频 TCP 连接后 **2695 ms** 恢复 H.264、generation 递增、JPEG 0；采样钩子/临时调试器已清理，更新的应用保持投屏。见[完整证据及失败记录](docs/maintenance/screencast-fps-tuning.md)。
- 当前设备帧率和一次中断恢复已验收；本轮未重跑全量/远端 CI，不代表物理拔插、长期功耗或所有固件通过。下一步继续这些边界验收，M2 长期事项仍进行中。未提交、推送或发布。

### 2026-10-24 工具栏入口移至标题栏

- 按用户截图将入口移到左上角标题栏，展开面板左对齐；保留毛玻璃、自动隐藏与过渡。入口 portal 脱离视频裁剪，唤起区域仅在标题栏内，不遮手机内容，保留其余拖动区。
- 定向 30/30、lint、renderer 构建通过；实际 Electron H.264 验证原生鼠标唤起/展开/两阶段隐藏、Canvas 几何不变及 320px 窄窗口。详见[工具栏记录](docs/maintenance/screencast-toolbar.md)。应用已更新并打开，调试器关闭。macOS、多 DPI 与系统级拖窗待验收，M2 长期事项未改变，未提交或发布。

### 2026-10-24 分辨率选择框样式与说明

- 投屏选择框使用可样式化原生 picker，与毛玻璃面板统一；小数显示改为百分比，增加原尺寸标注与宽高比例/H.264 档位取整说明，保持实际值和捕获算法。
- 定向30/30、lint、renderer构建通过；实际Electron检查深浅主题截图、展开时暂停收起，鼠标选择50%→1206×542、100%→2412×1084。已恢复100%并保持投屏，详见[工具栏记录](docs/maintenance/screencast-toolbar.md)。其他平台未验收，无提交或发布。

- 后续按用户要求只保留「原画 / 流畅」，对应1/0.5。加载旧比例时按原H.264档位映射，非法值默认原画；同档位不重启，实际切换只存规范值。新增配置兼容回归后定向33/33、lint、renderer构建通过，实际应用鼠标切换得到2412×1084/1206×542，最终保持原画H.264。记录同上；未重测FPS或其他平台，未提交或发布。

### 2026-10-24 投屏实时状态与控件对齐

- 展开工具栏显示实际H.264/JPEG和Canvas绘制FPS，每秒按实际间隔更新；首帧等待、generation重置、零帧及收起/卸载均处理，不添加捕获或IPC。状态与画质成组换行。
- 定向63/63、lint、renderer构建通过。真机H.264显示约60 FPS与独立绘制统计60.31 FPS一致，后续内容变为约30 FPS时如实更新；JPEG显示经无设备生产客户端回归，未强制真机降级。原生鼠标稳定窗口序列验证2秒/4秒隐藏及停采样，320px布局可用，保留早期resize合成序列差异。详见[工具栏记录](docs/maintenance/screencast-toolbar.md)。
- 按用户追加反馈修复Luna/Chromium双箭头叠加，统一28px高度与垂直中心；最终实际截图和几何核对一致。开发构建已打开；其他平台、长期性能与M2事项继续待验收，无提交或发布。

### 2026-10-25 投屏键盘与电脑到手机粘贴

- 用户要求独立审查后修复四项确认问题：剪贴板等待卡住输入队列、会话关闭/换代漏抬手、取消右键菜单后失焦、原生编辑菜单全选/删除未转发。应用 **578/578**、Licia 两模式各 **606 passing / 4 pending**、lint、三部分构建和实际 Electron 生命周期 **8/8** 通过；最后菜单类型调整后定向 **26/26** 再通过。完整类型检查仍被其他文件既有诊断阻挡，未标为通过。范围、真机证据及下一步见[独立审查记录](docs/maintenance/screencast-input-review.md)。

- 用户进一步要求删除工具栏 T：已移除按钮、弹窗状态及闲置 `inputText` IPC/桥接/类型；文本统一走键盘和融合粘贴。相关 **25/25**、lint、三部分构建、实际 Electron 生命周期 **8/8** 通过，真实应用确认无 T 且新键盘入口保留，已重开投屏。同步删除已移除弹窗专属测试，未重跑全量或重新操作剪贴板；见[工具栏记录](docs/maintenance/screencast-toolbar.md)。

- 后续按用户要求融合常规快捷键：Ctrl+C/X 成功后 Ctrl+V 使用手机剪贴板，电脑剪贴板文本变化后切换电脑来源；右键提供复制/剪切/自动粘贴和明确的电脑/手机粘贴入口。新增 6 项回归，最终应用 **585/585**、Licia 两模式各 **606 passing / 4 pending**、lint 和 renderer 构建通过；当前 Windows 真机验证常规复制/剪切粘贴、电脑文本切换、空电脑剪贴板及菜单来源回调，本次测试电脑剪贴板恢复成功。见[融合验证统计](docs/maintenance/screencast-input-fusion-verification.json)。实体手机直接复制和电脑重复复制相同文本仍需菜单手动指定，不等于实现手机到电脑同步；跨平台待验收。

- 后续用户明确授权清理 `dist/input-research` 临时文件、保留验证记录；路径/链接检查和 10 份 JSON/日志哈希核验完成，但删除命令仍被自动审批拒绝（仅返回 `blocked by policy`），清理未完成。实验文件约 393 MB 保留原处；记录与校验清单位置见下方验收文档。

- 点击手机输入框后直接打字，支持 IME 提交、方向/删除/选区快捷键、Ctrl+V 电脑纯文本粘贴；Ctrl+C/X 在手机内复制/剪切，Ctrl+Shift+V 粘贴手机剪贴板。全屏包含输入 textarea 并按容器适配 Canvas。会话所有权、取消、有限队列、10 秒截止及安全编码覆盖键盘和触摸顺序，输入正文不写参数日志。
- 最终应用 **579/579**，Licia 两模式各 **606 passing / 4 pending**，lint、main/preload/renderer 构建及实际 Electron 合成生命周期 **8/8** 通过。当前 Windows 真机验证选区替换、退格/Home/Delete、中文/表情/特殊符号粘贴、手机复制剪切与粘贴、全屏逐字符输入；已清空测试搜索文本，开发应用保持打开。详见[键盘与剪贴板记录](docs/maintenance/screencast-input.md)。
- 手机到电脑复制的原生助手被设备签名检查拒绝；用户确认无签名环境并明确暂缓，此项未完成、无辅助程序随包。下一步为已签名助手、macOS/其他固件、真实中文候选窗、多行与长文本验收。早期验收脚本未能恢复原电脑剪贴板，已说明并保留记录；生产粘贴不调用该测试 API。M2 长期事项未改变，未提交、推送或发布。

### 2026-10-24 Sourcery PR 字符上限提示清理

- 用户授权将 `Sorry @MonsterXia, your pull request is larger than the review limit of 150,000 diff characters` 也加入原超额度 Action；实际模板取自 PR #56 评论 `6386033835`。
- 在原 `sourcery-quota-comments.yml` 的整段正文白名单中增加第二种模板，数字上限可变；共用原作者/PR 校验、删除前重新读取与手动单 ID 入口，没有新工作流或定时任务。正常审查、带附加意见的混合正文及未知模板保留。
- 新增回归测试先在旧规则得到 4 项失败，再扩展规则后专项 55/55 通过；覆盖 created/edited、手动补清、不同上限、人类/其他 Bot/不同账号、混合正文及过期事件。`git diff --check` 通过。
- 下一步：本修复 PR 五项必需 CI 全部通过后合入；用默认分支 Actions 实际补清已有同类提示，核对正常评论正文哈希。最终合并与真实删除证据记录于本修复 PR，未以本地单测替代上线验收。
