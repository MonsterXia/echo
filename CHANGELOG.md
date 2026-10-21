# 变更记录

## 未发布：Scrcpy Harmony 独立维护

以下是已合入源码的改动，不代表已发布新的安装包；package.json 当前仍为 1.0.1。正式发布时确定新版本号并移动本节。

* 更名为 Scrcpy Harmony，包名改为 scrcpy-harmony，应用 ID 改为 io.github.monsterxia.scrcpyharmony；旧 ECHO 配置不自动迁移。[PR #8](https://github.com/MonsterXia/scrcpy-harmony/pull/8)
* 下载、反馈与更新源切换到本仓库，保留上游署名、许可证和历史。[PR #8](https://github.com/MonsterXia/scrcpy-harmony/pull/8)
* 修复投屏图像尺寸与触控尺寸不同导致的坐标偏移，并明确投屏分辨率比例。[PR #1](https://github.com/MonsterXia/scrcpy-harmony/pull/1)
* 固定 Electron 45，跟踪依赖锁文件；Windows 构建编排不再依赖 Bash。增加测试、lint 及 Windows/macOS 双架构打包安装启动 CI。[PR #3](https://github.com/MonsterXia/scrcpy-harmony/pull/3)、[PR #4](https://github.com/MonsterXia/scrcpy-harmony/pull/4)、[PR #5](https://github.com/MonsterXia/scrcpy-harmony/pull/5)、[PR #6](https://github.com/MonsterXia/scrcpy-harmony/pull/6)、[PR #7](https://github.com/MonsterXia/scrcpy-harmony/pull/7)
* 建立 [分阶段维护 RUNBOOK](RUNBOOK.md) 和 [来源记录](docs/maintenance/SOURCES.md)，同步维护文档。

## 上游 ECHO 历史版本

下列版本记录继承自 liriliri/echo；原日期、问题链接和版本号按历史保留，不表示本仓库已经发布同名发行版。

## v1.0.1 (2025年12月2日)

* 修复：6.x 获取物理分辨率失败

## v1.0.0 (2025年9月25日)

* 修复：投屏触摸移动事件 [#10](https://github.com/liriliri/echo/issues/10)

## v0.8.1 (2025年7月29日)

* 修复：macOS 平台已损坏提示

## v0.8.0 (2025年6月4日)

* 新特性：优化终端面板界面
* 修复：网页面板检测不到调试目标时不刷新

## v0.7.0 (2025年4月24日)

* 新特性：支持 hilog 日志面板

## v0.6.2 (2025年4月18日)

* 修复：windows dll 缺少

## v0.6.1 (2025年4月18日)

* 修复：投屏报错

## v0.6.0 (2025年4月17日)

* 新特性：投屏支持设置缩放比
* 新特性：投屏支持输入文本
* 新特性：支持 macOS x64 平台

## v0.5.0 (2025年4月16日)

* 新特性：支持投屏

## v0.4.0 (2025年4月12日)

* 新特性：支持 webview 调试
* 新特性：支持管理端口映射

## v0.3.0 (2025年4月10日)

* 新特性：主题色调整
* 新特性：自动监听设备连接

## v0.2.0 (2025年4月6日)

* 新特性：退出应用时关闭 HDC
* 新特性：检查更新

## v0.1.0 (2025年4月1日)

初版本发布。
