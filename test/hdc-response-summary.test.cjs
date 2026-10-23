const assert = require('node:assert/strict')
const { test } = require('node:test')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const path = require('node:path')

const moduleUrl = pathToFileURL(path.resolve(__dirname, '../script/lib/hdc-response-summary.mjs')).href
const loaded = import(moduleUrl)
const COMMAND = 'shell param get'

test('counts complete payloads and returns only fixed categories and numeric counts', async () => {
  const { createResponseSummary } = await loaded
  const summary = createResponseSummary(COMMAND)
  assert.deepEqual(summary.result(), { category: 'empty-output', bytes: 0, frames: 0 })
  summary.accept(Buffer.alloc(0))
  assert.deepEqual(summary.result(), { category: 'empty-output', bytes: 0, frames: 1 })
  const secret = 'SYNTHETIC_PRIVATE_TARGET_秘密_\u{1f512}'
  const payload = Buffer.from(secret)
  for (const byte of payload) summary.accept(Buffer.from([byte]))
  const result = summary.result()
  assert.deepEqual(result, { category: 'output', bytes: payload.length, frames: payload.length + 1 })
  assert.equal(JSON.stringify(result).includes(secret), false)
  result.category = 'modified'
  assert.equal(summary.result().category, 'output')
})

test('recognizes every split of fixed error markers without revealing response data', async () => {
  const { createResponseSummary } = await loaded
  for (const [marker, category] of [
    ['[Fail]', 'command-error'], ['[E123456]', 'command-error'],
    ['error:', 'command-error'], ['ERROR:', 'command-error'],
    ['[E000004]', 'target-not-ready'],
  ]) {
    for (let split = 0; split <= marker.length; split += 1) {
      const summary = createResponseSummary(COMMAND)
      summary.accept(Buffer.from(`SYNTHETIC_SECRET:${marker.slice(0, split)}`))
      summary.accept(Buffer.alloc(0))
      summary.accept(Buffer.from(`${marker.slice(split)}:SYNTHETIC_TARGET`))
      assert.equal(summary.result().category, category, `${marker} split ${split}`)
      assert.equal(JSON.stringify(summary.result()).includes('SYNTHETIC'), false)
    }
    const summary = createResponseSummary(COMMAND)
    for (const byte of Buffer.from(marker)) summary.accept(Buffer.from([byte]))
    assert.equal(summary.result().category, category)
  }
})

test('requires bracketed six-digit codes and preserves target error priority', async () => {
  const { createResponseSummary } = await loaded
  for (const ordinary of ['E000004', '[E000004', '[E0000044]', '[E00004]', '[E00x004]', '[Failure]']) {
    const summary = createResponseSummary(COMMAND)
    summary.accept(Buffer.from(ordinary))
    assert.equal(summary.result().category, 'output', ordinary)
  }
  for (const response of ['[Fail][E000004]error:', '[E000004][Fail]', '[[E000004]', 'eerror:[E000004]']) {
    const summary = createResponseSummary(COMMAND)
    for (const byte of Buffer.from(response)) summary.accept(Buffer.from([byte]))
    assert.equal(summary.result().category, 'target-not-ready')
    summary.accept(Buffer.from('normal text'))
    assert.equal(summary.result().category, 'target-not-ready')
  }
})

test('echo readiness requires exactly ready with optional surrounding whitespace', async () => {
  const { createResponseSummary } = await loaded
  for (const value of ['ready', '\r\n ready\n', '\tready\r\n']) {
    const summary = createResponseSummary('shell echo ready\n')
    for (const byte of Buffer.from(value)) summary.accept(Buffer.from([byte]))
    assert.equal(summary.result().category, 'echo-ready')
  }
  for (const value of ['already', 'not ready', 'ready ready', 'READY', 'rea', 're ady', ' \n']) {
    const summary = createResponseSummary('shell echo ready\n')
    summary.accept(Buffer.from(value))
    assert.equal(summary.result().category, 'echo-unexpected-output')
  }
  const summary = createResponseSummary('shell echo ready\n')
  assert.equal(summary.result().category, 'empty-output')
  summary.accept(Buffer.from('ready'))
  assert.equal(summary.result().category, 'echo-ready')
  summary.accept(Buffer.from('[E000004]'))
  assert.equal(summary.result().category, 'target-not-ready')
})

test('only whitelisted shell commands classify errors', async () => {
  const { createResponseSummary } = await loaded
  for (const command of ['alive', 'list targets', 'fport ls']) {
    const summary = createResponseSummary(command)
    summary.accept(Buffer.from('[E000004] SYNTHETIC_SECRET'))
    assert.deepEqual(summary.result(), { category: 'unclassified', bytes: 26, frames: 1 })
  }
  for (const command of [COMMAND, 'shell SP_daemon -deviceinfo', 'shell uname -a', 'shell cat /proc/meminfo', 'shell hidumper -s RenderService -a screen']) {
    const summary = createResponseSummary(command)
    summary.accept(Buffer.from('[Fail] SYNTHETIC_SECRET'))
    assert.equal(summary.result().category, 'command-error')
  }
  assert.throws(() => createResponseSummary('SYNTHETIC_SECRET_COMMAND'), { message: 'Unsupported diagnostic command' })
  const summary = createResponseSummary(COMMAND)
  assert.throws(() => summary.accept('SYNTHETIC_SECRET_PAYLOAD'), { message: 'Expected a payload Buffer' })
  assert.deepEqual(summary.result(), { category: 'empty-output', bytes: 0, frames: 0 })
})

test('large payload streams retain no buffers and bounded heap state', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { createResponseSummary } from ${JSON.stringify(moduleUrl)};
    const summary = createResponseSummary('shell param get');
    global.gc();
    const baseline = process.memoryUsage().heapUsed;
    let weak;
    for (let index = 0; index < 48; index++) {
      let payload = Buffer.alloc(1024 * 1024, 120);
      payload.write(String(index));
      weak = new WeakRef(payload);
      summary.accept(payload);
      payload = null;
      await new Promise(setImmediate);
      global.gc();
      assert.equal(weak.deref(), undefined, 'summary retained incoming payload');
    }
    global.gc();
    assert.ok(process.memoryUsage().heapUsed - baseline < 4 * 1024 * 1024);
    summary.accept(Buffer.from('[E000'));
    summary.accept(Buffer.alloc(0));
    summary.accept(Buffer.from('004]'));
    assert.deepEqual(summary.result(), { category: 'target-not-ready', bytes: 48 * 1024 * 1024 + 9, frames: 51 });
  `
  const child = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 30000 })
  assert.equal(child.status, 0, child.stderr || child.error?.message)
})
