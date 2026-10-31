# Scrcpy Harmony 1.0.4

正式版 / Stable release，Windows x64、macOS Apple Silicon 与 Intel。macOS 要求 13 或更新版本。

## 本版更新 / What's new

- H.264 投屏与 JPEG 首图/回退，支持恢复视频；原画/流畅、格式/FPS 和全屏工具栏。
- 直接键盘、IME、纯文本粘贴；右键明确选择电脑或手机粘贴来源。
- HAP 拖入主窗口或投屏窗口安装，支持覆盖安装，完成后显示通知并刷新列表。
- 改善异常退出及换电脑后的空闲投屏残留恢复；商店不可达时有限等待并回退本地应用信息。
- 简体中文和英文选择，可取消的更新窗口及具体版本下载页。
- **Beta Update／接收预发布更新现在明确显示开启/关闭，勾号可见，菜单文字统一对齐。**

H.264 mirroring with JPEG fallback and recovery, keyboard/IME/text paste, HAP drag-and-drop installation, guarded stale-session recovery, bounded app-store requests, English/Chinese UI, and visible aligned Beta Update On/Off feedback.

## 安装、升级与限制 / Installation and limitations

下载对应平台的 `.exe` 或 `.dmg`，关闭旧应用后安装；应用 ID 和配置目录保持不变。正式版不要求开启 Beta Update。更新入口仍打开下载页，由用户手动安装；切换语言后需要重启。

**Windows 未做发行者签名；macOS 为有效 ad-hoc 签名，无 Developer ID 或公证。** Mac 的 deep/strict 完整性校验通过不等于 Gatekeeper 放行，系统仍可能显示安装限制。无需关闭全局安全策略。请核对下载来源和 `SHA256SUMS.txt`。

**Windows is unsigned. macOS uses valid ad-hoc signing without Developer ID or notarization.** OS trust warnings may remain. Verify the source and checksums; upgrading is a manual installation. Stable updates do not require Beta Update.

沿用开发系列已归档的真机验证；本次未补测双主机物理换线及 2 小时活动/8 小时空闲。跨固件、Windows 内网、长期挂死、离线真实图标、受保护画面和无线调试仍待进一步验收。不承诺所有机型均可用，不提供音频转发或手机到电脑剪贴板自动同步。

Existing device evidence is retained with its original scope. New physical cross-host/endurance testing was deferred for this release. Other firmware, intranet, long-running and protected-content behavior remain subject to validation.

## 构建来源 / Provenance

固定源码：`2cce9e1d1034f1f16bbc47e86a5ce661d13e3aca`，准备 PR #79。三平台安装包均来自同一 [Build](https://github.com/MonsterXia/scrcpy-harmony/actions/runs/41197974717)；[同源 CI](https://github.com/MonsterXia/scrcpy-harmony/actions/runs/41197981217)。

安装启动、签名状态、SHA-512/更新 YAML 与 14 附件清单见 `verification-*`、`release-validation.json` 和 `SHA256SUMS.txt`。公开前将重新下载全部附件核验字节；真实安装应用的升级检查和完整结果归档于仓库的 [1.0.4 发行记录](https://github.com/MonsterXia/scrcpy-harmony/blob/master/docs/releases/1.0.4.md)。v1.0.3 及开发预发布保留。
