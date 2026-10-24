# 维护来源记录

记录日期：2026-10-21（Asia/Hong_Kong）。用于 [RUNBOOK](../../RUNBOOK.md) 的来源追踪；状态是归档时快照，后续实施以当前源码和新证据为准。

后续验收归档：2026-10-23 的 [M2-2 完整概览 IPC 与失败恢复](M2-2-overview-live.md)包含基线和正式候选的脱敏 JSON、构建身份及可重复步骤。它是本仓库新增验收证据，不改变以下原始来源快照。

后续 [M2-2 / M2-5 物理断连与空闲记录](M2-2-physical-idle.md)保留人工 USB 拔插的失败及成功轮次、明确时长的空闲观察和资源采样；不能将单次成功或并行代码合入认定为长期空闲问题已解决。

[后续重连诊断](M2-2-reconnect-diagnostics.md)增加命令级脱敏时序、响应分类与 USB 模式选择的用户观察；只证明本轮短暂未就绪后恢复，前两轮失败根因仍未确定。

后续 [M2-2 / M2-3 主进程关窗审计](M2-3-main-capture-close.md)记录窗口引用的小修复及仍未解决的捕获监听/所有权缺口；证据仅为真实主进程逻辑加合成 Electron/transport 边界，不是真机关窗或停止验收。

该缺口的后续[捕获会话所有权修复](M2-3-capture-ownership.md)与[实际 Electron 无设备验收](M2-3-capture-electron.md)补充了本地退订、旧 owner 隔离、真实窗口/IPC 生命周期证据；永久不返回的设备队列和真机停止确认仍有明确保留边界。

## 备份范围与读取方式

2026-10-24 [依赖源码迁移](dependency-sources.md)的上游版本、gitHead、归档与导入文件哈希见 [vendor/manifest.json](../../vendor/manifest.json)；18 个包的 LICENSE 与原始 package.json 随源码保存。共享源码保留原固定提交来源，不再依赖子模块下载。

迁移后的日常入口为中英文 README、[仓库结构指南](../repository-guide.md)、[构建指南](../build-guide.md)和 [Licia 维护说明](../../vendor/packages/licia/MAINTENANCE.md)。这些文档随当前源码维护；下列上游归档、旧版本发行及验收记录保留其当时的目录和命令，不作为当前构建步骤。

后续依赖迁移前恢复节点见 [1.0.3 发布记录](../releases/1.0.3.md)：功能基线 `8087ac8`，发布完成后以固定 tag、三平台安装包及校验清单恢复。该节点与下述解除 fork 历史备份分别保留。

解除 fork 前归档了本仓库 8 个 PR、上游 28 个 Issue 和 5 个 PR，共 41 个条目。保存内容包括正文、讨论评论、PR 审查、行内线程解决状态、提交和文件信息，以及 7 个附件；两个仓库当时均未启用 GitHub Discussions。

完整备份名称为 `2026-10-21-before-detach.zip`，由维护者保存于仓库旁的 `scrcpy-harmony-backups/` 目录，未提交进本仓库。ZIP 内含 `README.md`、`CHECKLIST.md`、`local/`、`upstream/`、`attachments/`、`repository.bundle`、`SHA256SUMS.json` 和 `AFTER-DETACH.json`。Git bundle 还包含上游 5 个 PR 的提交引用。

该 ZIP 的 SHA-256：`a8d258d88103fbe6a3f53b5b5710e2a0711bf43ccbe80d12b0b87950ab143a08`。这标识归档原件；后续重新生成的 ZIP 需重新记录校验值。

仓库内 RUNBOOK 已保留任务摘要、代码入口和验收条件，并链接公开原始记录，因此可以独立使用。需要完整离线讨论或附件时向维护者获取上述归档，按 `SHA256SUMS.json` 校验解压后的文件。不要把本机备份路径当作所有贡献者均可访问的路径。

## 上游 Issue

