// Real device + real Chromium decoder. Stores counters only, never screen bytes.
// Close the application and keep the device showing motion during this check.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { releaseProbeForward } = require('./lib/probe-forward.cjs')
const { recoverProbeBackup } = require('./lib/probe-backup.cjs')
const root = path.resolve(__dirname, '..')
if (!process.versions.electron) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-video-check-'))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const run = require('node:child_process').spawnSync(require('electron'), [__filename, dir, ...process.argv.slice(3)], {
    cwd: root, env, encoding: 'utf8', timeout: 90000, windowsHide: true,
  })
  async function finish() {
    const journal = path.join(dir, 'library-backup.json')
    if (fs.existsSync(journal)) {
      try {
        await recoverProbeBackup(journal, (command, record) => {
          const result = require('node:child_process').spawnSync(path.join(root, 'resources/hdc/hdc.exe'),
            ['-s', `127.0.0.1:${record.port}`, '-t', record.connectKey, 'shell', command],
            { encoding: 'utf8', timeout: 10000, windowsHide: true })
          if (result.error || result.status !== 0 || /\[E\d{6}\]|\[Fail\]|permission denied/i.test(result.stdout + result.stderr)) throw new Error('Parent library recovery command failed')
          return result.stdout
        })
        console.error('Parent confirmed original library restoration after interrupted probe')
      } catch (error) {
        console.error(`${error.message}; recovery journal retained at ${journal}`)
        process.exitCode = 1
      }
    }
    const file = path.join(dir, 'report.json')
    if (fs.existsSync(file)) {
      const report = fs.readFileSync(file, 'utf8')
      console.log(report)
      if (process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]), report)
    } else console.error(run.stderr || 'No native video report')
    process.exitCode ||= run.status === 0 ? 0 : 1
  }
  finish().catch(error => { console.error(error.message); process.exitCode = 1 })
} else {
  const { app, BrowserWindow, ipcMain } = require('electron')
  const { buildSync, build } = require('esbuild')
  const { Hdc } = require('hdckit')
  const dir = process.argv[2]
  app.setPath('userData', path.join(dir, 'profile'))
  // Match the application's existing Windows configuration.
  app.disableHardwareAcceleration()
  app.on('window-all-closed', () => {})
  const report = { scope: 'Real native device stream and Chromium H.264 decode/draw; no screen data saved', received: 0, bytes: 0 }
  let native, win, driver, scope, target, stopTask, sampling = false, initialForwards = [], originalHash, backup
  const originalLibrary = '/data/local/tmp/libscreen_casting.z.so'
  async function run() {
    await app.whenReady()
    const mainBundle = path.join(dir, 'native.cjs')
    buildSync({ stdin: { contents: "export * from './src/main/lib/hdc/nativeVideo'; export * from './src/main/lib/hdc/captureDriver'", resolveDir: root }, outfile: mainBundle, bundle: true, platform: 'node', format: 'cjs' })
    const { NativeVideo, CaptureUiDriver, CaptureScope } = require(mainBundle)
    const renderer = (await build({ entryPoints: [path.join(root, 'src/renderer/screencast/lib/ScreencastClient.ts')], write: false, bundle: true, platform: 'browser', format: 'iife', globalName: 'ClientModule', plugins: [{ name: 'store', setup(build) {
      build.onLoad({ filter: /screencast[/\\]store\.ts$/ }, () => ({ contents: 'export default globalThis.probeStore', loader: 'js' }))
    } }] })).outputFiles[0].text
    const client = Hdc.createClient({ bin: path.join(root, 'resources/hdc/hdc.exe') })
    const keys = await client.listTargets()
    if (keys.length !== 1) throw new Error('Exactly one connected device is required')
    native = new NativeVideo({ ...client.options, connectKey: keys[0], resourcesDir: process.env.SCREENCAST_NATIVE_RESOURCES || path.join(root, 'resources/native-video') })
    if (process.argv.includes('--without-preinstalled')) {
      const present = await native.run(['shell', `test -f ${originalLibrary} && echo present`])
      if (present === 'present') {
        originalHash = (await native.run(['shell', `sha256sum ${originalLibrary}`])).split(/\s+/)[0]
        if (!/^[a-f0-9]{64}$/.test(originalHash)) throw new Error('Cannot verify original library backup')
        backup = `/data/local/tmp/scrcpy_harmony_backup_${require('node:crypto').randomBytes(8).toString('hex')}.so`
        fs.writeFileSync(path.join(dir, 'library-backup.json'), JSON.stringify({ backup, hash: originalHash, port: client.options.port, connectKey: keys[0] }), { flag: 'wx' })
        await native.run(['shell', `mv ${originalLibrary} ${backup}`])
      }
      const absent = await native.run(['shell', `test ! -e ${originalLibrary} && echo absent`])
      if (absent !== 'absent') throw new Error('Preinstalled library is still present')
      report.preinstalledLibraryAbsent = true
    }
    target = client.getTarget(keys[0])
    initialForwards = await target.listForwards()
    driver = new CaptureUiDriver(target, path.join(root, 'resources/uitestkit_sdk/uitest_agent_v1.1.0.so'), '1.1.0')
    driver.nativeVideo = native
    ipcMain.handle('probe-create', () => 'probe-session')
    ipcMain.handle('probe-size', () => driver.getDisplaySize())
    ipcMain.handle('probe-start', async (_event, id, scale, generation, preferVideo) => {
      scope?.dispose()
      await driver.stopCaptureScreen()
      scope = new CaptureScope((data, metadata) => {
        if (sampling) {
          if (!metadata?.config) report.received++
          report.bytes += data.length
        }
        report.codec = metadata?.codec || 'jpeg'
        win.webContents.send('captureScreen', id, generation, data, metadata)
      })
      await driver.startOwnedCapture(scope, scale, preferVideo)
    })
    ipcMain.handle('probe-stop', () => {
      scope?.dispose()
      stopTask = driver.stopCaptureScreen()
      return stopTask
    })
    win = new BrowserWindow({ width: 500, height: 800, show: true, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } })
    const page = path.join(dir, 'index.html')
    fs.writeFileSync(page, '<title>Scrcpy Harmony live client check</title><style>canvas {width:100%}</style>')
    await win.loadFile(page)
    await win.webContents.executeJavaScript(`
      globalThis.probeStore = { scale: 0.5 };
      globalThis.counts = { decoded: 0, errors: [] };
      const ipc = require('electron').ipcRenderer;
      globalThis.main = {
        createCaptureSession: (...a) => ipc.invoke('probe-create', ...a),
        startCaptureScreen: (...a) => ipc.invoke('probe-start', ...a),
        stopCaptureScreen: (...a) => ipc.invoke('probe-stop', ...a),
        getDisplaySize: (...a) => ipc.invoke('probe-size', ...a),
        on: (name, callback) => { const listener = (_e, ...a) => callback(...a); ipc.on(name, listener); return () => ipc.off(name, listener) },
        touchDown() {}, touchMove() {}, touchUp() {},
      };
      const draw = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function(...a) { draw.apply(this, a); counts.decoded++; };
      console.error = (...a) => counts.errors.push(a.map(x => x?.message || String(x)).join(' '));
      void 0;
    `)
    await win.webContents.executeJavaScript(renderer + '; globalThis.client = new ClientModule.default("probe-target"); document.body.append(client.canvas); void 0;')
    await Promise.race([win.webContents.executeJavaScript('client.ready'), new Promise((_, reject) => setTimeout(() => reject(new Error('Client first paint timed out')), 20000))])
    report.deployedLibrary = native.preferred
    const started = performance.now()
    report.received = report.bytes = 0
    await win.webContents.executeJavaScript('counts.decoded = 0')
    sampling = true
    await new Promise(resolve => setTimeout(resolve, 15000))
    sampling = false
    report.durationMs = Math.round(performance.now() - started)
    Object.assign(report, await win.webContents.executeJavaScript('counts'))
    report.receivedFps = +(report.received * 1000 / report.durationMs).toFixed(2)
    report.decodedFps = +(report.decoded * 1000 / report.durationMs).toFixed(2)
    if (report.codec !== 'h264' || !report.decoded || report.errors.length || report.streamError) throw new Error('Real native decode validation failed')
    const beforeScale = await win.webContents.executeJavaScript('({ width: client.canvas.width, height: client.canvas.height, frames: counts.decoded })')
    await win.webContents.executeJavaScript('probeStore.scale = 1; client.start()')
    await new Promise(resolve => setTimeout(resolve, 3000))
    report.scaleRestart = await win.webContents.executeJavaScript('({ width: client.canvas.width, height: client.canvas.height, frames: counts.decoded })')
    if (report.scaleRestart.frames <= beforeScale.frames ||
        (report.scaleRestart.width === beforeScale.width && report.scaleRestart.height === beforeScale.height)) throw new Error('Scale restart did not produce a resized frame')
    await win.webContents.executeJavaScript('client.destroy(); void 0')
    await new Promise(resolve => setTimeout(resolve, 100))
    await stopTask
    await win.webContents.executeJavaScript('client = new ClientModule.default("probe-target"); document.body.replaceChildren(client.canvas); client.ready')
    report.reopened = true
    const finalCounts = await win.webContents.executeJavaScript('counts')
    if (report.codec !== 'h264' || finalCounts.errors.length) throw new Error('Native restart validation failed')
    await win.webContents.executeJavaScript('client.destroy(); void 0')
    await new Promise(resolve => setTimeout(resolve, 100))
    await stopTask
  }
  run().catch(error => { report.error = error.message }).finally(async () => {
    try { scope?.dispose(); await stopTask; await driver?.stopCaptureScreen(); await native?.stop(); report.stopConfirmed = true } catch (error) { report.cleanupError = error.message }
    driver?.connection?.end()
    try { await releaseProbeForward(target, driver?.port, initialForwards) } catch (error) { report.cleanupError = error.message }
    if (backup) {
      try {
        await recoverProbeBackup(path.join(dir, 'library-backup.json'), command => native.run(['shell', command]))
        report.originalLibraryRestored = true
      } catch (error) { report.cleanupError = error.message; report.restoreBackup = backup }
    }
    win?.destroy()
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    app.exit(report.error || report.cleanupError ? 1 : 0)
  })
}
