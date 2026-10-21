<div align="center">
  <a href="https://echo.liriliri.io/" target="_blank">
    <img src="https://echo.liriliri.io/icon.png" width="400">
  </a>
</div>

<h1 align="center">ECHO</h1>

<div align="center">

鸿蒙 HDC 桌面应用。

[![Windows][windows-image]][release-url]
[![macOS][mac-image]][release-url]
[![Downloads][download-image]][release-url]
![License][license-image]

</div>

[windows-image]: https://img.shields.io/badge/-Windows-blue?style=flat-square&logo=windows
[mac-image]: https://img.shields.io/badge/-macOS-black?style=flat-square&logo=apple
[download-image]: https://img.shields.io/github/downloads/liriliri/echo/total?style=flat-square
[release-url]: https://github.com/liriliri/echo/releases
[license-image]: https://img.shields.io/github/license/liriliri/echo?style=flat-square

<img src="https://echo.liriliri.io/screencast.png" style="width:100%">

[ECHO](https://echo.liriliri.io/) 是一个用于简化对鸿蒙设备操作控制的桌面应用程序，可以看作是 HDC 的图形用户界面。

## 安装

点击[这里](https://github.com/liriliri/echo/releases/)下载并安装 ECHO，支持 Windows x64，Mac arm64 平台和 Mac x64 平台。

当前源码使用 Electron 45，macOS 需要 13 或更新版本。开发环境需要 Node.js 22.12.0 或更新版本；初始化子模块后执行 `npm ci` 安装锁定的依赖。开发与验证步骤见 [项目开发指南](.agents/skills/scrcpy-harmony-project/references/development.md)。

## 功能

<img src="https://echo.liriliri.io/screenshot.png" style="width:100%">

* 应用管理
* 进程监控
* 布局查看
* 交互终端

## 相关项目

* [licia](https://github.com/liriliri/licia): ECHO 使用的工具库。
* [luna](https://github.com/liriliri/luna): ECHO 使用的 UI 库。
* [vivy](https://github.com/liriliri/vivy): 图标生成工具。
* [hdckit](https://github.com/liriliri/hdckit)：基于 Node.js 实现的鸿蒙 HDC 客户端。
