# 无 Java 视频投屏方案与验证

日期：2026-10-24。目标：解决当前设备 JPEG 投屏约 10 FPS 的瓶颈，不引入 JVM。

后续状态：兼容库自动部署已补齐，普通应用不再依赖手机预装库；官方资源、原库缺席时的真机验证与当前限制见[自动部署记录](native-video-deployment.md)。下文保留第一阶段接入时的证据和边界。

## 已有证据

- 当前 JPEG 管线直连采样 15 秒：scale=1 为 9.47 FPS，scale=0.5 为 9.87 FPS；这一轮没有发生 TCP 解析丢帧。不能将桌面掉帧修复宣传为 60 FPS。
- 原 TCP 解析错误在粘包/跨包中丢帧、丢控制回复；renderer 忙碌时丢弃最后一帧。已有独立修复及回归。
- 这台手机预先存在 `/data/local/tmp/libscreen_casting.z.so`（247989 字节，MD5 `8c8df9a96af21aac71d5091ffa0b1477`）。以 `uitest` 扩展方式启动后，纯 Node.js `http2` 调用 `/ScrcpyService/onStart` 收到 H.264，`onEnd` 返回 grpc-status=0。随后通过真实 Chromium 与生产 CaptureUiDriver/ScreencastClient 验证，见下方记录。
- 此手机原生库与外部 SDK 1.0.18 内所有候选库的 MD5 不匹配。不能据此声称可在干净设备上自动部署，或把未验证的 SDK 变体作为发行资源。

## 用户已选择：TypeScript + 设备原生服务 + WebCodecs

1. 设备端由原生 `.so` 采集和硬件编码 H.264；桌面无 Java/JAR/JRE。
2. 主进程用 Node.js 内置 HTTP/2 接收 gRPC 消息；严格限长、拆包、解析 protobuf 视频字段。通过原 sessionId/generation 传给投屏窗口。
3. renderer 用 Chromium WebCodecs 解码到已有 Canvas。H.264 有帧间依赖，不能套用 JPEG 的随意丢帧策略；积压时丢弃到下一个关键帧并重建解码器。
4. 保留现有触控坐标及截图接口。继续使用主进程按设备的会话串行队列，关闭/旋转/缩放使旧解码回调失效，停止确认后才让新会话启动。
5. 原生资源缺失、不兼容或解码不可用时，明确报告并提供 JPEG 兼容模式；不在后台循环重启两个采集服务。
6. 资源必须取得可追溯版本、哈希和分发说明，并通过干净设备部署验证。先支持已验证设备，再扩大兼容范围。

## 备选路线：Rust/C++ 通信进程

原生服务和视频编解码仍相同；Rust/C++ 只替换桌面通信/会话层。额外需要 Windows/macOS 三架构构建、进程生命周期、IPC 与打包集成。只有实测 Node.js 的 CPU、内存或传输成为瓶颈，或目标改为脱离 Electron 的独立客户端时，才有充分理由承担这部分复杂度。当前没有这一瓶颈的测量证据。

## 验收与边界

- 动态画面分别记录设备输入帧、解码帧、绘制帧、丢帧、延迟和 CPU；不能把配置为 60 FPS 当实测值。
- 覆盖首帧/关键帧、粘包拆包、SPS 变化、横竖屏、缩放、错误恢复、关闭与重开、断开重连，以及现有坐标回归。
- 不自动启用系统范围硬件加速、不更改安全设置、不替换手机已有库。
- 第一阶段已实现 H.264 集成，当时仅使用设备已有库；随后自动部署已完成，见上方后续记录。资源缺失或启动不兼容时回退 JPEG；主进程记录兼容回退，解码/运行中流失败由 renderer 停止旧会话后单向回退。

## 2026-10-24 实测

- `script/check-native-video.cjs` 使用真实 Electron 45、生产 NativeVideo/CaptureUiDriver/ScreencastClient 与手机，只替换页面 store 和测试 IPC 外壳，真实会话管理器另由合成边界和 Electron 生命周期回归覆盖。测试与应用一致地禁用 Windows 硬件加速，没有为得到数字单独启用 GPU。
- 稳态 15002 ms：H.264 输入 530 帧（35.33 FPS）、Canvas 绘制 531 帧（35.40 FPS）、无解码错误。输入和绘制在异步边界取样，窗口前已解码的一帧可进入绘制计数；不是“产生更多视频帧”。约为此前 JPEG 9.87 FPS 的 3.6 倍，但不是同一视频逐帧 A/B，也不承诺所有画面稳定 35/60 FPS。
- 缩放 0.5→1 后恢复绘制（2412×1084），销毁后新建客户端再次收到首帧，原生进程退出与本会话映射/副本清理确认成功。归档仅包含计数，无屏幕内容、设备标识或原始设备日志。
- 原生独立解码先测得 21.83 FPS，正式客户端两轮测得约 35 FPS。画面内容影响源端输出，不能把一轮差异归因于代码变化。
- 审查修复后的最终复测：15013 ms，输入与绘制各 516 帧，均为 **34.37 FPS**，无错误；缩放后的新尺寸、新绘制和客户端重开均明确断言成功，停止确认成功。见 [脱敏计数](screencast-native-video.json)。
- 仍待验证：物理旋转切换、拔插恢复、长时间 CPU/内存趋势、端到端延迟、干净设备安装。SPS 改变和坐标更新已有合成回归，不代替真机旋转验收。
- 重测：关闭应用、只连一台手机并保持动态画面，运行 `node script/check-native-video.cjs <报告.json>`；JPEG 对照运行 `node script/check-screencast-stream.cjs <报告.json>`。脚本显示投屏窗口，采集内存帧，仅落盘统计。当前脚本已接入资源自动部署，准备方法与原库缺席验证见后续记录；上述第一阶段数字仍对应原有库。

## 审查与验证范围

- 应用测试 488/488、ESLint、main/preload/renderer 构建通过；Electron 合成生命周期 8/8。完整 TypeScript 检查仍被仓库已有的 CSS 声明、依赖类型等错误阻塞，不把 Vite 转译当作类型检查通过。
- Licia 生产和隔离 fallback 两种测试均为 606 passing、4 pending；pending 为既有外部夹具用例。
- 新鲜上下文独立审查发现映射已消失导致清理卡住、配置流没有可用图像却循环重试、探针误删复用映射三处重要问题，均已修复。前两处新增回归先失败后通过；探针映射清理用可复用函数验证已有映射保留、新增映射释放。探针原先“JPEG 回退也算成功”的验证缺口亦补充明确 H.264/缩放后新帧断言，随后真机复测通过。
- 最终处理判断：将探针验收缺口作为验证正确性问题修复；其余审查暂不判断的干净设备资源/许可、物理旋转/拔插、长期性能和跨平台安装包，保留为未验收边界。错误地扩大结论会误导其他设备用户，因此本轮不声称跨设备发行就绪。

参考：[HOScrcpy SDK 接口说明](https://gitcode.com/OpenHarmonyToolkitsPlaza/HOScrcpy/blob/main/hoscrcpy%20API介绍.md)、[OpenHarmony screen_copy](https://github.com/openharmony/testfwk_arkxtest/blob/f59296c77aac5037a9335c317af58de3a0c22ecb/uitest/addon/screen_copy.cpp)。公开 OpenHarmony 实现只能辅助解释，不能当作当前商业设备固件源码。