| 编号 | 归档状态 | 标题 / 原始记录 |
| --- | --- | --- |
| #1 | 已关闭 | [这个有支持远程投屏操作吗](https://github.com/liriliri/echo/issues/1) |
| #2 | 已关闭 | [MAC M1Pro 安装打开抱错](https://github.com/liriliri/echo/issues/2) |
| #3 | 已关闭 | [windows版本hdc.exe依赖libusb_shared.dll](https://github.com/liriliri/echo/issues/3) |
| #4 | 已关闭 | [macos的arm64打开提示文件已损坏](https://github.com/liriliri/echo/issues/4) |
| #5 | 已关闭 | [权限问题](https://github.com/liriliri/echo/issues/5) |
| #6 | 已关闭 | [openharmony 4.1 无法发现设备，能否支持openharmony 4.1的设备？](https://github.com/liriliri/echo/issues/6) |
| #7 | 已关闭 | [流畅度有待提高一下](https://github.com/liriliri/echo/issues/7) |
| #8 | 已关闭 | [Windows 上卸载后没有清理 C:/Users/username/AppData/Local/echo-updater](https://github.com/liriliri/echo/issues/8) |
| #9 | 已关闭 | [不支持openharmony横屏设备投屏](https://github.com/liriliri/echo/issues/9) |
| #10 | 已关闭 | [投屏时鼠标轨迹线能取消显示吗？](https://github.com/liriliri/echo/issues/10) |
| #11 | 已关闭 | [relase包命名有误](https://github.com/liriliri/echo/issues/11) |
| #12 | 开放 | [投不了抖音，投抖音会卡死闪退](https://github.com/liriliri/echo/issues/12) |
| #13 | 开放 | [网络调试无法连接](https://github.com/liriliri/echo/issues/13) |
| #14 | 开放 | [使用文档](https://github.com/liriliri/echo/issues/14) |
| #15 | 开放 | [能否实现下载鸿蒙设备上的文件](https://github.com/liriliri/echo/issues/15) |
| #16 | 开放 | [有考虑把Echo 和 AYA合并吗？ 一个项目支持三个平台](https://github.com/liriliri/echo/issues/16) |
| #18 | 已关闭 | [harmonyOS 5.1.0 无法发现设备](https://github.com/liriliri/echo/issues/18) |
| #19 | 开放 | [【部分鸿蒙设备】网页Tab下调试列表没有内容。](https://github.com/liriliri/echo/issues/19) |
| #20 | 开放 | [How to compile?](https://github.com/liriliri/echo/issues/20) |
| #21 | 开放 | [工具扫描不到设备](https://github.com/liriliri/echo/issues/21) |
| #22 | 开放 | [启动后静默不操作较长一段时间会出现卡死！](https://github.com/liriliri/echo/issues/22) |
| #23 | 开放 | [投屏功能未支持从window直接复制内容（文本）到输入框](https://github.com/liriliri/echo/issues/23) |
| #24 | 开放 | [个人应用存在读取不到应用图标问题](https://github.com/liriliri/echo/issues/24) |
| #25 | 开放 | [投屏时没有捕捉声音](https://github.com/liriliri/echo/issues/25) |
| #26 | 开放 | [最新1.0.1版本在华为mate 80的6.1.0.117版本上运行时，发现无法点击（投屏的上半区域能点，但是左边也是错误，下半区域都是无法点击成功）](https://github.com/liriliri/echo/issues/26) |
| #27 | 开放 | [点击偏移](https://github.com/liriliri/echo/issues/27) |
| #28 | 开放 | [显示异常](https://github.com/liriliri/echo/issues/28) |
| #32 | 开放 | [首先感谢! 中文字体显示有锯齿.另外,能连接成功后让手机屏幕息屏吗?](https://github.com/liriliri/echo/issues/32) |

## 上游 PR

| 编号 | 归档状态 | 标题 / 原始记录 |
| --- | --- | --- |
| #17 | 关闭未合并 | [fix: get display resolution failed](https://github.com/liriliri/echo/pull/17) |
| #29 | 开放 | [fix: show icons for sideloaded / personal Harmony apps](https://github.com/liriliri/echo/pull/29) |
| #30 | 开放 | [fix: show hdc devices when one target fails to parse](https://github.com/liriliri/echo/pull/30) |
| #31 | 开放 | [fix: keep listing apps when one bm dump fails](https://github.com/liriliri/echo/pull/31) |
| #33 | 开放 | [fix: map screencast touches using actual device display size](https://github.com/liriliri/echo/pull/33) |

