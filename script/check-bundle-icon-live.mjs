// Read-only bilibili icon evidence. Build first, then run with <directory> [offline].
// The application-list selector is restricted; metadata, HDC and rendering stay real.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { _electron } from 'playwright-core'

assert.ok(process.argv[2], 'Pass an evidence directory')
assert.ok(!process.argv[3] || process.argv[3] === 'offline', 'Use offline or omit mode')
const output = path.resolve(process.argv[2])
const offline = process.argv[3] === 'offline'
const bundleName = 'yylx.danmaku.bili'
const hash = (data) => createHash('sha256').update(data).digest('hex')
const report = {
  startedAt: new Date().toISOString(), bundleName, offline,
  scope: 'One real application; getBundles selector restricted to bilibili; real getBundleInfos, HDC and renderer; fresh profile; no application mutations',
  verificationPassed: false, offlineIconAcceptancePassed: false,
}
let application, profile, blockedRequests = 0
async function bounded(promise, milliseconds) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Verification deadline exceeded')), milliseconds)
    })])
  } finally { clearTimeout(timer) }
}
// This proxy never forwards traffic. Do not retain request URLs or headers.
const proxy = createServer((_req, res) => { blockedRequests++; res.writeHead(502); res.end() })
proxy.on('connect', (_req, socket) => { blockedRequests++; socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n') })
async function verify() {
  await mkdir(output, { recursive: true })
  profile = await mkdtemp(path.join(os.tmpdir(), 'scrcpy-icon-'))
  await mkdir(path.join(profile, 'data'))
  // An unused panel avoids querying any application before installing the selector.
  await writeFile(path.join(profile, 'data/main.json'), JSON.stringify({
    panel: 'icon-validation', application: { sysBundle: false, listView: true },
  }))
  Object.assign(report, {
    sourceSha256: hash(await readFile('src/main/lib/hdc/bundle.ts')),
    rendererSourceSha256: hash(await readFile('src/renderer/main/components/application/Application.tsx')),
    mainBuildSha256: hash(await readFile('dist/main/index.js')),
    scriptSha256: hash(await readFile(new URL(import.meta.url))),
  })
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
  const proxyUrl = `http://127.0.0.1:${proxy.address().port}`
  const env = { ...process.env }
  if (offline) {
    for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) env[key] = proxyUrl
    env.NO_PROXY = env.no_proxy = 'localhost,127.0.0.1'
  }
  application = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'), env,
    args: [path.resolve('dist'), `--user-data-dir=${profile}`,
      ...(offline ? [`--proxy-server=${proxyUrl}`] : [])], chromiumSandbox: true,
  })
  const child = application.process()
  const page = await application.firstWindow()
  page.setDefaultTimeout(30_000)
  await page.locator('#app .luna-toolbar').first().waitFor()
  await application.evaluate(({ ipcMain }, bundleName) => {
    ipcMain.removeHandler('getBundles')
    ipcMain.handle('getBundles', () => [bundleName])
    const getInfos = ipcMain._invokeHandlers.get('getBundleInfos')
    if (!getInfos) throw new Error('Metadata handler missing')
    globalThis.iconQueriesCompleted = 0
    ipcMain.removeHandler('getBundleInfos')
    ipcMain.handle('getBundleInfos', async (event, key, names) => {
      if (!Array.isArray(names) || names.some(name => name !== bundleName)) {
        throw new Error('Only the selected application may be queried')
      }
      const result = await getInfos(event, key, names)
      globalThis.iconQueriesCompleted++
      return result
    })
  }, bundleName)
  const targets = await page.evaluate(() => main.getTargets())
  assert.equal(targets.length, 1, 'Connect exactly one authorized device')
  const key = targets[0].key
  report.device = { version: targets[0].ohosVersion, api: targets[0].sdkVersion }
  report.runtime = await application.evaluate(({ app }) => ({
    packaged: app.isPackaged, electron: process.versions.electron,
    platform: process.platform, arch: process.arch,
  }))
  const hdc = path.resolve('resources/hdc', process.platform === 'win32' ? 'hdc.exe' : 'hdc')
  const shell = (...args) => execFileSync(hdc, ['-t', key, 'shell', ...args], {
    encoding: 'utf8', timeout: 15_000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  const raw = shell('bm', 'dump', '-n', bundleName)
  const dump = JSON.parse(raw.slice(raw.indexOf('{')))
  assert.equal(dump.name, bundleName)
  const appInfo = dump.applicationInfo
  const module = dump.hapModuleInfos?.find(m => m.name === dump.mainEntry)
  report.metadata = {
    label: appInfo.label, iconPath: appInfo.iconPath, iconId: appInfo.iconId,
    distribution: appInfo.appDistributionType, provision: appInfo.appProvisionType,
  }
  const help = shell('bm', 'dump', '-h')
  report.capabilities = { labelOption: /--label\b/.test(help), iconOption: /--icon\b/.test(help) }
  report.resourceAccess = []
  for (const [kind, remote] of [['hap', module?.hapPath], ['resourceIndex', module?.resourcePath]]) {
    if (!remote) continue
    assert.ok(remote.startsWith(`/data/app/el1/bundle/public/${bundleName}/`))
    assert.ok(!remote.includes('..'))
    const destination = path.join(profile, `${kind}.probe`)
    let response = '', commandCompleted = false
    try {
      response = execFileSync(hdc, ['-t', key, 'file', 'recv', remote, destination], {
        encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'],
      })
      commandCompleted = true
    } catch (error) { response = `${error.stdout || ''}\n${error.stderr || ''}` }
    const file = await stat(destination).catch(() => null)
    report.resourceAccess.push({ kind, readable: commandCompleted && !!file?.size && !/error|fail|denied/i.test(response),
      permissionDenied: /permission denied|operation not permitted/i.test(response) })
  }
  if (offline) {
    report.stage = 'network-control'
    const beforeNodeProbe = blockedRequests
    const nodeBlocked = await application.evaluate(async () => {
      // Axios follows the same environment proxy as production metadata requests.
      const axios = process.getBuiltinModule('module').createRequire(`${process.cwd()}/package.json`)('axios')
      try { await axios.get('https://example.invalid/icon-network-probe', { timeout: 5000 }); return false }
      catch { return true }
    })
    const nodeProxyRequests = blockedRequests - beforeNodeProbe
    const beforeRendererProbe = blockedRequests
    const rendererBlocked = await page.evaluate(async () => {
      try { await fetch('https://example.invalid/icon-network-probe'); return false }
      catch { return true }
    })
    const rendererProxyRequests = blockedRequests - beforeRendererProbe
    report.network = { mode: 'Deny proxy for Node HTTP(S) and Chromium; no upstream forwarding',
      nodeBlocked, rendererBlocked, nodeProxyRequests, rendererProxyRequests,
      observedProxyRequests: blockedRequests }
    assert.ok(nodeBlocked && rendererBlocked && nodeProxyRequests > 0 && rendererProxyRequests > 0)
  } else report.network = { mode: 'Normal network; fresh profile and process' }

  const query = () => page.evaluate(({ key, bundleName }) => main.getBundleInfos(key, [bundleName]), { key, bundleName })
  const summarize = info => ({ label: info.label, iconPresent: !!info.icon,
    iconKind: !info.icon ? 'empty' : info.icon.startsWith('data:') ? 'data' : /^https?:/.test(info.icon) ? 'remote-url' : 'other' })
  const [before] = await query()
  assert.equal(before?.label, '哔哩哔哩')
  report.ipc = { before: summarize(before) }
  report.stage = 'application-panel'
  await page.evaluate(() => main.setMainStore('panel', 'application'))
  await page.reload()
  const panel = page.locator('.panel-with-toolbar').filter({ hasText: '共 1 个应用' })
  await panel.waitFor()
  await panel.locator('input[type="text"]').fill(bundleName)
  const row = panel.locator('.luna-data-grid-data-container tr').filter({ hasText: bundleName })
  await row.waitFor()
  assert.ok((await row.innerText()).includes('哔哩哔哩'))
  const defaultHash = hash(await readFile('src/renderer/assets/default-icon.png'))
  async function inspectImage(locator) {
    await locator.waitFor()
    await locator.evaluate(img => img.decode())
    const image = await locator.evaluate(img => ({ width: img.naturalWidth,
      height: img.naturalHeight, source: img.currentSrc }))
    assert.ok(image.width > 0 && image.height > 0)
    // Electron net uses the same session proxy; this byte check does not bypass
    // offline control and does not depend on the image host allowing CORS.
    const bytes = await application.evaluate(async ({ net }, source) =>
      Array.from(new Uint8Array(await (await net.fetch(source)).arrayBuffer())), image.source)
    const sha256 = hash(Buffer.from(bytes))
    return { width: image.width, height: image.height, sha256, isDefault: sha256 === defaultHash }
  }
  report.ui = { list: await inspectImage(row.locator('img')) }
  await panel.screenshot({ path: path.join(output, 'bilibili-list.png') })
  report.stage = 'icon-view'
  // Icon view searches names; the list view also searches package columns.
  await panel.locator('input[type="text"]').fill('哔哩哔哩')
  await panel.locator('.icon-grid').click()
  const icon = panel.locator('.luna-icon-list-name-wrapper').filter({ hasText: '哔哩哔哩' }).locator('../..')
  report.ui.icons = await inspectImage(icon.locator('img'))
  await panel.screenshot({ path: path.join(output, 'bilibili-icons.png') })
  report.stage = 'refresh'
  const completedBefore = await application.evaluate(() => globalThis.iconQueriesCompleted)
  await panel.locator('[title="刷新"]').click()
  const deadline = Date.now() + 30_000
  while (await application.evaluate(() => globalThis.iconQueriesCompleted) === completedBefore) {
    assert.ok(Date.now() < deadline, 'Refresh metadata query did not complete')
    await delay(100)
  }
  await icon.locator('img').waitFor()
  report.ui.afterRefresh = await inspectImage(icon.locator('img'))
  const [after] = await query()
  report.ipc.after = summarize(after)
  assert.deepEqual(report.ipc.after, report.ipc.before)
  assert.deepEqual(report.ui.afterRefresh, report.ui.icons)
  assert.equal(report.ui.list.sha256, report.ui.icons.sha256)
  report.outcome = report.ui.list.isDefault ? 'default-icon-fallback' : 'application-icon-rendered'
  report.pageErrorCount = (await page.pageErrors()).length
  assert.equal(report.pageErrorCount, 0)
  if (offline) report.network.observedProxyRequests = blockedRequests
  await application.close()
  report.exitCode = child.exitCode
  assert.equal(report.exitCode, 0)
}
try {
  await bounded(verify(), 120_000)
  report.offlineIconAcceptancePassed = offline && report.ipc.before.iconPresent && !report.ui.list.isDefault
  report.verificationPassed = true
  report.stage = 'complete'
} catch (error) {
  // Raw exceptions can contain device keys, URLs or app metadata. Keep failures bounded.
  report.errorType = error.name
  report.verificationPassed = false
  report.offlineIconAcceptancePassed = false
  console.error(`bilibili icon verification failed: ${error.name}`)
  process.exitCode = 1
} finally {
  try {
    if (application) await bounded(application.close(), 10_000).catch(() => application.process().kill())
    proxy.closeAllConnections()
    await new Promise(resolve => proxy.close(resolve))
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  } finally {
    if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}
console.log(`bilibili icon result: ${report.outcome || 'verification-incomplete'}`)
