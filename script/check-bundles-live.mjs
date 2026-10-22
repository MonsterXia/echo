// Build first. Read-only device validation; never installs/uninstalls applications.
// node script/check-bundles-live.mjs <evidence-directory>
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import os from 'node:os'
import { _electron } from 'playwright-core'

assert.ok(process.argv[2], 'Pass an evidence directory')
const outputDir = path.resolve(process.argv[2])
await mkdir(outputDir, { recursive: true })
const profile = await mkdtemp(path.join(await realpath(os.tmpdir()), 'scrcpy-bundles-'))
await mkdir(path.join(profile, 'data'))
await writeFile(path.join(profile, 'data/main.json'), JSON.stringify({ panel: 'application', application: { sysBundle: true, listView: true } }))
const report = { startedAt: new Date().toISOString(), platform: process.platform, arch: process.arch, os: os.release(),
  sourceSha256: createHash('sha256').update(await readFile('src/main/lib/hdc/bundle.ts')).digest('hex'), passed: false,
  scope: 'Read-only real HDC/IPC and application panel refresh; installation/uninstallation not exercised' }
const redactions = new Map()
let application, output = ''
async function waitFor(check, timeout = 180_000) {
  const deadline = Date.now() + timeout
  do { if (await check()) return; await delay(250) } while (Date.now() < deadline)
  throw new Error('Timed out waiting for the application list')
}
try {
  application = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'),
    args: [path.resolve('dist'), `--user-data-dir=${profile}`, '--enable-logging'], chromiumSandbox: true })
  const child = application.process()
  const append = (chunk) => { output = (output + chunk.toString()).slice(-128_000) }
  child.stdout?.on('data', append); child.stderr?.on('data', append)
  const page = await application.firstWindow()
  page.setDefaultTimeout(30_000)
  await page.locator('#app .panel-with-toolbar').first().waitFor()
  report.runtime = await application.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), electron: process.versions.electron }))
  const targets = await page.evaluate(() => main.getTargets())
  assert.equal(targets.length, 1, 'Connect one authorized Harmony device')
  const key = targets[0].key
  redactions.set(key, 'DEVICE_1')
  report.device = { name: targets[0].name, version: targets[0].ohosVersion, api: targets[0].sdkVersion }
  const hdc = await page.evaluate(() => main.resolveResources(
    navigator.platform.startsWith('Win') ? 'hdc/hdc.exe' : 'hdc/hdc'))
  const param = (name) => execFileSync(hdc, ['-t', key, 'shell', 'param', 'get', name],
    { encoding: 'utf8', timeout: 15_000 }).trim()
  report.device.model = param('const.product.model')
  report.device.software = param('const.product.software.version')
  const names = await page.evaluate((key) => main.getBundles(key, true), key)
  const selected = names.filter((name) => name.startsWith('com.huawei.hmos.')).slice(0, 2)
  assert.equal(selected.length, 2, 'Need two system bundles for read-only comparison')
  names.forEach((name, index) => { if (!selected.includes(name)) redactions.set(name, `APP_${index + 1}`) })
  const missing = 'io.github.monsterxia.scrcpyharmony.missing.m1_2'
  assert.ok(!names.includes(missing))
  const query = (bundleNames) => page.evaluate(({ key, bundleNames }) => main.getBundleInfos(key, bundleNames), { key, bundleNames })
  const before = await query(selected)
  assert.equal(before.length, 2)
  const mixed = await query([selected[0], missing, selected[1]])
  assert.deepEqual(mixed, before)
  assert.deepEqual(await query([missing]), [])
  const after = await query(selected)
  assert.deepEqual(after, before)
  report.ipc = { installedCount: names.length, missing, before, mixed, after }
  console.log('Real mixed bm dump query and subsequent recovery passed')

  const panel = page.locator('.panel-with-toolbar').filter({ hasText: /共 \d+ 个应用/ })
  await panel.waitFor()
  const refresh = panel.locator('[title="刷新"]')
  const ready = () => refresh.evaluate((el) => !el.closest('.luna-toolbar-disabled'))
  await waitFor(ready)
  const total = () => panel.locator('.luna-toolbar-item-text').innerText()
  report.ui = { before: await total() }
  assert.match(report.ui.before, /共 [1-9]\d* 个应用/)
  await refresh.click()
  await waitFor(async () => !(await ready()), 10_000)
  report.ui.refreshBusyObserved = true
  await waitFor(ready)
  report.ui.after = await total()
  assert.equal(report.ui.after, report.ui.before)
  report.pageErrors = (await page.pageErrors()).map((e) => e.message)
  assert.deepEqual(report.pageErrors, [])
  await application.close()
  report.exitCode = child.exitCode
  assert.equal(report.exitCode, 0)
  report.passed = true
} catch (error) {
  report.error = error.stack
  throw error
} finally {
  if (application) await application.close().catch(() => {})
  const redact = (text) => [...redactions].sort((a, b) => b[0].length - a[0].length).reduce((value, [from, to]) => value.replaceAll(from, to), text).replaceAll(process.cwd(), '<repository>')
  await writeFile(path.join(outputDir, 'report.json'), redact(JSON.stringify(report, null, 2)) + '\n')
  await writeFile(path.join(outputDir, 'application.log'), redact(output))
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
console.log('Live read-only bundle check passed')
