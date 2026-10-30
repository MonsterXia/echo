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
const orphanCrash = process.argv.includes('--orphan-crash')
const orphanRecover = process.argv.includes('--orphan-recover')
const crossHostRecover = process.argv.includes('--cross-host-recover')
if (crossHostRecover && (orphanRecover || orphanCrash)) throw new Error('Cross-host recovery must use a separate fresh profile')
const recoveryProfile = process.env.SCRCPY_TEST_RECOVERY_PROFILE
if ((orphanCrash || orphanRecover) && (!recoveryProfile || !path.isAbsolute(recoveryProfile))) {
  throw new Error('Orphan verification requires an absolute SCRCPY_TEST_RECOVERY_PROFILE temporary directory')
}
const profile = recoveryProfile || fs.mkdtempSync(path.join(os.tmpdir(), 'scrcpy-static-window-'))
const upgradeMode = process.argv.includes('--upgrade')
const controlledMotion = process.argv.includes('--controlled-motion')
const manualMotion = process.argv.includes('--manual-motion')
const installed = process.argv[3]?.startsWith('--') ? undefined : process.argv[3]
function ownershipRecords() {
  const dir = path.join(profile, 'data/native-video/sessions')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { recursive: true }).filter(file => file.endsWith('.json'))
    .map(file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')))
}
const previousOwners = orphanRecover ? ownershipRecords() : []
if (orphanRecover) assert.equal(previousOwners.length, 1, 'one crashed session must be recorded')
if (crossHostRecover) assert.equal(ownershipRecords().length, 0, 'cross-host profile must have no local journal')
let deliberatelyCrashed = false
const report = { scope: 'Real app IPC, device capture and Chromium Canvas; unlocked static screen; no pixels saved',
  startedAt: new Date().toISOString(), rounds: [], passed: false }
