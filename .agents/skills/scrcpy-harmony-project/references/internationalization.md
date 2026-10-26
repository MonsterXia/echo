# 国际化开发流程

适用于新增或修改用户可见文案、菜单、提示、弹窗、无障碍标签、UI 组件及语言设置。当前支持 **English (`en-US`)** 和 **简体中文 (`zh-CN`)**。不要将第三方数据、协议值或日志当成待翻译界面文案。

## 代码入口和运行约定

- 业务词条：`src/common/langs/en-US.json` 与 `zh-CN.json`。业务代码从 `common/util` 导入 `t`，它注册两份独立词典并合并共享词条。
- 共享窗口/组件词条：`src/share/common/langs/`；共享代码从对应 `share/common/i18n` 导入。已有词条语义相同时复用，不为同一含义添加新 key。业务和共享层的同名覆盖应保持相同含义。
- `src/share/common/i18n.ts` 提供格式化、英文兜底及 `resolveLocale`。未知 key 显示 key 以便诊断；检查器应在交付前拦截，兜底不是允许漏翻译。
- `src/share/main/lib/language.ts` 在启动时读取 settings.json 的 `language`，显式设置优先；`system` 或无效设置使用系统语言，不支持的系统语言使用英文。英语地区变体归 `en-US`，中文地区/脚本变体归 `zh-CN`（当前没有繁体词典）。
- 设置页提供系统、English、简体中文，使用语言自称方便跨语言切换。低频 settings 使用 `src/main/lib/SettingsStore.ts` 同步临时文件替换保存，IPC 返回前落盘，避免选择后立即重启丢失；窗口几何信息继续使用防抖 FileStore。保存后提示重启，由用户点击重启按钮应用；不要自动重启或刷新正在投屏的窗口。
- `src/renderer/lib/language.ts` 在页面懒加载前同步业务 i18n、`document.documentElement.lang` 与 `LunaModal.i18n`。这保证模块顶层初始化的表头和第三方确认框一致。不要让第三方组件单独依赖 navigator.language。

## 每次开发的步骤

1. **定位可见文案。** 检查新增/修改的正文、空态、错误、菜单、tooltip、placeholder、文件选择过滤名称、aria-label，以及第三方控件默认文本。动态设备名、路径等作为插值数据传入。
2. **同步两种语言。** 在正确层的两个 JSON 中同时增加/修改语义明确的 camelCase key。用完整句子和命名占位符，避免拼接句子、中文充当英文或仅写一份翻译。计数可用不依赖单复数的完整文案（例如 `Applications: {{total}}`）。
3. **接入显示位置。** 使用 `t('key', { name })`。条件文案用 `t(condition ? 'keyA' : 'keyB')` 或显式翻译映射，使检查器能核对所有 key。不要用任意运行时字符串组装 key。不要翻译之后再把值用于协议判断、命令或持久化枚举。
4. **验证。** 运行 `npm run check:i18n`；语言选择、fallback、插值或组件初始化有改动时运行 `node --test test/i18n*.test.cjs`。按改动范围执行 lint、应用测试和构建。检查器同时在 lint 和应用测试中执行，CI 沿用现有检查名称。
5. **双语 UI 验收。** 涉及布局或组件时，在两种语言分别检查页面/菜单/弹窗、长文案换行与按钮可见性、空态与错误提示；涉及语言设置时检查保存、重启、所有窗口标题和确认框。记录运行环境和未验证项，不把词条静态检查当作视觉验收。

示例：

```tsx
notify(t('bundleInstalling', { path: hapPath }))
```

两份翻译都必须保留 `{{path}}`。插值包含外部文本时沿用组件文本渲染，不把翻译当可执行 HTML。Luna 的部分 description 支持 Markdown，LunaModal.confirm/alert 的字符串内容也按 HTML 渲染：向这些槽位插入外部应用名等数据时，应对完整译文做 HTML 转义或传入文本节点；不能照搬未转义的旧调用。不要为了翻译而改变协议值或去除转义。

## 检查器与审查边界

`script/check-i18n.mjs` / `script/lib/i18n-check.mjs` 检查词典存在、重复 key、非空文本、双语 key/占位符一致，及 `src` 中显式 t 调用、JSX 正文和常见可见属性的硬编码。它不是任意数据流分析器，不能替代对变量、模板、options 标签和第三方默认文本的人工审查。

HDC、CPU、PID、URL、FPS 等技术标识可原样保留。检查器例外以文件和精确值登记，并说明原因；不要豁免整个目录或新增普通句子来绕过检查。语言自称、日志级别、命令、包名/应用名、设备返回属性、内部错误日志及诊断时间戳保持原始语义；应用不声称翻译设备内容。新增面向用户的错误应转换成可操作的本地化提示，详细原因留在日志。

新增语言时需同时补两个词典层、resolveLocale、设置选项、检查器语言列表和回归，并验证第三方组件的语言支持。没有完成翻译与界面验收时，不展示为已支持语言。
