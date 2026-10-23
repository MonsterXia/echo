# Licia 原始源码维护

本目录使用 manifest.json 中锁定的上游版本与 gitHead。`src/`、`test/`、`upstream/` 保留原文件及哈希，MIT 许可证和作者不变。

## 修改一个模块

1. 修改 `src/<名称>.js` 的实现及示例。`_('dependencyA dependencyB types')` 声明内部依赖；`types` 只用于类型声明，不进入运行时依赖。
2. 同步文件中的 `/* typescript ... */` 类型片段和 `test/<名称>.js`。只改运行实现而不检查类型、测试，仍可能造成接口不一致。
3. 在仓库根目录运行 `npm run test:licia -- <名称>`；兼容分支使用 `npm run test:licia -- --fallback <名称>`。提交前运行 `npm test`、lint 和应用构建。

`npm run build:vendor` 生成包根目录的 CommonJS JS、`.d.ts`、`node.js`/`browser.js` 及类型入口。这些文件不提交，也不应手改。`npm run dev` 监听 `src/` 并自动重编译；等待编译和 Vite 重启就绪后，手动刷新 renderer，主进程使用的模块改变后重启 Electron。

新增模块需要合法标识符文件名、`module` 元信息及 `typescript` 块；`env: all` 展开为 Node、浏览器和小程序，其他环境使用空格分隔。入口索引从原始模块自动生成，无需修改 `upstream/index.json`。原有原生全局对象的类型块可以为空；缺失依赖、无效 JS 或声明语法会使构建失败，并保留上一次有效输出。此语法校验不是完整类型检查。

## 本地构建边界

`script/lib/licia-build.mjs` 按上游 `lib/build.js` 适配，保留环境相关的六项 Babel 转换、CommonJS 依赖生成、类型提取和入口生成。`upstream/build.js`、`util.js`、`source-package.json` 和测试模板用于维护时对照；不执行其中安装脚本，不依赖 eustia、lsla 或上游网站/发布工程。

升级上游时同时对照原始模块、生成规则和测试；更新来源与导入哈希，单独记录本地补丁。生成器与上游同步仍是维护责任，不能把一次输出对照当作未来升级自动兼容的保证。

## 测试范围

`script/test-licia.mjs` 按源码 `module.test`/`module.env` 元信息选择 Node 测试，用本地生成的模块运行原始测试和 helper。默认检查生产产物；`--fallback` 在临时目录重新生成 `LICIA_TEST=true` 的模块，覆盖被现代原生 API 绕过的兼容实现，不覆盖仓内生产产物。文件及压缩样本在唯一临时目录内运行，结束清理；不执行测试中的安装指令。`npm test` 包含生产和 fallback 两种模式；指定模块不符合 Node 自动测试条件时明确报错。

四项原始测试暂不自动运行：`ajax`、`fetch` 需要上游 Sinon 夹具；`lazyImport`、`lazyRequire` 依赖特定 underscore 安装及目录布局。它们保留原文件，并在完整测试中显示 pending；指定这些模块会说明原因，不会悄悄跳过或下载依赖。上游浏览器专用和 manual 测试也未接入 Node 流程；涉及它们的修改需补对应验收，应用 Electron 冒烟不等于全部 Licia 浏览器测试。
