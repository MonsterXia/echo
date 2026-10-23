# 本地依赖源码

本次迁移以已发布的 [v1.0.3](https://github.com/MonsterXia/scrcpy-harmony/releases/tag/v1.0.3) 为恢复节点。当前源码开发版为 1.0.4-dev.0，不是另一个已发布 Release。

## 修改与编译

| 内容 | 可维护源码 | 生成结果 |
| --- | --- | --- |
| HDC 客户端 | `packages/hdckit/src/**/*.ts` | `packages/hdckit/dist/` |
| Luna 组件和 React 包装 | `packages/luna-*/src/**/*.ts`、`*.tsx` | 对应包的 `cjs/`、`esm/` 与声明文件 |
| Luna 样式与图标 | 对应 `src/<组件>/style.scss`、`icon.css` 及 `src/share/*.scss` | 包根目录 `luna-*.css` |
| Licia 工具 | `packages/licia/*.js` 及声明 | 直接由 Node/Vite 使用，无独立生成步骤 |
| 共享 Electron 和图标源 | 仓库 `src/share`、`src/renderer/icon` | 随应用构建；不再是 Git 子模块 |

直接编辑这些源码并提交到本仓库即可，不要改 `node_modules` 或被忽略的生成文件。

```text
npm ci
npm run build:vendor
npm test
npm run build
npm run pack -- --no-publish
```

`npm ci` 的 postinstall 编译本地包；使用 `--ignore-scripts` 安装后，手动运行 `build:vendor`。三个 `build:*`、`test` 和 `dev` 入口会先准备源码产物。`npm run dev` 监听 HDC/Luna 的源码与样式；成功重编译后刷新 renderer 的依赖缓存。主进程/preload 改动仍需重启 Electron。Licia JS 直接加载，开发服务器监听其修改。不要同时在同一检出运行会重写生成目录的 build/test/dev，使用独立检出并行验证。

TypeScript 编译使用 `noCheck` 生成模块与声明，不是完整类型检查。Luna 保留每个锁定版本自己的共享源码，防止不同发布日期的组件被无意混成同一版本。应用使用的包入口、React 和 CSS 导入保留；未使用的预打包浏览器 UMD 入口不再提供。

## 来源、许可证与更新

`manifest.json` 记录 18 个包的版本、npm integrity、发布 gitHead、源码归档 SHA-256 与首次导入文件 SHA-256。Licia 使用对应 npm 包的未压缩 JavaScript 模块；HDC/Luna 从对应 gitHead 的原始 TS/样式编译。`upstream-package.json` 是原始发布元数据；本地 `package.json` 只保留所需依赖及入口、移除上游构建脚本，并标记 private。

HDC、Licia、Luna 的 MIT 原文和作者信息保留在各包 LICENSE。两份共享源码按原固定提交内置；这些上游快照没有独立 LICENSE 文件，manifest 如实记录，不虚构 MIT 授权。应用本身继续保留 AGPL-3.0 和历史署名。应用发布元数据 author 为 MonsterXia；此变更不覆盖第三方作者。完整构建将 LICENSE 和汇总 THIRD_PARTY_NOTICES.txt 放入发行包。

适配时记录修改动机和测试，更新本仓提交；manifest 的 importedFiles 代表首次导入原件，不要把本地修改冒充原始上游。升级上游时单独提交版本/来源变化、原件哈希和本地补丁差异，运行整个回归和三平台构建，禁止用上游最新分支覆盖当前源码。生成目录不提交，干净 npm ci 必须能够重建。

## 外部依赖边界

这消除了上述 npm 包与两个 Git 子模块的下载需求；Electron、React、Vite、TypeScript、Sass/PostCSS 等通用工具链、execa/micromark 等普通依赖仍按锁文件安装。HDC 原生可执行文件、uitestkit 资源和 Electron/打包工具仍需准备或下载，不宣称全链路离线或逐字节可复现。可选的应用图标/主题重新生成脚本仍调用原来的 lsla，未纳入本次正常构建路径。

恢复旧版本请用独立目录检出 v1.0.3 并初始化其子模块；或者直接安装该 Release 的已校验安装包。不要强制重置有未保存修改的迁移目录。
