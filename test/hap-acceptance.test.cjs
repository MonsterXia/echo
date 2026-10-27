const assert = require('node:assert/strict')
const { test } = require('node:test')
const { finishInstallReport } = require('../script/lib/hap-report.cjs')

test('a disconnected final query preserves the original failure and still writes a report', async () => {
  const report = { passed: false, error: 'original failure' }
  let saved
  await assert.doesNotReject(finishInstallReport({ report,
    close: async () => {}, cleanup: async () => {},
    inspect: () => { throw Error('device disconnected') },
    write: async data => { saved = structuredClone(data) },
  }))
  assert.equal(saved.error, 'original failure')
  assert.equal(saved.finallyInstalled, null)
  assert.deepEqual(saved.finalizationErrors, [{ stage: 'inspect', message: 'device disconnected' }])
})

test('cleanup errors do not skip inspection or persistence, and a previously passing run fails', async () => {
  let saved
  await assert.rejects(finishInstallReport({ report: { passed: true },
    close: async () => { throw Error('window close failed') },
    cleanup: async () => { throw Error('profile cleanup failed') }, inspect: () => false,
    write: async data => { saved = structuredClone(data) },
  }), /finalization/i)
  assert.equal(saved.passed, false)
  assert.equal(saved.finallyInstalled, false)
  assert.equal(saved.finalizationErrors.length, 2)
})

test('successful finalization records the actual final state without introducing a failure', async () => {
  const report = { passed: true }
  let saved
  await finishInstallReport({ report, close: async () => {}, cleanup: async () => {},
    inspect: () => true, write: async data => { saved = structuredClone(data) } })
  assert.equal(saved.passed, true)
  assert.equal(saved.finallyInstalled, true)
})

const { JSDOM } = require('jsdom')
const acceptance = require('../script/lib/hap-acceptance.cjs')
function notice() {
  const dom = new JSDOM('<body><section><div>Failed to install application</div></section></body>')
  const el = dom.window.document.querySelector('div')
  el.getBoundingClientRect = () => ({ left: 10, right: 210, top: 10, bottom: 60, width: 200, height: 50 })
  return { dom, el }
}
for (const [name, apply] of [
  ['hidden error', el => { el.style.visibility = 'hidden' }],
  ['transparent error ancestor', el => { el.parentElement.style.opacity = '0' }],
  ['display-none error ancestor', el => { el.parentElement.style.display = 'none' }],
]) test(`notification evidence rejects ${name}, even with a stale nonzero rectangle`, () => {
  const { dom, el } = notice()
  apply(el)
  assert.equal(acceptance.measureNotice(el).visible, false)
  dom.window.close()
})
test('notification evidence distinguishes visible, clipped and outside-fullscreen items', () => {
  const { dom, el } = notice()
  assert.equal(acceptance.measureNotice(el).visible, true)
  assert.equal(acceptance.measureNotice(el).fits, true)
  el.getBoundingClientRect = () => ({ left: -10, right: 190, top: 10, bottom: 60, width: 200, height: 50 })
  assert.equal(acceptance.measureNotice(el).fits, false)
  Object.defineProperty(dom.window.document, 'fullscreenElement', { value: dom.window.document.createElement('aside') })
  assert.equal(acceptance.measureNotice(el).insideFullscreen, false)
  dom.window.close()
})
test('a list requested before installation cannot prove refresh even when it finishes afterward', () => {
  const stale = { startedSeq: 2, completedSeq: 9, completed: true, success: true }
  assert.equal(acceptance.freshListAfter([stale], 5), undefined)
  assert.equal(acceptance.freshListAfter([{ ...stale, startedSeq: 6, completed: false }], 5), undefined)
  assert.equal(acceptance.freshListAfter([{ ...stale, startedSeq: 6, success: false }], 5), undefined)
  const fresh = { startedSeq: 6, completedSeq: 8, completed: true, success: true }
  assert.equal(acceptance.freshListAfter([stale, fresh], 5), fresh)
})

test('transport errors are unknown state, not evidence that the test package was uninstalled', () => {
  const { parseTestBundleDump } = require('../script/lib/hap-report.cjs')
  assert.equal(parseTestBundleDump('error: failed to get information and the parameters may be wrong.', 'fixture.app'), null)
  assert.throws(() => parseTestBundleDump('[Fail]Device not found', 'fixture.app'), /Unexpected bundle dump/)
  assert.throws(() => parseTestBundleDump('bm: command not found', 'fixture.app'), /Unexpected bundle dump/)
})
test('bundle-state evidence must match the authorized sample', () => {
  const { parseTestBundleDump } = require('../script/lib/hap-report.cjs')
  const dump = JSON.stringify({ installTime: 10, updateTime: 20, applicationInfo: { bundleName: 'fixture.app', versionName: '1.0.1', versionCode: 1000001, debug: true } })
  assert.equal(parseTestBundleDump(dump, 'fixture.app').versionName, '1.0.1')
  assert.throws(() => parseTestBundleDump(dump, 'different.app'), /bundle name/)
})