上游 PR #33 在上游仍开放，但相同触控坐标修复已通过本仓库 PR #1 合入；两边状态分别记录。

## 本仓库 PR

| 编号 | 归档状态 | 标题 / 原始记录 |
| --- | --- | --- |
| #1 | 已合并 | [fix: 修复鸿蒙投屏触控坐标偏移并明确分辨率比例](https://github.com/MonsterXia/scrcpy-harmony/pull/1) |
| #2 | 已合并 | [docs: 建立项目基础 skill 和 AGENTS 入口](https://github.com/MonsterXia/scrcpy-harmony/pull/2) |
| #3 | 已合并 | [ci: 添加 PR test/lint 必需检查并升级 Electron 45](https://github.com/MonsterXia/scrcpy-harmony/pull/3) |
| #4 | 已合并 | [fix: remove Bash dependency from Windows distribution builds](https://github.com/MonsterXia/scrcpy-harmony/pull/4) |
| #5 | 已合并 | [ci: require Windows installer packaging on pull requests](https://github.com/MonsterXia/scrcpy-harmony/pull/5) |
| #6 | 已合并 | [ci: verify installed Windows application startup on PRs](https://github.com/MonsterXia/scrcpy-harmony/pull/6) |
| #7 | 已合并 | [ci: verify macOS packaging and startup on arm64 and Intel](https://github.com/MonsterXia/scrcpy-harmony/pull/7) |
| #8 | 已合并 | [将应用更名为 Scrcpy Harmony 并建立独立发布入口](https://github.com/MonsterXia/scrcpy-harmony/pull/8) |

## 本地性能专项

2026-10-24 投屏低帧率专项的来源、原生接口参考与本机实测见[无 Java 视频记录](screencast-video-design.md)，最终[脱敏帧计数](screencast-native-video.json)。它是当前工作分支的证据，不代表已发布版本或其他设备兼容性。

同日后续[原生库自动部署记录](native-video-deployment.md)补充官方归档来源、固定资源清单、独立审查处理及原库缺席验证；[部署后脱敏帧计数](screencast-native-deployment.json)对应正式上传的候选库，不沿用第一阶段预装库数字。

用户实测后的[窗口比例适配记录](screencast-window-fit.md)包含默认黑边根因、首帧自动调整及[真机几何与计数](screencast-window-fit.json)，保留重启过程中停止请求挂起的独立边界。

后续[首帧等待修复](screencast-first-frame-recovery.md)定位冗余 JPEG stop、控制服务隐式初始化和 TCP 未结算请求，记录故障回归及[最终真机打开/重开/缩放计数](screencast-first-frame-recovery.json)。

## 解除 fork 的核验

解除前后仓库 ID 均为 `1426959270`；解除后 API 返回 `fork: false` 且不再包含 parent；master 保持为 `d672f8954d96ad3511527d074d312077fa8e4eee`，原有 8 个 PR 仍可访问。平台元数据可能丢失的事前警告，没有在这 8 个 PR 上发生。

