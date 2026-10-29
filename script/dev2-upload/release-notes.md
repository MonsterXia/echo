Scrcpy Harmony **1.0.4-dev.2** 开发预发布 / Development preview.

### 本版更新 / Changes
- 修复将 HAP 拖入主窗口或投屏窗口时的安装流程；支持覆盖安装、大写扩展名，完成后给出通知并刷新列表。Fix HAP drag installation, replacement installs, uppercase extensions and completion feedback.
- 改善桌面异常退出后反复提示 Screen mirroring 无法启动：为新会话保存归属，前台核验后回收残留。Recover recorded native mirroring sessions left behind by an exited desktop process.
- 补齐反向转发兼容、损坏记录隔离、进程身份检查及后台预热/前台恢复衔接。Harden forwarding, ownership and preparation boundaries.
- 继续包含 H.264/JPEG 投屏、键盘与粘贴、Beta Update 和中英文选择。Includes existing H.264/JPEG mirroring, keyboard/paste, Beta Update and language selection.

### 下载与验证 / Downloads and verification
Windows x64、macOS Apple Silicon / Intel；macOS 13+。
请下载对应安装包升级。设置中开启 Beta Update 后可检查预发布；更新功能打开下载页，由用户安装。
Download the installer for your platform. Enable Beta Update in Settings to include previews in update checks; installation remains manual.

Source/tag: `dc03b25363f2b6f42e2feeff873b661982679eab`.
[CI](https://github.com/MonsterXia/scrcpy-harmony/actions/runs/40875222123) and same-source [Build / installation / startup](https://github.com/MonsterXia/scrcpy-harmony/actions/runs/40875259788) passed on all three platforms. Local application tests: **736 passed**; Licia production/fallback: **606 passed, 4 pending each**.

Artifact ZIP digests, installer/update YAML version/name/size/SHA-512 and source reports are verified before upload. All 14 uploaded attachments are downloaded again and checked by SHA-256 before publication. See `SHA256SUMS.txt`, `release-validation.json` and the `verification-*` reports for actual signing/notarization/Gatekeeper results. Successful startup does not imply OS trust approval.

### 验收边界 / Limitations
旧版无归属记录、删除/更换 profile 或首次写入记录前的崩溃，仍不能自动认领历史会话；数字 PID 的核验与停止之间仍受现有 shell 接口限制。跨固件、长期运行、物理拔插矩阵和 Windows/macOS x64 真机验收仍待补齐。此前 macOS arm64 真机证据不是本版三个安装包的新真机矩阵。
Legacy sessions without ownership records and crashes before the first record remain outside automatic recovery. Cross-firmware, long-duration, physical-reconnect and Windows/macOS x64 device matrices remain pending. Existing device evidence is separate from this release's three-platform installer/startup checks.

This is a **Pre-release**. Stable Latest remains **v1.0.3**; dev.0 and dev.1 remain available.
