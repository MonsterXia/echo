const assert = require('node:assert/strict')
const { test } = require('node:test')

test('catalog validator rejects missing translations and mismatched interpolation', async () => {
  const { checkCatalogPair } = await import('../script/lib/i18n-check.mjs')
  assert.deepEqual(checkCatalogPair({ welcome: 'Hello {{name}}' }, { welcome: '你好 {{name}}' }, 'fixture'), [])
  assert.ok(checkCatalogPair({ welcome: 'Hello {{name}}' }, { welcome: '你好 {{user}}' }, 'fixture').some(x => x.includes('placeholder mismatch')))
  assert.ok(checkCatalogPair({ welcome: 'Hello' }, {}, 'fixture').some(x => x.includes('missing or empty')))
})

test('source validator catches visible hardcoding and unknown or unbounded dynamic keys', async () => {
  const { checkSource } = await import('../script/lib/i18n-check.mjs')
  const keys = new Set(['save', 'cancel'])
  assert.deepEqual(checkSource('fixture.tsx', `<button title={t('save')}>{t(ok ? 'save' : 'cancel')}</button>`, keys), [])
  for (const source of [`<button>Save</button>`, `<input placeholder="搜索"/>`, `const menu = { label: 'Exit' }`, `t('typo')`, `t(variable)`]) {
    assert.ok(checkSource('fixture.tsx', source, keys).length, source)
  }
})

test('project translation catalogs and source usage stay consistent', async () => {
  const { checkProject } = await import('../script/lib/i18n-check.mjs')
  assert.deepEqual(checkProject(), [])
})
