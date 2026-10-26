---
name: scrcpy-harmony-project
description: Use when analyzing, developing, debugging, reviewing, or building this scrcpy-harmony repository, the Scrcpy Harmony Electron desktop app for HarmonyOS HDC, including screencast, touch input, device tools, IPC, and packaging.
---

# Scrcpy Harmony 项目基础

用于本仓库的持久项目上下文。代码路径均相对仓库根目录，参考文档链接相对本 skill。目录与构建说明已按 2026-10-24 依赖源码迁移更新；源码与文档不一致时，以当前源码为准并修正文档。

## 快速定位

这是单包 Electron 应用，不是原生 scrcpy C/Java 服务端，也不是独立 Web 服务。核心依赖是 React、MobX，以及 `vendor/packages/` 中本地维护的 Luna UI、Licia 和 `hdckit`，详见 `vendor/README.md`。

| 要处理的内容 | 优先入口 |
| --- | --- |
| 启动、窗口与生命周期 | `src/main/index.ts`、`src/main/window/` |
| IPC 参数和桥接 API | `src/common/types.ts`、`src/preload/main.ts` |
| 设备连接、HDC 能力 | `src/main/lib/hdc.ts`、`src/main/lib/hdc/` |
| 主窗口功能与状态 | `src/renderer/main/App.tsx`、`src/renderer/main/components/`、`src/renderer/main/store/` |
| 投屏、触摸坐标 | `src/renderer/screencast/lib/ScreencastClient.ts`、`src/main/lib/hdc/uitest.ts` |
| 构建、资源、打包 | `package.json`、`vite*.ts`、`script/` |
| 本地依赖二次适配 | `vendor/README.md`、`vendor/packages/*/src/`、`script/lib/` |
| 国际化、界面文案与语言切换 | [国际化开发流程](references/internationalization.md)、`src/common/langs/`、`src/share/common/langs/` |

## 按需读取

- 修改功能、追踪 IPC、理解状态或投屏：读 [架构与代码导航](references/architecture.md) 的相关章节。
- 配置环境、运行验证、启动或打包：读 [开发与验证](references/development.md)。
- 新增或修改用户可见文案、菜单、弹窗、语言设置或 UI 组件时，读 [国际化开发流程](references/internationalization.md)，同步简体中文和英文并执行词条检查。
- 查看迁移后目录与源码/产物对应关系：读 [仓库结构指南](../../../docs/repository-guide.md)。
- 分阶段修复与交接：读仓库根目录 [RUNBOOK](../../../RUNBOOK.md)；上游报告与 PR 的历史状态见 [来源记录](../../../docs/maintenance/SOURCES.md)。
- 普通小改只读对应入口及其直接依赖；以上导航不足时再扩大搜索。

## 关键约束

- 设备调用链为 renderer 的全局 `main` → preload `invoke` → 主进程 `handleEvent` → `hdckit`。新增接口时一并检查类型、桥接和处理器；事件名称需两端一致。
- `share/*` 来自本仓库跟踪的 `src/share`；图标源 `src/renderer/icon` 也为普通目录。v1.0.3 及更早 tag 才需要初始化子模块。`common/*` 对应 `src/common`，两者都是 Vite 别名。
- 投屏 JPEG 帧尺寸、CSS 显示尺寸和设备触摸尺寸是三个坐标空间。触摸使用 `getDisplaySize()` 的结果，不用请求的 `scale` 反推。
- 主窗口切换标签后，已访问面板仍挂载；异步任务和监听的清理不能只依赖标签切换。设备切换另有按 target key 重建机制。
- UI 延续 MobX + `observer`、Luna 组件、SCSS Modules；业务文案通过 `common/util.ts` 的 `t()`，同步维护 `src/common/langs/{en-US,zh-CN}.json`。共享文案在 `src/share/common/langs/`；不得把英文映射到中文字典或依靠 fallback 代替翻译。提交前运行 `npm run check:i18n`；修改布局或语言流程时补双语 UI 验证。
- 验证报告区分静态检查、无真机单测、Electron 运行与设备验证，不把其中一种当作其余几种已通过。

## 使用与维护

先确认当前工作目录和 `git status --short`，按表定位源码。需要构建时再检查本地依赖编译产物、共享源码和资源。新增知识只记录稳定的职责、链路及真实限制；不把本次任务日志、临时环境缺失或未经验证的推测写成永久规则。
