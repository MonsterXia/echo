// Build first; one authorized phone with WPS and bilibili installed. Read-only.
// The local proxy first accepts store traffic without replying, then forwards
// only the fixed store API. HDC, production IPC and UI remain real throughout.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { request } from 'node:https'
import { connect } from 'node:net'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import os from 'node:os'
import { _electron } from 'playwright-core'
import { runLiveProbe, closeOwnedApplication } from './lib/live-probe-lifecycle.mjs'

assert.ok(process.argv[2], 'Pass an evidence directory')
const directory = path.resolve(process.argv[2])
const storeUrl = 'https://web-drcn.hispace.dbankcloud.com/edge/webedge/appinfo'
const names = ['cn.wps.mobileoffice.hap', 'yylx.danmaku.bili']
const report = { startedAt: new Date().toISOString(), passed: false,
  scope: 'Real macOS/Windows Electron, HDC and application UI; two selected apps; controlled silent store followed by real allowlisted upstream; no device mutations or pixels saved' }
const sockets = new Set(), upstream = new Set()
let online = false, requests = 0, profile, application, diagnostics = ''
const proxy = createServer((req, res) => {
  if (req.url !== storeUrl) { res.writeHead(502); res.end(); return }
  requests++
  if (!online) { req.resume(); return }
  const remote = request(storeUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, timeout: 5000 }, reply => {
    res.writeHead(reply.statusCode || 502, { 'content-type': reply.headers['content-type'] || 'application/json' })
    reply.pipe(res)
  })
  upstream.add(remote)
  remote.on('close', () => upstream.delete(remote))
  remote.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
  remote.on('timeout', () => remote.destroy())
  res.on('close', () => remote.destroy())
  req.pipe(remote)
})
proxy.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
proxy.on('connect', (req, socket, head) => {
  if (req.url !== 'web-drcn.hispace.dbankcloud.com:443') { socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); return }
  requests++
  // A CONNECT socket is detached from HTTP parsing; drain it to observe the
  // client's FIN, and finish the server half instead of retaining a half-close.
  socket.on('end', () => socket.destroy())
  if (!online) { socket.resume(); return }
  // Axios can use a TLS CONNECT tunnel. Preserve end-to-end TLS verification;
  // the probe never reads or saves application data flowing through the tunnel.
  const remote = connect(443, 'web-drcn.hispace.dbankcloud.com')
  upstream.add(remote)
  remote.on('connect', () => {
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head.length) remote.write(head)
    socket.pipe(remote); remote.pipe(socket)
  })
  remote.on('error', () => socket.destroy())
  socket.on('error', () => remote.destroy())
  socket.on('close', () => remote.destroy())
  remote.on('close', () => { upstream.delete(remote); socket.destroy() })
})

