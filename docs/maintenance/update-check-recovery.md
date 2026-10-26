# Check for Updates 无反馈修复

日期：2026-10-26（Asia/Shanghai）。用户反馈检查更新损坏；本次在保留此前投屏修复的同一工作区实施；下列本地证据对应两项修复同时存在的源码，未发布或覆盖安装包。

## 原因与现场

在正在运行的本地 dist 的投屏窗口中，实际点击应用菜单的 Check for Updates，无提示。主进程日志出现 `Skip checkForUpdates because application is not packed and dev update config is not forced`。已核对当前安装的 electron-updater 源码：未打包且未显式允许开发检查时返回 null，不发“无更新”事件；调用方没有处理这个分支。

此外，结果原来只发送到主窗口的 renderer 弹窗，投屏窗口在前台（尤其置顶）时可能看不到。检查 Promise 未消费拒绝；通道 setter 会隐式允许降级，开发版还默认允许预发布，与项目 latest/latest-x64 的稳定发布通道不一致。GitHubProvider 的实际实现证实该组合会影响标签选择。

## 修复

- 项目 updater 在显式 GitHub feed 下允许本地构建检查元数据；保留 Windows/macOS arm64 的 latest、macOS x64 的 latest-x64，明确禁用预发布选择、降级、自动下载和退出安装。开发版不会把旧正式版当作更新，未来更高正式版仍可识别。
- 共享 checkUpdate 返回并合并在途 Promise，消费网络/初始化异常，对 error 事件加 rejection 只提示一次；null 不能当作“无更新”。菜单检查期间禁用并显示 Checking for Updates，提示关闭后恢复。
- 更新结果改为附着当前窗口的系统对话框，覆盖置顶投屏场景；移除主窗口 renderer 的旧更新弹窗监听。发现更新时只在用户确认后打开 Releases，不下载或安装。
- 从实际 package.json homepage 构造下载页时清除 fragment/query，避免 `#readme/releases` 错误地址。

独立复审指出置顶遮挡和首页 fragment 拼接两项，均以失败回归验证后修复；最终只读复审未发现剩余阻断。

## 验证

- 修复前新增用例复现失败：本地配置开关缺失、窗口不可见、Promise 不可等待、错误分支和在途请求缺口；下载页用例使用真实 package.json 再现 fragment 错误。
- 13 项更新专项通过。包括真实 AppUpdater/GitHubProvider 加合成 HTTP：本地启用、稳定标签选择、1.0.4-dev.0 不接受 1.0.3 降级但接受 1.0.4；系统对话框父窗口、确认/取消、异常去重及销毁后不再弹窗。
- 全量应用 **630/630**，Licia 生产/fallback 各 **606 passing / 4 pending**，lint 通过。4 pending 为既有外部夹具，不属于本功能失败。
- 完整 `npm run build` 通过。随后通过真实桌面菜单检查 GitHub，观察到禁用的 Checking for Updates…，完成后系统对话框显示 There are currently no updates available，关闭后菜单恢复 Check for Updates。
- 实际日志两次记录当前 1.0.4-dev.0、稳定源 1.0.3、downgrade is disallowed；一次来自主窗口，一次在临时置顶投屏窗口中发起，结果系统对话框均可见。置顶测试结束恢复原设置并返回投屏；未点击下载、未安装、未保存屏幕截图。
- 未制造真实网络中断；错误和有更新确认/取消由隔离自动回归覆盖。实际可用下载页面来自 [GitHub Releases](https://github.com/MonsterXia/scrcpy-harmony/releases)，本轮没有下载发行资产。
- 最终本地构建 main SHA-256：`1c68a1d6df820f958fab98bee1ec57c91111f7669f748290ea5b0cc186703163`。当前运行的本地构建已包含本次更新检查修复和此前投屏修复，已安装 app 未替换。

范围：以上自动测试替换网络和 Electron 窗口边界，不代表下载、安装、签名或跨平台实际更新验收。当前功能始终是查询元数据后引导用户手动下载。

## 交付与下一步

按用户授权以独立 PR 提交更新检查修复，审查与五项 CI 通过后合入；[交付 PR 的实时状态](https://github.com/MonsterXia/scrcpy-harmony/pulls?q=is%3Apr+head%3Acodex%2Ffix-update-check)。安装包发布和跨平台真实更新验收仍未完成，不随源码合入标记完成。
