const assert = require('node:assert/strict')
const { test } = require('node:test')
const { buildSync } = require('esbuild')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')

test('language survives immediate process exit and preserves other settings and defaults', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scrcpy-settings-'))
  try {
    const modulePath = path.join(root, 'store.cjs'), file = path.join(root, 'data/settings.json')
    buildSync({ entryPoints: ['src/main/lib/SettingsStore.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: modulePath })
    fs.mkdirSync(path.dirname(file))
    fs.writeFileSync(file, JSON.stringify({ language: 'en-US', hdcPath: '/fixture/hdc', betaUpdate: true }))
    const child = spawnSync(process.execPath, ['-e', `const Store=require(process.argv[1]).default;const store=new Store(process.argv[2],{language:'system',theme:'system'});store.set('language','zh-CN');process.exit(0)`, modulePath, file], { encoding: 'utf8' })
    assert.equal(child.status, 0, child.stderr)
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { language: 'zh-CN', hdcPath: '/fixture/hdc', betaUpdate: true, theme: 'system' })
    const Store = require(modulePath).default
    const reloaded = new Store(file, { language: 'system' })
    assert.equal(reloaded.get('language'), 'zh-CN')
    let changed
    reloaded.on('change', (key, value) => { changed = [key, value] })
    reloaded.set('language', 'en-US')
    assert.deepEqual(changed, ['language', 'en-US'])
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).language, 'en-US')
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['settings.json'])
    fs.writeFileSync(file, '{broken')
    assert.equal(new Store(file, { language: 'system' }).get('language'), 'system')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
