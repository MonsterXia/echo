// Requires one already authorized device on the existing local HDC server.
// Never starts/kills HDC, changes device settings, or enumerates applications.
// node script/check-target-parameters-live.mjs <evidence-directory>
import assert from 'node:assert/strict'
import net from 'node:net'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { _electron as electron } from 'playwright-core'

const fault = 'parameters'
const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url))
assert.ok(process.argv[2], 'Pass an evidence directory')
const output = path.resolve(process.argv[2])
const temporaryRoot = await realpath(os.tmpdir())
const profile = await mkdtemp(path.join(temporaryRoot, 'scrcpy-m2-5-'))
const upstreamPort = Number(process.env.OHOS_HDC_SERVER_PORT || 8710)
assert.ok(Number.isInteger(upstreamPort) && upstreamPort > 0 && upstreamPort < 65536)
const report = { fault, platform: process.platform, arch: process.arch,
  sourceSha256: createHash('sha256').update(await readFile(path.join(root, 'src/main/lib/hdc.ts'))).digest('hex'),
  realDevice: null, syntheticFault: false, recovered: false, passed: false }
const sockets = new Set()
const violations = []
let inject = false
let application
let child
const commands = new Set(['alive', 'list targets', 'shell echo ready\n', 'shell param get'])
const counts = Object.fromEntries([...commands].map((command) => [command.trim(), 0]))
const server = net.createServer((downstream) => {
  const upstream = net.connect({ host: '127.0.0.1', port: upstreamPort })
  for (const socket of [downstream, upstream]) {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => { downstream.destroy(); upstream.destroy() })
  }
  downstream.on('close', () => upstream.destroy())
  upstream.pipe(downstream)
  let buffer = Buffer.alloc(0)
  let handshake = true
  let tracker = false
  downstream.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    while (buffer.length >= 4) {
      const length = buffer.readUInt32BE(0)
      if (length > 4096) {
        violations.push('oversized request')
        downstream.destroy(); upstream.destroy(); return
      }
      if (buffer.length < length + 4) return
      const frame = buffer.subarray(0, length + 4)
      const body = frame.subarray(4)
      buffer = buffer.subarray(length + 4)
      if (handshake) {
        handshake = false
        upstream.write(frame)
        continue
      }
      const command = body.toString()
      if (!commands.has(command)) {
        // Never log an unapproved request or its possible private arguments.
        violations.push('non-allowlisted command blocked')
        downstream.destroy(); upstream.destroy(); return
      }
      counts[command.trim()]++
      if (command === 'alive') tracker = true
      if (inject && !tracker && command === (fault === 'enumeration' ? 'list targets' : 'shell param get')) {
        report.syntheticFault = true
        upstream.unpipe(downstream)
        upstream.destroy()
        if (fault === 'parameters') {
          const text = Buffer.from('[Fail]Failed to communicate with daemon.\n')
          const size = Buffer.alloc(4)
          size.writeUInt32BE(text.length)
          downstream.end(Buffer.concat([size, text]))
        } else downstream.end()
        return
      }
      upstream.write(frame)
    }
  })
})
let deadline
try {
  await mkdir(path.join(profile, 'data'), { recursive: true })
  // An unused panel keeps all device-operation panels unmounted. The real
  // toolbar, store, preload, IPC handlers and HDC transport remain untouched.
  await writeFile(path.join(profile, 'data/main.json'), JSON.stringify({ panel: 'm2-5-validation' }))
  const forbiddenBin = path.join(profile, 'forbidden-hdc.exe')
  // Existing empty file prevents fallback to bundled HDC and cannot start a server.
  await writeFile(forbiddenBin, '')
  await writeFile(path.join(profile, 'data/settings.json'), JSON.stringify({
    hdcPath: forbiddenBin, killHdcWhenExit: false, theme: 'light',
  }))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  // Timeout tears down only this verification's proxy and Electron process.
  deadline = setTimeout(() => {
    for (const socket of sockets) socket.destroy()
    child?.kill()
  }, 60_000)
  application = await electron.launch({ executablePath: require('electron'),
    args: [path.join(root, 'dist'), `--user-data-dir=${profile}`],
    env: { ...process.env, OHOS_HDC_SERVER_PORT: String(server.address().port) },
    timeout: 30_000 })
  child = application.process()
  child.stdout?.resume()
  child.stderr?.resume()
  const page = await application.firstWindow({ timeout: 20_000 })
  page.setDefaultTimeout(15_000)
  const waitFor = async (predicate) => {
    const until = Date.now() + 15_000
    do {
      if (await page.evaluate(predicate)) return
      await delay(100)
    } while (Date.now() < until)
    throw new Error('Timed out waiting for verification state')
  }
  await waitFor(async () => {
    const items = await main.getMemStore('targets')
    return items?.length === 1 && (await main.getMainStore('target'))?.key === items[0].key &&
      document.querySelector('#app select')?.value === items[0].key
  })
  report.realDevice = await page.evaluate(async () => {
    const targets = await main.getTargets()
    const selected = await main.getMainStore('target')
    const item = targets[0]
    return { count: targets.length, transport: item.key.includes(':') ? 'network' : 'USB',
      softwareVersion: item.ohosVersion, apiVersion: item.sdkVersion,
      selectedMatches: selected?.key === item.key,
      optionMatches: document.querySelector('#app select')?.value === item.key }
  })
  assert.equal(report.realDevice.count, 1)
  assert.equal(report.realDevice.selectedMatches, true)
  assert.equal(report.realDevice.optionMatches, true)
  assert.ok(report.realDevice.softwareVersion)
  const refresh = page.locator('#app .icon-refresh')
  await refresh.click()
  await page.getByText('设备已刷新', { exact: true }).waitFor()
  inject = true
  await refresh.click()
  if (fault === 'enumeration') {
    await page.locator('.luna-notification').getByText('设备读取失败，请检查 HDC 连接后刷新', { exact: true }).waitFor()
    const failed = await page.evaluate(async () => ({
      count: (await main.getMemStore('targets')).length,
      selectedIsNull: (await main.getMainStore('target')) === null,
      label: document.querySelector('#app select option')?.textContent,
    }))
    assert.equal(failed.count, 0)
    assert.equal(failed.selectedIsNull, true)
    assert.match(failed.label, /设备读取失败/)
  } else {
    await waitFor(async () => (await main.getMemStore('targets'))?.length === 0 && (await main.getMainStore('target')) === null)
    assert.equal(await page.evaluate(async () => (await main.getMainStore('target')) === null), true)
  }
  inject = false
  await refresh.click()
  await waitFor(async () => {
    const items = await main.getMemStore('targets')
    return items?.length === 1 && (await main.getMainStore('target'))?.key === items[0].key &&
      document.querySelector('#app select')?.value === items[0].key
  })
  report.recovered = await page.evaluate(async () => {
    const items = await main.getTargets()
    return items.length === 1 && (await main.getMainStore('target'))?.key === items[0].key &&
      document.querySelector('#app select')?.value === items[0].key
  })
  assert.equal(report.recovered, true)
  assert.deepEqual(violations, [])
  report.pageErrorCount = (await page.pageErrors()).length
  assert.equal(report.pageErrorCount, 0)
  await application.close()
  assert.equal(child.exitCode, 0)
  report.passed = true
} catch (error) {
  report.errorClass = error.name
  report.failureLine = error.stack?.match(/check-target-[^:]+:(\d+):/)?.[1]
  // Deliberately omit raw errors/IPC values/console logs from the report.
  report.failure = 'Verification assertion or runtime operation failed'
  process.exitCode = 1
} finally {
  if (child?.exitCode === null) await application.close().catch(() => child.kill())
  clearTimeout(deadline)
  for (const socket of sockets) socket.destroy()
  if (server.listening) await new Promise((resolve) => server.close(resolve))
  assert.equal(path.dirname(profile), temporaryRoot)
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  report.commands = counts
  report.blockedCommandCount = violations.length
  await mkdir(output, { recursive: true })
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
}
