import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Mocha from 'mocha'
import { buildLicia, moduleMetadata, sourceComment } from './lib/licia-build.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const packageDir = path.join(root, 'vendor/packages/licia')
const temporaryRoot = fs.realpathSync(os.tmpdir())
const temporary = fs.mkdtempSync(path.join(temporaryRoot, 'scrcpy-licia-tests-'))
const originalCwd = process.cwd()
const outputDir = path.join(temporary, '.licia/test')
const mocha = new Mocha({ reporter: 'dot', timeout: 5000 })
// These original tests install additional fixtures at run time. Keep them in
// the source snapshot, but never execute their scripts or silently fetch tools.
const exclusions = {
  ajax: 'requires the upstream Sinon XMLHttpRequest fixture',
  fetch: 'requires the upstream Sinon fetch fixture',
  lazyImport: 'requires the upstream underscore installation/layout fixture',
  lazyRequire: 'requires the upstream underscore installation/layout fixture',
}
const fallback = process.argv.includes('--fallback')
const requested = process.argv.slice(2).filter(arg => arg !== '--fallback')
const helper = fs.readFileSync(path.join(packageDir, 'upstream/test.helper.tpl'), 'utf8')
let selected = 0
try {
  fs.mkdirSync(outputDir, { recursive: true })
  fs.cpSync(path.join(packageDir, 'test'), path.join(temporary, 'test'), { recursive: true })
  let runtimeDir = packageDir
  if (fallback) {
    runtimeDir = path.join(temporary, 'fallback-modules')
    fs.cpSync(path.join(packageDir, 'src'), path.join(runtimeDir, 'src'), { recursive: true })
    // Exercise original fallback branches without changing production outputs.
    buildLicia(runtimeDir, { testMode: true })
  }
  for (const file of fs.readdirSync(path.join(packageDir, 'src')).sort()) {
    if (!file.endsWith('.js')) continue
    const name = file.slice(0, -3)
    if (requested.length && !requested.includes(name)) continue
    const metadata = moduleMetadata(fs.readFileSync(path.join(packageDir, 'src', file), 'utf8'))
    const environments = metadata.test === 'all' ? ['node', 'browser']
      : metadata.test === 'manual' ? [] : metadata.test?.split(/\s+/) ?? metadata.env
    if (!environments.includes('node')) {
      if (requested.includes(name)) throw new Error(`${name} has no automated Node test; see its source test metadata`)
      continue
    }
    selected++
    const originalTest = fs.readFileSync(path.join(packageDir, 'test', file), 'utf8')
    const excluded = exclusions[name]
    if (sourceComment(originalTest, 'scripts') && !excluded) {
      throw new Error(`Review external fixture setup before enabling ${name}`)
    }
    if (excluded && requested.includes(name)) throw new Error(`${name}: ${excluded}`)
    const body = excluded ? `it.skip(${JSON.stringify(excluded)}, function() {});`
      : /\bit\s*\(/.test(originalTest) ? originalTest : `it('basic', function() {\n${originalTest}\n});`
    const generated = `module.paths.unshift(${JSON.stringify(path.join(root, 'node_modules'))});
const expect = require('chai').expect;
const util = new Proxy({}, {get: (_, name) => require(${JSON.stringify(runtimeDir + path.sep)} + name + '.js')});
describe(${JSON.stringify(name)}, function() {
  const ${name} = util[${JSON.stringify(name)}];
  ${helper.replaceAll('<%=modName%>', name)}
  {
${body.split('\n').map(line => '    ' + line).join('\n')}
  }
});\n`
    const output = path.join(outputDir, name + '.cjs')
    fs.writeFileSync(output, generated)
    mocha.addFile(output)
  }
  if (!selected || (requested.length && selected !== new Set(requested).size)) throw new Error('Unknown or unsupported Licia test selection')
  console.log(`Licia upstream Node tests (${fallback ? 'source fallback branches' : 'production output'}): ${selected} modules; ${requested.length ? 0 : Object.keys(exclusions).length} explicit external-fixture exclusions`)
  process.chdir(temporary)
  const failures = await new Promise(resolve => mocha.run(resolve))
  if (failures) process.exitCode = 1
} finally {
  process.chdir(originalCwd)
  mocha.dispose()
  assert.equal(path.dirname(temporary), temporaryRoot)
  fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
