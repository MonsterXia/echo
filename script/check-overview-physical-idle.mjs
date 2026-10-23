// Build first. Requires a human USB unplug/replug and one authorized device.
// node script/check-overview-physical-idle.mjs <evidence-directory> [idle-seconds]
// No synthetic transport faults, device writes, application queries or raw logs.
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
import { performance } from 'node:perf_hooks'
import { _electron as electron } from 'playwright-core'

assert.ok(process.argv[2], 'Pass an evidence directory')
const idleSeconds = Number(process.argv[3] || 600)
assert.ok(Number.isInteger(idleSeconds) && idleSeconds >= 60 && idleSeconds <= 3600)
const root = fileURLToPath(new URL('..', import.meta.url))
const output = path.resolve(process.argv[2])
const temporaryRoot = await realpath(os.tmpdir())
const profile = await mkdtemp(path.join(temporaryRoot, 'scrcpy-physical-idle-'))
const upstreamPort = parseInt(process.env.OHOS_HDC_SERVER_PORT || '8710', 10)
assert.ok(Number.isInteger(upstreamPort) && upstreamPort > 0 && upstreamPort < 65536)
const report = { startedAt: new Date().toISOString(), idleRequestedSeconds: idleSeconds,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
  scope: 'Human physical USB unplug/replug, real overview IPC/UI, measured idle interval; no synthetic faults or device writes',
  passed: false, reads: [], resources: [], observedErrorCategories: [] }
const commands = new Set(['alive', 'list targets', 'fport ls', 'shell echo ready\n',
  'shell param get', 'shell SP_daemon -deviceinfo', 'shell uname -a',
  'shell cat /proc/meminfo', 'shell hidumper -s RenderService -a screen'])
const counts = Object.fromEntries([...commands].map(command => [command.trim(), 0]))
const sockets = new Set()
let blocked = 0, application, child, deadline
const server = net.createServer(downstream => {
  const upstream = net.connect({ host: '127.0.0.1', port: upstreamPort })
  for (const socket of [downstream, upstream]) {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => { downstream.destroy(); upstream.destroy() })
  }
  downstream.on('close', () => upstream.destroy())
  upstream.pipe(downstream)
  let buffer = Buffer.alloc(0), handshake = true
  downstream.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk])
    while (buffer.length >= 4) {
      const length = buffer.readUInt32BE(0)
      if (length > 4096) { blocked++; downstream.destroy(); upstream.destroy(); return }
      if (buffer.length < length + 4) return
      const frame = buffer.subarray(0, length + 4)
      buffer = buffer.subarray(length + 4)
      if (handshake) { handshake = false; upstream.write(frame); continue }
      const command = frame.subarray(4).toString()
      if (!commands.has(command)) { blocked++; downstream.destroy(); upstream.destroy(); return }
      counts[command.trim()]++
      upstream.write(frame)
    }
  })
})
async function phase(name) {
  report.phase = name
  await writeFile(path.join(output, 'progress.json'), JSON.stringify({ phase: name, at: new Date().toISOString() }) + '\n')
  console.log(name)
}
async function waitFor(predicate, timeoutMs = 25_000) {
  const until = performance.now() + timeoutMs
  do {
    if (await predicate()) return
    await delay(250)
  } while (performance.now() < until)
  throw new Error('Verification state deadline exceeded')
}

