const assert = require('node:assert/strict')
const { test } = require('node:test')
const { buildSync, transformSync } = require('esbuild')
const vm = require('node:vm')
const fs = require('node:fs')

function load(entry) {
  const module = { exports: {} }
  const { text } = buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0]
  vm.runInNewContext(text, { module, exports: module.exports, require, console })
  return module.exports
}

test('application and shared strings use distinct complete English and Chinese translations', () => {
  const { i18n, t } = load('src/common/util.ts')
  i18n.locale('en-US')
  assert.equal(t('overview'), 'Overview')
  assert.equal(t('settings'), 'Settings')
  assert.equal(t('install'), 'Install')
  assert.equal(t('totalBundle', { total: 3 }), 'Applications: 3')
  i18n.locale('zh-CN')
  assert.equal(t('overview'), '概览')
  assert.equal(t('settings'), '设置')
  assert.equal(t('totalBundle', { total: 3 }), '共 3 个应用')
  assert.equal(t('install'), '安装')
})

test('locale resolution normalizes system variants and safely handles invalid stored values', () => {
  const { resolveLocale } = load('src/share/common/i18n.ts')
  for (const locale of ['zh', 'zh-CN', 'zh_Hans_CN', 'zh-SG', 'zh-TW']) assert.equal(resolveLocale(locale), 'zh-CN')
  for (const locale of ['en', 'en-US', 'en-GB', 'EN_au']) assert.equal(resolveLocale(locale), 'en-US')
  for (const locale of [undefined, null, 42, {}, '', 'system', 'fr-FR']) assert.equal(resolveLocale(locale), undefined)
})

test('missing locale entries fall back to English, and unknown keys remain diagnosable', () => {
  const { init, i18n, t } = load('src/share/common/i18n.ts')
  init({ 'en-US': { fallbackExample: 'Hello {{name}}' }, 'zh-CN': {} })
  i18n.locale('zh-CN')
  assert.equal(t('fallbackExample', { name: 'Sam' }), 'Hello Sam')
  assert.equal(t('missingTranslation'), 'missingTranslation')
})

test('main-process language selection respects persisted choices and resolves system fallback', () => {
  for (const [saved, system, expected] of [
    ['system', 'zh-Hans-CN', 'zh-CN'], ['en-US', 'zh-CN', 'en-US'],
    ['zh-CN', 'en-GB', 'zh-CN'], ['system', 'fr-FR', 'en-US'],
    [null, 'zh-CN', 'zh-CN'], [42, 'en-GB', 'en-US'],
  ]) {
    const common = load('src/share/common/i18n.ts')
    const module = { exports: {} }, handlers = {}
    vm.runInNewContext(transformSync(fs.readFileSync('src/share/main/lib/language.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
      module, exports: module.exports,
      require(id) {
        if (id.endsWith('/store')) return { getSettingsStore: () => ({ get: () => saved }) }
        if (id.endsWith('/i18n')) return common
        if (id === 'electron') return { app: { getLocale: () => system } }
        if (id === './util') return { handleEvent: (key, fn) => { handlers[key] = fn } }
        if (id.endsWith('/log')) return () => ({ info() {} })
        throw new Error(id)
      },
    })
    module.exports.init()
    assert.equal(handlers.getLanguage(), expected)
    assert.equal(common.t('settings'), expected === 'en-US' ? 'Settings' : '设置')
  }
})

test('renderer language setup keeps document and Luna dialogs in sync with application translations', () => {
  const common = load('src/common/util.ts'), module = { exports: {} }
  const document = { documentElement: {} }, locales = []
  vm.runInNewContext(transformSync(fs.readFileSync('src/renderer/lib/language.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, document,
    require(id) {
      if (id === 'common/util') return common
      if (id === 'luna-modal') return { i18n: { locale: value => locales.push(value) } }
      throw new Error(id)
    },
  })
  for (const locale of ['zh-CN', 'en-US']) {
    module.exports.applyLanguage(locale)
    assert.equal(document.documentElement.lang, locale)
    assert.equal(locales.at(-1), locale)
    assert.equal(common.t('overview'), locale === 'en-US' ? 'Overview' : '概览')
  }
})

test('settings load and save the language preference through the existing persistence bridge', async () => {
  const saved = { language: 'en-US' }, module = { exports: {} }
  const main = { getSettingsStore: async key => saved[key], setSettingsStore: async (key, value) => { saved[key] = value } }
  vm.runInNewContext(transformSync(fs.readFileSync('src/renderer/main/store/settings.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code, { module, exports: module.exports, require: id => id === 'share/common/i18n' ? load('src/share/common/i18n.ts') : require(id), main })
  const settings = new module.exports.Settings()
  await settings.init()
  assert.equal(settings.language, 'en-US')
  await settings.set('language', 'zh-CN')
  assert.equal(saved.language, 'zh-CN')
  const reloaded = new module.exports.Settings()
  await reloaded.init()
  assert.equal(reloaded.language, 'zh-CN')
  saved.language = 'en_GB'
  await reloaded.init()
  assert.equal(reloaded.language, 'en-US')
  saved.language = 42
  await reloaded.init()
  assert.equal(reloaded.language, 'system')
})