let app, ownedChild, ownedSocket, launchError
if (upgradeMode) report.scope = 'Real app: static JPEG manual retry, then automatic H264 promotion on user motion; no pixels saved'
if (controlledMotion) report.scope = 'Controlled real-device JPEG baseline (initial preferVideo=false), automatic H264 promotion and actual pointer swipes; no pixels saved'
if (manualMotion) report.scope = 'Controlled real-device JPEG baseline, toolbar manual H264 promotion and actual pointer swipes; no pixels saved'
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
  child.stdout.on('data', chunk => { diagnostics += chunk })
  const until = Date.now() + 30000
  // The inspector can listen during Node bootstrap, before Electron's module
  // exists. Also wait for the main document before injecting observations.
  while (!diagnostics.includes('main ready and show') || !/Debugger listening on (ws:\/\/[^\s]+)/.test(diagnostics)) {
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
    if (message.error || message.result.exceptionDetails) {
      throw new Error('App inspector evaluation failed: ' + (message.error?.message ||
        message.result.exceptionDetails.exception?.description || message.result.exceptionDetails.text))
    }
    return message.result.result.value
  }
  return { evaluate, process: () => child, diagnostics: () => diagnostics,
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
async function verifyActiveCrossHostProtection() {
  const { buildSync } = require('esbuild')
  const Module = require('node:module')
  const file = path.join(root, 'src/main/lib/hdc/nativeVideo.ts')
  const mod = new Module(file, module)
  mod._compile(buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, file)
  const bin = path.join(root, 'resources/hdc', process.platform === 'win32' ? 'hdc.exe' : 'hdc')
  const { stdout } = await promisify(execFile)(bin, ['list', 'targets'], { timeout: 10000, windowsHide: true })
  const keys = stdout.trim().split(/\s+/)
  assert.equal(keys.length, 1)
  assert.notEqual(keys[0], '[Empty]')
  const owners = ownershipRecords()
  assert.equal(owners.length, 1, 'active H.264 must own a recorded native process')
  // A separate process with no cache directory uses real HDC, just as a new
  // host would. Its recovery must leave the current stream's process alive.
  const native = new mod.exports.NativeVideo({ bin, port: 8710, connectKey: keys[0] })
  await native.recoverOrphans(true)
  const stat = await native.run(['shell', `cat /proc/${owners[0].devicePid}/stat`])
  assert.ok(stat.startsWith(`${owners[0].devicePid} (`))
  assert.equal(stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19], owners[0].started)
  report.crossHostRecovery.activeNativeProcessPreserved = true
}
async function run() {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  if (crossHostRecover) report.crossHostRecovery = { initialLocalRecords: 0 }
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
  if (controlledMotion) await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('startCaptureScreen')
    if (!original) throw new Error('Capture handler unavailable')
    ipcMain.removeHandler('startCaptureScreen')
    // Controlled starting format only; capture, promotion, decoding and input
    // continue through the real implementation and physical device.
    ipcMain.handle('startCaptureScreen', (event, id, scale, generation) => original(event, id, scale, generation, false))
  })
  const instrumentation = () => {
    const original = CanvasRenderingContext2D.prototype.drawImage
    window.captureTiming = { draws: 0, codecs: {}, timeline: [] }
    if (window.main) window.main.on('captureScreen', (_session, _generation, _image, metadata) => {
      if (metadata?.promotion) {
        window.captureTiming.promotion = metadata.promotion
        if (!window.captureTiming.promotionPacketAt) window.captureTiming.promotionPacketAt = Date.now()
      }
    })
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      const result = original.apply(this, args)
      const probe = window.captureTiming
      const codec = typeof VideoFrame !== 'undefined' && args[0] instanceof VideoFrame ? 'H.264' : 'JPEG'
      if (!probe.firstAt) { probe.firstAt = Date.now(); probe.firstCodec = codec }
      probe.draws++
      probe.codecs[codec] = (probe.codecs[codec] || 0) + 1
      if (probe.timeline.length < 300) probe.timeline.push({ at: Date.now(), codec })
      if (codec === 'JPEG') probe.lastJpegAt = Date.now()
      if (codec === 'H.264' && !probe.firstVideoAt) {
        probe.firstVideoAt = Date.now()
        probe.handoverGapMs = probe.lastJpegAt ? probe.firstVideoAt - probe.lastJpegAt : null
      }
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
  for (let round = 0; round < (controlledMotion ? 1 : upgradeMode ? 2 : installed ? 1 : 3); round++) {
    const clickedAt = Date.now()
    await renderer(() => window.main.showScreencast())
    await waitFor(() => renderer(() => window.captureTiming?.draws > 0 && Boolean(document.querySelector('canvas')?.getBoundingClientRect().width), true))
    const visibleMs = Date.now() - clickedAt
    await delay(controlledMotion ? 500 : 11000)
    if (upgradeMode) {
      const before = await renderer(() => window.captureTiming, true)
      if (before.codecs['H.264']) {
        report.earlyVideo = { round: round + 1, promotion: before.promotion ?? null, frames: before.codecs['H.264'] }
        throw new Error('Video already active before requested test phase; sample retained, scenario needs repeat')
      }
      if (round === 0 && !controlledMotion) {
        await renderer(() => document.querySelector('[aria-controls="screencast-tools"]').click(), true)
        await waitFor(() => renderer(() => [...document.querySelectorAll('button')].some(b => b.textContent === '切换到视频' && !b.disabled), true))
        await renderer(() => [...document.querySelectorAll('button')].find(b => b.textContent === '切换到视频').click(), true)
        console.log('MANUAL_RETRY_STARTED_KEEP_PHONE_STATIC')
        await delay(15000)
        await renderer(() => {
          const toggle = document.querySelector('[aria-controls="screencast-tools"]')
          if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click()
        }, true)
        await waitFor(() => renderer(() => [...document.querySelectorAll('button')].some(b => b.textContent === '切换到视频' && !b.disabled), true))
        report.manualRetryRetainedJpeg = await renderer(() => {
          const canvas = document.querySelector('canvas')
          return !!canvas?.width && window.captureTiming.codecs.JPEG > 0 && !window.captureTiming.codecs['H.264']
        }, true)
        assert.ok(report.manualRetryRetainedJpeg)
      } else {
        if (manualMotion) {
          await renderer(() => document.querySelector('[aria-controls="screencast-tools"]').click(), true)
          await waitFor(() => renderer(() => [...document.querySelectorAll('button')].some(b => b.textContent === '切换到视频' && !b.disabled), true))
          await renderer(() => [...document.querySelectorAll('button')].find(b => b.textContent === '切换到视频').click(), true)
        }
        console.log('READY_FOR_MOTION: swipe phone continuously for several seconds')
        if (controlledMotion) await renderer(() => {
          window.captureTiming.controlledMotion = 'running'
          void (async () => {
            const canvas = document.querySelector('canvas')
            const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
            for (let swipe = 0; swipe < 16; swipe++) {
              const rect = canvas.getBoundingClientRect()
              const send = (type, fraction) => canvas.dispatchEvent(new PointerEvent(type, {
                button: 0, pointerId: 1, clientX: rect.x + rect.width * fraction,
                clientY: rect.y + rect.height * 0.55,
              }))
              const from = swipe % 2 ? 0.2 : 0.8, to = 1 - from
              send('pointerdown', from)
              for (let step = 1; step <= 10; step++) { await pause(40); send('pointermove', from + (to - from) * step / 10) }
              send('pointerup', to)
              await pause(350)
            }
            window.captureTiming.controlledMotion = 'done'
          })().catch(() => { window.captureTiming.controlledMotion = 'failed' })
        }, true)
        await waitFor(() => renderer(() => window.captureTiming?.codecs['H.264'] >= 3, true), 60000)
        if (controlledMotion) await waitFor(() => renderer(() => window.captureTiming.controlledMotion === 'done', true), 20000)
        await delay(3000)
      }
    }
    const stats = await renderer(() => window.captureTiming, true)
    const capabilities = await renderer(() => ({ videoDecoder: typeof VideoDecoder, secure: isSecureContext }), true)
    assert.equal(capabilities.videoDecoder, 'function', 'Validation must exercise native video capability')
    report.rounds.push({ round: round + 1, firstDrawMs: stats.firstAt - clickedAt, visibleMs,
      firstCodec: stats.firstCodec, draws: stats.draws, codecs: stats.codecs, width: stats.width, height: stats.height, capabilities,
      ...(upgradeMode ? { handoverGapMs: stats.handoverGapMs ?? null, promotion: stats.promotion ?? null,
        timeline: stats.timeline, controlledMotion: stats.controlledMotion ?? null } : {}) })
    console.log(JSON.stringify(report.rounds.at(-1)))
    if (crossHostRecover && round === 0 && stats.codecs['H.264'] > 0) {
      await verifyActiveCrossHostProtection()
      const before = await renderer(() => window.captureTiming.codecs['H.264'], true)
      await waitFor(() => renderer(() => window.captureTiming.codecs['H.264'], true).then(count => count > before), 15000)
      report.crossHostRecovery.videoContinuedAfterForeignInspection = true
    }
    if (orphanCrash || orphanRecover) {
      assert.ok(stats.codecs['H.264'] > 0, 'native frames must actually draw')
      const owners = ownershipRecords()
      assert.equal(owners.length, 1)
      assert.equal(owners[0].hostPid, ownedChild.pid)
      if (orphanRecover) {
        assert.ok(owners.every(owner => owner.name !== previousOwners[0].name))
        report.previousSessionReplaced = true
      } else {
        await terminateOwned()
        deliberatelyCrashed = true
        assert.equal(ownershipRecords().length, 1)
        report.crashLeftOwnershipRecord = true
        break
      }
    }
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
  if (crossHostRecover) {
    report.crossHostRecovery.recoveredWithoutLocalJournal = app.diagnostics().includes('Recovered disconnected native capture from another desktop session')
    assert.ok(report.crossHostRecovery.recoveredWithoutLocalJournal, 'must exercise cross-host recovery, not just a normal startup')
    assert.ok(report.rounds.some(round => round.codecs?.['H.264'] > 0), 'must decode native video after recovery')
    assert.ok(report.crossHostRecovery.videoContinuedAfterForeignInspection, 'must preserve active video during a foreign host check')
  }
  report.passed = true
}
run().catch(error => { report.error = error.message; process.exitCode = 1 }).finally(async () => {
  try {
    if (!deliberatelyCrashed) await app?.close()
    if (orphanRecover || crossHostRecover) {
      assert.equal(ownershipRecords().length, 0, 'normal quit must clear the replacement ownership')
      report.normalExitClearedOwnership = true
    }
  } catch (error) { report.closeError = error.message; report.passed = false; process.exitCode = 1 }
  ownedSocket?.close()
  try { await terminateOwned() } catch (error) { report.closeError = error.message; report.passed = false; process.exitCode = 1 }
  clearTimeout(deadline)
  fs.writeFileSync(path.resolve(process.argv[2] || 'static-start-report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
})
