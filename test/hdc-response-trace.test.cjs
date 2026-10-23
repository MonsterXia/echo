const assert = require('node:assert/strict')
const { test } = require('node:test')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const path = require('node:path')

const moduleUrl = pathToFileURL(path.resolve(__dirname, '../script/lib/hdc-response-trace.mjs')).href
const loaded = import(moduleUrl)
const COMMAND = 'shell param get'
const MAX_FRAME_BYTES = 16 * 1024 * 1024
function header(size) {
  const value = Buffer.alloc(4)
  value.writeUInt32BE(size)
  return value
}
function frame(value) {
  const payload = Buffer.isBuffer(value) ? value : Buffer.from(value)
  return Buffer.concat([header(payload.length), payload])
}
function result(category = 'empty-output', bytes = 0, frames = 0, flags = {}) {
  return { response: { category, bytes, frames }, partialFrameAtClose: false,
    invalidFraming: false, parsingDisabled: false, ...flags }
}

test('complete frames count payload bytes only and leave input unchanged', async () => {
  const { createResponseTrace } = await loaded
  const trace = createResponseTrace(COMMAND)
  assert.deepEqual(trace.result(), result())
  trace.accept(Buffer.alloc(0))
  const input = frame('synthetic normal output')
  const original = Buffer.from(input)
  trace.accept(input)
  assert.deepEqual(trace.result(), result('output', input.length - 4, 1))
  assert.deepEqual(input, original)
  const snapshot = trace.result()
  snapshot.response.category = 'mutated'
  assert.equal(trace.result().response.category, 'output')
})

test('every header/payload split and bytewise TCP delivery produce the same summary', async () => {
  const { createResponseTrace } = await loaded
  const input = frame('合成秘密🔒 [E000004]')
  const original = Buffer.from(input)
  for (let split = 0; split <= input.length; split += 1) {
    const trace = createResponseTrace(COMMAND)
    trace.accept(input.subarray(0, split))
    trace.accept(Buffer.alloc(0))
    if (split > 0 && split < input.length) {
      assert.deepEqual(trace.result(), result('empty-output', 0, 0, { partialFrameAtClose: true }))
    }
    trace.accept(input.subarray(split))
    assert.deepEqual(trace.result(), result('target-not-ready', input.length - 4, 1))
  }
  const trace = createResponseTrace(COMMAND)
  for (const byte of input) trace.accept(Buffer.from([byte]))
  assert.deepEqual(trace.result(), result('target-not-ready', input.length - 4, 1))
  assert.deepEqual(input, original)
})

test('multiple frames, empty frames and markers crossing payload boundaries are recognized', async () => {
  const { createResponseTrace } = await loaded
  const trace = createResponseTrace(COMMAND)
  trace.accept(Buffer.concat([frame(''), frame('[E000'), frame(''), frame('004]'), frame('')]))
  assert.deepEqual(trace.result(), result('target-not-ready', 9, 5))
  const echo = createResponseTrace('shell echo ready\n')
  echo.accept(Buffer.concat([frame('[Fail] E0'), frame('00004')]))
  assert.deepEqual(echo.result(), result('target-not-ready', 14, 2))
})

test('partial EOF flags both truncated header and truncated payload without summarizing either', async () => {
  const { createResponseTrace } = await loaded
  const incomplete = [header(8).subarray(0, 1), header(8).subarray(0, 2),
    header(8).subarray(0, 3), header(8), Buffer.concat([header(8), Buffer.from('secret')])]
  for (const tail of incomplete) {
    const trace = createResponseTrace(COMMAND)
    trace.accept(Buffer.concat([frame('ok'), tail]))
    assert.deepEqual(trace.result(), result('output', 2, 1, { partialFrameAtClose: true }))
  }
})

test('exactly 16 MiB is accepted as one complete frame', async () => {
  const { createResponseTrace } = await loaded
  const trace = createResponseTrace(COMMAND)
  trace.accept(header(MAX_FRAME_BYTES))
  assert.equal(trace.result().partialFrameAtClose, true)
  const payload = Buffer.alloc(MAX_FRAME_BYTES, 120)
  payload.write('[E000004]', payload.length - 9)
  trace.accept(payload)
  assert.deepEqual(trace.result(), result('target-not-ready', MAX_FRAME_BYTES, 1))
})

test('oversized frames disable parsing without throwing or counting their content', async () => {
  const { createResponseTrace } = await loaded
  for (const size of [MAX_FRAME_BYTES + 1, 0xffffffff]) {
    const trace = createResponseTrace(COMMAND)
    trace.accept(frame('ok'))
    const input = Buffer.concat([header(size), Buffer.from('SYNTHETIC_SECRET'), frame('[E000004]')])
    const original = Buffer.from(input)
    assert.doesNotThrow(() => trace.accept(input))
    assert.deepEqual(trace.result(), result('output', 2, 1, { invalidFraming: true, parsingDisabled: true }))
    trace.accept(frame('[E000004]'))
    trace.disable()
    assert.deepEqual(trace.result(), result('output', 2, 1, { invalidFraming: true, parsingDisabled: true }))
    assert.deepEqual(input, original)
  }
})

