// Windows custom titlebar regression: real clicks, visible state and relaunch.
// Usage after npm run build: node script/check-beta-menu-live.cjs <output-dir>
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { _electron } = require('playwright-core')

assert.equal(process.platform, 'win32', 'This probe targets the Windows custom titlebar')
assert.ok(process.argv[2], 'Pass an evidence output directory')
const output = path.resolve(process.argv[2])
fs.mkdirSync(output, { recursive: true })
const report = { kind: 'Windows local dist; real titlebar clicks and settings IPC', scenarios: [], passed: false }
report.mainSha256 = createHash('sha256').update(fs.readFileSync('dist/main/index.js')).digest('hex')
report.stylesheets = fs.readdirSync('dist/renderer/assets').filter(file => file.endsWith('.css')).sort()
  .map(file => ({ file, sha256: createHash('sha256').update(fs.readFileSync(path.join('dist/renderer/assets', file))).digest('hex') }))

async function poll(read, expected) {
  const until = Date.now() + 15000
  let value
  do {
    value = await read()
    if (value === expected) return
    await new Promise(resolve => setTimeout(resolve, 100))
  } while (Date.now() < until)
  assert.equal(value, expected)
}

async function session(profile, language, theme, initial, toggle) {
  const application = await _electron.launch({
    executablePath: require('electron'),
    args: [path.resolve('dist/main/index.js'), `--user-data-dir=${profile}`],
    timeout: 30000,
  })
  const deadline = setTimeout(() => application.process().kill(), 60000)
  try {
    const page = await application.firstWindow()
    page.setDefaultTimeout(15000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const label = language === 'en-US' ? 'Beta Update' : '接收预发布更新'
    const states = language === 'en-US' ? ['Beta Update: Off', 'Beta Update: On']
      : ['接收预发布更新：已关闭', '接收预发布更新：已开启']
    async function openAndCheck(checked, suffix) {
      await page.locator('.cet-menubar-menu-button').first().click()
      const item = page.locator('.cet-action-menu-item').filter({ hasText: label })
      await item.waitFor({ state: 'visible' })
      const visual = await item.evaluate(element => {
        const icon = element.querySelector('.cet-menu-item-icon.checkbox')
        const rect = icon.getBoundingClientRect()
        return { text: element.textContent, checked: element.getAttribute('aria-checked'),
          iconWidth: rect.width, iconHeight: rect.height, visibility: getComputedStyle(icon).visibility }
      })
      assert.ok(visual.iconWidth >= 12 && visual.iconHeight >= 12, 'Checkbox icon must retain visible dimensions')
      assert.equal(visual.checked, String(checked))
      assert.equal(visual.visibility, checked ? 'visible' : 'hidden')
      assert.equal(visual.text, states[Number(checked)])
      const labelPositions = await page.locator('.cet-menubar-menu-container .cet-action-label:visible')
        .evaluateAll(labels => labels.filter(label => label.textContent.trim())
          .map(label => label.getBoundingClientRect().left))
      assert.ok(labelPositions.length > 1)
      assert.ok(Math.max(...labelPositions) - Math.min(...labelPositions) <= 1,
        `All menu labels must share the same left edge, including the checkbox item: ${labelPositions}`)
      assert.equal(await page.evaluate(() => main.getSettingsStore('betaUpdate')), checked)
      assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'data/settings.json'), 'utf8')).betaUpdate, checked)
      await page.locator('.cet-menubar-menu-container').first().screenshot({ path: path.join(output, `${language}-${theme}-${suffix}.png`) })
      report.scenarios.push({ language, theme, phase: suffix, ...visual, labelPositions })
      return item
    }
    const item = await openAndCheck(initial, `restart-${initial}`)
    if (toggle) {
      await item.click()
      await poll(() => page.evaluate(() => main.getSettingsStore('betaUpdate')), !initial)
      await openAndCheck(!initial, `clicked-${!initial}`)
    }
    assert.deepEqual(errors, [])
  } finally {
    try { await application.close() } finally { clearTimeout(deadline) }
  }
}

;(async () => {
  try {
    for (const language of ['en-US', 'zh-CN']) {
      for (const theme of ['light', 'dark']) {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'scrcpy-beta-menu-'))
        fs.mkdirSync(path.join(profile, 'data'))
        fs.writeFileSync(path.join(profile, 'data/settings.json'), JSON.stringify({ language, theme, betaUpdate: false }))
        await session(profile, language, theme, false, true)
        await session(profile, language, theme, true, true)
        await session(profile, language, theme, false, false)
      }
    }
    report.passed = true
  } finally {
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report, null, 2))
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
