const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const root = path.resolve(__dirname, '..')
const selected = name => /^(hdckit|licia|luna-.+)$/.test(name)

test('selected direct and transitive packages resolve to maintained local source', () => {
  const pkg = require('../package.json')
  const lock = require('../package-lock.json')
  const names = Object.keys(pkg.devDependencies).filter(selected)
  assert.equal(names.length, 18, 'include the transitive drag selector')
  for (const name of names) {
    assert.equal(pkg.devDependencies[name], `file:vendor/packages/${name}`)
    assert.equal(fs.realpathSync(path.join(root, 'node_modules', name)),
      fs.realpathSync(path.join(root, 'vendor/packages', name)))
    assert.ok(fs.existsSync(path.join(root, 'vendor/packages', name, 'LICENSE')))
  }
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (selected(key.split('node_modules/').at(-1))) {
      assert.ok(entry.link, `remote or nested selected package: ${key}`)
      assert.match(entry.resolved, /^vendor\/packages\//)
    }
  }
})

test('shared sources are available without a submodule checkout', () => {
  assert.equal(fs.existsSync(path.join(root, '.gitmodules')), false)
  for (const dir of ['src/share', 'src/renderer/icon']) {
    assert.equal(fs.existsSync(path.join(root, dir, '.git')), false)
    assert.ok(fs.existsSync(path.join(root, dir, 'README.md')))
  }
})

test('local compiler emits callable HDC modules and rebuilds source edits', async (t) => {
  const { buildPackage } = await import('../script/lib/vendor-build.mjs')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor source & build '))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, 'src'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'hdckit' }))
  const input = path.join(dir, 'src/index.ts')
  fs.writeFileSync(input, 'export const value: number = 7')
  await buildPackage(dir)
  const output = path.join(dir, 'dist/index.js')
  assert.equal(require(output).value, 7)
  assert.ok(fs.existsSync(path.join(dir, 'dist/index.d.ts')))
  fs.writeFileSync(input, 'export const value: number = 9')
  await buildPackage(dir)
  delete require.cache[require.resolve(output)]
  assert.equal(require(output).value, 9)
  fs.writeFileSync(input, 'export const value: =')
  await assert.rejects(buildPackage(dir))
  delete require.cache[require.resolve(output)]
  assert.equal(require(output).value, 9, 'failed edits preserve the last valid output')
})

test('CSS scopes classes and IDs without changing attributes, URLs or keyframes', async () => {
  const { prefixSelectors } = await import('../script/lib/vendor-build.mjs')
  const input = '.selected:hover, #panel, .luna-menu-item, [title=".sample"] {background:url("icon.svg")} @keyframes spin {from {opacity:0} to {opacity:1}}'
  const output = prefixSelectors(input, 'luna-menu')
  assert.match(output, /\.luna-menu-selected:hover/)
  assert.match(output, /#luna-menu-panel/)
  assert.match(output, /\.luna-menu-item/)
  assert.doesNotMatch(output, /luna-menu-luna/)
  assert.match(output, /\[title="\.sample"\]/)
  assert.match(output, /url\("icon.svg"\)/)
  assert.match(output, /@keyframes spin/)
})

test('all generated Luna entry points and React wrappers bundle from local source', async () => {
  const { build } = require('esbuild')
  const manifest = require('../vendor/manifest.json')
  for (const { name } of manifest.packages.filter(({ name }) => name.startsWith('luna-'))) {
    const pkgDir = path.join(root, 'vendor/packages', name)
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json')))
    for (const entry of ['.', './react'].filter(e => pkg.exports[e])) {
      const result = await build({ entryPoints: [path.join(pkgDir, pkg.exports[entry])], bundle: true,
        write: false, platform: 'browser', format: 'esm', logLevel: 'silent' })
      assert.ok(result.outputFiles[0].contents.length)
    }
    const css = fs.readFileSync(path.join(pkgDir, name + '.css'), 'utf8')
    assert.ok(css.includes('.' + name), name)
    assert.ok(!css.includes('.' + name + '-' + name), name)
    if (fs.existsSync(path.join(pkgDir, 'src', name.slice(5), 'icon.css'))) {
      const { JSDOM } = require('jsdom')
      const postcss = require('postcss')
      const document = new JSDOM(`<span class="${name}-icon-test"></span><span class="other ${name}-icon-test"></span><span class="icon-test"></span>`).window.document
      const fontRules = []
      postcss.parse(css).walkRules(rule => {
        if (rule.nodes.some(node => node.prop === 'font-family' && node.value.includes(name + '-icon'))) fontRules.push(rule.selector)
      })
      assert.ok(fontRules.length, name + ' defines its icon font')
      for (const selector of fontRules) {
        assert.equal(document.querySelectorAll(selector).length, 2, name + ' icon font matches only scoped icons')
      }
    }
  }
  assert.equal(typeof require('hdckit').default.createClient, 'function')
  assert.equal(typeof require('hdckit/dist/hdc/UiDriver').default, 'function')
})
