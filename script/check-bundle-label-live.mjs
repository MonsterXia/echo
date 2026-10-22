// Read-only bilibili label validation. Build first, then:
// node script/check-bundle-label-live.mjs <evidence-directory> [offline]
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import os from 'node:os'
import { _electron } from 'playwright-core'

assert.ok(process.argv[2], 'Pass an evidence directory')
const output = path.resolve(process.argv[2])
const offline = process.argv[3] === 'offline'
const bundleName = 'yylx.danmaku.bili'
await mkdir(output, { recursive: true })
const profile = await mkdtemp(path.join(os.tmpdir(), 'scrcpy-label-'))
await mkdir(path.join(profile, 'data'))
await writeFile(path.join(profile, 'data/main.json'), JSON.stringify({
  panel: 'application', application: { sysBundle: false, listView: true },
}))
const report = {
  startedAt: new Date().toISOString(), platform: process.platform,
  arch: process.arch, os: os.release(), bundleName, offline,
  networkControl: offline ? 'Child process HTTP(S) proxy at closed localhost port 9; HDC remains real' : 'Normal network',
  sourceSha256: createHash('sha256').update(await readFile('src/main/lib/hdc/bundle.ts')).digest('hex'),
  passed: false,
}
let application
async function waitFor(check, timeout = 180_000) {
  const deadline = Date.now() + timeout
  do { if (await check()) return; await delay(250) } while (Date.now() < deadline)
  throw new Error('Timed out waiting for the application list')
}
try {
  const env = { ...process.env }
  if (offline) {
    for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
      env[name] = 'http://127.0.0.1:9'
    }
    env.NO_PROXY = env.no_proxy = 'localhost,127.0.0.1'
  }
  application = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'), env,
    args: [path.resolve('dist'), `--user-data-dir=${profile}`], chromiumSandbox: true,
  })
  const child = application.process()
  const page = await application.firstWindow()
  page.setDefaultTimeout(30_000)
  await page.locator('#app .panel-with-toolbar').first().waitFor()
  report.runtime = await application.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), electron: process.versions.electron }))
  const targets = await page.evaluate(() => main.getTargets())
  assert.equal(targets.length, 1, 'Connect exactly one authorized device')
  const key = targets[0].key
  report.device = { version: targets[0].ohosVersion, api: targets[0].sdkVersion }
  const hdc = path.resolve('resources/hdc', process.platform === 'win32' ? 'hdc.exe' : 'hdc')
  const shell = (...args) => execFileSync(hdc, ['-t', key, 'shell', ...args], { encoding: 'utf8', timeout: 15_000, maxBuffer: 8 * 1024 * 1024 }).trim()
  report.device.model = shell('param', 'get', 'const.product.model')
  report.hdc = execFileSync(hdc, ['-v'], { encoding: 'utf8' }).trim()
  const raw = shell('bm', 'dump', '-n', bundleName)
  const dump = JSON.parse(raw.slice(raw.indexOf('{')))
  report.metadata = {
    label: dump.applicationInfo.label, iconPath: dump.applicationInfo.iconPath,
    distribution: dump.applicationInfo.appDistributionType,
    provision: dump.applicationInfo.appProvisionType,
  }
  const expected = shell('bm', 'dump', '-n', bundleName, '-l')
  assert.equal(expected, '哔哩哔哩')
  const query = () => page.evaluate(({ key, bundleName }) => main.getBundleInfos(key, [bundleName]), { key, bundleName })
  const [before] = await query()
  assert.equal(before.label, expected)
  report.ipc = { label: before.label, iconPresent: !!before.icon }
  if (offline) assert.equal(before.icon, '', 'Online metadata must actually be unavailable')
  else assert.ok(before.icon, 'Store icon fallback must still work online')
  const panel = page.locator('.panel-with-toolbar').filter({ hasText: /共 \d+ 个应用/ })
  await panel.waitFor()
  await panel.locator('input[type="text"]').fill(bundleName)
  const refresh = panel.locator('[title="刷新"]')
  const ready = () => refresh.evaluate(el => !el.closest('.luna-toolbar-disabled'))
  await waitFor(ready)
  const row = panel.locator('.luna-data-grid-data-container tr').filter({ hasText: bundleName })
  await row.waitFor()
  assert.ok((await row.innerText()).includes(expected))
  await refresh.click()
  await waitFor(async () => !(await ready()), 10_000)
  await waitFor(ready)
  assert.ok((await row.innerText()).includes(expected))
  const [after] = await query()
  assert.equal(after.label, expected)
  report.ui = { label: expected, refreshPassed: true }
  await panel.screenshot({ path: path.join(output, 'bilibili.png') })
  report.pageErrors = (await page.pageErrors()).map(e => e.message)
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
  // Only selected app fields are saved; no device key or full application logs.
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
console.log(`bilibili label validation passed (${offline ? 'offline' : 'online'})`)
