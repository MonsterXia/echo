# M4-1 音频转发能力评估

评估日期：2026-10-22（Asia/Hong_Kong）。执行者：Codex。应用基线：`9e944ae27ad7cc4c656467257e3e84d8067dc2f8`；分支：`codex/m4-1-audio-assessment`。

## 决定与证据边界

**建议：暂缓实现，待能力验证。** 文档研究与无设备静态核对已完成；设备能力、可分发方案和音视频体验未验收。普通 HDC 调试授权下，尚未建立本项目可直接使用的内部音频捕获链路。不能据此断言 HarmonyOS/OpenHarmony 不支持内部音频：官方有 AVScreenCapture 路径，当前 HarmonyOS 文档还列出 API 26.0.0 的独立内录启动接口。[H1][H2][H3]

优先候选是**设备端应用经用户确认的 AVScreenCapture 内录 + 独立传输 + 桌面播放**；API 26.0.0 AudioCapturer 内录可作为另一候选，须单独确认 SDK、目标系统与授权流程。两者均不是 Windows/macOS Electron 可以仅靠 HDC 调试授权直接调用的现成音频服务。本轮不创建设备端应用，不安装 HAP，不启动 HDC/投屏，不录音、不访问用户媒体、不枚举设备或应用，不修改生产代码、依赖或产品功能范围。

当前允许的后续侧载验证仅限 bilibili，且没有本地 bilibili HAP。这**不构成安装自制采集伴侣 HAP 的授权**。因此本轮完成评估材料，实施与真机探针保持暂缓；只有具备下文解除条件后才另立任务。

## 来源与读取记录

以下均于评估日读取正文。华为网页使用当前文档中心渲染正文（旧链接会跳转新版分类）；部分页面按章节延迟加载，已打开所引用章节，不以搜索摘要作为结论。页面的“起始 API”与页首设备支持标签分别记录，不能把 API 数字直接换成所有设备的商品系统版本。OpenHarmony 的 master 是开发文档快照，不能替代 HarmonyOS 商用固件验证。

