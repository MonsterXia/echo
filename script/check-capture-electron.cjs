// Actual Electron windows and IPC, with synthetic UiDriver transport only.
// This is a no-device lifecycle check, not an acceptance of device capture.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

if (!process.versions.electron) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-electron-'))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const sourceRoot = path.resolve(process.argv[2] || path.join(__dirname, '..'))
  const run = spawnSync(require('electron'), [__filename, dir, sourceRoot], {
    cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8', timeout: 90000,
    windowsHide: true,
  })
  const reportPath = path.join(dir, 'report.json')
  if (fs.existsSync(reportPath)) process.stdout.write(fs.readFileSync(reportPath))
  else console.error('Electron lifecycle check did not produce a report.')
  process.exitCode = run.status === 0 ? 0 : 1
} else {
  const assert = require('node:assert/strict')
  const vm = require('node:vm')
  const crypto = require('node:crypto')
  const { transformSync } = require('esbuild')
  const electron = require('electron')
  const hdckit = require('hdckit')
  const { app, BrowserWindow, ipcMain } = electron
  const dir = process.argv[2]
  const sourceRoot = process.argv[3]
  app.setPath('userData', path.join(dir, 'profile'))
  app.on('window-all-closed', () => {})
  const report = {
    scope: 'Actual Electron windows and IPC; synthetic transport and frame bytes; no device or HAP access',
    electron: process.versions.electron,
    checks: {},
    sources: {},
  }
  const windows = [], drivers = [], calls = [], cache = new Map()
  let current, transport = async () => ({ sessionId: 'synthetic-frame-session' })
  class SyntheticDriver extends hdckit.UiDriver {
    constructor(...args) {
      super(...args)
      this.observedListeners = new Set()
      this.send = (...args) => {
        calls.push(args[1])
        return transport(...args)
      }
      drivers.push(this)
    }
    on(name, listener) {
      if (name === 'message') this.observedListeners.add(listener)
      return super.on(name, listener)
    }
    off(name, listener) {
      if (name === 'message') this.observedListeners.delete(listener)
      return super.off(name, listener)
    }
    async stop() { calls.push('initializeDriver') }
  }
  const registry = {
    create() {
      const win = new BrowserWindow({
        show: false, width: 500, height: 640,
        webPreferences: { nodeIntegration: true, contextIsolation: false },
      })
      windows.push(win)
      current = win
      win.on('closed', () => { if (current === win) current = undefined })
      return win
    },
    getWin: (name) => name === 'screencast' ? current : undefined,
    loadPage(win) {
      win.loadURL('data:text/html,<title>Synthetic capture lifecycle</title>')
    },
    sendTo(name, ...args) { if (name === 'screencast' && current) current.webContents.send(...args) },
  }
  const loaded = new Map()
  function load(file) {
    file = path.resolve(sourceRoot, file)
    if (loaded.has(file)) return loaded.get(file).exports
    const source = fs.readFileSync(file, 'utf8')
    report.sources[path.relative(sourceRoot, file).replaceAll('\\', '/')] =
      crypto.createHash('sha256').update(source).digest('hex')
    const module = { exports: {} }
    loaded.set(file, module)
    const code = transformSync(source, { loader: 'ts', format: 'cjs' }).code
    vm.runInNewContext(code, {
      module, exports: module.exports, Buffer, console, setTimeout, clearTimeout,
      require(id) {
        if (id === 'electron') return electron
        if (id === 'hdckit') return { ...hdckit, UiDriver: SyntheticDriver }
        if (id === 'share/main/lib/window') return registry
        if (id === 'share/main/lib/util') return {
          handleEvent: (name, handler) => ipcMain.handle(name, (_event, ...args) => handler(...args)),
          resolveResources: () => 'synthetic-resource-not-opened',
        }
        if (id === 'share/common/log') return () => ({ debug() {}, info() {}, warn() {}, error() {} })
        if (id === '../lib/store') return { getScreencastStore: () => ({}) }
        if (id === './base') return {
          getTargetStore: (key, name) => cache.get(`${key}:${name}`),
          setTargetStore: (key, name, value) => cache.set(`${key}:${name}`, value),
        }
        if (id.startsWith('.')) return load(path.resolve(path.dirname(file), `${id}.ts`))
        if (id.startsWith('licia/') || id.startsWith('node:')) return require(id)
        throw new Error('Unexpected dependency in no-device check')
      },
    }, { filename: file })
    return module.exports
  }
  const pause = () => new Promise((resolve) => setTimeout(resolve, 20))
  async function until(condition) {
    const end = Date.now() + 5000
    while (!condition()) {
      if (Date.now() > end) throw new Error('Lifecycle condition did not complete')
      await pause()
    }
  }
  const count = () => drivers.reduce((sum, driver) => sum + driver.observedListeners.size, 0)
  const emit = () => drivers.forEach((driver) => driver.emit('message', 'synthetic-frame-session', Buffer.from([1, 2, 3])))
  const invoke = (win, channel, ...args) => win.webContents.executeJavaScript(
    `require('electron').ipcRenderer.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})`
  )
  async function prepare(win) {
    await until(() => !win.webContents.isLoading())
    await win.webContents.executeJavaScript(`globalThis.syntheticFrames = []; require('electron').ipcRenderer.on('captureScreen', (_event, ...args) => syntheticFrames.push(args)); void 0`)
    return win
  }
  async function run() {
    await app.whenReady()
    const windowModule = load('src/main/window/screencast.ts')
    load('src/main/lib/hdc/uitest.ts').init({
      getTarget: async () => ({ createUiDriver: async () => new SyntheticDriver({}) }),
    })
    windowModule.showWin()
    const first = await prepare(current)
    const firstSession = await invoke(first, 'createCaptureSession', 'synthetic-target')
    await invoke(first, 'startCaptureScreen', firstSession, 0.5, 1)
    assert.equal(count(), 1)
    emit()
    await pause()
    assert.equal(await first.webContents.executeJavaScript('syntheticFrames.length'), 1)
    const closeEvents = []
    first.on('close', () => closeEvents.push(['close', count()]))
    first.on('closed', () => closeEvents.push(['closed', count()]))
    first.webContents.on('destroyed', () => closeEvents.push(['contents-destroyed', count()]))
    const firstClosed = new Promise((resolve) => first.once('closed', resolve))
    first.close()
    await firstClosed
    const listenersAtClosed = count()
    await pause()
    report.closeEvents = closeEvents
    assert.equal(listenersAtClosed, 0, 'An actually closed window must release its local capture listener')
    report.checks.actualCloseDisposesListener = true
    windowModule.showWin()
    const second = await prepare(current)
    emit()
    await pause()
    assert.equal(await second.webContents.executeJavaScript('syntheticFrames.length'), 0)
    report.checks.reopenedWindowRejectsOldFrames = true
    const secondSession = await invoke(second, 'createCaptureSession', 'synthetic-target')
    await invoke(second, 'startCaptureScreen', secondSession, 0.5, 1)
    assert.equal(await invoke(second, 'stopCaptureScreen', firstSession), 'obsolete')
    assert.equal(count(), 1)
    emit()
    await pause()
    assert.equal(await second.webContents.executeJavaScript('syntheticFrames.length'), 1)
    report.checks.oldStopCannotStopReplacement = true

    const reloadFinished = new Promise((resolve) => second.webContents.once('did-finish-load', resolve))
    second.webContents.reload()
    await reloadFinished
    await prepare(second)
    assert.equal(count(), 0)
    assert.equal(await invoke(second, 'stopCaptureScreen', secondSession), 'obsolete')
    await assert.rejects(invoke(second, 'startCaptureScreen', secondSession, 0.5, 2))
    const afterReload = await invoke(second, 'createCaptureSession', 'synthetic-target')
    await invoke(second, 'startCaptureScreen', afterReload, 0.5, 1)
    assert.equal(count(), 1)
    report.checks.reloadInvalidatesOldDocument = true

    const crashed = new Promise((resolve) => second.webContents.once('render-process-gone', resolve))
    second.webContents.forcefullyCrashRenderer()
    await crashed
    assert.equal(count(), 0)
    report.checks.rendererCrashDisposesListener = true
    second.destroy()

    windowModule.showWin()
    const third = await prepare(current)
    let releaseStart
    const delayed = new Promise((resolve) => { releaseStart = resolve })
    let delayedOnce = false
    transport = async (_method, api) => {
      if (api === 'startCaptureScreen' && !delayedOnce) {
        delayedOnce = true
        return delayed
      }
      return { sessionId: 'synthetic-frame-session' }
    }
    const pendingSession = await invoke(third, 'createCaptureSession', 'synthetic-target')
    const abandoned = invoke(third, 'startCaptureScreen', pendingSession, 0.5, 1).catch(() => {})
    await until(() => delayedOnce)
    const thirdClosed = new Promise((resolve) => third.once('closed', resolve))
    third.close()
    await thirdClosed
    assert.equal(count(), 0)
    windowModule.showWin()
    const fourth = await prepare(current)
    const replacement = await invoke(fourth, 'createCaptureSession', 'synthetic-target')
    const before = calls.filter((name) => name === 'startCaptureScreen').length
    let settled = false
    const starting = invoke(fourth, 'startCaptureScreen', replacement, 0.5, 1).then(() => { settled = true })
    await pause()
    assert.equal(settled, false)
    assert.equal(calls.filter((name) => name === 'startCaptureScreen').length, before)
    releaseStart({ sessionId: 'synthetic-frame-session' })
    await starting
    await abandoned
    assert.equal(count(), 1)
    emit()
    await pause()
    assert.equal(await fourth.webContents.executeJavaScript('syntheticFrames.length'), 1)
    report.checks.lateStartCannotAttachToReplacement = true

    transport = async (_method, api) => {
      if (api === 'stopCaptureScreen') throw new Error('Synthetic stop rejection')
      return { sessionId: 'synthetic-frame-session' }
    }
    await assert.rejects(invoke(fourth, 'stopCaptureScreen', replacement))
    assert.equal(count(), 0)
    fourth.close()
    windowModule.showWin()
    const fifth = await prepare(current)
    const recovery = await invoke(fifth, 'createCaptureSession', 'synthetic-target')
    const priorStarts = calls.filter((name) => name === 'startCaptureScreen').length
    await assert.rejects(invoke(fifth, 'startCaptureScreen', recovery, 0.5, 1))
    assert.equal(count(), 0)
    assert.equal(calls.filter((name) => name === 'startCaptureScreen').length, priorStarts)
    transport = async () => ({ sessionId: 'synthetic-frame-session' })
    await invoke(fifth, 'startCaptureScreen', recovery, 0.5, 2)
    assert.equal(count(), 1)
    report.checks.failedStopDisposesLocallyAndBlocksUnsafeStart = true
    const fifthClosed = new Promise((resolve) => fifth.once('closed', resolve))
    fifth.destroy()
    await fifthClosed
    assert.equal(count(), 0)
    report.checks.directDestructionDisposesListener = true
  }
  run().then(() => { report.passed = true }).catch((error) => {
    report.passed = false
    report.failure = String(error.message).replaceAll(sourceRoot, '<checkout>')
  }).finally(() => {
    for (const win of windows) if (!win.isDestroyed()) win.destroy()
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    app.exit(report.passed ? 0 : 1)
  })
}
