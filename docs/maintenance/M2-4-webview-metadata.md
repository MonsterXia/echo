# M2-4 WebView 目标元数据展示

日期：2026-10-23。基线 `e52021a60a2e2d93c786c190bdda04210823f2f6`；分支 `codex/webview-metadata-rendering`。

## 已确认缺陷与最小修复

`Webview.tsx` 将带 favicon 的目标标题插入 HTML 字符串，交给 `licia/toEl` 解析。`faviconUrl` 同样插入双引号属性。真实 Luna DataGrid 遇到 DOM 节点会直接挂入单元格，因此设备调试端点返回的标题可成为元素，图标值中的引号可结束 src 属性并产生额外属性。不带 favicon 的标题原本由表格的文本赋值展示，是通过的对照。

修复仅移除该组件中的 `toEl`：用 `document.createElement` 创建 span/img，单独赋值 `img.src`，以 `document.createTextNode` 添加标题。没有将元数据重新交给 HTML 解析器。标题中的标签、实体和引号按原文显示。

本次不增加 URL 协议白名单：需要消除的是拼接造成的 HTML/属性注入，DOM 属性赋值可以独立修复它；HTTP、HTTPS、data 图标语义保持兼容。此结论不意味着任意 URL 都安全，也不验证图片下载、解码或 Electron 权限隔离。设备发现、轮询、IPC、外部浏览器/DevTools URL 策略和捕获代码没有修改。

## 可重复验证

`test/webview-metadata.test.cjs` 执行真实 Webview、React hooks/MobX observer、安装版 Luna DataGrid 和 toolbar。仅替换 IPC、轮询时钟、共享图标的展示转发及 resize 边界；没有复制生产展示逻辑。断言读取真实 grid 单元格 DOM，并通过实际选择和工具栏点击检查打开动作。jsdom 未启用脚本执行或外部资源加载，所有标题/URL/目标均为合成样本。

| 检查 | 实测结果 |
| --- | --- |
| 修复前 `node --test test/webview-metadata.test.cjs` | 1 通过、5 失败。无图标文本对照通过；含 favicon 标题的 `<b>` / `<svg>` 被解析，实体被解码；引号图标值的 src 被截断；三种图标模式下 `<literal>` 均消失。失败为产品行为断言。 |
| 修复后新增专项 | 6/6；标题文本、无注入元素/事件属性、src 原值、图标兼容及选中后打开动作通过。 |
| `node --test test/webview-metadata.test.cjs test/webview-lifecycle.test.cjs` | 23/23；既有轮询、切换、失败清空与刷新选择回归保持通过。 |
| 在 `fs.readFileSync` 边界拒绝读取 `src/share` 后运行上述两份测试 | 23/23；新夹具适用于 CI 不初始化共享子模块的检出。 |
| `npm test` | 430/430，0 fail / cancelled / skipped。 |
| `npm run lint` | exit 0。 |
| `npm run build:renderer` | exit 0；保留现有 Vite CJS、Sass if()、licia eval 和大 chunk 警告。 |

本轮在独立工作树使用已有独立依赖及 dist，没有访问 HDC/手机、应用清单、HAP 或真实应用信息，也未发布版本。合成用例证明 DOM 注入和文本损坏边界，不声称已在真实 Electron 执行注入脚本或已验证完整浏览器安全。

## 状态与下一步

局部修复和本地验证已完成，最终提交的独立 OpenAI（GPT-6）Review 与五项必需 CI 待主对话安排，再决定合并。M2-4 保持进行中，真实 WebView/Chrome 对照、断连恢复和 DevTools 加载仍待授权验收。

整合补充：初始 `61026be` 已获 [独立审查](https://github.com/MonsterXia/scrcpy-harmony/pull/51#pullrequestreview-5629990151)，但早期 CI 的既有响应追踪 GC 测试失败，不能将此前本地 430/430 等同首轮 CI 成功。修复该测试的 [#52](https://github.com/MonsterXia/scrcpy-harmony/pull/52) 已独立审查、五项 CI 通过并合入 master `b755306eb4e388053a0eab2f8ee7321b316793dd`；本分支普通 merge 同步，保留双方 RUNBOOK，WebView 实现和测试均未变。同步后 WebView 与响应诊断组合 41/41、全量 431/431、lint 通过；最终候选仍需增量独审及重新运行的五项 CI。本轮无设备访问。
