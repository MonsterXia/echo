const { test } = require('node:test')
const assert = require('node:assert/strict')
const { releaseProbeForward } = require('../script/lib/probe-forward.cjs')

test('probe cleanup preserves a reused mapping and releases only a newly created one', async () => {
  const calls = []
  const target = { removeForward: async (...args) => calls.push(args) }
  await releaseProbeForward(target, 43210, [{ local: 'tcp:43210', remote: 'tcp:8012' }])
  assert.equal(calls.length, 0)
  await releaseProbeForward(target, 43211, [{ local: 'tcp:43210', remote: 'tcp:8012' }])
  assert.deepEqual(calls, [['tcp:43211', 'tcp:8012']])
})
