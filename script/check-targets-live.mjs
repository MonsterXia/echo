// Build first. Optional --reconnect waits for a human to unplug/replug USB.
// node script/check-targets-live.mjs <evidence-directory> [--reconnect]
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'

assert.ok(process.argv[2], 'Pass an evidence directory')
const outputDir = path.resolve(process.argv[2])
await mkdir(outputDir, { recursive: true })
const profile = await mkdtemp(path.join(await realpath(os.tmpdir()), 'scrcpy-targets-'))
const require = createRequire(import.meta.url)
const keys = []
const redact = (text) => keys.reduce((value, key, index) =>
  value.replaceAll(key, `DEVICE_${index + 1}`), text)
const report = { startedAt: new Date().toISOString(), platform: process.platform,
  os: os.release(), arch: process.arch, reconnect: process.argv.includes('--reconnect'),
  sourceSha256: createHash('sha256').update(await readFile('src/main/lib/hdc.ts')).digest('hex'),
  states: [], passed: false }
let application
let output = ''
try {
  application = await electron.launch({ executablePath: require('electron'),
    args: [path.resolve('dist'), `--user-data-dir=${profile}`, '--enable-logging'],
    chromiumSandbox: true, timeout: 30_000 })
  const child = application.process()
  const append = (chunk) => { output = (output + chunk.toString()).slice(-64_000) }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  const page = await application.firstWindow({ timeout: 30_000 })
  page.setDefaultTimeout(20_000)
  await page.locator('#app .panel-with-toolbar').first().waitFor({ state: 'visible' })
  report.runtime = await application.evaluate(({ app }) => ({
    version: app.getVersion(), packaged: app.isPackaged, electron: process.versions.electron,
  }))
  await page.evaluate(() => {
    window.targetChangeCount = 0
    main.on('changeTarget', () => window.targetChangeCount++)
  })
  const snapshot = async (phase) => {
    const state = await page.evaluate(async () => {
      const select = document.querySelector('#app select')
      return { ipcTargets: await main.getTargets(), rendererTargets: await main.getMemStore('targets'),
        selected: await main.getMainStore('target'), events: window.targetChangeCount,
        select: { disabled: select.disabled, value: select.value,
          labels: [...select.options].map((option) => option.text) } }
    })
    report.states.push({ phase, at: new Date().toISOString(), ...state })
    return state
  }
  await page.waitForFunction(async () => (await main.getMemStore('targets'))?.length > 0)
  const initial = await snapshot('connected')
  keys.push(...initial.ipcTargets.map((target) => target.key))
  assert.ok(keys.length > 0, 'Connect and authorize a Harmony device first')
  assert.deepEqual(initial.rendererTargets, initial.ipcTargets)
  assert.equal(initial.select.value, initial.selected.key)
  assert.equal(initial.select.disabled, false)
  const hdc = await page.evaluate(() => main.resolveResources(
    navigator.platform.startsWith('Win') ? 'hdc/hdc.exe' : 'hdc/hdc'))
  const param = (name) => execFileSync(hdc, ['-t', keys[0], 'shell', 'param', 'get', name],
    { encoding: 'utf8', timeout: 15_000 }).trim()
  report.device = { name: param('const.product.name'), model: param('const.product.model'),
    software: param('const.product.software.version'), api: param('const.ohos.apiversion') }
  assert.equal(initial.ipcTargets[0].name, report.device.name)
  assert.equal(initial.ipcTargets[0].sdkVersion, report.device.api)
  assert.ok(initial.ipcTargets[0].ohosVersion)
  assert.ok(report.device.software.includes(initial.ipcTargets[0].ohosVersion))
  console.log('Connected device verified:', redact(JSON.stringify(initial)))
  if (report.reconnect) {
    assert.equal(keys.length, 1, 'Disconnect/reconnect check expects one device')
    console.log('READY: unplug USB and leave it disconnected until DISCONNECTED is printed')
    await page.waitForFunction(async () => {
      const targets = await main.getMemStore('targets')
      return Array.isArray(targets) && targets.length === 0 &&
        (await main.getMainStore('target')) === null && document.querySelector('#app select').disabled
    }, null, { timeout: 240_000 })
    const disconnected = await snapshot('disconnected')
    assert.deepEqual(disconnected.ipcTargets, [])
    assert.ok(disconnected.events > initial.events)
    console.log('DISCONNECTED verified: reconnect USB now')
    await page.waitForFunction(async (key) => {
      const targets = await main.getMemStore('targets')
      return targets?.some((target) => target.key === key) &&
        (await main.getMainStore('target'))?.key === key && document.querySelector('#app select').value === key
    }, keys[0], { timeout: 240_000 })
    const reconnected = await snapshot('reconnected')
    assert.deepEqual(reconnected.ipcTargets, initial.ipcTargets)
    assert.deepEqual(reconnected.rendererTargets, initial.rendererTargets)
    assert.ok(reconnected.events > disconnected.events)
  }
  assert.deepEqual((await page.pageErrors()).map((error) => error.message), [])
  await application.close()
  assert.equal(child.exitCode, 0)
  report.passed = true
} catch (error) {
  report.error = error.stack
  throw error
} finally {
  if (application) await application.close().catch(() => {})
  await writeFile(path.join(outputDir, 'report.json'), redact(JSON.stringify(report, null, 2)) + '\n')
  await writeFile(path.join(outputDir, 'application.log'), redact(output))
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
console.log('Live target check passed')
