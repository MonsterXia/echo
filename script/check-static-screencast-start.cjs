// Build first and close other instances. Keep one unlocked device still.
// Records actual Canvas draws through the real app, never screenshots or IDs.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawn, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { createHash } = require('node:crypto')
const { setTimeout: delay } = require('node:timers/promises')
const root = path.resolve(__dirname, '..')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'scrcpy-static-window-'))
const installed = process.argv[3]
const report = { scope: 'Real app IPC, device capture and Chromium Canvas; unlocked static screen; no pixels saved',
  startedAt: new Date().toISOString(), rounds: [], passed: false }
let app, ownedChild, ownedSocket, launchError
const deadline = setTimeout(() => {
  report.error = 'Static-window check timed out'
  ownedSocket?.close()
  void terminateOwned().catch(error => { report.closeError = error.message })
}, 180000)
async function terminateOwned() {
  if (!ownedChild?.pid || ownedChild.exitCode !== null || ownedChild.signalCode !== null) return
  if (process.platform === 'win32') {
    await promisify(execFile)('taskkill.exe', ['/PID', String(ownedChild.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 })
  } else ownedChild.kill('SIGKILL')
  const until = Date.now() + 5000
  while (ownedChild.exitCode === null && ownedChild.signalCode === null) {
    if (Date.now() > until) throw new Error('Owned test process exit unconfirmed')
    await delay(50)
  }
}
async function launch(executablePath, args, env) {
  // Observe through the main-process inspector only: browser automation changed
  // VideoDecoder availability in the tested Electron runtime.
  const child = spawn(executablePath, [...args, '--inspect=0'], { cwd: root, env, windowsHide: true })
  ownedChild = child
  child.on('error', error => { launchError = error })
  let diagnostics = ''
  child.stderr.on('data', chunk => { diagnostics += chunk })
  const until = Date.now() + 30000
  while (!/Debugger listening on (ws:\/\/[^\s]+)/.test(diagnostics)) {
    if (launchError) throw launchError
    if (Date.now() > until || child.exitCode !== null) throw new Error('App debugging endpoints unavailable')
    await delay(100)
  }
  const socket = new WebSocket(diagnostics.match(/Debugger listening on (ws:\/\/[^\s]+)/)[1])
  ownedSocket = socket
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Inspector connection timed out')), 10000)
    socket.onopen = () => { clearTimeout(timer); resolve() }
    socket.onerror = () => { clearTimeout(timer); reject(new Error('Inspector connection failed')) }
  })
  let id = 0
  const pending = new Map()
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.id) pending.get(message.id)?.resolve(message)
  }
  const disconnected = () => {
    for (const request of pending.values()) request.reject(new Error('Inspector disconnected'))
  }
  socket.onclose = disconnected
  socket.onerror = disconnected
  const evaluate = async (fn, arg) => {
    const requestId = ++id
    const reply = new Promise((resolve, reject) => {
      const finish = callback => value => { clearTimeout(timer); pending.delete(requestId); callback(value) }
      const timer = setTimeout(() => pending.get(requestId)?.reject(new Error('Inspector request timed out')), 15000)
      pending.set(requestId, { resolve: finish(resolve), reject: finish(reject) })
    })
    const electron = "process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')"
    try { socket.send(JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: {
      expression: `(${fn.toString()})(${electron}, ${JSON.stringify(arg) || 'undefined'})`, returnByValue: true, awaitPromise: true,
    } })) } catch (error) { pending.get(requestId)?.reject(error) }
    const message = await reply
    if (message.error || message.result.exceptionDetails) throw new Error('App inspector evaluation failed')
    return message.result.result.value
  }
  return { evaluate, process: () => child,
    close: async () => {
      await evaluate(({ app }) => { setTimeout(() => app.quit(), 0) })
      socket.close()
      const until = Date.now() + 15000
      while (child.exitCode === null && child.signalCode === null) {
        if (Date.now() > until) throw new Error('App did not confirm exit')
        await delay(100)
      }
    },
  }
}
async function renderer(fn, cast = false) {
  return app.evaluate(({ BrowserWindow }, { source, cast }) => {
    const win = BrowserWindow.getAllWindows().find(win => {
      const url = win.webContents.getURL()
      return cast ? url.includes('page=screencast') : url.includes('index.html') && !url.includes('page=')
    })
    return win?.webContents.executeJavaScript(`(${source})()`)
  }, { source: fn.toString(), cast })
}
async function waitFor(check, timeout = 60000) {
  const until = Date.now() + timeout
  while (!(await check())) {
    if (Date.now() > until) throw new Error('Window observation timed out')
    await delay(100)
  }
}
async function run() {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  app = await launch(installed || require('electron'),
    [...(installed ? [] : [path.join(root, 'dist')]), `--user-data-dir=${profile}`], env)
  report.runtime = await app.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged }))
  report.nativeDiagnostics = []
  const observe = chunk => {
    for (const line of chunk.toString().split('\n')) {
      if (/first frame timeout|extension exited before listening|Native video unavailable|socket occupied/.test(line)) {
        report.nativeDiagnostics.push(line.trim().replace(/scrcpy_harmony_[a-f0-9]+/g, 'session'))
      }
    }
  }
  app.process().stdout?.on('data', observe)
  app.process().stderr?.on('data', observe)
  if (!installed) report.mainAssetSha256 = createHash('sha256').update(fs.readFileSync(path.join(root, 'dist/main/index.js'))).digest('hex')
  await waitFor(() => renderer(() => Boolean(document.querySelector('#app .panel-with-toolbar'))))
  await renderer(async () => {
    const targets = await window.main.getTargets()
    if (targets.length !== 1) throw new Error('Exactly one authorized device required')
    await window.main.setMainStore('target', targets[0])
  })
  const instrumentation = () => {
    const original = CanvasRenderingContext2D.prototype.drawImage
    window.captureTiming = { draws: 0, codecs: {} }
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      const result = original.apply(this, args)
      const probe = window.captureTiming
      const codec = typeof VideoFrame !== 'undefined' && args[0] instanceof VideoFrame ? 'H.264' : 'JPEG'
      if (!probe.firstAt) { probe.firstAt = Date.now(); probe.firstCodec = codec }
      probe.draws++
      probe.codecs[codec] = (probe.codecs[codec] || 0) + 1
      probe.width = this.canvas.width
      probe.height = this.canvas.height
      return result
    }
  }
  await app.evaluate(({ app }, source) => {
    app.on('web-contents-created', (_event, contents) => {
      contents.once('dom-ready', () => { void contents.executeJavaScript(`(${source})()`) })
    })
  }, instrumentation.toString())
  for (let round = 0; round < (installed ? 1 : 3); round++) {
    const clickedAt = Date.now()
    await renderer(() => window.main.showScreencast())
    await waitFor(() => renderer(() => window.captureTiming?.draws > 0 && Boolean(document.querySelector('canvas')?.getBoundingClientRect().width), true))
    const visibleMs = Date.now() - clickedAt
    await delay(11000)
    const stats = await renderer(() => window.captureTiming, true)
    const capabilities = await renderer(() => ({ videoDecoder: typeof VideoDecoder, secure: isSecureContext }), true)
    assert.equal(capabilities.videoDecoder, 'function', 'Validation must exercise native video capability')
    report.rounds.push({ round: round + 1, firstDrawMs: stats.firstAt - clickedAt, visibleMs,
      firstCodec: stats.firstCodec, draws: stats.draws, codecs: stats.codecs, width: stats.width, height: stats.height, capabilities })
    console.log(JSON.stringify(report.rounds.at(-1)))
    // The device JPEG service may also suppress identical static frames.
    // Continued live capture requires a separate controlled display change.
    assert.ok(stats.draws >= 1, 'Capture must produce a real picture')
    await app.evaluate(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.webContents.getURL().includes('page=screencast')) win.close()
      }
    })
    await delay(2500)
  }
  report.passed = true
}
run().catch(error => { report.error = error.message; process.exitCode = 1 }).finally(async () => {
  try { await app?.close() } catch (error) { report.closeError = error.message; report.passed = false; process.exitCode = 1 }
  ownedSocket?.close()
  try { await terminateOwned() } catch (error) { report.closeError = error.message; report.passed = false; process.exitCode = 1 }
  clearTimeout(deadline)
  fs.writeFileSync(path.resolve(process.argv[2] || 'static-start-report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
})