async function verify({ step, acquire, signal }) {
  await acquire(() => mkdir(directory, { recursive: true }), async () => {})
  profile = await acquire(() => mkdtemp(path.join(os.tmpdir(), 'scrcpy-store-fallback-')),
    value => rm(value, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  await acquire(() => mkdir(path.join(profile, 'data')), async () => {})
  await acquire(() => writeFile(path.join(profile, 'data/main.json'), JSON.stringify({ panel: 'store-validation', application: { sysBundle: false, listView: true } })), async () => {})
  report.sha256 = {}
  for (const file of ['src/main/lib/hdc/bundle.ts', 'src/main/lib/hdc/onlineBundleInfo.ts', 'dist/main/index.js']) {
    report.sha256[file] = createHash('sha256').update(await step(() => readFile(file))).digest('hex')
  }
  await acquire(() => new Promise((resolve, reject) => {
    proxy.once('error', reject)
    proxy.listen(0, '127.0.0.1', () => { proxy.removeListener('error', reject); resolve(proxy) })
  }), async server => {
    for (const remote of upstream) remote.destroy()
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  })
  const env = { ...process.env }, proxyUrl = `http://127.0.0.1:${proxy.address().port}`
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) env[key] = proxyUrl
  env.NO_PROXY = env.no_proxy = 'localhost,127.0.0.1'
  application = await acquire(() => _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), env,
    args: [path.resolve('dist'), `--user-data-dir=${profile}`], chromiumSandbox: true, timeout: 30000 }), closeOwnedApplication)
  const child = application.process()
  const capture = chunk => { diagnostics = (diagnostics + chunk.toString()).slice(-128000) }
  child.stdout?.on('data', capture); child.stderr?.on('data', capture)
  const page = await step(() => application.firstWindow())
  page.setDefaultTimeout(15000)
  await step(() => page.locator('#app .luna-toolbar').first().waitFor())
  report.runtime = await step(() => application.evaluate(({ app }) => ({ platform: process.platform, arch: process.arch, electron: process.versions.electron, packaged: app.isPackaged })))
  await step(() => application.evaluate(({ ipcMain }, names) => {
    ipcMain.removeHandler('getBundles')
    ipcMain.handle('getBundles', () => names)
    const original = ipcMain._invokeHandlers.get('getBundleInfos')
    globalThis.storeQueriesCompleted = 0
    ipcMain.removeHandler('getBundleInfos')
    ipcMain.handle('getBundleInfos', async (event, key, selected) => {
      if (!Array.isArray(selected) || selected.some(name => !names.includes(name))) throw new Error('Unexpected query scope')
      const result = await original(event, key, selected)
      globalThis.storeQueriesCompleted++
      return result
    })
  }, names))
  const targets = await step(() => page.evaluate(() => main.getTargets()))
  assert.equal(targets.length, 1)
  const key = targets[0].key
  const query = () => step(() => page.evaluate(({ key, names }) => main.getBundleInfos(key, names), { key, names }))
  report.stage = 'silent-store'
  const start = performance.now()
  const before = await query()
  report.firstBatchMs = Math.round(performance.now() - start)
  report.firstBatchChecks = { count: before.length, identitiesMatch: before.map(info => info.bundleName).join('|') === names.join('|'), localFieldsPresent: before.every(info => info.label && info.versionName), iconsEmpty: before.every(info => !info.icon), requests }
  assert.ok(report.firstBatchMs < 8000, 'two local metadata reads plus one bounded store request')
  assert.deepEqual(before.map(info => info.bundleName), names)
  assert.ok(before.every(info => info.label && info.versionName && !info.icon))
  assert.equal(requests, 1)
  for (let i = 0; i < 20 && sockets.size; i++) await delay(25, undefined, { signal })
  report.openProxySocketsAfterTimeout = sockets.size
  assert.equal(sockets.size, 0, 'production timeout must close the silent proxy connection')
  report.silentRequestCancelled = true
  await step(() => page.evaluate(() => main.setMainStore('panel', 'application')))
  await step(() => page.reload())
  const panel = page.locator('.panel-with-toolbar').filter({ has: page.locator('.luna-data-grid') })
  for (const name of names) await step(() => panel.locator('.luna-data-grid-data-container tr').filter({ hasText: name }).waitFor())
  const refresh = panel.locator('[title="刷新"], [title="Refresh"]')
  const completed = await step(() => application.evaluate(() => globalThis.storeQueriesCompleted))
  const refreshStart = performance.now()
  await step(() => refresh.click())
  const deadline = Date.now() + 8000
  while (await step(() => application.evaluate(() => globalThis.storeQueriesCompleted)) === completed) {
    assert.ok(Date.now() < deadline); await delay(100, undefined, { signal })
  }
  report.offlineRefreshMs = Math.round(performance.now() - refreshStart)
  assert.deepEqual(await query(), before)
  assert.equal(requests, 1)
  report.localListAndRefreshPassed = true
  console.log('Silent-store local list and refresh passed; waiting for retry cooldown')
  report.stage = 'network-recovery'
  online = true
  await delay(31000, undefined, { signal })
  const after = await query()
  assert.deepEqual(after.map(info => [info.bundleName, info.label, info.versionName]), before.map(info => [info.bundleName, info.label, info.versionName]))
  assert.ok(after.every(info => typeof info.icon === 'string' && /^https:\/\//.test(info.icon)), 'real store metadata must return after cooldown')
  report.realStoreRecoveredWithoutRestart = true
  report.storeRequestCount = requests
  report.onlineFailureWarningCount = diagnostics.split('Online bundle info unavailable; using device metadata').length - 1
  assert.equal(report.onlineFailureWarningCount, 1)
  report.pageErrorCount = (await step(() => page.pageErrors())).length
  assert.equal(report.pageErrorCount, 0)
}
const result = await runLiveProbe({ verify })
report.passed = result.passed
report.cleanupPassed = result.cleanupPassed
if (!result.passed) {
  const error = result.errors[0]
  report.errorType = error.name
  report.failureCount = result.errors.length
  if (error.name === 'AssertionError') report.assertion = error.message.split('\n')[0]
  process.exitCode = 1
}
await mkdir(directory, { recursive: true })
await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report))
