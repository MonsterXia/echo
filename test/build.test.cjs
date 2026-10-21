const assert = require('node:assert/strict')
const { test } = require('node:test')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo build & package '))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  for (const dir of ['build', 'resources/hdc', 'resources/uitestkit_sdk']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true })
    fs.writeFileSync(path.join(root, dir, 'fixture.txt'), dir)
  }
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'echo', version: '1.0.1', main: 'dist/main/index.js',
    scripts: { build: 'unused' },
    devDependencies: { electron: '45.0.0', vite: '5.4.21' },
  }))
  const npmCli = path.join(root, 'npm fixture.cjs')
  fs.writeFileSync(npmCli, `
    const fs = require('node:fs')
    const path = require('node:path')
    const args = process.argv.slice(2)
    fs.appendFileSync(process.env.COMMAND_LOG, JSON.stringify({ args, cwd: process.cwd() }) + '\\n')
    if (args[1] === process.env.FAIL_TASK) process.exit(23)
    if (args[0] === 'run') {
      const dir = path.join('dist', args[1].split(':')[1])
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'index.js'), 'built')
    }
  `)
  const log = path.join(root, 'commands.jsonl')
  return {
    root,
    run(failTask = '') {
      return spawnSync(process.execPath, [path.resolve(__dirname, '../script/build.mjs')], {
        cwd: root, encoding: 'utf8',
        env: { ...process.env, npm_execpath: npmCli, COMMAND_LOG: log, FAIL_TASK: failTask },
      })
    },
    commands() {
      return fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse)
    },
  }
}

test('build prepares a runnable distribution without requiring a shell', (t) => {
  const f = fixture(t)
  const result = f.run()
  assert.equal(result.status, 0, result.stderr)
  const pkg = JSON.parse(fs.readFileSync(path.join(f.root, 'dist/package.json')))
  assert.equal(pkg.main, 'main/index.js')
  assert.deepEqual(pkg.devDependencies, { electron: '45.0.0' })
  assert.deepEqual(pkg.scripts, { start: 'electron main/index.js' })
  for (const dir of ['main', 'preload', 'renderer']) {
    assert.equal(fs.readFileSync(path.join(f.root, 'dist', dir, 'index.js'), 'utf8'), 'built')
  }
  assert.equal(fs.readFileSync(path.join(f.root, 'dist/resources/hdc/fixture.txt'), 'utf8'), 'resources/hdc')
  assert.equal(fs.readFileSync(path.join(f.root, 'dist/resources/uitestkit_sdk/fixture.txt'), 'utf8'), 'resources/uitestkit_sdk')
  assert.equal(fs.readFileSync(path.join(f.root, 'dist/build/fixture.txt'), 'utf8'), 'build')
  assert.deepEqual(f.commands().at(-1), {
    args: ['install', '--omit=dev', '--no-audit', '--no-fund'],
    cwd: path.join(f.root, 'dist'),
  })
})

test('a failed build stops before packaging incomplete output', (t) => {
  const f = fixture(t)
  const result = f.run('build:preload')
  assert.notEqual(result.status, 0)
  assert.deepEqual(f.commands().map(({ args }) => args), [
    ['run', 'build:main'], ['run', 'build:preload'],
  ])
  assert.equal(fs.existsSync(path.join(f.root, 'dist/package.json')), false)
})
