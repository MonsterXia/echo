// Live-device transport comparison. Keeps JPEGs in memory only; saves counts.
// Run with the app closed and a moving image on the device.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { Hdc, UiDriver } = require('hdckit')
const { loadConnection, sourcePath } = require('../test/helpers/uitest-stream.cjs')
const { releaseProbeForward } = require('./lib/probe-forward.cjs')

const root = path.resolve(__dirname, '..')
const baseline = '1f0de37'
const previous = execFileSync('git', ['show', `${baseline}:vendor/packages/hdckit/src/hdc/UiDriver.ts`], { cwd: root, encoding: 'utf8' })
const current = fs.readFileSync(sourcePath, 'utf8')
const report = {
  scope: 'Live JPEG transport; identical TCP chunks fed to old and current parsers; no screen contents saved',
  baseline,
  scale: Number(process.env.SCREENCAST_SCALE || 1),
  durationMs: 0,
  chunks: 0,
  bytes: 0,
  baselineFrames: 0,
  fixedFrames: 0,
  deliveredFrames: 0,
}
const oldParser = new (loadConnection(previous))()
const newParser = new (loadConnection(current))()
const jpeg = (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8
oldParser.setOnMessage((_id, bytes) => { if (jpeg(bytes)) report.baselineFrames++ })
newParser.setOnMessage((_id, bytes) => { if (jpeg(bytes)) report.fixedFrames++ })
const client = Hdc.createClient({ bin: path.join(root, 'resources/hdc/hdc.exe') })
let driver, connection, target, forwards = [], sampling = false
const watchdog = setTimeout(() => { console.error('Live capture check timed out'); process.exit(1) }, 45000)
async function run() {
  const keys = await client.listTargets()
  if (keys.length !== 1) throw new Error('Exactly one connected device is required')
  target = client.getTarget(keys[0])
  forwards = await target.listForwards()
  driver = new UiDriver(target, path.join(root, 'resources/uitestkit_sdk/uitest_agent_v1.1.0.so'), '1.1.0')
  connection = await driver.getConnection()
  report.displaySize = await driver.getDisplaySize()
  connection.socket.prependListener('data', (chunk) => {
    if (!sampling) return
    report.chunks++
    report.bytes += chunk.length
    oldParser.onData(chunk)
    newParser.onData(chunk)
  })
  sampling = true
  await driver.startCaptureScreen(() => { report.deliveredFrames++ }, { scale: report.scale })
  const started = performance.now()
  await new Promise((resolve) => setTimeout(resolve, 15000))
  report.durationMs = Math.round(performance.now() - started)
  await driver.stopCaptureScreen()
  sampling = false
  report.baselineFps = +(report.baselineFrames * 1000 / report.durationMs).toFixed(2)
  report.fixedFps = +(report.fixedFrames * 1000 / report.durationMs).toFixed(2)
  report.stopConfirmed = true
  console.log(JSON.stringify(report, null, 2))
  if (process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]), JSON.stringify(report, null, 2) + '\n')
}
run().catch((error) => { console.error(error.message); process.exitCode = 1 }).finally(async () => {
  sampling = false
  if (driver?.captureScreenCallback) {
    try { await driver.stopCaptureScreen() } catch { process.exitCode = 1 }
  }
  connection?.end()
  await releaseProbeForward(target, driver?.port, forwards)
  clearTimeout(watchdog)
})
