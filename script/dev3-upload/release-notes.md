# Scrcpy Harmony 1.0.4-dev.3

开发预发布，包含 PR #75 的跨电脑投屏恢复与应用商店加载修复。源提交：`7cd2f9528c481731a39b9a97f59fef07b2ee5771`。稳定版 Latest 继续为 v1.0.3，dev.0/dev.1/dev.2 保留。

## 本版修复

- 换电脑后没有旧主机 journal 时，可自动回收已核验身份、已知库且无活动连接的投屏残留；支持 HarmonyOS socket 表头，并用设备端锁串行化恢复。已被另一恢复清理的候选不会再阻断启动。
- 商店不可达时，查询三秒截止并取消底层连接；失败冷却、请求合并及有限缓存避免逐包重复等待，应用列表继续使用本地信息。网络恢复后无需重启。
- macOS 开发包显式重建 ad-hoc 签名，两个架构均要求 DMG 安装后的 deep/strict 签名校验通过，避免上一版损坏签名。

## 下载与验证

选择 `win-x64.exe`、`mac-arm64.dmg`（Apple Silicon）或 `mac-x64.dmg`（Intel）。附件包含更新 YAML、blockmap、`SHA256SUMS.txt`、来源/签名报告及 `release-validation.json`。Windows x64、macOS arm64/x64 使用同一源码构建，完成实际安装与启动；公开前校验全部附件下载字节。

macOS ad-hoc 签名不等于 Developer ID、公证或 Gatekeeper 信任，系统可能仍要求确认允许打开；Windows 未作 Authenticode 发行者签名。具体退出码及签名状态见各平台 verification 附件。未修改系统全局安全策略。

## 验证范围

跨电脑恢复已有 Mac 真机的无旧 journal 恢复、三轮 H.264、活跃流保护及设备锁互斥证据；商店已有真实 HDC/IPC/UI 的受控断网、列表刷新及网络恢复证据。这些不等于本版三个安装包的全新真机矩阵。Windows 内网现场、两台物理电脑换线、其他固件、长期运行仍待验收。

原生客户端不参与恢复锁，最后连接检查与信号之间仍有短竞态；未知库或无法确认身份时不接管。离线真实图标尚未实现，图标 URL 成功不等于图片离线缓存。开启设置中的 Beta Update 才会检查开发预发布，更新入口打开本版本下载页，由用户安装。