test('disable discards pending data, preserves completed counts and never marks framing invalid', async () => {
  const { createResponseTrace } = await loaded
  for (const tail of [header(8).subarray(0, 2), Buffer.concat([header(8), Buffer.from('partial')])]) {
    const trace = createResponseTrace(COMMAND)
    trace.accept(Buffer.concat([frame('ok'), tail]))
    assert.equal(trace.result().partialFrameAtClose, true)
    trace.disable()
    trace.disable()
    trace.accept(Buffer.concat([header(0xffffffff), frame('[E000004]')]))
    assert.deepEqual(trace.result(), result('output', 2, 1, { parsingDisabled: true }))
  }
})

test('summary never exposes target, command or response text', async () => {
  const { createResponseTrace } = await loaded
  const secret = 'SYNTHETIC_PRIVATE_TARGET_秘密'
  const trace = createResponseTrace(COMMAND)
  trace.accept(frame(secret))
  trace.accept(Buffer.concat([header(1000), Buffer.from(secret)]))
  const json = JSON.stringify(trace.result())
  for (const text of [secret, 'SYNTHETIC', COMMAND, '秘密']) assert.equal(json.includes(text), false)
  assert.deepEqual(trace.result(), result('output', Buffer.byteLength(secret), 1, { partialFrameAtClose: true }))
})

function runCollectionProbe(retain = '') {
  const script = `
    import assert from 'node:assert/strict';
    import { createResponseTrace } from ${JSON.stringify(moduleUrl)};
    const retain = ${JSON.stringify(retain)};
    const retained = [];
    async function assertCollected(references, label) {
      // WeakRef.deref() keeps its target alive until this job ends. Advance the
      // event loop before each GC, and allow bounded retries for deferred work.
      for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise(setImmediate);
        global.gc();
        await new Promise(setImmediate);
        if (references.every(reference => reference.deref() === undefined)) return;
      }
      assert.fail(label + ' remained reachable after 20 GC turns');
    }
    const max = 16 * 1024 * 1024;
    const trace = createResponseTrace('shell param get');
    const header = Buffer.alloc(4);
    header.writeUInt32BE(max);
    const partialReferences = [];
    const allocate = Buffer.allocUnsafe;
    // Observe the actual parser allocation in this isolated child, then restore
    // the allocator. Track backing storage too, so a retained view also fails.
    Buffer.allocUnsafe = function(size) {
      const buffer = allocate(size);
      if (size === max) {
        partialReferences.push(new WeakRef(buffer), new WeakRef(buffer.buffer));
        if (retain === 'partial-buffer') retained.push(buffer);
        if (retain === 'partial-backing') retained.push(buffer.buffer);
      }
      return buffer;
    };
    try { trace.accept(header); } finally { Buffer.allocUnsafe = allocate; }
    assert.equal(partialReferences.length, 2, 'expected the real 16 MiB parser allocation');
    trace.accept(Buffer.from('partial'));
    trace.disable();
    await assertCollected(partialReferences, 'partial frame');
    assert.equal(trace.result().parsingDisabled, true);
    const oversized = createResponseTrace('shell param get');
    header.writeUInt32BE(max + 1);
    oversized.accept(header);
    for (let i = 0; i < 8; i++) {
      let chunk = Buffer.alloc(8 * 1024 * 1024, 120);
      const references = [new WeakRef(chunk), new WeakRef(chunk.buffer)];
      oversized.accept(chunk);
      if (retain === 'late-chunk') retained.push(chunk);
      chunk = null;
      await assertCollected(references, 'oversized input');
    }
    assert.deepEqual(oversized.result(), {
      response: { category: 'empty-output', bytes: 0, frames: 0 },
      partialFrameAtClose: false, invalidFraming: true, parsingDisabled: true,
    });
    assert.equal(retained.length, 0);
  `
  return spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 30000 })
}

test('disable releases the partial frame and oversized streams retain no later chunks', () => {
  const child = runCollectionProbe()
  assert.equal(child.status, 0, child.stderr || child.error?.message)
})

test('collection checks fail when a partial frame, backing storage or later chunk is retained', () => {
  for (const retained of ['partial-buffer', 'partial-backing', 'late-chunk']) {
    const child = runCollectionProbe(retained)
    assert.equal(child.status, 1, child.stderr || child.error?.message)
    const label = retained === 'late-chunk' ? 'oversized input' : 'partial frame'
    assert.ok(child.stderr.includes(`${label} remained reachable after 20 GC turns`), child.stderr)
  }
})