| 编号 | 来源 | 日期/版本与用于支持的结论 |
| --- | --- | --- |
| U1 | [上游 Issue #25](https://github.com/liriliri/echo/issues/25) | 创建/更新于 2026-04-09；读取时 open、评论列表为空。正文要求像安卓版一样把声音投到电脑，没有设备型号、性能目标或权限方案。它是需求，不能作能力证据。 |
| H1 | [HarmonyOS：AVScreenCapture 录屏基础流程](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/avscreencapture-c-basic-process) | 页面更新 2026-10-14；内录/麦克风分开配置、用户隐私弹窗、数据/状态回调、停止释放；PC/2in1 的 API 22 特例。 |
| H2 | [HarmonyOS：native_avscreen_capture.h](https://developer.huawei.com/consumer/cn/doc/harmonyos-references/capi-native-avscreen-capture-h) | 页面更新 2026-09-24；基础接口 API 10，State/Data/Error 回调 API 12；当前设备标签 Phone/Tablet 12+、PC/2in1 13+、TV 19+；须结合具体接口。 |
| H3 | [HarmonyOS：AudioCapturer](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/arkts-apis-audio-audiocapturer#requestplaybackcapturestart) | 页面更新 2026-10-10；`requestPlaybackCaptureStart` 起始 26.0.0，Stage 模型、Phone/PC/Tablet/TV；异步检查用户授权并回报启动结果。 |
| H4 | [HarmonyOS：Audio Enums](https://developer.huawei.com/consumer/cn/doc/harmonyos-references/arkts-apis-audio-e) | 页面更新 2026-09-14；SourceType 旧内录废弃标记、AudioPrivacyType、API 26.0.0 AudioPlaybackCaptureMode 的内容范围。 |
| H5 | [HarmonyOS：Audio Interfaces](https://developer.huawei.com/consumer/cn/doc/harmonyos-references/arkts-apis-audio-i) | 页面更新 2026-09-14；AudioCapturerOptions 的旧 `playbackCaptureConfig` 与新 `playbackCaptureMode`，AudioRendererOptions 的 `privacyType`。 |
| H6 | [HarmonyOS：受限开放权限](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/restricted-permissions) | 页面更新 2026-10-10；CUSTOM_SCREEN_RECORDING、CAPTURE_PLAYBACK_DOWNLINK 的场景、设备、授权类型及 AGC 审核要求。 |
| H7 | [HarmonyOS：hdc](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/hdc) | 页面更新 2026-09-20；完整命令列表、调试连接、端口转发，未列出专用实时音频捕获命令。 |
| H8 | [HarmonyOS：使用 AVScreenCapture 录音](https://developer.huawei.com/consumer/en/doc/best-practices/bpta-audio-record-base-on-avscreencapture) | 页面更新 2026-04-15；纯音频 M4A 文件示例证明存在设备内音频能力，不证明低延迟实时传输。 |
| O1 | [OpenHarmony：录屏基础流程](https://github.com/openharmony/docs/blob/f41b9345badd47c7ab0c263344cd7f4b5a549afb/zh-cn/application-dev/media/media/avscreencapture-c-basic-process.md) / [C API](https://github.com/openharmony/docs/blob/f41b9345badd47c7ab0c263344cd7f4b5a549afb/zh-cn/application-dev/reference/apis-media-kit/capi-native-avscreen-capture-h.md) / [类型与回调](https://github.com/openharmony/docs/blob/f41b9345badd47c7ab0c263344cd7f4b5a549afb/zh-cn/application-dev/reference/apis-media-kit/capi-native-avscreen-capture-base-h.md) | 评估日解析 master 为固定提交 `f41b9345…`；区分 OH_MIC、OH_ALL_PLAYBACK、OH_APP_PLAYBACK，回调带时间戳。枚举存在不等于逐应用筛选已验证。 |
| O2 | [OpenHarmony：AudioCapturer 指南](https://github.com/openharmony/docs/blob/f41b9345badd47c7ab0c263344cd7f4b5a549afb/zh-cn/application-dev/media/audio/using-audiocapturer-for-recording.md) / [Enums](https://github.com/openharmony/docs/blob/f41b9345badd47c7ab0c263344cd7f4b5a549afb/zh-cn/application-dev/reference/apis-audio-kit/arkts-apis-audio-e.md) / [Interfaces](https://github.com/openharmony/docs/blob/f41b9345badd47c7ab0c263344cd7f4b5a549afb/zh-cn/application-dev/reference/apis-audio-kit/arkts-apis-audio-i.md) | 同一固定快照；麦克风权限、旧内录废弃、应用播放流隐私策略。该快照相关文件没有 H3/H5 的新内录入口，不能混称两平台同步支持。 |
| O3 | [OpenHarmony：权限模型](https://github.com/openharmony/docs/blob/f41b9345badd47c7ab0c263344cd7f4b5a549afb/zh-cn/application-dev/security/AccessToken/app-permission-mgmt-overview.md) / [系统权限](https://github.com/openharmony/docs/blob/f41b9345badd47c7ab0c263344cd7f4b5a549afb/zh-cn/application-dev/security/AccessToken/permissions-for-system-apps.md) / [普通用户授权权限](https://github.com/openharmony/docs/blob/f41b9345badd47c7ab0c263344cd7f4b5a549afb/zh-cn/application-dev/security/AccessToken/permissions-for-all-user.md) / [普通系统授权权限](https://github.com/openharmony/docs/blob/f41b9345badd47c7ab0c263344cd7f4b5a549afb/zh-cn/application-dev/security/AccessToken/permissions-for-all.md) | 同一固定快照；normal/system_basic/system_core、ACL、MICROPHONE、INTERNET、CAPTURE_SCREEN、CAPTURE_VOICE_DOWNLINK_AUDIO。 |
| O4 | [OpenHarmony：HDC](https://github.com/openharmony/docs/blob/f41b9345badd47c7ab0c263344cd7f4b5a549afb/zh-cn/application-dev/dfx/hdc.md) | 同一固定快照；转发是连接运输能力，不是内容采集权限。 |
| D1 | [hdckit 0.12.1 注册表包](https://registry.npmjs.org/hdckit/-/hdckit-0.12.1.tgz) | 仅下载并静态读取 `dist/hdc/UiDriver.js`、`.d.ts`；SHA-512 与仓库锁文件 integrity 匹配。没有安装或运行包。 |

## 接口与权限矩阵

“普通调试可用”仅指已授权的 HDC 通道能力；应用运行权限、录屏会话同意、被采集应用的策略是另外的边界。

| 路径 | 数据/版本 | 授权与分发边界 | 对本项目的结论 |
| --- | --- | --- | --- |
| HDC `shell`、`fport` / `rport` | 命令执行、socket 字节流运输；H7/O4 未列专用音频捕获命令 | 调试授权不自动授予设备应用的麦克风、录屏或系统能力；仍需一个合法运行的音频生产端 | 可研究为运输通道；不能据此宣称系统不支持声音，也不能将转发成功当作内录成功。 |
| AudioCapturer 麦克风源 | PCM；AudioCapturer 自 API 8；具体 source 另有起始版本 | `ohos.permission.MICROPHONE` 为 normal/user_grant；后台运行另核对长时任务要求 [O2/O3] | 录的是外部声音，不能满足“设备内部声音”需求；本轮与候选最小范围均不启用。 |
| AVScreenCapture C API | 内录/麦克风/视频可区分；基础 API 10、现代数据与状态回调 API 12；HarmonyOS 设备标签见 H2 | 公开设备端 SDK 路径；按 H1/H2 注册状态回调并由系统征求同意、显示通知，用户拒绝则取消；麦克风另需 MICROPHONE。纯内录不应为了套用示例而开启麦克风 | 第一候选，需设备端组件。H1/H2 未将普通弹窗路径标成系统应用专用；不能把 CAPTURE_SCREEN 系统权限当该公共流程的默认前提。实际商品固件、签名和后台持续性待验证。 |
| AudioCapturer 旧 playback capture | `SOURCE_TYPE_PLAYBACK_CAPTURE`、`AudioPlaybackCaptureConfig`：API 10 起、12 起 deprecated [H4/H5/O2] | 旧过滤器 API 10 涉及语音通话时要求仅系统应用可申请的 CAPTURE_VOICE_DOWNLINK_AUDIO；API 11 起该过滤器不再支持此通话类型 | 不选作新功能主路径；不能把旧的通话权限限制推广到所有公共内录能力。 |
| AudioCapturer 新内录 | `playbackCaptureMode` + `requestPlaybackCaptureStart`，API 26.0.0、Stage；SystemCapability.Multimedia.Audio.PlaybackCapture [H3–H5] | 启动是非阻塞授权请求，最终回调决定是否成功；MODE_DEFAULT 排除提示音/隐私流，MODE_MEDIA 等另有筛选范围。配置与旧 source 的关系、普通签名运行及具体授权界面需 SDK/设备验证 | 第二候选，不能下推到 API 12/20/22 设备，也不能由 OpenHarmony master 推断商用可用。未验证编译、安装或启动。 |
| 播放方的 `privacyType` | AudioRendererOptions；AudioPrivacyType 自 API 10，SHARED 自 21 [H4/H5] | PRIVATE 不允许其他应用录制/投射；PUBLIC 不包含隐私类型流；SHARED 是播放方选择，不能由桌面工具替别人开启 | 用户同意捕获不等于所有应用同意被捕获。保留静音/受限说明；不承诺 DRM、通话、隐私流或任意指定应用可录。 |
| 免隐私弹窗 | `CUSTOM_SCREEN_RECORDING`：H1 的 PC/2in1 API 22；H6 另列 TV 从 26.0.0 扩展 | system_basic、manual_settings、受限申请与 AGC 审核；不是任意手机可申请的普通权限 | 不纳入候选范围，不靠调试/系统签名绕过用户确认。 |
| 系统/特殊音频能力 | O3 的 CAPTURE_VOICE_DOWNLINK_AUDIO 为 system_basic/system_grant；CAPTURE_SCREEN 为 system_core/system_grant。H6 的 CAPTURE_PLAYBACK_DOWNLINK 是另一个 API 26.0.0 受限权限 | API 是否为系统接口、应用身份/APL、证书与 ACL 授权须分别满足；只在 manifest 写权限或允许 HDC 不够。H6 新下行权限限特定辅助工作场景、Phone/Tablet，并需审核 | 不支持把这些能力作为普通桌面版现成通路；不使用通话下行采集。不能混淆两个不同名称的下行权限。 |

分发还须独立解决设备端组件的签名、安装方式、更新与卸载、SDK/ABI 配套、可申请权限与应用市场审核。H6 明确受限权限申请与上架审核关联；本评估没有取得相关资格，也没有验证普通签名伴侣应用能在目标版本安装。开发调试包可运行不能替代普通用户可分发结论；OpenHarmony 定制系统/系统应用的能力不能直接视为 HarmonyOS 手机第三方能力。

## 当前架构与缺口

静态核对使用上述应用基线，引用仓库文件与 D1 实际版本，不使用其他并行任务未提交改动。

| 已有路径 | 现场核对 | 音频所缺能力 |
| --- | --- | --- |
| 依赖与资源 | `package-lock.json`：hdckit 0.12.1、Electron 45.0.0、React 19.3.1；`script/resources.mjs` 指向 uitestkit 1.1.0，HDC 下载 URL 使用上游 master | 锁文件不代表本机已安装；HDC URL 未锁二进制版本，本轮不下载/执行 HDC，不能声称实测 HDC 版本或兼容性。没有设备端音频应用构建/签名流程。 |
| `src/main/lib/hdc/uitest.ts` | 创建 UiDriver、使用 `uitest_agent_v1.1.0.so`，`startCaptureScreen` 回调通过 `captureScreen(connectKey, image)` 发给窗口 | 没有音频格式/时间戳/序号/会话协商接口。D1 的 UiDriver 只有图像 Buffer 回调与 scale 参数，没有公开音频捕获方法；不推断闭源 agent 内部绝无其他能力。 |
| `src/preload/main.ts`、`src/common/types.ts` | 提供 start/stopCaptureScreen 等桥接 | 没有音频 IPC、权限状态、协商格式或背压。 |
| `src/renderer/screencast/lib/ScreencastClient.ts` | JPEG Blob 解码到 Canvas，绘制中跳过新帧；当前帧事件没有设备采集时间戳 | 不存在音频解码/播放队列，也没有音视频共同时间轴。音频不能沿用视频丢帧逻辑。 |
| `src/main/lib/hdc/base.ts` 的 forwardTcp、`hdc/port.ts` | 可建立/列出/删除转发，按远端地址复用映射 | 需要音频专用会话的端口所有权、连接认证、关闭与重连协议，不能删除他人转发或重启共享 HDC。 |

D1 的 UiDriver 启动路径还可能上传 agent、设置测试模式、启动/停止 uitest；因此本次没有以“静态探针”名义实例化它。已阅读这些方法不等于已经运行设备端能力测试。

## 解除暂缓后可验证的最小范围（设计候选，未实施）

1. **捕获端**：单设备、用户主动开始的一路内部媒体音频，明确关闭麦克风并将 mic 参数置为不采集配置；不混音、不录文件、不抓通话、不访问媒体库。先确认普通签名的设备端组件及发布途径可行。优先 AVScreenCapture 原始数据回调；仅在已确认的 API 26.0.0 平台比较新内录路径。拒绝授权应直接终止，不能后台反复弹窗重试。[H1–H5]
2. **运输与播放**：先验证 USB/HDC 通道上一条本地专用连接；不依赖尚未验收的网络连接 M2-5。采样格式由设备协商后固定，协议至少携带会话代次、序号、格式、有效长度和设备时间戳，校验长度并限制缓存。桌面输出选择可用的 PCM 播放方案；如后续需要 AAC/Opus，再单独评估编码与延迟。示例 48 kHz、双声道、16 bit PCM 的净载荷为 `48000 × 2 × 2 = 192000 bytes/s`，只是计算值，不是吞吐实测或格式支持证明。
3. **同步**：区分音频采集时刻、桌面接收时刻与实际播放时刻，核对回调时间戳单位和时钟域，记录队列积压、抖动与漂移。API 12 DataCallback 的 buffer 在回调返回后失效，须按有效数据长度及时转移到有界队列，不能与旧 Acquire/Release 方式混用。[H2] 目前 JPEG 不含设备采集时间戳，接收时刻不能证明嘴型同步。初始探针只验证音频可达；音画同步若是实施验收条件，须与投屏路径负责人另定同源时间戳或共同采集方案，不能偷偷改图像链路。
4. **延迟**：以获准的合成点击声/画面闪烁测端到端延迟分布、音画偏差、30 分钟漂移、CPU/内存和 underrun/overflow；先协商验收阈值，再判可接受性。原始流、文件录制、JPEG 并行捕获分别测量，不能拿文件成功推导低延迟。当前所有性能结果均为“未测”，无 FPS、毫秒或功耗达标结论。
5. **断连与结束**：USB 断开、窗口关闭、切换设备、用户停止/撤回、应用退出、采集服务错误时，停止播放、清空队列、销毁旧代次并释放自己拥有的采集/转发资源；数据源持续性受限时明确降级到现有无声投屏。重连建立新会话并按系统要求重新取得同意，不播放旧缓存；不能自动重录或关闭共享 HDC。蜂窝通话中断、锁屏、后台/前台、路由改变、系统用户切换需分别验证，不将本轮研究扩展为息屏功能 M4-4。[H1/H2/O1]

## 待验证项与解除条件

| 门槛 | 必须获得的证据 | 当前状态/下一步 |
| --- | --- | --- |
| G1：范围与部署 | 用户另行接受“需要设备端组件”的产品范围，并明确允许的部署/测试方式；提供有授权的测试内容 | 未满足。当前仅允许 bilibili 后续侧载，不安装自制 HAP；无本地 bilibili HAP。先由维护者决定是否接受伴侣方案。 |
| G2：平台与权限 | 指定 HarmonyOS 或 OpenHarmony 发行版、API、设备形态、SDK/ABI、HDC 主机/设备配套；普通签名构建、安装与用户授权成功/拒绝的证据 | 未验证。优先检查 AVScreenCapture 的 SDK 与系统能力；新内录另设 API 26.0.0 行，不推定兼容旧系统。签名配置可审查但不得归档私钥或设备标识。 |
| G3：数据可得性 | 获准来源的内部音频产生有效 buffer；麦克风禁用；私密/禁止捕获内容保持限制；应用不播放与权限拒绝能区分 | 未验证。只保存汇总计数、格式、脱敏错误码和合成结果；不保存私人音轨或原始系统日志。非零/静音 buffer 本身不能单独证明成功或失败原因。 |
| G4：运输/同步/性能 | 音频到达桌面并连续播放，协商格式正确；时间戳单位/时钟域有依据；延迟、偏差、漂移与资源数据满足事先约定指标 | 未验证。先做独立原型证据，再决定 JPEG 并行是否可接受；现有视频缺时间戳是已确认的架构缺口。 |
| G5：生命周期与分发 | 重复开始停止、授权拒绝/撤回、断连重连、设备切换、来电/后台/锁屏、桌面输出路由变化均不泄漏或误录；签名、分发和所需审核可实际执行 | 未验证。与投屏生命周期任务对接设计，另立实现 PR 与验收，不修改其持有文件。 |

**转为“实施”**：G1–G3 有可复查通过证据、普通用户分发可行，并对 G4/G5 制定双方接受的验收指标后，另开实现计划与 PR。**继续“暂缓”**：缺设备、SDK、普通签名部署、授权或应用捕获策略证据。**限定“不支持”**：仅在某一明确版本/权限/设备组合得到否定证据时记录该组合；依赖系统身份、免弹窗特权、隐私绕过或通话下行的方案不纳入本项目普通桌面版最小范围。禁止用“没找到 HDC 音频命令”作平台整体不支持的结论。

## 本轮核验与交接

- 隔离：先 `list_artifacts`（空），再创建独立托管工作树；开始时 fetch 并核验 origin/master 为上述基线。共享目录的 `script/resources.mjs`、`src/main/window/main.ts`、`src/renderer/main/components/webview/Webview.tsx` 未编辑、暂存或携带。
- 来源：GitHub 连接器不可用，使用 `gh api` 读取 U1 正文及空评论列表；华为官方网页经浏览器读取，OpenHarmony 经官方仓库固定提交读取。仅使用一手来源作事实依据。
- 静态探针：解析 package/lock；下载 D1、校验 SHA-512 与 lock 完全匹配并读取 UiDriver；检索图像 IPC/Canvas/转发路径。无依赖安装、构建、HDC 调用、设备捕获或模拟性能测试。
- 文档变更检查：提交前执行 `git diff --check`、本地链接和变更范围核对；仅本报告及 RUNBOOK 的 M4-1 行/交接。文档变更不另写实现镜像测试；CI 的 test/lint/三个平台打包启动检查只证明基线回归，不证明音频能力。
- 独立审查：审查基线至 `7b511fe` 及随后链接修订；发现 H3 旧路径大小写导致 404，已替换为官方导航的准确地址并复核正文。审查结论为能力评估文档无未解决阻断项；已交叉核对新内录授权/版本、旧接口废弃、回调生命周期、系统权限和实际投屏源码。审查者未逐项复核所有页面日期、受限权限审核条目及包完整性记录，未执行 SDK/签名/真机/性能验收；不能作为功能通过证据。
- PR、审查和 CI：[独立草稿 PR #24](https://github.com/MonsterXia/scrcpy-harmony/pull/24)，[当前提交检查页](https://github.com/MonsterXia/scrcpy-harmony/pull/24/checks)；待审查，不自动合并或发布。M4-1 维持“暂缓（评估已记录，能力待验证）”，下一步由维护者处理 G1/G2。
