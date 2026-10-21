# Scrcpy Harmony 分阶段维护 RUNBOOK

本文件是后续维护的执行入口。初始基线为 2026-10-21 合入 PR #8 后的 `d672f8954d96ad3511527d074d312077fa8e4eee`；日期按 Asia/Hong_Kong。来源状态是当日快照，完整条目索引见 [维护来源记录](docs/maintenance/SOURCES.md)。

## 使用方式与完成标准

1. 从最早未完成阶段选择一项，在下方记录负责人、分支、基线提交和复现环境。没有目标设备时，可先做无设备验证，将真机验收保留为待办。
2. 读取来源正文/讨论并核对当前代码。上游开放 Issue 是报告，上游开放 PR 是候选方案；先复现或建立失败用例，再决定适配方式，不直接批量合入。
3. 每个独立问题使用小范围 PR。实现后执行与改动相关的检查，并等待该 PR 的必需 CI 检查通过；流程见 [开发与验证](.agents/skills/scrcpy-harmony-project/references/development.md)。
4. 在本文件更新任务状态、证据链接和剩余限制。只有满足该项验收条件才标记完成；PR 合并但缺少设备回归时，标为“待验收”。
5. 若无法复现，记录版本、步骤、持续时间和观察结果；若缺少设备/权限，记录阻塞条件及下次动作。不要以“未复现”直接代替“已修复”。

状态采用：**待开始 / 进行中 / 待验收 / 已完成 / 阻塞 / 暂缓**。阶段可以按依赖拆分推进；阶段 4 的功能须单独确定范围。以下验收要求是待执行计划，不是已有测试结果。

## 当前已完成基线

