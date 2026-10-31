# 仓库结构与源码维护

[中文 README](../README_ZH.md) · [English README](../README.md) · [构建指南](build-guide.md) · [本地依赖维护](../vendor/README.md)

本指南对应 1.0.4 的依赖迁移后布局。公开状态见[发行记录](releases/1.0.4.md)；v1.0.3 是迁移前恢复版本，使用该 tag 时按它自己的文档初始化子模块。运行功能与 IPC 的详细导航见[架构参考](../.agents/skills/scrcpy-harmony-project/references/architecture.md)。

## 目录职责

```text
scrcpy-harmony/
├─ src/
│  ├─ main/                 Electron 主进程、窗口、HDC 与持久化
│  ├─ preload/              renderer 到主进程的 IPC 桥接
│  ├─ renderer/
│  │  ├─ main/              主窗口与设备管理面板
│  │  ├─ screencast/        投屏窗口与输入控制
│  │  └─ icon/              内置 SVG 图标源，普通跟踪目录
│  ├─ common/               类型、国际化、主题与应用公共逻辑
│  └─ share/                内置 Electron 共享源码，普通跟踪目录
├─ vendor/
│  ├─ manifest.json         固定版本、上游提交、许可证与导入哈希
│  └─ packages/
│     ├─ hdckit/src/        HDC 客户端 TypeScript
│     ├─ licia/             原始模块、测试与上游生成规则参考
│     └─ luna-*/src/        16 个 Luna 包的 TS/TSX、SCSS 与共享源
├─ script/                  资源准备、本地编译、打包与验收脚本
├─ test/                    应用及构建流程的 Node 回归测试
├─ build/                   已跟踪的应用图标资源
├─ docs/                    使用、构建、发行与维护记录
├─ .github/workflows/       测试、平台打包及手动产物构建
└─ .agents/skills/          项目代码导航与维护者参考
```

`package.json` 管理应用元数据、命令和依赖入口，`package-lock.json` 锁定 npm 依赖。`vite.config.ts`、`vite.main.ts`、`vite.preload.ts` 分别配置 renderer、main、preload 构建。`build/` 是源码资源目录，不能当作生成目录清理。

## 修改哪里、生成什么

| 修改入口 | 生成结果 |
| --- | --- |
| `src/main/` | `dist/main/index.js` |
| `src/preload/` | `dist/preload/index.js` |
| `src/renderer/`、`src/common/`、`src/share/` | 对应 main/preload/renderer 产物；共享源码保留原路径别名 |
| `vendor/packages/hdckit/src/` | 该包的 `dist/`，保留公共与应用使用的内部导入路径 |
| `vendor/packages/licia/src/*.js` | 该包根目录 JS、`.d.ts` 与 Node/browser 入口索引；实现、依赖和类型片段一起维护，测试在该包的 `test/` |
| `vendor/packages/luna-*/src/` | 对应包的 `cjs/`、`esm/`、声明及 `luna-*.css`；各版本共享源码分别保留 |
| `LICENSE`、`vendor/manifest.json` 与各包 LICENSE | `dist/LICENSE`、`dist/THIRD_PARTY_NOTICES.txt`，随安装包分发 |

依赖生成文件、`node_modules/`、`dist/`、`release/`、下载的 `resources/` 均不提交。修改原始文件和对应测试，再执行生成流程。`vendor/.build-stamp` 是开发服务器识别编译完成的内部标记，也不提交。

应用 SVG 源位于 `src/renderer/icon/`，主题源为 `src/common/theme.json`；它们与已跟踪的 `src/renderer/icon.css`、`theme.scss` 等文件属于原有资产工作流。可选 `gen:icon`/`gen:theme` 仍依赖根 package.json 未声明的 lsla，正常 build 不运行这些命令。修改前先确认生成工具，不要将其与自动构建的 Luna 图标 CSS 混淆。

## 构建与测试流程

```text
npm ci → postinstall → build:vendor
  ├─ HDC TypeScript → dist/
  ├─ Licia 原始模块 → CommonJS + 类型声明 + 环境索引
  └─ Luna TS/TSX + SCSS/icon CSS → cjs/esm/CSS

npm run build
  ├─ build:main / build:preload / build:renderer
  │    └─ 各自 prebuild 先执行 build:vendor
  └─ 复制资源、图标、许可证 → dist/ → 安装发行目录依赖

npm run pack -- --no-publish → 使用 dist/ → release/<version>/安装包
```

`file:vendor/packages/*` 保留 `hdckit`、`licia/trim`、`luna-setting` 等导入。`script/lib/vendor-vite.mjs` 处理本地 CommonJS 与开发预打包。原生 HDC 可执行文件仍由 `script/resources.mjs` 准备；内置 hdckit 客户端源码并不表示本仓可以编译原生 HDC。

| 命令 | 作用 |
| --- | --- |
| `npm run build:vendor` | 从本仓原始源码重建 18 个包，不下载包源码 |
| `npm test` | 重建本地包，再运行应用回归及 Licia 生产/fallback 两种 Node 测试模式 |
| `npm run test:licia -- cloneDeep` | 重建本地包，运行单个 Licia 生产模块测试 |
| `npm run test:licia -- --fallback cloneDeep` | 在隔离目录生成并检查兼容分支，不改生产产物 |
| `npm run lint` | 检查应用及内置共享 `src` 中的 TS/TSX，不等于所有上游源码 lint |
| `npm run dev` | 先编译本地依赖，再监听依赖及 main/preload，启动 renderer 服务 |
| `npm start` | 等上述构建就绪后启动 Electron，不是独立网页运行方式 |

依赖改动后等待编译和 Vite 重启完成，再手动刷新 renderer；main/preload 及其依赖的变化需要重启 Electron。不要在同一检出同时运行重写生成目录的 build/test/dev。外部工具链和设备资源仍需安装或下载；这些流程不是完全离线构建，也不是完整类型检查。

## 来源、更新与验证记录

HDC、Licia 和 Luna 保留原作者与 MIT 许可证，应用保留 AGPL-3.0 及历史署名。应用发布 author/Windows CompanyName 为 MonsterXia，不替换第三方作者。共享目录的上游快照没有独立 LICENSE，该事实记录在 manifest 中，没有新增虚构授权。

`manifest.json` 的 `importedFiles` 对应原始快照，本地适配由 Git 提交记录，不把修改后的哈希冒充上游原件。Licia 的 `publishedFiles` 是原 npm 生成产物的历史哈希；源码、测试和规则参考保留在包内。更新规则见 [vendor README](../vendor/README.md)和 [Licia 维护说明](../vendor/packages/licia/MAINTENANCE.md)。

安装启动、来源对照、测试排除和设备验收边界见[迁移验证记录](maintenance/dependency-sources.md)。长期状态见 [RUNBOOK](../RUNBOOK.md)，历史资料见[来源索引](maintenance/SOURCES.md)。历史验证只对应记录的提交，不能替代新修改自己的检查。
