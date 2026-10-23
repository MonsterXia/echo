# 依赖源码迁移（2026-10-24）

状态：**进行中**。先发布的 [1.0.3 恢复节点](../releases/1.0.3.md) 已完成；迁移分支为 `codex/vendor-dependencies`，源码开发版 1.0.4-dev.0。

## 实现

- 锁定版本的 hdckit、Licia 和 16 个 Luna 包改为 `file:vendor/packages/*`，包括原传递依赖 luna-drag-selector；来源、LICENSE 和原始 manifest 保留。
- HDC/Luna TS、React 和 SCSS/icon CSS 由本仓 `build:vendor` 编译；共享源码在原路径转为普通文件。可直接修改本仓源码后重编译，无需上游发布。
- 按用户对长期二次适配的明确选择，Licia 改为导入 456 个原始模块、配套测试和上游生成规则参考。实现、依赖和类型片段在 `src/*.js` 一起维护；本仓生成运行 JS、声明及环境入口，生成文件不提交，不执行上游安装/发布脚本。
- Vite 显式处理本地链接的 CommonJS，开发模式准备并监听本地依赖。npm ci、测试及三个应用构建入口都会准备生成模块。
- 按用户追加要求，仅将应用根 package.json author 改为 MonsterXia；第三方原作者与许可证保留。发行目录增加 LICENSE 和 THIRD_PARTY_NOTICES.txt。

## 验证与限制

- 已验证：18 个包本地解析、无远端目标包锁条目、源码修改后重新编译生效、语法错误拒绝、CSS 选择器作用域、Luna/React 入口与 HDC 私有路径。
- 本地 456 项测试及 lint 通过；完整 main/preload/renderer 构建通过。早期同时运行 build 和 test 导致生成文件被重写、10 个 ENOENT，改为顺序验证后全部通过；不将并行输出目录当作隔离环境。
- Windows 打包及隔离配置启动通过：主窗口、设置页、IPC、实际 app.asar 内 author/许可证/第三方声明均校验，EXE CompanyName 为 MonsterXia；开发机未运行安装器。
- 开发服务器实际运行通过；临时修改本仓 Luna SCSS 后，自动编译生成的样式在 Electron renderer 生效，随后恢复原文件。
- 独立审查完成：1,155 个导入文件哈希与 manifest 一致，16 个 Luna CSS 的选择器集合与原 npm 包一致，两份共享源码与固定提交一致（检出换行差异除外）。已修复图标字体属性选择器未加前缀，以及重编译删除目录导致开发监听 ENOENT 两项问题；无遗留重要发现。
- 干净独立 clone 验证通过：在无 node_modules/生成产物的检出中执行 `npm ci --offline --no-audit`，使用已有 npm 缓存安装 597 个包并自动重编译 18 个本地包；5 项迁移测试再次通过，链接均位于该检出内。此结果不代表空缓存的工具链/二进制可以离线安装。
- 初版 [PR #55 CI](https://github.com/MonsterXia/scrcpy-harmony/actions/runs/39985794320) 五项全部通过；该轮还未包含用户随后选择的 Licia 原始源码生成方案。
- Licia 补充验证：458 个生成 JS 的规范化 AST（忽略格式/位置和等价属性键写法）与原 npm 包一致，459 个类型声明规范化后相同；生产和隔离 fallback 模式各通过 606 项上游 Node 用例，各有相同 4 项外部夹具测试 pending。原始浏览器/manual 测试保留但未自动运行。
- Licia 独立审查：456 个模块的环境/测试选择与上游索引一致，920 个新增原始文件哈希一致；fallback 隔离生成方案已复核，无阻塞发现。应用回归现为 457 项，全部通过；lint 与完整构建再次通过。最终源码方案的干净安装、打包开发验证及 PR CI 待补齐。
- 原始真机、无线和长期运行待验收状态不变。未声称完整类型检查、完全离线构建、签名或公证通过。可选 lsla 资产生成器不在正常 build 路径，本轮未迁移。

下一步：完成剩余检查和 PR，记录链接与真实结果后再标记迁移完成。使用方法和源码维护规则见 [vendor README](../../vendor/README.md)，详细设计和执行记录见 [计划](../superpowers/plans/2026-10-23-dependency-sources.md)。