- [x] 触控坐标映射修复已通过 [本仓库 PR #1](https://github.com/MonsterXia/scrcpy-harmony/pull/1) 合入；对应 [上游 PR #33](https://github.com/liriliri/echo/pull/33)。报告机型的剩余回归见阶段 2。
- [x] 项目导航、锁文件、Electron 45、Windows 构建及三个平台 CI 已通过本仓库 PR #2–#7 合入，详情见来源索引。
- [x] [PR #8](https://github.com/MonsterXia/scrcpy-harmony/pull/8) 完成 Scrcpy Harmony 更名、独立应用 ID、仓库链接和更新源配置。
- [x] PR #8 的 [CI 运行](https://github.com/MonsterXia/scrcpy-harmony/actions/runs/39611929271) 中，test、lint、Windows、macOS arm64/x64 打包安装启动检查全部通过。这不代表签名、公证、真机兼容性或线上更新已验收。
- [x] 2026-10-21 备份 PR、Issue、讨论、附件与 Git 历史后解除 fork。仓库仍为 `MonsterXia/scrcpy-harmony`，现有 8 个 PR 在解除后保留；原作者与 AGPL-3.0 许可证保留。

## 阶段 0：维护入口与首次独立发布

目标：确保反馈入口可用，并建立可验证的独立发行流程。当前阶段状态：**待开始**。

| ID | 状态 | 工作项 | 验收条件 |
| --- | --- | --- | --- |
| M0-1 | 待开始 | 启用本仓库 Issues，核对 About、主页和反馈入口 | 仓库 Issues 可访问；应用内反馈能进入本仓库；About 不再将用户引向上游下载页。基线时 Issues 关闭，本次文档更新未修改 GitHub 设置。 |
| M0-2 | 待开始 | 准备首次独立 Release，确定新版本号 | 包元数据、锁文件、CHANGELOG 和 tag 一致；三个平台安装与启动检查通过；逐项说明签名、公证及真机验证状态；向用户说明旧 ECHO 配置不自动迁移。 |
| M0-3 | 待开始 | 验证实际更新检查与下载入口 | 使用两个明确版本的已打包应用和本仓库 Release，验证“有更新 / 无更新 / 网络或元数据错误”；Windows、macOS arm64、macOS x64 读取各自元数据并跳转本仓库 Releases。记录具体文件名和日志，不能只凭单测通过勾选。 |

操作入口：`package.json`、`script/pack.mjs`、`.github/workflows/build.yml`、`src/main/lib/updater.ts`、`src/renderer/main/App.tsx`。手动 Build workflow 只生成并上传 artifact，不创建 Release。更新功能当前提示用户打开 Releases 下载，不执行自动下载安装。

退出条件：反馈入口和首个独立发行版可用，线上更新检查有实际验证记录。发布前出现问题时保留诊断，修复后用新版本重新验收。

## 阶段 1：设备与应用数据读取健壮性

目标：单个异常设备或应用不会使整个列表消失。当前阶段状态：**待开始**。

| ID | 状态 | 来源与工作项 | 验收条件 |
| --- | --- | --- | --- |
| M1-1 | 待开始 | [Issue #21](https://github.com/liriliri/echo/issues/21)、[PR #30](https://github.com/liriliri/echo/pull/30)：设备枚举异常隔离及版本字段兼容 | 同时存在有效设备和读取失败设备时，有效设备仍显示；缺失/不同格式版本字段不使整个列表失败；空列表与全部失败可诊断；连接、断开、重连通过目标设备验证。 |
| M1-2 | 待开始 | [PR #31](https://github.com/liriliri/echo/pull/31)：逐应用处理 `bm dump` 失败 | 有效 JSON、错误文本、缺失主模块、命令失败混合输入时正常应用仍可见，结果与 bundleName 不错位；失败项有可定位日志；安装/卸载后的列表刷新正常。 |
| M1-3 | 待开始 | [Issue #24](https://github.com/liriliri/echo/issues/24)、[PR #29](https://github.com/liriliri/echo/pull/29)：侧载应用名称与图标 | 验证本地 label/iconPath 的实际格式与可读性；侧载应用可显示名称和图标；本地资源缺失、不可读或离线时有合理回退；商店应用仍正常。 |

代码入口：M1-1 为 `src/main/lib/hdc.ts` 的 `getTargets`；M1-2/3 为 `src/main/lib/hdc/bundle.ts` 的 `getBundleInfos`，UI 为 `src/renderer/main/components/application/`。

基线检查发现 `getTargets` 使用整体 `Promise.all(...).catch(() => [])`，`getBundleInfos` 在集中解析时直接 `JSON.parse`，名称/图标主要依赖线上信息。先完成 M1-2 再适配 M1-3，避免同时改动相同解析流程。

退出条件：每项有真实代码路径的无设备回归测试、对应设备验收、通过的 CI 和合并 PR；若设备暂缺，停留在“待验收”。

## 阶段 2：投屏、长时间运行与连接回归

目标：补足实际设备和长时间运行证据。当前阶段状态：**待开始**。

| ID | 状态 | 来源与工作项 | 验收条件 |
| --- | --- | --- | --- |
| M2-1 | 待验收 | [#26](https://github.com/liriliri/echo/issues/26)、[#27](https://github.com/liriliri/echo/issues/27)：触控坐标修复后的机型回归 | 记录 Mate 80 / HarmonyOS 6.1.0.117 或实际替代版本，以及 1920×1080 横屏设备；验证四角、中心、拖动、缩放、旋转和断开重连。已有修复不等于这些机型已通过。 |
| M2-2 | 待开始 | [#22](https://github.com/liriliri/echo/issues/22)：长时间空闲后卡死 | 先记录可复现的等待时间、设备和访问过的面板；采集主进程/renderer 日志、CPU/内存变化；修复后运行至少原复现时长，并检查切换设备、关闭投屏后的监听/定时器释放。 |
| M2-3 | 待开始 | [#12](https://github.com/liriliri/echo/issues/12)：特定应用投屏卡死或闪退 | 对比普通应用与抖音，记录应用/系统版本及捕获日志；区分捕获接口错误、客户端异常和受保护内容限制；错误时界面可恢复，正常投屏不回退。 |
| M2-4 | 待开始 | [#19](https://github.com/liriliri/echo/issues/19)：WebView 调试目标为空 | 以 Pura 70 Pro / 5.1.0.150（API 17）原报告为线索，核对 socket、端口转发和 `/json`；官方调试方法能发现的目标在应用中也可见，空目标及断连可恢复。 |
| M2-5 | 待开始 | [#13](https://github.com/liriliri/echo/issues/13)：网络调试连接 | 明确系统版本、HDC 版本、配对与连接前提，比较命令行和应用设备列表；验证 USB/网络连接、断连重连及失败提示，记录不支持的系统范围。 |

入口：`src/renderer/screencast/lib/ScreencastClient.ts`、`src/main/lib/hdc/uitest.ts`、`src/renderer/main/App.tsx`、`src/main/lib/hdc/webview.ts`、`src/main/lib/hdc.ts`。M2-4/5 应在 M1-1 后复验，避免把设备枚举失败误判为调试协议问题。

退出条件：每项具有复现和修复后证据，或明确的支持范围/无法复现记录与后续动作。CI 无设备启动检查不能替代本阶段。

## 阶段 3：显示适配与用户文档

目标：改善小屏显示并提供可照做的操作说明。当前阶段状态：**待开始**。

| ID | 状态 | 来源与工作项 | 验收条件 |
| --- | --- | --- | --- |
| M3-1 | 待开始 | [#28](https://github.com/liriliri/echo/issues/28)：小分辨率窗口和黑边 | 记录桌面分辨率、DPI、设备方向与窗口尺寸；检查最小窗口、工具栏、纵横比例和输入坐标；调整布局后重跑投屏坐标回归。 |
| M3-2 | 待开始 | [#32](https://github.com/liriliri/echo/issues/32)：中文字体锯齿 | 分开采集应用 UI 与设备投屏文字，记录系统缩放和显示器；确认问题发生于字体渲染还是捕获缩放，提供同条件前后截图。息屏诉求见 M4-4。 |
| M3-3 | 待开始 | [#14](https://github.com/liriliri/echo/issues/14)、[#20](https://github.com/liriliri/echo/issues/20)：用户与构建说明 | 覆盖安装、开发者选项/调试授权、设备选择、投屏/输入、日志导出、常见失败和旧配置边界；按文档在干净环境走通构建。说明应用依赖 Electron 主进程，Vite 页面不能独立作为浏览器版使用。 |

入口：`src/main/window/screencast.ts`、`src/renderer/screencast/components/`、`src/renderer/main.tsx`、`README.md` 与开发指南。开发指南已经存在，但不能据此将普通用户操作文档标为完成。

退出条件：约定的分辨率/DPI 组合有验收记录，文档命令和截图与当期发行版一致。

## 阶段 4：新功能逐项评估

此阶段初始状态均为**待评估**，不因列入清单而自动承诺实现。每项先记录能力验证、权限、支持版本和最小范围，再安排独立实现与验收；无法支持时记录依据。

| ID | 来源 | 评估与验收方向 |
| --- | --- | --- |
| M4-1 | [#25](https://github.com/liriliri/echo/issues/25)：音频转发 | 验证 HarmonyOS/HDC 是否有可用音频捕获路径，再确定同步、延迟、断连恢复及权限范围。 |
| M4-2 | [#23](https://github.com/liriliri/echo/issues/23)：电脑复制文本到设备 | 现有投屏工具栏已有文本输入；先复现复制/粘贴与该入口的差别，再定义快捷键、中文、多行输入和失败反馈。 |
| M4-3 | [#15](https://github.com/liriliri/echo/issues/15)：文件下载 | 验证目标目录权限及 HDC 文件传输能力，再定义选择文件、进度、取消、重名处理和失败恢复。 |
| M4-4 | [#32](https://github.com/liriliri/echo/issues/32)：连接后手机息屏 | 验证息屏后捕获与输入是否继续可用；区分熄屏、锁屏和黑屏效果，确定用户唤醒及断连恢复行为。 |
| M4-5 | [#16](https://github.com/liriliri/echo/issues/16)：与 AYA 合并、跨平台及多实例 | 先分别确定产品范围、平台和多设备需求；当前共享启动模块有单实例限制，不能将移除该限制视为完整多实例支持。 |

退出条件：每项有独立的“实施 / 暂缓 / 不支持”决定及依据；选择实施的项目另列验收条件和 PR，不与阶段 1 的缺陷修复混合。

## 历史事项与关闭复核

上游已关闭的 Issue #1–#11、#18 及 PR #17 保留在 [来源记录](docs/maintenance/SOURCES.md)，不自动加入当前缺陷队列，也不代表本项目已复测。出现相同症状时建立上述任务的新记录，并注明原条目。修复本仓库不等于关闭上游 Issue，不代替上游维护者修改其状态。

## 进度与交接记录

每次推进先更新阶段表中的状态，再在这里追加一条记录；证据优先链接到本仓库 PR、CI、可访问日志或仓库文件，避免只有个人电脑绝对路径。

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