try {
  await mkdir(output, { recursive: true })
  report.hashes = {}
  const files = ['src/main/lib/hdc.ts', 'src/main/lib/hdc/finiteShell.ts',
    'src/main/lib/hdc/parameters.ts', 'src/renderer/main/components/overview/Overview.tsx',
    'src/renderer/main/store/index.ts', 'src/preload/main.ts',
    'dist/main/index.js', 'dist/preload/index.js', 'script/check-overview-physical-idle.mjs']
  const rendererRoot = path.join(root, 'dist/renderer')
  for (const entry of await readdir(rendererRoot, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) files.push(path.relative(root, path.join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
  }
  for (const file of files) report.hashes[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex')
  await mkdir(path.join(profile, 'data'))
  await writeFile(path.join(profile, 'data/main.json'), JSON.stringify({ panel: 'physical-idle-validation' }))
  const forbiddenBin = path.join(profile, 'forbidden-hdc.exe')
  await writeFile(forbiddenBin, '')
  await writeFile(path.join(profile, 'data/settings.json'), JSON.stringify({
    hdcPath: forbiddenBin, killHdcWhenExit: false, theme: 'light', language: 'zh-CN',
  }))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  deadline = setTimeout(() => { for (const socket of sockets) socket.destroy(); child?.kill() }, (idleSeconds + 900) * 1000)
  application = await electron.launch({ executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'dist'), `--user-data-dir=${profile}`],
    env: { ...process.env, OHOS_HDC_SERVER_PORT: String(server.address().port) }, timeout: 30_000 })
  child = application.process()
  const classifyOutput = chunk => {
    // Classify in memory only; never retain a raw log line or IPC argument.
    const text = chunk.toString()
    for (const match of text.matchAll(/HDC (?:parameter|device information|memory|screen) command failed|HDC_COMMAND_(?:TIMEOUT|ABORTED|PROTOCOL) during (?:connect|handshake|ready|send|read)/g)) {
      report.observedErrorCategories.push({ phase: report.phase || 'startup', category: match[0] })
    }
  }
  child.stdout?.on('data', classifyOutput); child.stderr?.on('data', classifyOutput)
  const page = await application.firstWindow({ timeout: 20_000 })
  page.setDefaultTimeout(25_000)
  await page.waitForURL('**/renderer/index.html')
  assert.equal(await realpath(fileURLToPath(page.url())), await realpath(path.join(rendererRoot, 'index.html')))
  report.runtime = await application.evaluate(({ app }) => ({ packaged: app.isPackaged,
    electron: process.versions.electron, platform: process.platform, arch: process.arch }))
  await waitFor(() => page.evaluate(async () => {
    const targets = await main.getMemStore('targets')
    const target = await main.getMainStore('target')
    return targets?.length === 1 && !!target && target.key === targets[0].key
  }))
  await page.evaluate(async () => {
    globalThis.physicalOriginalKey = (await main.getMainStore('target')).key
    globalThis.physicalTargetEvents = 0
    main.on('changeTarget', () => globalThis.physicalTargetEvents++)
  })
  assert.equal(await page.evaluate(() => !globalThis.physicalOriginalKey.includes(':')), true)
  async function readOverview(phaseName) {
    const result = await page.evaluate(async () => {
      const start = performance.now()
      const target = await main.getMainStore('target')
      try {
      const value = await main.getOverview(target.key)
      const suffix = Math.floor(Math.log(value.memTotal) / Math.log(1024))
      const memory = +((value.memTotal / 1024 ** suffix).toFixed(2)) + ['', 'K', 'M', 'G', 'T'][suffix]
      globalThis.physicalExpectedUi = [value.name, value.brand, value.model, value.serialNum || '未知',
        `OpenHarmony ${target.ohosVersion} (API ${target.sdkVersion})`, value.kernelVersion,
        `${value.processor || '未知'} (${value.abi})`, value.physicalResolution, memory]
      return { ok: true, elapsedMs: Math.round(performance.now() - start), sameDevice: target.key === globalThis.physicalOriginalKey,
        descriptiveValid: ['name', 'brand', 'model', 'abi', 'kernelVersion'].every(k => typeof value[k] === 'string' && value[k].length > 0),
        resolutionValid: /^[1-9]\d*x[1-9]\d*$/.test(value.physicalResolution),
        memoryValid: value.memTotal > 0 && value.memUsed >= 0 && value.memUsed <= value.memTotal }
      } catch (error) {
        const text = String(error?.message || '')
        const category = text.match(/HDC (?:parameter|device information|memory|screen) command failed|HDC_COMMAND_(?:TIMEOUT|ABORTED|PROTOCOL) during (?:connect|handshake|ready|send|read)|ECONNRESET|ECONNREFUSED|EPIPE/)?.[0] || 'unknown-ipc-error'
        return { ok: false, elapsedMs: Math.round(performance.now() - start), category }
      }
    })
    report.reads.push({ phase: phaseName, ...result })
    assert.equal(result.ok, true)
    for (const key of ['sameDevice', 'descriptiveValid', 'resolutionValid', 'memoryValid']) assert.equal(result[key], true)
  }
  async function assertUi() {
    await waitFor(() => page.evaluate(() => {
      const text = [...document.querySelectorAll('.panel-with-toolbar [class*="_value_"]')].map(n => n.textContent)
      const expected = globalThis.physicalExpectedUi
      return text.length === 9 && expected?.length === 9 && text.every((value, i) => value === expected[i]) &&
        /^\d+(?:\.\d+)?[KMGT]?$/.test(text[8]) && parseFloat(text[8]) > 0
    }), 65_000)
  }
  await readOverview('before-unplug')
  await page.getByText('概览', { exact: true }).click()
  await assertUi()
  // Let startup's delayed changeTarget settle before observing physical removal.
  await delay(3000)
  const initialEvents = await page.evaluate(() => globalThis.physicalTargetEvents)
  await phase('READY_UNPLUG_USB')
  await waitFor(() => page.evaluate(async () => {
    const targets = await main.getMemStore('targets')
    return Array.isArray(targets) && targets.length === 0 && (await main.getMainStore('target')) === null &&
      document.querySelector('#app select')?.closest('.luna-toolbar-item').classList.contains('luna-toolbar-disabled')
  }), 300_000)
  const disconnectedEvents = await page.evaluate(() => globalThis.physicalTargetEvents)
  assert.ok(disconnectedEvents > initialEvents)
  assert.equal(await page.evaluate(() => document.querySelectorAll('.panel-with-toolbar [class*="_value_"]').length), 0)
  assert.equal(await page.evaluate(async () => (await main.getTargets()).length), 0)
  report.disconnected = { observedByTracker: true, selectionCleared: true, oldDetailsRemoved: true, ipcTargetsEmpty: true }
  const rejected = await page.evaluate(async () => {
    const start = performance.now()
    try { await main.getOverview(globalThis.physicalOriginalKey); return { rejected: false } }
    catch { return { rejected: true, elapsedMs: Math.round(performance.now() - start) } }
  })
  assert.equal(rejected.rejected, true)
  assert.ok(rejected.elapsedMs < 12_500)
  report.disconnectedOverview = rejected
  await phase('DISCONNECTED_VERIFIED_RECONNECT_USB')
  await waitFor(() => page.evaluate(async () => {
    const targets = await main.getMemStore('targets')
    const selected = await main.getMainStore('target')
    return targets?.length === 1 && selected?.key === globalThis.physicalOriginalKey &&
      targets[0].key === globalThis.physicalOriginalKey && document.querySelector('#app select')?.value === globalThis.physicalOriginalKey
  }), 300_000)
  assert.ok(await page.evaluate(() => globalThis.physicalTargetEvents) > disconnectedEvents)
  await phase('RECONNECTED_VERIFYING_AUTOMATIC_UI')
  // The target-key remount starts a real UI query. Let it complete before the
  // independent IPC probe, avoiding verifier-induced overlapping device reads.
  let automaticUiRecovered = true
  try { await assertUi() } catch {
    automaticUiRecovered = false
    report.automaticUiState = await page.evaluate(() => {
      const text = [...document.querySelectorAll('.panel-with-toolbar [class*="_value_"]')].map(n => n.textContent)
      return { loading: !!document.querySelector('.panel-with-toolbar .panel-loading'),
        fieldCount: text.length, matchesExpected: text.map((value, i) => value === globalThis.physicalExpectedUi?.[i]),
        unknownFields: text.map(value => value === '未知') }
    })
    await phase('RECONNECTED_MANUAL_REFRESH')
    await page.locator('.panel-with-toolbar .icon-refresh').click()
    await page.locator('.panel-with-toolbar .panel-loading').waitFor({ state: 'visible' })
    await page.locator('.panel-with-toolbar .panel-loading').waitFor({ state: 'hidden', timeout: 65_000 })
    await assertUi()
  }
  assert.equal(await page.locator('.panel-with-toolbar .panel-loading').count(), 0)
  await readOverview('after-reconnect')
  await assertUi()
  report.reconnected = { sameDevice: true, observedByTracker: true, automaticUiRecovered,
    manualRefreshUsed: !automaticUiRecovered }
  // Start only after reconnect's asynchronous refreshes have settled.
  await delay(5000)
  await assertUi()
  const idleCounts = { ...counts }
  const idleStart = performance.now()
  await phase('IDLE_STARTED')
  const sample = async () => {
    const metrics = await application.evaluate(({ app }) => app.getAppMetrics().map(({ type, cpu, memory }) => ({
      type, cpuPercent: cpu.percentCPUUsage, workingSetKiB: memory.workingSetSize,
      ...(typeof memory.privateBytes === 'number' ? { privateKiB: memory.privateBytes } : {}),
    })))
    report.resources.push({ elapsedMs: Math.round(performance.now() - idleStart),
      trackerPollCount: counts['list targets'] - idleCounts['list targets'],
      proxySocketCount: sockets.size, processes: metrics })
  }
  await sample()
  while (performance.now() - idleStart < idleSeconds * 1000) {
    await delay(Math.min(30_000, idleSeconds * 1000 - (performance.now() - idleStart)))
    await sample()
  }
  report.idleElapsedMs = Math.round(performance.now() - idleStart)
  assert.ok(report.idleElapsedMs >= idleSeconds * 1000)
  // hdckit's real tracker polls list targets once per second during UI idle.
  report.idleTrackerPolls = counts['list targets'] - idleCounts['list targets']
  report.idleOperationCountsUnchanged = Object.keys(counts).filter(key => key !== 'list targets')
    .every(key => counts[key] === idleCounts[key])
  assert.ok(report.idleTrackerPolls > 0)
  assert.equal(report.idleOperationCountsUnchanged, true)
  await phase('IDLE_FINISHED_VERIFYING')
  await readOverview('after-idle')
  await page.locator('.panel-with-toolbar .icon-refresh').click()
  await page.locator('.panel-with-toolbar .panel-loading').waitFor({ state: 'visible' })
  await page.locator('.panel-with-toolbar .panel-loading').waitFor({ state: 'hidden' })
  await assertUi()
  await readOverview('after-idle-refresh')
  report.afterIdleUiRecovered = true
  report.pageErrorCount = (await page.pageErrors()).length
  assert.equal(report.pageErrorCount, 0)
  assert.equal(blocked, 0)
  await application.close()
  assert.equal(child.exitCode, 0)
  report.passed = true
  await phase('PASSED')
} catch (error) {
  report.errorClass = error.name
  report.failureLine = error.stack?.match(/check-overview-physical-idle\.mjs:(\d+):/)?.[1]
  report.failure = 'Verification assertion/runtime failed; private values and raw errors omitted'
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
  console.log(JSON.stringify({ passed: report.passed, phase: report.phase, reads: report.reads,
    disconnected: report.disconnected, disconnectedOverview: report.disconnectedOverview,
    reconnected: report.reconnected, idleElapsedMs: report.idleElapsedMs,
    idleOperationCountsUnchanged: report.idleOperationCountsUnchanged,
    idleTrackerPolls: report.idleTrackerPolls, errorClass: report.errorClass,
    failureLine: report.failureLine, pageErrorCount: report.pageErrorCount, blockedCommandCount: blocked }))
}
