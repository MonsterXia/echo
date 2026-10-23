const assert = require('node:assert/strict')
const { test } = require('node:test')
const { once } = require('node:events')
const { fixture, outcome, bounded, frame, READY, PARAM, INFO, KERNEL, MEMORY, SCREEN } = require('./helpers/overview-fixture.cjs')

const commands = [PARAM, INFO, KERNEL]
const fields = ['params', 'info', 'kernel']

test('overview uses five finite reads, preserves fields and leaves key input on legacy transport', async (t) => {
  const f = await fixture(t, { envPort: '18710', expectedPort: 18710 })
  f.state.params += 'const.product.brand = Synthetic brand\nconst.product.model = Test model\n'
  const result = await f.overview()
  assert.equal(result.name, 'Synthetic')
  assert.equal(result.brand, 'Synthetic brand')
  assert.equal(result.model, 'Test model')
  assert.equal(result.abi, 'arm64')
  assert.equal(result.serialNum, 'SYNTHETIC')
  assert.equal(result.processor, 'TestCPU')
  assert.equal(result.kernelVersion, 'Linux synthetic ')
  assert.equal(result.memTotal, 8388608)
  assert.equal(result.physicalResolution, '1080x1920')
  assert.deepEqual(f.state.requests, [READY, PARAM, READY, INFO, READY, KERNEL, READY, MEMORY, READY, SCREEN])
  assert.deepEqual(f.state.deadlines, [10000, 15000, 10000, 10000, 15000])
  assert.equal(f.clients.length, 10)
  assert.ok(f.clients.every((s) => s.kind === 'finite' && s.closed))
  await f.input()
  assert.deepEqual(f.state.requests.slice(-2), [READY, 'shell uinput -K -d 3 -u 3'])
  assert.ok(f.clients.slice(10).every((s) => s.kind === 'legacy'))
})

for (const [index, command] of commands.entries()) {
  for (const phase of ['connect', 'handshake', 'ready', 'send', 'read']) {
    test(`${command} ${phase} deadline closes the channel, stops the overview and permits retry`, { timeout: 5000 }, async (t) => {
      const f = await fixture(t)
      f.state.earlyCommand = command; f.state.earlyStall = phase
      const result = await bounded(outcome(f.overview()))
      assert.equal(result.error?.code, 'HDC_COMMAND_TIMEOUT')
      assert.equal(result.error.stage, phase)
      assert.ok(f.clients.every((s) => s.kind === 'finite' && s.closed), 'no live or legacy overview sockets')
      assert.equal(f.state.requests.filter((cmd) => cmd === command).length, phase === 'read' ? 1 : 0)
      assert.ok(!f.state.requests.includes(commands[index + 1] || MEMORY), 'later reads must not start')
      if (phase === 'send') assert.equal(f.state.heldWrites.length, 1)
      const count = f.clients.length
      if (phase !== 'connect') f.peers.at(-1).end(frame('late response'))
      for (const callback of f.state.heldWrites) callback(new Error('late write failure'))
      await new Promise((resolve) => setTimeout(resolve, 20))
      assert.equal(f.clients.length, count, 'no automatic retry or fallback')
      f.state.earlyStall = ''
      assert.equal((await f.overview()).physicalResolution, '1080x1920')
    })
  }

  for (const errorText of ['[Fail] synthetic-denied', '[E000001] synthetic-denied', 'error: synthetic-denied']) {
    test(`${command} rejects explicit errors without exposing output and permits retry: ${errorText}`, async (t) => {
      const f = await fixture(t), field = fields[index], original = f.state[field]
      f.state[field] = errorText
      const result = await outcome(f.overview())
      assert.match(result.error?.message ?? '', /command failed/)
      assert.ok(!result.error.message.includes('synthetic-denied'))
      assert.ok(!f.state.requests.includes(commands[index + 1] || MEMORY))
      assert.ok(f.clients.every((s) => s.kind === 'finite' && s.closed))
      f.state[field] = original
      assert.equal((await f.overview()).name, 'Synthetic')
    })
  }

  for (const failure of ['reset', 'truncated']) {
    test(`${command} ${failure} rejects without partial overview and permits retry`, async (t) => {
      const f = await fixture(t)
      f.state.earlyCommand = command; f.state.earlyStall = failure
      const result = await outcome(f.overview())
      assert.equal(result.error?.code, failure === 'reset' ? 'ECONNRESET' : 'HDC_COMMAND_PROTOCOL')
      assert.ok(f.clients.every((s) => s.kind === 'finite' && s.closed))
      assert.ok(!f.state.requests.includes(commands[index + 1] || MEMORY))
      f.state.earlyStall = ''
      assert.equal((await f.overview()).name, 'Synthetic')
    })
  }
}

test('overview parameter values retain embedded error labels and missing optional fields', async (t) => {
  const f = await fixture(t)
  f.state.params = 'const.product.name = error: synthetic\r\nconst.product.model = [Fail] synthetic\r\n'
  const result = await f.overview()
  assert.equal(result.name, 'error: synthetic')
  assert.equal(result.model, '[Fail] synthetic')
  assert.equal(result.brand, undefined)
  assert.equal(result.abi, undefined)
})

test('device information no longer collides with the old shell batch separator', async (t) => {
  const f = await fixture(t)
  f.state.info = 'sn: synthetic echo_separator serial\ndeviceTypeName: TestCPU\n'
  assert.equal((await f.overview()).serialNum, 'synthetic echo_separator serial')
})

test('unavailable server rejects overview without service startup and a later request recovers', async (t) => {
  const f = await fixture(t), address = f.server.address()
  await new Promise((resolve) => f.server.close(resolve))
  const result = await outcome(f.overview())
  assert.equal(result.error?.code, 'ECONNREFUSED')
  assert.equal(f.clients.length, 1)
  assert.ok(f.clients.every((s) => s.kind === 'finite' && s.closed))
  assert.deepEqual(f.state.requests, [])
  f.server.listen(address.port, '127.0.0.1'); await once(f.server, 'listening')
  assert.equal((await f.overview()).name, 'Synthetic')
})
