// Build first. One authorized phone on the existing HDC server is required.
// node script/check-overview-live.mjs <evidence-directory> [--all-stages]
// Real preload/IPC/handler/renderer; only an allowlisted transport proxy injects faults.
import assert from 'node:assert/strict'
import net from 'node:net'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { _electron as electron } from 'playwright-core'

const root = fileURLToPath(new URL('..', import.meta.url))
assert.ok(process.argv[2], 'Pass an evidence directory')
assert.ok(!process.argv[3] || process.argv[3] === '--all-stages')
const output = path.resolve(process.argv[2])
const temporaryRoot = await realpath(os.tmpdir())
const profile = await mkdtemp(path.join(temporaryRoot, 'scrcpy-overview-'))
const upstreamPort = parseInt(process.env.OHOS_HDC_SERVER_PORT || '8710', 10)
assert.ok(Number.isInteger(upstreamPort) && upstreamPort > 0 && upstreamPort < 65536)
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const report = {
  startedAt: new Date().toISOString(),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
  scope: 'Real phone, full overview preload/IPC and UI; synthetic transport errors/stalls; no physical disconnection or device writes',
  passed: false, successes: [], failures: [],
}
const commands = new Set(['alive', 'list targets', 'fport ls', 'shell echo ready\n', 'shell param get',
  'shell SP_daemon -deviceinfo', 'shell uname -a',
  'shell SP_daemon -deviceinfo\necho "echo_separator"\nuname -a',
  'shell cat /proc/meminfo', 'shell hidumper -s RenderService -a screen'])
const counts = Object.fromEntries([...commands].map(command => [command.trim(), 0]))
const sockets = new Set()
let blocked = 0, inject = null, application, child, deadline
const server = net.createServer((downstream) => {
  const upstream = net.connect({ host: '127.0.0.1', port: upstreamPort })
  for (const socket of [downstream, upstream]) {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => { downstream.destroy(); upstream.destroy() })
  }
  downstream.on('close', () => upstream.destroy())
  upstream.pipe(downstream)
  let buffer = Buffer.alloc(0), handshake = true
  downstream.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    while (buffer.length >= 4) {
      const length = buffer.readUInt32BE(0)
      if (length > 4096) { blocked++; downstream.destroy(); upstream.destroy(); return }
      if (buffer.length < length + 4) return
      const frame = buffer.subarray(0, length + 4)
      buffer = buffer.subarray(length + 4)
      if (handshake) { handshake = false; upstream.write(frame); continue }
      const command = frame.subarray(4).toString()
      if (!commands.has(command)) {
        // Never persist unapproved commands or their potentially private arguments.
        blocked++; downstream.destroy(); upstream.destroy(); return
      }
      counts[command.trim()]++
      if (inject?.command === command) {
        const fault = inject
        fault.hits++
        upstream.unpipe(downstream)
        upstream.destroy()
        downstream.once('close', () => { fault.closed++ })
        if (fault.mode === 'error') {
          const body = Buffer.from('[Fail]Synthetic overview verification failure\n')
          const size = Buffer.alloc(4); size.writeUInt32BE(body.length)
          downstream.end(Buffer.concat([size, body]))
        }
        // Stall leaves only this verifier's downstream open until production timeout.
        return
      }
      upstream.write(frame)
    }
  })
})

