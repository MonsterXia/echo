# 无 Java 原生库自动部署验收

日期：2026-10-24。用户要求让未预装兼容库的手机直接使用 H.264；本轮完成 Node/TypeScript 自动部署与本机验收，未提交或发布版本。

## 实现与资源来源

- 资源来自 [HOScrcpy 官方 v1.0.16-beta 发布](https://gitcode.com/OpenHarmonyToolkitsPlaza/HOScrcpy/releases/tag/v1.0.16-beta)的 `hosScrcpy-1.0.18-beta.jar`，归档大小 18442278 字节，SHA-256 为 `2ce60b1893cc2be471a8cd7eab7e4127e41921f1f89a32a134c730ba15c8c0fd`。固定下载地址、六个 ARM64 原生库的路径/大小/哈希见 [manifest](../../vendor/native-video/manifest.json)。保留上游 MIT 文本及其占位版权字段，不补造作者信息；独立原生组件没有另附许可文件，来源边界见 [资源说明](../../vendor/native-video/README.md)。
- `npm run resources` 用 Node 内置 crypto/zlib 验证完整归档并只解压清单条目。也可运行 `node script/native-video-resources.mjs --archive <官方归档路径>`。归档后缀为 JAR，但准备、构建、运行均不执行 Java、不需要 JDK/JRE；应用只打包六个 `.so` 和三份来源/许可文件。构建验证资源完整性，按白名单复制并清理旧生成目录，残留 JAR 不会进入产物。
- 正式应用先检查 aarch64 与可解析的 UITest 版本（最低 6.0.2.2），验证本地 ELF64/ARM64、大小、SHA-256，再将候选库上传到独占随机名称，核对手机端 SHA-256 后启动。版本门槛来自 SDK 的 unix 服务分支，不保证所有满足门槛的固件兼容。
- 候选失败必须确认进程、映射、文件清理才继续；清理结果未知时保留会话所有权并阻止新部署。成功候选在当前 driver 内优先复用，每次会话重新部署并在停止时删除，不留下永久设备缓存、不覆盖其他工具的库。正式应用不依赖 `/data/local/tmp/libscreen_casting.z.so`。
- 此手机六个候选中只有 `libscrcpy_server_unix_6.6-20260418.z.so` 能启动，最新 20260629 候选失败。因此采用有限顺序探测，不按系统版本猜测内核变体。全部不兼容或解码不可用时沿用 JPEG 回退。

## 真机验证

关闭主应用，连接一台手机并保持动态画面，执行 `node script/check-native-video.cjs <报告.json> --without-preinstalled`。探针先写恢复日志，再临时移走原库；正常退出及父进程检测到子进程超时均按哈希校验恢复，恢复失败会保留日志并报告失败。普通应用部署不会移动原库。

最终复测使用真实 NativeVideo/CaptureUiDriver/ScreencastClient、Electron 45 和手机原生服务；页面 store/测试 IPC 外壳为替身，会话管理器另有真实 Electron 生命周期回归。与应用相同地禁用 Windows 硬件加速。结果见[脱敏统计](screencast-native-deployment.json)：

| 检查 | 结果 |
| --- | --- |
| 预装库在原路径缺席 | 是 |
| 自动上传并使用 | `libscrcpy_server_unix_6.6-20260418.z.so` |
| 实际视频格式 | H.264 |
| 稳态窗口 | 15004 ms |
| 输入 / Canvas 绘制 | 513 / 514 帧，34.19 / 34.26 FPS |
| 解码错误 | 0 |
| 缩放 0.5→1 | 恢复新帧，2412×1084 |
| 客户端销毁后重开 | 成功 |
| 停止清理确认 / 原库恢复校验 | 成功 / 成功 |

输入与绘制计数在异步边界取样，窗口前已解码的一帧可计入绘制，不能视作多生成一帧。此前含空格的 Windows 本地资源目录也成功部署。相对早期 JPEG 约 10 FPS 明显改善，但不是相同视频逐帧 A/B，不承诺锁定 60 FPS。

这里只临时移走预装库，证明本实现不依赖该文件；没有恢复出厂或覆盖所有固件。归档不包含屏幕帧、设备标识、恢复日志或原始设备日志。

## 验证与审查

- 全量应用测试 **501/501**；Licia 生产与隔离 fallback 均 **606 passing / 4 pending**（既有外部夹具）。ESLint、`git diff --check`、完整 `npm run build` 通过，dist 包含清单内六个库及三份说明文件。
- 真实 Electron 合成生命周期 **8/8**；首帧、缩放和重开由上述真机探针明确断言。官方 URL 新下载资源的 Node 准备流程通过。
- 新鲜上下文独立审查指出：HDC 错误误判成功会放行未清理会话、探针强制超时会跳过子进程 finally、宽泛复制可能打入残留 JAR。三项均已修复并新增先失败后通过的回归：stdout/stderr 错误和不完整进程列表保留所有权、文件删除必须确认；父进程按恢复日志兜底；构建只复制清单文件。超时恢复测试使用真实被终止的合成子进程与模拟设备，不声称对真实手机强制中断也已验收。
- 完整 TypeScript 检查在上一阶段仍有仓库既有类型/CSS 声明问题，本轮不声称其通过。未运行远端五项 CI、新安装包安装或 macOS 真机验证。

下一步是扩展固件兼容矩阵、物理旋转/拔插及长时间 CPU/内存/端到端延迟采样；这些仍未验收。M2-2/M2-3 的长期与重连事项不因本轮自动部署完成而关闭。
