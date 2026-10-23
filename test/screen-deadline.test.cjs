const assert = require('node:assert/strict')
const { test } = require('node:test')
const { fixture, outcome, bounded, frame, READY, MEMORY, INFO, KERNEL, SCREEN } = require('./helpers/overview-fixture.cjs')

for (const [screen, expected] of [
  ['physical screen resolution: 1080x1920\n', '1080x1920'],
  ['RenderService\nphysical resolution=2560x1440\n', '2560x1440'],
  ['no screen metadata\n', ''],
]) {
  test(`screen finite transport preserves resolution format ${JSON.stringify(screen)}`, async (t) => {
    const f = await fixture(t, { envPort: '18710', expectedPort: 18710 }); f.state.screen = screen
    const result = await f.overview()
    assert.equal(result.physicalResolution, expected)
    assert.equal(result.memTotal, 8388608)
    assert.deepEqual(f.state.deadlines, [10000, 15000, 10000, 10000, 15000])
    assert.deepEqual(f.state.requests, [READY, 'shell param get', READY, INFO, READY, KERNEL, READY, MEMORY, READY, SCREEN])
    assert.equal(f.clients.filter((s) => s.kind === 'finite').length, 10)
    assert.ok(f.clients.filter((s) => s.kind === 'finite').every((s) => s.closed))
  })
}

for (const phase of ['connect', 'handshake', 'ready', 'send', 'read']) {
  test(`screen ${phase} deadline closes sockets, ignores late data and permits refresh`, { timeout: 4000 }, async (t) => {
    const f = await fixture(t); f.state.screenStall = phase
    const result = await bounded(outcome(f.overview()))
    assert.equal(result.error?.code, 'HDC_COMMAND_TIMEOUT')
    assert.equal(result.error.stage, phase)
    if (phase === 'send') assert.equal(f.state.heldWrites.length, 1, 'the screen write callback was held')
    assert.ok(f.clients.slice(8).length > 0, 'screen transport was reached')
    assert.ok(f.clients.slice(8).every((s) => s.closed), 'close before rejection')
    assert.equal(f.state.requests.filter((cmd) => cmd === SCREEN).length, phase === 'read' ? 1 : 0)
    const count = f.clients.length
    if (phase !== 'connect') f.peers.at(-1).end(frame('physical resolution=9999x9999'))
    for (const callback of f.state.heldWrites) callback(new Error('late write failure'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(f.clients.length, count, 'no automatic retry or fallback')
    f.state.screenStall = ''; f.state.screen = 'physical resolution=720x1280'
    assert.equal((await f.overview()).physicalResolution, '720x1280')
  })
}

for (const text of ['[Fail] screen denied', '[E000001] failed', 'error: failed']) {
  test(`screen command error rejects instead of empty resolution: ${text}`, async (t) => {
    const f = await fixture(t); f.state.screen = text
    const result = await outcome(f.overview())
    assert.match(result.error?.message ?? '', /screen command failed/)
    assert.equal(f.state.requests.filter((cmd) => cmd === SCREEN).length, 1)
    assert.ok(f.clients.slice(8).every((s) => s.closed))
    f.state.screen = 'physical resolution=720x1280'
    assert.equal((await f.overview()).physicalResolution, '720x1280')
  })
}

for (const mode of ['reset', 'truncated']) {
  test(`screen ${mode} rejects and the next overview recovers`, async (t) => {
    const f = await fixture(t); f.state.screenStall = mode
    const result = await outcome(f.overview())
    assert.equal(result.error?.code, mode === 'reset' ? 'ECONNRESET' : 'HDC_COMMAND_PROTOCOL')
    assert.equal(f.state.requests.filter((cmd) => cmd === SCREEN).length, 1)
    assert.ok(f.clients.slice(8).every((s) => s.closed))
    f.state.screenStall = ''
    assert.equal((await f.overview()).physicalResolution, '1080x1920')
  })
}

test('screen fifteen-second total deadline expires on the real clock', { timeout: 21000 }, async (t) => {
  const f = await fixture(t, { wallClock: true }); f.state.screenStall = 'read'
  const started = performance.now()
  const result = await bounded(outcome(f.overview()), 18000)
  const elapsed = performance.now() - started
  assert.equal(result.error?.code, 'HDC_COMMAND_TIMEOUT')
  assert.equal(result.error.stage, 'read')
  assert.ok(elapsed >= 14900 && elapsed < 18000, `elapsed ${elapsed}`)
  assert.ok(f.clients.slice(8).every((s) => s.closed))
})