try {
  report.hashes = {}
  for (const file of ['src/main/lib/hdc.ts', 'src/main/lib/hdc/finiteShell.ts',
    'src/main/lib/hdc/parameters.ts', 'src/renderer/main/components/overview/Overview.tsx',
    'src/preload/main.ts', 'dist/main/index.js', 'dist/preload/index.js', 'script/check-overview-live.mjs']) {
    report.hashes[file] = hash(await readFile(path.join(root, file)))
  }
  const rendererRoot = path.join(root, 'dist/renderer')
  for (const entry of await readdir(rendererRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const file = path.join(entry.parentPath, entry.name)
    report.hashes[path.relative(root, file).replaceAll('\\', '/')] = hash(await readFile(file))
  }
  await mkdir(path.join(profile, 'data'))
  await writeFile(path.join(profile, 'data/main.json'), JSON.stringify({ panel: 'overview-validation' }))
  const forbiddenBin = path.join(profile, 'forbidden-hdc.exe')
  await writeFile(forbiddenBin, '')
  await writeFile(path.join(profile, 'data/settings.json'), JSON.stringify({
    hdcPath: forbiddenBin, killHdcWhenExit: false, theme: 'light', language: 'zh-CN',
  }))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  deadline = setTimeout(() => { for (const socket of sockets) socket.destroy(); child?.kill() }, 180_000)
  application = await electron.launch({ executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'dist'), `--user-data-dir=${profile}`],
    env: { ...process.env, OHOS_HDC_SERVER_PORT: String(server.address().port) }, timeout: 30_000 })
  child = application.process()
  child.stdout?.resume(); child.stderr?.resume()
  const page = await application.firstWindow({ timeout: 20_000 })
  page.setDefaultTimeout(25_000)
  await page.waitForURL('**/renderer/index.html')
  assert.equal(await realpath(fileURLToPath(page.url())), await realpath(path.join(rendererRoot, 'index.html')))
  const targetDeadline = Date.now() + 20_000
  let targetReady = false
  do {
    targetReady = await page.evaluate(async () => {
      const targets = await main.getMemStore('targets')
      const target = await main.getMainStore('target')
      return targets?.length === 1 && !!target && target.key === targets[0].key
    })
    if (!targetReady) await delay(100)
  } while (!targetReady && Date.now() < targetDeadline)
  assert.equal(targetReady, true)
  report.runtime = await application.evaluate(({ app }) => ({ packaged: app.isPackaged,
    electron: process.versions.electron, platform: process.platform, arch: process.arch }))
  const validateIpc = async () => {
    const result = await page.evaluate(async () => {
      const start = performance.now()
      const target = await main.getMainStore('target')
      const overview = await main.getOverview(target.key)
      // Keep private expected values inside the renderer; return booleans only.
      const suffix = Math.floor(Math.log(overview.memTotal) / Math.log(1024))
      const memory = +((overview.memTotal / 1024 ** suffix).toFixed(2)) + ['', 'K', 'M', 'G', 'T'][suffix]
      globalThis.overviewVerificationExpected = [overview.name, overview.brand, overview.model,
        overview.serialNum || '未知', `OpenHarmony ${target.ohosVersion} (API ${target.sdkVersion})`,
        overview.kernelVersion, `${overview.processor || '未知'} (${overview.abi})`, overview.physicalResolution, memory]
      return { elapsedMs: Math.round(performance.now() - start),
        descriptiveFields: ['name', 'brand', 'model', 'abi', 'kernelVersion'].every(k => typeof overview[k] === 'string' && overview[k].length > 0),
        resolutionValid: /^[1-9]\d*x[1-9]\d*$/.test(overview.physicalResolution),
        memoryValid: overview.memTotal > 0 && overview.memUsed >= 0 && overview.memUsed <= overview.memTotal,
        expectedKeys: ['name', 'brand', 'model', 'abi', 'serialNum', 'kernelVersion', 'processor', 'memTotal', 'memUsed', 'physicalResolution'].every(k => k in overview) }
    })
    for (const field of ['descriptiveFields', 'resolutionValid', 'memoryValid', 'expectedKeys']) assert.equal(result[field], true)
    report.successes.push(result)
  }
  for (let i = 0; i < 3; i++) await validateIpc()
  await page.getByText('概览', { exact: true }).click()
  const panel = page.locator('.panel-with-toolbar')
  const refresh = panel.locator('.icon-refresh')
  const values = panel.locator('[class*="_value_"]')
  const uiValid = async () => {
    await values.nth(8).waitFor()
    await page.waitForFunction(() => {
      const values = [...document.querySelectorAll('.panel-with-toolbar [class*="_value_"]')].map(n => n.textContent)
      const expected = globalThis.overviewVerificationExpected
      return values.length === 9 && expected?.length === 9 && values.every((value, i) => value === expected[i]) &&
        /^[1-9]\d*x[1-9]\d*$/.test(values[7]) && /^\d+(?:\.\d+)?[KMGT]?$/.test(values[8]) && parseFloat(values[8]) > 0
    })
  }
  await uiValid()
  report.initialUiValid = true
  const stages = process.argv[3] ? ['shell param get', 'shell SP_daemon -deviceinfo', 'shell uname -a',
    'shell cat /proc/meminfo', 'shell hidumper -s RenderService -a screen'] :
    ['shell cat /proc/meminfo', 'shell hidumper -s RenderService -a screen']
  for (const command of stages) {
    for (const mode of ['error', 'stall']) {
      const fault = { command, mode, hits: 0, closed: 0 }
      inject = fault
      const before = { ...counts }
      const start = Date.now()
      await refresh.click()
      await page.getByText('出错了', { exact: true }).waitFor()
      await values.nth(8).waitFor()
      const clearedFields = await values.evaluateAll(nodes => {
        const text = nodes.map(n => n.textContent)
        return { descriptive: [0, 1, 2, 3, 5, 7].every(i => text[i] === '未知'),
          processor: text[6] === '未知 (undefined)', memory: text[8] === '未知' }
      })
      report.lastClearedFields = clearedFields
      const cleared = clearedFields.descriptive && clearedFields.processor && clearedFields.memory
      assert.equal(cleared, true)
      assert.equal(await panel.locator('.panel-loading').count(), 0)
      const until = Date.now() + 2000
      while (!fault.closed && Date.now() < until) await delay(20)
      assert.equal(fault.hits, 1)
      assert.equal(fault.closed, 1)
      const elapsedMs = Date.now() - start
      if (mode === 'stall') assert.ok(elapsedMs >= (command.includes('hidumper') || command.includes('SP_daemon') ? 14_500 : 9_500))
      // Once this stage fails, later overview stages must not be sent.
      for (const later of stages.slice(stages.indexOf(command) + 1)) assert.equal(counts[later], before[later])
      inject = null
      await refresh.click()
      await uiValid()
      await validateIpc()
      report.failures.push({ stage: command.slice(6), mode, elapsedMs, cleared, closed: true, recovered: true, requestCount: fault.hits })
      // Let the previous toast disappear before requiring a new failure notification.
      await page.getByText('出错了', { exact: true }).waitFor({ state: 'hidden' })
    }
  }
  assert.equal(blocked, 0)
  report.pageErrorCount = (await page.pageErrors()).length
  assert.equal(report.pageErrorCount, 0)
  await application.close()
  assert.equal(child.exitCode, 0)
  report.passed = true
} catch (error) {
  report.errorClass = error.name
  report.failureLine = error.stack?.match(/check-overview-live\.mjs:(\d+):/)?.[1]
  report.failure = 'Verification assertion or runtime operation failed; raw IPC and logs intentionally omitted'
  process.exitCode = 1
} finally {
  if (child?.exitCode === null) await application.close().catch(() => child.kill())
  clearTimeout(deadline)
  for (const socket of sockets) socket.destroy()
  if (server.listening) await new Promise(resolve => server.close(resolve))
  assert.equal(path.dirname(profile), temporaryRoot)
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  report.commands = counts
  report.blockedCommandCount = blocked
  await mkdir(output, { recursive: true })
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
}