基线时本仓库无独立 Issue，Issues 功能关闭。该状态按归档快照保留；2026-10-21 已通过 M0-1 启用 Issues，并修正 GitHub About 与主页链接，当前验收结果见 [RUNBOOK](../../RUNBOOK.md#m0-1-验收记录)。

## 2026-10-24 投屏初始化耗时证据

[启动优化记录](screencast-start-latency.md)汇总真实分段探针、控制初始化并发失败记录和最终 Electron 可见首帧/FPS。基线约 10.93 秒；最终完全重建无缓存链路 5.59 秒，实际应用复用健康控制及兼容提示后首帧 2.33 秒。来源是本机生产模块、实际应用及已连接真机，不代表全新手机或其他固件已通过。

## 2026-10-24 无缓存后台准备

[后台准备与点击验收](screencast-preparation.md)：生产模块强制重建、独立缓存探针的准备时间/取流次数/CPU ticks，与实际 Electron 点击至 Canvas、TTL 清理、活动重启及 FPS 分开记录。最终应用点击 603 ms，后台准备耗时并未消失；当前固件实测，不外推为全部新手机秒开。

## 2026-10-24 投屏工具栏交互

[工具栏默认隐藏与毛玻璃修正](screencast-toolbar.md)记录用户两次截图反馈、展开/收起行为、定向测试和实际 Electron 几何验证。首版背景缺失曾影响可读性，不能仅凭布局检查当作视觉验收。

工具栏记录后续补充整条面板统一玻璃层：用户指出前版底色过厚后修正透明度与模糊，实际 Electron 验证浅/深主题的面板背景、内部透明与图标色；不将此前行为测试记为再次执行。

工具栏记录继续补充 2 秒自动收起、交互期间暂停、28 项定向测试及实际 Electron 事件验证；首轮原生输入复核差异亦保留。

工具栏记录追加空闲入口隐藏与右上角唤起：30 项定向测试，实际 Electron 原生鼠标序列及隐藏时 Canvas 命中验证。

工具栏记录新增 160ms 过渡的实际 Electron 中间透明度、快速反向切换、输入禁用与减少动态效果验收；保留首帧探针超时记录，未据此声明启动性能。

工具栏记录继续追加用户箭头截图要求的左上角标题栏入口：portal 与局部 no-drag 热区、30 项回归、实际 Electron 鼠标序列/截图/窄窗口几何验证；macOS 与系统级拖窗仍待验收。

同一记录补充分辨率选择框：实际 Electron 支持可样式化 select，深浅毛玻璃菜单截图与生产链路50%/100%尺寸切换已检查；提示 H.264 整数缩放档位的实际语义，未声称所有百分比均精确生效。

后续精简为原画/流畅两个有效档位，记录旧配置映射、33项回归与实际应用两档尺寸切换；此前六个百分比是历史阶段，当前界面不再展示。

工具栏记录追加实际格式/Canvas FPS显示的63项回归、真机采样对照、收起停采样和窄窗口验证；同时记录用户指出的重复箭头和垂直不齐根因及最终截图/控件中心一致证据。JPEG显示未在真机强制回退验收。

## 2026-10-25 键盘输入与向手机粘贴

[输入独立审查](screencast-input-review.md)记录本轮四项确认缺陷、修复与复核、578 项应用回归、8 项实际 Electron 生命周期、类型检查限制及真机前置状态失败；最新脱敏结果见[审查验证统计](screencast-input-review-verification.json)。

随后按用户要求移除工具栏 T 和闲置的旧输入 IPC；[工具栏记录](screencast-toolbar.md)新增 25 项定向回归、三部分构建、8 项 Electron 生命周期和真实应用按钮/桥接检查，保留此前阶段历史数据。

同日用户要求隐藏快捷键融合为普通 Ctrl+C→Ctrl+V；[融合验证](screencast-input-fusion-verification.json)保存最终 585 项应用测试和实际 Windows 自动来源切换、空剪贴板、菜单回调、本次桌面剪贴板恢复结果。实现使用只读文本快照，限制及初次探针差异记在下方文档中，不代表双向剪贴板同步。

[键盘与剪贴板记录](screencast-input.md)保存用户最终范围、输入链路/快捷键、独立审查回归、579 项应用测试及当前 Windows 真机合成文本与全屏验收。保留签名拒绝、成功响应误报、XML 验收误报及测试剪贴板恢复失败的事实。手机到电脑复制按用户要求延期，其他平台和人工 IME 候选窗未验收。

## 2026-10-24 帧率参数与流中断恢复

[PR #56 审查与修复](screencast-pr56-review.md)保存新上下文独立审查的三个确认问题、复现与回归、首轮 CI 许可校验失败原因及修复后本地验证。最终提交审查和 CI/合入状态见该 PR；历史“未提交”条目仅描述当时阶段，不代表当前 PR 状态。

[帧率与意外降级记录](screencast-fps-tuning.md)及[脱敏统计](screencast-fps-tuning.json)分别保存原应用、独立编码流与更新后实际应用计数：原分辨率约 34→60 FPS。包含独立探针/应用时间重叠时失败与 JPEG 降级、一次原生重连修复、实际视频 TCP 中断后 2.695 秒恢复的证据，不外推为物理拔插或全部固件通过。参数参考官方 HOScrcpy API 文档固定 commit，桌面无 Java。
