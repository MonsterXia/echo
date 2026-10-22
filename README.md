<div align="center">
  <a href="https://github.com/MonsterXia/scrcpy-harmony" target="_blank">
    <img src="https://echo.liriliri.io/icon.png" width="400">
  </a>
</div>

<h1 align="center">Scrcpy Harmony</h1>

<div align="center">

鸿蒙 HDC 桌面应用。

[![Windows][windows-image]][release-url]
[![macOS][mac-image]][release-url]
[![Downloads][download-image]][release-url]
![License][license-image]

</div>

[windows-image]: https://img.shields.io/badge/-Windows-blue?style=flat-square&logo=windows
[mac-image]: https://img.shields.io/badge/-macOS-black?style=flat-square&logo=apple
[download-image]: https://img.shields.io/github/downloads/MonsterXia/scrcpy-harmony/total?style=flat-square
[release-url]: https://github.com/MonsterXia/scrcpy-harmony/releases
[license-image]: https://img.shields.io/github/license/MonsterXia/scrcpy-harmony?style=flat-square

<img src="https://echo.liriliri.io/screencast.png" style="width:100%">

[Scrcpy Harmony](https://github.com/MonsterXia/scrcpy-harmony) 是一个用于简化对鸿蒙设备操作控制的桌面应用程序，可以看作是 HDC 的图形用户界面。

## 项目来源与维护

本项目基于 [liriliri/echo](https://github.com/liriliri/echo)，由 MonsterXia 独立维护。2026-10-21 已解除 GitHub fork 关系，保留代码来源与历史。原作者为 surunzi，保留上游提交历史、署名及 AGPL-3.0 许可证。仓库名为 `scrcpy-harmony`，应用名为 Scrcpy Harmony，npm 包名为 `scrcpy-harmony`；本项目是基于 HDC 的 Electron 应用。

问题反馈、下载和后续版本以本仓库为准。应用 ID 为 `io.github.monsterxia.scrcpyharmony`，与上游 ECHO 分开安装并使用新的用户配置目录。旧配置保留原处，不会自动迁移。本页界面图片来自上游，仅供功能参考，可能与当前名称和界面不同。

## 主页与问题反馈

- [项目主页](https://github.com/MonsterXia/scrcpy-harmony#readme)：本仓库 README，包含安装、功能与维护说明。
- [问题反馈](https://github.com/MonsterXia/scrcpy-harmony/issues)：先搜索已有报告，再通过 New issue 提交。应用内也可从“帮助 → 报告问题”（Help → Report Issue）打开此入口。

反馈时请提供 Scrcpy Harmony 版本、桌面系统、设备型号与 HarmonyOS/HDC 版本、复现步骤、预期与实际结果；附上相关日志或截图前，请移除设备标识及其他个人信息。

## 维护与开发入口

- [用户指南](docs/user-guide.md)：安装、调试授权、设备选择、投屏与输入、日志保存和常见失败。
- [构建指南](docs/build-guide.md)：从干净检出准备依赖和资源，在 Windows/macOS 构建与启动 Electron。
- [分阶段维护 RUNBOOK](RUNBOOK.md)：待办、优先顺序、验收条件及交接记录。
- [维护来源记录](docs/maintenance/SOURCES.md)：上游 Issue/PR、本仓库已完成 PR 和归档说明。
- [维护者开发与验证参考](.agents/skills/scrcpy-harmony-project/references/development.md)：模块验证脚本、打包和 CI 细节。
- [变更记录](CHANGELOG.md)：独立维护后的发行改动与上游历史版本。

## 安装

点击[这里](https://github.com/MonsterXia/scrcpy-harmony/releases/)下载并安装 Scrcpy Harmony，支持 Windows x64，Mac arm64 平台和 Mac x64 平台。首次独立发行版为 [1.0.2](https://github.com/MonsterXia/scrcpy-harmony/releases/tag/v1.0.2)，上游安装包不包含本项目的改动。

**1.0.2 的安装包未做发行者签名或 macOS 公证，macOS Gatekeeper 检查未通过。** 三平台安装启动检查已通过，签名报告、校验清单和未验证范围见 [发布记录](docs/releases/1.0.2.md)。

当前使用 Electron 45，macOS 需要 13 或更新版本。安装包包含设备资源，普通用户无需安装 Node.js。开启设备 USB 调试并授权电脑后，在主窗口刷新、选择设备，再点“投屏”；完整步骤及日志保存注意事项见[用户指南](docs/user-guide.md)。

截至 2026-10-22，公开发行版为 **1.0.2**；master 后续的设备枚举、应用读取和名称回退修复尚未发行，不能用 master 的验收结果代替 1.0.2。源码构建的包版本目前也显示 1.0.2，反馈时请附提交号。

开发需要 Node.js 22.12.0 或更新版本、Git 子模块及锁文件安装，按[构建指南](docs/build-guide.md)执行。应用必需 Electron 主进程与 preload；单独打开 Vite 页面不能作为浏览器版使用。

## 功能

<img src="https://echo.liriliri.io/screenshot.png" style="width:100%">

* 设备概览、截图与按键操作
* 投屏、触控与文本输入
* 应用安装、管理和信息查看
* 进程监控、HiLog 与交互终端
* 布局查看、端口转发与 WebView 调试

## 相关项目

* [licia](https://github.com/liriliri/licia): Scrcpy Harmony 使用的工具库。
* [luna](https://github.com/liriliri/luna): Scrcpy Harmony 使用的 UI 库。
* [vivy](https://github.com/liriliri/vivy): 图标生成工具。
* [hdckit](https://github.com/liriliri/hdckit)：基于 Node.js 实现的鸿蒙 HDC 客户端。
