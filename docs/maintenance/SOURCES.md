# 维护来源记录

记录日期：2026-10-21（Asia/Hong_Kong）。用于 [RUNBOOK](../../RUNBOOK.md) 的来源追踪；状态是归档时快照，后续实施以当前源码和新证据为准。

后续验收归档：2026-10-23 的 [M2-2 完整概览 IPC 与失败恢复](M2-2-overview-live.md)包含基线和正式候选的脱敏 JSON、构建身份及可重复步骤。它是本仓库新增验收证据，不改变以下原始来源快照。

## 备份范围与读取方式

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

## 解除 fork 的核验

解除前后仓库 ID 均为 `1426959270`；解除后 API 返回 `fork: false` 且不再包含 parent；master 保持为 `d672f8954d96ad3511527d074d312077fa8e4eee`，原有 8 个 PR 仍可访问。平台元数据可能丢失的事前警告，没有在这 8 个 PR 上发生。

基线时本仓库无独立 Issue，Issues 功能关闭。该状态按归档快照保留；2026-10-21 已通过 M0-1 启用 Issues，并修正 GitHub About 与主页链接，当前验收结果见 [RUNBOOK](../../RUNBOOK.md#m0-1-验收记录)。
