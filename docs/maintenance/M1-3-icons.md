# M1-3：bilibili 离线图标验证

2026-10-22 / Codex；应用基线 `cccf486`，分支 `codex/m1-3-local-app-metadata`，[PR #18](https://github.com/MonsterXia/scrcpy-harmony/pull/18)。**本轮补齐离线行为证据，未修复离线应用图标，M1-3 保持进行中。**

## 结果

仅验证 bilibili（`yylx.danmaku.bili`），设备系统 7.0.0.109 / API 26，Windows x64 / Electron 45.0.0。两次运行均使用全新进程和临时配置；先联网验证，再启动全新的离线实例，避免把之前下载的图标缓存当作离线读取能力。

| 检查 | 联网 | 受控离线 |
| --- | --- | --- |
| 真实 IPC 名称 | 哔哩哔哩 | 哔哩哔哩 |
| IPC 图标 | 远程图片 URL | 空值 |
| 列表、图标视图、刷新后 | 均显示 1024×1024 的应用图标，三处哈希一致 | 均显示 144×144 的默认图标，三处哈希与仓库 default-icon.png 完全一致 |
| 页面异常 / 进程退出 | 0 / 0 | 0 / 0 |
| 离线图标验收 | 不适用 | **未通过**，只有默认图标回退 |

证据：[联网报告](m1-3-icons/online/report.json)、[列表](m1-3-icons/online/bilibili-list.png)、[图标视图](m1-3-icons/online/bilibili-icons.png)；[离线报告](m1-3-icons/offline/report.json)、[列表](m1-3-icons/offline/bilibili-list.png)、[图标视图](m1-3-icons/offline/bilibili-icons.png)。四张图片均已目视检查，只含 bilibili 面板。

报告分别使用 `verificationPassed`（验证步骤完成）和 `offlineIconAcceptancePassed`（离线应用图标可用）；离线结果前者为 true、后者为 false。脚本成功退出不能用来宣称图标已修复。

## 验证方法与边界

新增 `script/check-bundle-icon-live.mjs`，启动时不挂载任何功能面板；随后只将 `getBundles` 的选择范围限制为 bilibili，并给真实 `getBundleInfos` 加请求范围检查和完成计数。生产元数据处理器、HDC 返回及 renderer 未被替换。刷新验证等待真实元数据请求结束，再检查图片。此范围不覆盖全设备应用枚举。

离线模式在本机绑定一个拒绝代理，**不转发任何上游请求**。Node HTTP(S) 环境变量与 Chromium 代理均指向它，分别发送探针并确认各有请求到达代理、且请求失败。现场共观察到 6 次被拒绝请求，不记录 URL、请求头或应用清单。这比之前只设置 Node 环境代理的名称验证多覆盖了 renderer 图片请求。

图片先等待实际解码、核对尺寸，再通过同一 Electron 网络会话读取图片字节并计算 SHA-256；数据 URL 同样读取真实字节。截图只裁剪应用面板。报告仅保留指定应用字段、版本、布尔检查结果及哈希，不保存设备 key、原始应用日志或原始异常内容。独立审查后为验证流程增加 120 秒期限和关闭进程的兜底，报告写入失败也执行临时配置清理；成功状态仅在期限内完成后写入。结束后清理隔离配置及文件接收探针。

应用代码使用独立检出构建，避免混入主工作区其他改动。完整 build、66 项测试、lint 和脚本语法检查通过；保留既有 Vite/Sass 警告，不把 build 当作完整类型检查。报告记录元数据源码、renderer 源码、主进程构建和验证脚本的哈希。验证脚本初轮因 Electron 求值环境无直接 require、图标视图按名称过滤而超时，修正脚本后复测；这些不是应用图标故障。

另外以缺失构建目录、报告目标被同名目录占用两种实际失败条件执行脚本：两次均非零退出且未遗留新建临时配置。这些失败路径检查未连接设备；未将其计入真机验收。

```powershell
npm run build
node script/check-bundle-icon-live.mjs release/m1-3-icons/online
node script/check-bundle-icon-live.mjs release/m1-3-icons/offline offline
```

这属于未打包源码验证，不覆盖打包应用、进程内由联网切换到离线的热缓存、设备断连重连或所有系统版本。样本元数据仍是 `app_gallery / release`，不能宣称 debug 签名侧载已通过。

## 图标读取阻塞与下一步

1. 设备返回 `iconPath=$media:app_icon` 和资源 ID，未给出可直接读取的图片路径。`bm dump -h` 有 label 选项，无 icon 选项；设备 BundleMgr 的帮助也未列出图标导出。官方 [bm 实现](https://github.com/openharmony/bundlemanager_bundle_tool/blob/master/frameworks/src/bundle_command.cpp) 的名称查询通过 `DUMP_BUNDLE_LABEL` 返回文本，不能当作图片接口。
2. 使用该应用真实模块元数据中的 HAP 和 resources.index 路径分别执行 HDC 文件接收，两者均返回权限拒绝，没有取得文件字节。上游候选 [PR #29](https://github.com/liriliri/echo/pull/29) 对可读图片路径的处理不适用于本次资源引用；没有据此加入未经设备验证的路径猜测或文件读取实现。
3. 官方 [bundleResourceManager 文档](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/reference/apis-ability-kit/js-apis-bundleResourceManager-sys.md) 提供图标资源接口，但标为系统接口并要求 `ohos.permission.GET_BUNDLE_RESOURCES`；[服务实现](https://github.com/openharmony/bundlemanager_bundle_framework/blob/master/services/bundlemgr/src/bundle_resource/bundle_resource_host_impl.cpp) 也有调用者与权限检查。这仅是后续调查线索，不能推断桌面 HDC 已具备该接口或当前设备可调用。
4. 用户确认没有本地 bilibili HAP。本轮未安装、卸载、清理应用数据或提升权限。继续实现离线图标前，需要可读的 bilibili HAP/资源样本，或先验证当前设备提供的授权图标读取接口；不能使用其他应用替代。

最终提交的必需 CI 状态见 [PR 检查页](https://github.com/MonsterXia/scrcpy-harmony/pull/18/checks)。CI 不包含本地设备，也不能代替上述未通过的离线图标验收。
