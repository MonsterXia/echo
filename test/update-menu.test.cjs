const assert = require('node:assert/strict')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const fs = require('node:fs')
const vm = require('node:vm')

function fixture(saved = {}, translations) {
  const snapshots = []
  let menu, finish, fail
  const pending = new Promise((resolve, reject) => { finish = resolve; fail = reject })
  const module = { exports: {} }
  vm.runInNewContext(transformSync(fs.readFileSync('src/main/lib/menu.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports,
    require(id) {
      if (id === 'electron') return {
        Menu: { buildFromTemplate: template => template, setApplicationMenu: value => { menu = value } },
        app: { name: 'Scrcpy Harmony' }, shell: {},
      }
      if (id === 'share/main/lib/window') return {
        sendTo: (name, channel) => {
          assert.equal(name, 'main'); assert.equal(channel, 'refreshMenu')
          const item = menu[0].submenu[1]
          snapshots.push({ label: item.label, enabled: item.enabled !== false })
        },
      }
      if (id === './store') return { getSettingsStore: () => ({ get: key => saved[key], set: (key, value) => { saved[key] = value } }) }
      if (id === 'share/main/lib/updater') return { checkUpdate: () => pending }
      if (id === 'licia/isMac') return false
      if (id === 'licia/isWindows') return true
      if (id === 'common/util') return { t: key => translations?.[key] || key }
      if (id === 'share/common/util') return { isDev: () => false }
      if (id === 'share/main/lib/util') return { handleEvent() {} }
      if (id === './screencastEdit' || id.startsWith('share/main/window/')) return {}
      throw new Error(`Unexpected import ${id}`)
    },
  })
  module.exports.init()
  snapshots.length = 0
  return { snapshots, saved, rebuild: () => module.exports.init(), beta: () => menu[0].submenu.find(item => item.id === 'beta-update'), click: () => menu[0].submenu[1].click(menu[0].submenu[1]), finish, fail }
}

for (const rejected of [false, true]) {
  test(`Windows titlebar menu refreshes while checking and after ${rejected ? 'failure' : 'completion'}`, async () => {
    const f = fixture()
    const task = f.click()
    // custom-electron-titlebar copies MenuItem state only when refreshMenu is sent.
    assert.deepEqual(f.snapshots, [{ label: 'checkingForUpdates', enabled: false }])
    if (rejected) {
      f.fail(new Error('checker failed'))
      await assert.rejects(task, /checker failed/)
    } else {
      f.finish()
      await task
    }
    assert.deepEqual(f.snapshots, [
      { label: 'checkingForUpdates', enabled: false },
      { label: 'checkUpdate...', enabled: true },
    ])
  })
}


test('Beta Update defaults off and persists its checkbox choice across menu rebuilds', () => {
  const f = fixture()
  assert.equal(f.beta()?.type, 'checkbox')
  assert.equal(f.beta().checked, false)
  f.beta().click({ checked: true })
  assert.equal(f.saved.betaUpdate, true)
  f.rebuild()
  assert.equal(f.beta().checked, true)
  f.beta().click({ checked: false })
  f.rebuild()
  assert.equal(f.beta().checked, false)
})

for (const [locale, off, on] of [
  ['en-US', 'Beta Update: Off', 'Beta Update: On'],
  ['zh-CN', '接收预发布更新：已关闭', '接收预发布更新：已开启'],
]) {
  test(`Beta Update visibly follows the saved checkbox state after clicks and rebuilds (${locale})`, () => {
    const translations = JSON.parse(fs.readFileSync(`src/common/langs/${locale}.json`, 'utf8'))
    const f = fixture({}, translations)
    assert.equal(f.beta().label, off)
    for (const [checked, label] of [[true, on], [false, off]]) {
      // Electron toggles the MenuItem before invoking our callback.
      const item = f.beta()
      item.checked = checked
      item.click(item)
      assert.equal(f.saved.betaUpdate, checked)
      assert.equal(f.beta().label, label, 'the next menu snapshot must show the new state')
      f.rebuild()
      assert.equal(f.beta().checked, checked)
      assert.equal(f.beta().label, label)
    }
  })
}
