# M4-2：桌面文本输入与剪贴板能力评估

## 状态与边界

2026-10-23 / Codex；基线 `8d1cfabbc683a2664fd5f12d2ce89bb61e47f6a8`，分支 `codex/m4-2-text-input`，独立 worktree、依赖与输出目录。本轮仅评估，生产代码、依赖和共享子模块均未修改。

**决定：暂缓实现，先验证输入目标与失败收敛契约，再另立最小实现任务；M4-2 保持待能力验证、未验收。** 现有链路能传递文本，但不等于“电脑复制后，在投屏中粘贴到当前设备输入框”已实现。重点缺口为固定坐标、单行弹窗、发送结果无人处理及缺少投屏粘贴路由。以下证据没有连接设备、调用 HDC、安装 HAP、读取系统剪贴板或接触真实应用数据；全部输入为合成字符串。

## 来源与版本

- [上游 #23](https://github.com/liriliri/echo/issues/23)：标题为“投屏功能未支持从window直接复制内容（文本）到输入框”；2026-03-20 创建，本次读取时 open、正文为空、评论为空。缺少系统版本和步骤，不能声称复现了报告者的设备场景。
- [应用固定基线](https://github.com/MonsterXia/scrcpy-harmony/tree/8d1cfabbc683a2664fd5f12d2ce89bb61e47f6a8)：下文源码路径均相对此基线。锁定 Electron 45.0.0、hdckit 0.12.1、luna-modal 1.3.3；share 子模块 `f9898acb070bbadb7d9b9ea2b72ec2e40c26e943`。当前应用加载 `uitest_agent_v1.1.0.so`，不能按最新 OpenHarmony API 推定其全部能力。
- [OpenHarmony UiTest API](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/reference/apis-test-kit/js-apis-uitest.md)：Driver 的两参数坐标输入自 API 11 起，API 20 增加 mode 重载，并列有不支持并发调用的错误码。公开文档与本仓库 agent 的适配关系仍待验证。
- [OpenHarmony 输入指导](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/application-test/uitest-guidelines.md)：坐标输入会点击目标位置后在光标处输入；中文/特殊字符可能走设备侧粘贴。组件输入与坐标输入不同，不能把前者的清空行为套用到后者。
- [Electron 45 clipboard](https://github.com/electron/electron/blob/v45.0.0/docs/api/clipboard.md)：本版本主进程 `readText()` 返回 `Promise<string>`；未来候选实现须 await，不能沿用旧版同步签名。[快捷键文档](https://www.electronjs.org/docs/latest/tutorial/keyboard-shortcuts)区分应用内与全局快捷键。
- [W3C Clipboard API and events（2026-06-24 草案）](https://www.w3.org/TR/2026/WD-clipboard-apis-20260624/)区分用户 paste 事件和异步剪贴板读取。此处用于设计边界，不作为 Electron 各平台权限实测证据。

## 当前真实路径

| 边界 | 当前源码与行为 | 判断 |
| --- | --- | --- |
| 文本按钮 | `src/renderer/screencast/components/Toolbar.tsx/inputText` 等待 LunaModal.prompt 后调用 main.inputText；未 await/return，也没有 catch、发送中状态或失败提示 | UI 在设备结果之前完成回调，拒绝可变成未处理拒绝 |
| 弹窗 | 安装的 `luna-modal/esm/modal/index.js/Modal.prompt` 创建 input，默认 type=text；Enter 确认、取消返回 null | 单行入口；LF/CRLF 在此边界已经丢失 |
| 类型、preload | `src/common/types.ts/IpcInputText` 返回 Promise<void>；`src/preload/main.ts` 与 `src/share/preload/util.ts` 返回 ipcRenderer.invoke | 桥接类型支持等待，toolbar 没有消费它 |
| 主进程 | `src/share/main/lib/util.ts/handleEvent` 返回 listener；`src/main/lib/hdc/uitest.ts/inputText` await getUiDriver 与 driver.inputText | 此处理器会等待、传播拒绝；不能把 UI 缺口归因于这里遗漏 await |
| 目标语义 | hdckit `dist/hdc/UiDriver.js/inputText(text,x=0,y=0)` 发送 `Driver.inputText`，参数为 `[{x:0,y:0},text]` | 应用没有传最后触点或明确输入框位置；公开 API 是坐标输入，不能承诺发送到当前焦点 |
| 文本协议 | 同文件 Connection.sendMessage 使用 JSON.stringify、UTF-8 Buffer 和字节长度封包 | 文本不拼入 shell 命令；协议保真不等于设备控件接受 |
| 投屏快捷键 | ScreencastClient 处理帧与 pointer，没有 paste/keydown 文本转发；主进程菜单只有通用 paste role | 本地粘贴动作没有被路由成设备文本输入 |
| 已有剪贴板读取 | `src/renderer/main/components/shell/Term.tsx` 读取后调用 writeShell | 属于终端 stdin；不可复用为设备 UI 输入，尤其换行可能执行命令 |
| 记录内容 | share 的 handleEvent 将 channel 与全部 args 交给 logger.debug；生产默认 info，开发默认 trace | 开发调试可能输出原文；不能承诺“文本从不进入日志”，未来输入功能须局部去除文本参数记录 |

主进程 getUiDriver 的首次使用还会创建 agent 并 await stop 后缓存；本次协议探针使用已缓存的真实 UiDriver，**不覆盖冷启动、真实 Electron IPC、操作系统剪贴板、设备授权或销毁顺序**。PR #22 的捕获生命周期测试不构成文本输入验收证据。

文本 RPC 的 sendMessage 默认 timeout=0。设备不回复时没有有限完成保证；UI 单独 Promise.race 只会改变显示，不会撤销已发写入。后续必须分别描述“未发送”“明确拒绝”“结果未知”，结果未知不得自动重发。UiDriver.send 对连接建立阶段的 timeout 有恢复路径，也不应被描述为设备写入的幂等保证。

## 本轮受控证据

环境：Windows x64、Node 22.21.1、npm 10.9.4、Chrome 155.0.8059.85、playwright-core 1.64.1。独立 npm ci，跳过 Electron 二进制下载；未下载 HDC/agent 资源。使用本页附录脚本，执行 `node dist/m4-2-probe.cjs`，退出码 0。

| 探针 | 实际运行范围 | 结果与限制 |
| --- | --- | --- |
| 单行弹窗 | 无网络空白 Chrome 页面加载真实 LunaModal UMD，DOM value 赋值合成中文/LF/CRLF 后 Enter | type=text；“中文\\n第二行\\r\\n第三行”返回“中文第二行第三行”。没有模拟 OS 粘贴，不代表剪贴板权限测试 |
| toolbar 等待 | 转译真实 Toolbar.tsx；替换 React 展示、store、prompt 与 main 桥接；桥接 Promise 保持 pending | callback 提前完成；随后拒绝产生 `synthetic input failure` 的 unhandledRejection；取消/空串未调用桥接 |
| 主进程与 UiDriver | 注册真实 uitest.ts handler，使用真实 UiDriver.inputText/send、Connection.sendMessage/sendRawMessage/onData；仅将 driver 查找、连接与 socket.write 换为内存边界 | 7 组文本均经实际 JSON/UTF-8 封包保真；坐标均为 (0,0)。未回复时 handler 不完成，合成成功回包后完成，exception 回包拒绝传播 |
| 范围检查 | Git 差异、源码搜索及来源核对 | 仅报告与 RUNBOOK 的本项交接进入提交；没有功能修复、设备操作或发布 |

七组样本：空串、ASCII、中文标点、LF/CRLF/tab、引号/反斜杠/`$();&<>`、emoji/组合音标、4096 个“中”。这些仅验证编码与异步边界，**4096 不是支持上限，也不是性能承诺**。空串在协议上可保真，但当前 toolbar 会跳过。

探针初次运行因未替换无关 fullscreen 导入、Node 无 document 而失败；补充该展示依赖替身后通过。该失败不属于应用缺陷。最终脚本 SHA-256：`27eacd9e4faad8fdeef3fd212778e76cbbe14af238dd4ee190c370e63aa9ae98`；JSON 结果 SHA-256：`52916491d052473559ee2379639a2c0626d3269f1d4dd946ce7bcca3dddab1c5`。脚本在附录原样归档；结果要点已逐项记录上表。哈希按 UTF-8/LF 计算。

## 建议的最小范围（未实现）

1. **先确定目标契约。** 验证 agent 1.1.0 与目标系统上坐标输入的聚焦、插入/替换语义。若采用最后有效点击位置，须保存设备坐标，沿用 displaySize/CSS 映射，旋转、设备切换、重连后失效；未确定有效目标时禁止发送并提示先选择设备输入框。不能只把固定 (0,0) 入口绑定 Ctrl+V。
2. **可靠的显式文本发送。** 使用多行编辑框接收用户手动输入或本地粘贴，发送前显示设备与目标状态；取消不发送，空串不发送，保留前后空格。保留草稿直到确认结果，await/catch 贯穿 UI；明确失败可由用户重试。应用不另做桌面或设备剪贴板同步；UiTest 内部粘贴对设备剪贴板的影响仍须验证。
3. **之后接入应用内粘贴。** Windows Ctrl+V / macOS Cmd+V 仅在投屏输入目标有效、投屏区域实际获焦且没有本地编辑框/对话框/IME 组合输入时处理。先评估真实 paste 事件的 text/plain；若需要按钮读取，提供窄的主进程读取桥接并等待 Electron 45 Promise。只在用户明确操作时读取，无后台监听、全局快捷键或启动预读；菜单和按键同一路由，避免双发。本地编辑框保留正常粘贴行为。
4. **明确失败与生命周期。** 按设备避免输入并发，并验证与 touch/捕获/布局调用共存；重复按键不得双发。设备切换、窗口关闭、重连使未发送任务失效；已经发出的写入不能宣称撤销，迟到结果不得更新新窗口/设备。无回复时显示结果未知，禁止自动重试；若无法提供可说明的取消/收敛边界，直接粘贴入口暂缓开放。
5. **限制内容与反馈。** 仅纯文本，忽略 HTML/图片/文件；先定义并测试字符/字节上限，超限明确拒绝且不截断、不自动拆成多次写入。读取拒绝、无纯文本、未连接、目标失效、设备拒绝、结果未知分别提示。日志只记录阶段/长度/错误类别，避免原文及原文哈希；共享 debug 参数日志的局部处理另列实现变更，不在评估 PR 修改子模块。

这不是双向剪贴板同步、全键盘控制或输入法透传。没有要求用户额外安装 HAP，也不将 HDC 调试授权等同于剪贴板权限。Async Clipboard 的权限/用户激活行为需在打包 Electron 实测；不通过全局允许权限来绕过错误。

## 后续验收矩阵

“协议已验证”只指本轮内存封包探针，其他项目均待验收。设备样本限后续明确授权的 bilibili 可编辑区域与合成文本；不发送评论/消息/搜索请求，不访问私人或内部应用。若该样本没有多行控件，标记缺少合适样本，不能扩大安装范围或宣称多行通过。

| 项目 | 必须观察的结果 | 本轮状态 |
| --- | --- | --- |
| 中文、emoji、组合字符、引号、反斜杠、shell 字符 | 设备可见内容逐字一致，未触发命令/提交 | 协议已验证；设备待验收 |
| LF/CRLF、tab、空格 | 编辑框不丢换行；定义 CRLF→LF 策略并告知；多行设备控件保留预期结构 | 当前单行缺口已证实；实现/设备待验收 |
| 空串、取消、纯空格、图片/富文本/文件、超限 | 空/取消不发送；纯空格按文本保留；仅取纯文本；超限不截断 | 空/取消受控通过，其余待验收 |
| 目标坐标与焦点 | 点击不同输入框、已有文本/选区、旋转、不同缩放均输入到指定位置；无目标时不发送 | 已证实默认 (0,0)；正确目标待验收 |
| Win/macOS 快捷键与菜单 | 一次操作只发一次；本地编辑/对话框/IME 不被劫持；离焦不读取 | 待打包 Electron 45 验收 |
| 剪贴板权限与读取失败 | 用户操作触发，拒绝可解释、无设备写入，无权限自动放行 | 未访问剪贴板，待验收 |
| await 与拒绝反馈 | 真正完成前保持发送中；主进程拒绝到 UI，无 unhandledRejection，草稿保留 | handler/Driver 受控通过；toolbar 缺口已证实 |
| 无回复、断连、切换/关闭、重复发送 | 结果未知不自动重发；旧目标未发任务失效，迟到结果不污染新目标；资源有可说明的归属 | 待实现与设备验证 |
| 调试授权、agent 启动、受限控件 | 权限不足/不支持能够区分；不以重试或提权绕过；原文不进入日志 | 待验收 |
| 连续输入与投屏共存 | 不因并发出现 17000002；捕获、触摸与输入可恢复，重复/乱序为零 | 待验收，无性能结论 |

## 交付与下一步

本 PR 只提供能力判断、缺口和可重复的无设备证据，不启动实现。维护者先确认目标语义验证范围、结果未知策略和允许的文本大小，再安排独立实现/真机任务。主对话对最终 SHA 做独立复审并记录审查身份与五项必需 CI；本分支不自行合并。CI 只能验证仓库兼容性，不能替代以上能力验收。

2026-10-23 整合核对：初评 `aa8ab6e` 已获主对话 OpenAI GPT-6 独立审查，无阻断；审查核对源码、primary 引用及附录哈希，未重复探针。普通 merge 同步 master `2465cb343e60a0e6059036b6962a776409e3f7fd` 后，文本工具栏、投屏客户端、类型/preload、uitest handler、share 子模块、package.json 与锁文件相对初评基线均未变，评估结论继续成立。RUNBOOK 仅将同位置新增的 M4-2/M4-3 交接完整并存，另按主对话交接追加本轮合入汇总。此次仅核对文档、差异及引用，未重复全量测试或探针，未操作设备。最终提交的增量审查、五项必需 CI 和合并状态见 [PR #40](https://github.com/MonsterXia/scrcpy-harmony/pull/40)及[检查页](https://github.com/MonsterXia/scrcpy-harmony/pull/40/checks)，不沿用初评结果宣布最终提交已通过。

## 附录：可重复的无设备探针

在上述固定基线的独立检出完成子模块初始化与 npm ci 后，将以下内容保存到被忽略的 `dist/m4-2-probe.cjs`；Chrome 路径按实际安装位置调整。只启动隔离无头 Chrome；没有 network socket connect、真实 Electron main/preload 进程运行或系统剪贴板调用。禁止将此探针的替身结果标成真实 IPC 或设备通过。


```javascript
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const { transformSync } = require('esbuild')
const { chromium } = require('playwright-core')
const out = {}
const tick = () => new Promise(setImmediate)
function load(file, loader, mocks, globals = {}) {
  const module = { exports: {} }
  const code = transformSync(fs.readFileSync(file, 'utf8'), { loader, format: 'cjs', jsx: 'automatic' }).code
  vm.runInNewContext(code, { module, exports: module.exports, require: id => {
    if (id in mocks) return mocks[id]
    if (id.startsWith('licia/')) return require(id)
    throw Error('Unexpected import: ' + id)
  }, ...globals })
  return module.exports
}
;(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<html><body></body></html>')
    await page.addScriptTag({ path: path.resolve('node_modules/luna-modal/luna-modal.js') })
    out.browser = browser.version()
    out.modal = await page.evaluate(async () => {
      const pending = LunaModal.prompt('Synthetic only', '')
      const input = document.querySelector('input')
      input.value = '中文\n第二行\r\n第三行'
      input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }))
      return { type: input.type, result: await pending }
    })
    assert.deepEqual(out.modal, { type: 'text', result: '中文第二行第三行' })
  } finally { await browser.close() }

  let promptValue = '合成文本', rejectBridge, calls = 0
  const bridge = new Promise((_, reject) => { rejectBridge = reject })
  const store = { target: { key: 'synthetic-target' } }
  const node = (type, props) => ({ type, props })
  const Toolbar = load('src/renderer/screencast/components/Toolbar.tsx', 'tsx', {
    'mobx-react-lite': { observer: x => x }, 'luna-toolbar/react': {},
    'share/renderer/components/ToolbarIcon': 'icon', 'common/util': { t: x => x },
    './Toolbar.module.scss': {}, '../store': store,
    'luna-modal': { prompt: async () => promptValue },
    'react/jsx-runtime': { jsx: node, jsxs: node, Fragment: 'fragment' },
    'licia/fullscreen': {}, 'licia/download': {},
  }, { main: { inputText: () => { calls++; return bridge } } }).default
  const find = n => n?.props?.icon === 'text' ? n : [n?.props?.children].flat().map(x => x && find(x)).find(Boolean)
  const click = find(Toolbar()).props.onClick
  await click()
  out.toolbarReturnsBeforeBridge = calls === 1
  const unhandled = new Promise(resolve => process.once('unhandledRejection', e => resolve(e.message)))
  rejectBridge(Error('synthetic input failure'))
  out.toolbarUnhandledRejection = await unhandled
  promptValue = ''; await click(); promptValue = null; await click()
  assert.equal(calls, 1)
  out.cancelAndEmptyDoNotSend = true

  const file = path.resolve('node_modules/hdckit/dist/hdc/UiDriver.js')
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(file, 'utf8') + '\nexports.ProbeConnection = Connection;', {
    module, exports: module.exports, require: createRequire(file), __dirname: path.dirname(file), Buffer, setTimeout,
  })
  const driver = new module.exports.default({})
  const connection = new module.exports.ProbeConnection()
  driver.getConnection = async () => connection
  let packet
  connection.socket = { write: data => { packet = data } }
  const handlers = new Map()
  load('src/main/lib/hdc/uitest.ts', 'ts', {
    './base': { getTargetStore: () => driver }, 'share/main/lib/window': {},
    'share/main/lib/util': { handleEvent: (n, h) => handlers.set(n, h) },
  }).init({})
  const input = handlers.get('inputText')
  const header = Buffer.from('_uitestkit_rpc_message_head_')
  const tail = Buffer.from('_uitestkit_rpc_message_tail_')
  function reply(result) {
    const data = Buffer.from(JSON.stringify(result)), size = Buffer.alloc(4)
    size.writeUInt32BE(data.length)
    connection.onData(Buffer.concat([header, packet.subarray(header.length, header.length + 4), size, data, tail]))
  }
  const samples = ['', 'ASCII', '中文，测试', 'A\nB\r\nC\tD', '"\'\\$();&<>', '🙂é', '中'.repeat(4096)]
  for (const text of samples) {
    let settled = false
    const pending = input('synthetic-target', text).then(() => { settled = true })
    await tick()
    assert.equal(settled, false)
    const len = packet.readUInt32BE(header.length + 4)
    const wire = JSON.parse(packet.subarray(header.length + 8, header.length + 8 + len))
    assert.equal(wire.params.api, 'Driver.inputText')
    assert.deepEqual(wire.params.args, [{ x: 0, y: 0 }, text])
    reply({ result: null }); await pending
  }
  const failing = input('synthetic-target', '合成失败')
  const rejected = assert.rejects(failing, /synthetic device rejection/)
  await tick(); reply({ exception: { message: 'synthetic device rejection' } }); await rejected
  out.mainDriverWire = { samples: samples.length, preserved: true, point: { x: 0, y: 0 }, waitsForReply: true, propagatesException: true }
  fs.writeFileSync('dist/m4-2-probe-result.json', JSON.stringify(out, null, 2) + '\n')
  console.log(JSON.stringify(out, null, 2))
})().catch(e => { console.error(e); process.exitCode = 1 })
```
