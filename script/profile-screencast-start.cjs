// Close the application's screencast before running. No device IDs or pixels saved.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildSync } = require('esbuild')
const { Hdc } = require('hdckit')
const { releaseProbeForward } = require('./lib/probe-forward.cjs')
const root = path.resolve(__dirname, '..')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screencast-start-'))
const bundle = path.join(dir, 'probe.cjs')
buildSync({ stdin: { contents: "export * from './src/main/lib/hdc/nativeVideo'; export * from './src/main/lib/hdc/captureDriver'", resolveDir: root }, outfile: bundle, bundle: true, platform: 'node', format: 'cjs' })
const { NativeVideo, CaptureUiDriver, CaptureScope } = require(bundle)
const report = { scope: 'Production control/native startup to first encoded frame; excludes window and Chromium decode', stages: [] }
const started = performance.now()
function wrap(object, method, label) {
  const original = object[method]
  object[method] = async function (...args) {
    const begin = performance.now()
    const stage = { name: typeof label === 'function' ? label(args) : label, atMs: Math.round(begin - started) }
    try { return await original.apply(this, args) } catch (error) { stage.failed = true; throw error }
    finally { stage.durationMs = Math.round(performance.now() - begin); report.stages.push(stage) }
  }
}
let driver, native, target, forwards, scope
async function run() {
  const client = Hdc.createClient({ bin: path.join(root, 'resources/hdc/hdc.exe') })
  const keys = await client.listTargets()
  if (keys.length !== 1) throw new Error('Exactly one connected device required')
  target = client.getTarget(keys[0])
  forwards = await target.listForwards()
  driver = new CaptureUiDriver(target, path.join(root, 'resources/uitestkit_sdk/uitest_agent_v1.1.0.so'), '1.1.0')
  native = new NativeVideo({ ...client.options, connectKey: keys[0], resourcesDir: path.join(root, 'resources/native-video'), cacheDir: process.env.SCREENCAST_PROBE_CACHE })
  driver.nativeVideo = native
  if ((await native.run(['shell', 'cat /proc/net/unix'])).includes('@scrcpy_grpc_socket')) {
    throw new Error('Close the active screencast before profiling control initialization')
  }
  wrap(driver, 'shell', args => 'control: ' + args[0].split(' ').slice(0, 2).join(' '))
  wrap(driver, 'stop', 'control reset')
  wrap(driver, 'getDisplaySize', 'control ready')
  wrap(native, 'run', args => 'native: ' + args[0].slice(0, args[0][0] === 'shell' ? 2 : 1).join(' ').replace(/scrcpy_harmony_[a-f0-9]+/g, 'session'))
  wrap(native, 'candidates', 'compatibility inventory')
  wrap(native, 'openStream', 'native first encoded frame')
  wrap(native, 'stop', 'native cleanup')
  const open = performance.now()
  if (process.argv.includes('--reset-control')) await driver.stop()
  await driver.initializeControl()
  let click = open
  if (process.argv.includes('--prepare')) {
    const prepared = await native.prepare(1)
    if (!prepared) throw new Error('Preparation unavailable')
    report.preparationReadyMs = Math.round(performance.now() - open)
    report.streamsBeforeClick = report.stages.filter(stage => stage.name === 'native first encoded frame').length
    const [pid] = await native.ownedPids()
    if (pid) {
      const ticks = async () => {
        const stat = await native.run(['shell', `cat /proc/${pid}/stat`])
        const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)
        return Number(fields[11]) + Number(fields[12])
      }
      const before = await ticks(), begin = performance.now()
      await new Promise(resolve => setTimeout(resolve, 2000))
      const after = await ticks()
      report.idleSample = { durationMs: Math.round(performance.now() - begin), cpuTicks: after - before }
    }
    click = performance.now()
  }
  scope = new CaptureScope((_data, metadata) => { report.codec = metadata?.codec || 'jpeg' })
  await driver.startOwnedCapture(scope, 1)
  report.readyMs = Math.round(performance.now() - click)
  report.library = native.preferred
}
run().catch(error => { report.error = error.message; process.exitCode = 1 }).finally(async () => {
  try { scope?.dispose(); await driver?.stopCaptureScreen(); await native?.stop() } catch (error) { report.cleanupError = error.message; process.exitCode = 1 }
  driver?.connection?.end()
  try { await releaseProbeForward(target, driver?.port, forwards || []) } catch (error) { report.cleanupError = error.message; process.exitCode = 1 }
  const json = JSON.stringify(report, null, 2) + '\n'
  if (process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]), json)
  console.log(json)
})
