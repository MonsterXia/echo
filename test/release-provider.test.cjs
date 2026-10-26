const assert = require('node:assert/strict')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const fs = require('node:fs')
const vm = require('node:vm')
const { AppUpdater } = require('electron-updater/out/AppUpdater')

function loadPageParser() {
  const module = { exports: {} }
  vm.runInNewContext(transformSync(fs.readFileSync('src/main/lib/releasePage.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code, { module, exports: module.exports, require, URL })
  return module.exports
}

function fixture({ releases = [], beta = false, platform = 'darwin', channel = 'latest', pages, metadataVersion, requestError, current = '1.0.3', hanging = false, clock = {}, rateLimited = false, htmlPages = [], hangingPath } = {}) {
  const module = { exports: {} }
  vm.runInNewContext(transformSync(fs.readFileSync('src/main/lib/ReleaseProvider.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, require: id => id === './releasePage' ? loadPageParser() : require(id), URL, setTimeout, clearTimeout, ...clock,
  })
  const updater = new AppUpdater(undefined, { version: current, isPackaged: false })
  updater.channel = channel
  updater.allowPrerelease = beta
  updater.allowDowngrade = false
  const requests = [], tokens = []
  const provider = new module.exports.ReleaseProvider({}, updater, { platform, isUseMultipleRangeRequest: false, executor: {
    async request(options, token) {
      requests.push(options)
      tokens.push(token)
      if (hanging || (hangingPath && options.path.includes(hangingPath))) return token.createPromise(() => {})
      if (requestError) throw new Error(requestError)
      if (options.hostname === 'api.github.com' && rateLimited) { const error = new Error('rate limit'); error.statusCode = 403; throw error }
      if (options.path.includes('/releases?page=')) return htmlPages[Number(new URL('https://github.com'+options.path).searchParams.get('page')) - 1]
      if (options.hostname === 'api.github.com') {
        const page = Number(new URL('https://api.github.com' + options.path).searchParams.get('page'))
        return JSON.stringify(pages ? pages[page - 1] || [] : releases)
      }
      const tag = decodeURIComponent(options.path.split('/download/')[1].split('/')[0])
      return `version: ${metadataVersion || tag.replace(/^v/, '')}\nfiles:\n  - url: app.dmg\n    sha512: fixture\n`
    },
  } })
  return { provider, updater, requests, tokens, cancel: module.exports.cancelReleaseChecks, begin: module.exports.beginReleaseCheck }
}
const release = (tag, prerelease = false, draft = false) => ({ tag_name: tag, prerelease, draft, name: tag, body: '' })

test('unchecked chooses highest stable version, ignoring flags, semver prereleases and draft releases', async () => {
  const f = fixture({ releases: [release('v1.0.4-dev.0', true), release('v1.0.3'), release('v1.0.2'), release('v3.0.0', true), release('v4.0.0', false, true), release('v5.0.0-rc.1'), release('not-semver')] })
  assert.equal((await f.provider.getLatestVersion()).version, '1.0.3')
})

test('checked considers dev, beta, rc and stable together by semver, not publication order', async () => {
  const f = fixture({ beta: true, releases: [release('v1.0.4-dev.0', true), release('v1.0.3'), release('v1.0.5-beta.2', true), release('v1.0.5-rc.1', true), release('v9.0.0', false, true)] })
  assert.equal((await f.provider.getLatestVersion()).version, '1.0.5-rc.1')
})

test('stable beats same-version prereleases and newer stable beats older prereleases with Beta enabled', async () => {
  const f = fixture({ beta: true, releases: [release('v1.0.4-rc.9', true), release('v1.0.4'), release('v1.0.3-dev.9', true)] })
  assert.equal((await f.provider.getLatestVersion()).version, '1.0.4')
})

test('switching preference affects the next check and never offers a downgrade', async () => {
  const f = fixture({ current: '1.0.4-dev.0', releases: [release('v1.0.5-dev.0', true), release('v1.0.3')] })
  assert.equal(await f.updater.isUpdateAvailable(await f.provider.getLatestVersion()), false)
  f.updater.allowPrerelease = true
  assert.equal(await f.updater.isUpdateAvailable(await f.provider.getLatestVersion()), true)
  f.updater.allowPrerelease = false
  assert.equal((await f.provider.getLatestVersion()).version, '1.0.3')
})

for (const [platform, channel, filename] of [['win32', 'latest', 'latest.yml'], ['darwin', 'latest', 'latest-mac.yml'], ['darwin', 'latest-x64', 'latest-x64-mac.yml']]) {
  test(`prerelease uses the published ${filename} metadata and exact release tag`, async () => {
    const f = fixture({ beta: true, platform, channel, releases: [release('v1.0.4-dev.0', true)] })
    const info = await f.provider.getLatestVersion()
    assert.equal(info.tag, 'v1.0.4-dev.0')
    assert.equal(f.requests.at(-1).path, `/MonsterXia/scrcpy-harmony/releases/download/v1.0.4-dev.0/${filename}`)
    assert.equal(f.requests.filter(o => o.hostname === 'github.com').length, 1, 'no beta/dev channel fallback')
  })
}

test('later release pages are included instead of trusting the first page', async () => {
  const f = fixture({ beta: true, pages: [Array.from({ length: 100 }, () => release('v1.0.0')), [release('v2.0.0-rc.1', true)]] })
  assert.equal((await f.provider.getLatestVersion()).version, '2.0.0-rc.1')
  assert.equal(f.requests.filter(o => o.hostname === 'api.github.com').length, 2)
})

test('metadata for a different version fails instead of advertising the wrong release', async () => {
  const f = fixture({ beta: true, releases: [release('v1.0.4-dev.0', true)], metadataVersion: '1.0.3' })
  await assert.rejects(f.provider.getLatestVersion(), /version|版本/i)
})

test('network failures and empty eligible lists fail explicitly', async () => {
  await assert.rejects(fixture({ requestError: 'network failure' }).provider.getLatestVersion(), /network failure/)
  await assert.rejects(fixture({ releases: [release('v1.0.4-dev.0', true)] }).provider.getLatestVersion(), /release|version/i)
})

test('a full bounded listing is rejected rather than claiming a partial maximum', async () => {
  const f = fixture({ pages: Array.from({ length: 10 }, () => Array.from({ length: 100 }, () => release('v1.0.0'))) })
  await assert.rejects(f.provider.getLatestVersion(), /complete-check limit/)
  assert.equal(f.requests.filter(o => o.hostname === 'github.com').length, 0)
})

test('malformed release records fail instead of being treated as stable', async () => {
  const f = fixture({ releases: [{ tag_name: 'v9.0.0', draft: false }] })
  await assert.rejects(f.provider.getLatestVersion(), /Invalid release/)
})

test('changing Beta preference during a request cannot mix policies across release pages', async () => {
  const f = fixture({ pages: [Array.from({ length: 100 }, () => release('v1.0.3')), [release('v2.0.0-rc.1', true)]] })
  const task = f.provider.getLatestVersion()
  f.updater.allowPrerelease = true
  assert.equal((await task).version, '1.0.3')
  assert.equal((await f.provider.getLatestVersion()).version, '2.0.0-rc.1')
})


test('Cancel aborts an active metadata request', async () => {
  const f = fixture({ hanging: true })
  const task = f.provider.getLatestVersion()
  f.cancel()
  await assert.rejects(task, /cancel/i)
  assert.equal(f.tokens[0].cancelled, true)
})

test('30-second deadline cancels the request and clears its timer', async () => {
  let expire, cleared = 0
  const f = fixture({ hanging: true, clock: {
    setTimeout(callback, ms) { assert.equal(ms, 30_000); expire = callback; return 1 },
    clearTimeout(id) { assert.equal(id, 1); cleared++ },
  } })
  const task = f.provider.getLatestVersion()
  expire()
  await assert.rejects(task, /cancel/i)
  assert.equal(cleared, 1)
})

for (const fail of [false, true]) {
  test(`timer and active cancellation registration are removed after ${fail ? 'failure' : 'success'}`, async () => {
    let cleared = 0
    const f = fixture({ releases: [release('v1.0.3')], requestError: fail ? 'network' : undefined, clock: {
      setTimeout() { return 1 }, clearTimeout() { cleared++ },
    } })
    const task = f.provider.getLatestVersion()
    if (fail) await assert.rejects(task, /network/)
    else await task
    f.cancel()
    assert.equal(cleared, 1)
    assert.equal(f.tokens[0].cancelled, false)
  })
}


test('cancelling before AppUpdater enters the provider prevents any network request', async () => {
  const f = fixture({ releases: [release('v1.0.3')] })
  const end = f.begin()
  f.cancel()
  await assert.rejects(f.provider.getLatestVersion(), /cancel/i)
  assert.equal(f.requests.length, 0)
  end()
  assert.equal((await f.provider.getLatestVersion()).version, '1.0.3')
})


test('REST quota failure falls back to public release headers without changing version selection', async () => {
  const card = (tag, label) => `<section data-release-anchor="release-${tag}"><div data-turbo-frame="repo-content-turbo-frame"><span><a class="Link--primary" href="/MonsterXia/scrcpy-harmony/releases/tag/${tag}">${tag}</a></span><span><span class="Label">${label}</span></span></div></section>`
  const html = `<html><body>${card('v1.0.4-dev.0', 'Pre-release')}${card('v1.0.3', 'Latest')}</body></html>`
  const f = fixture({ rateLimited: true, htmlPages: [html] })
  assert.equal((await f.provider.getLatestVersion()).version, '1.0.3')
  f.updater.allowPrerelease = true
  assert.equal((await f.provider.getLatestVersion()).version, '1.0.4-dev.0')
  assert.ok(f.requests.some(r => r.path.includes('/releases?page=1')))
})


function fallbackPages() {
  const card = (tag, label) => `<section data-release-anchor="release-${tag}"><div data-turbo-frame="repo-content-turbo-frame"><span><a class="Link--primary" href="/MonsterXia/scrcpy-harmony/releases/tag/${tag}">${tag}</a></span><span><span class="Label">${label}</span></span></div></section>`
  return [
    `<html>${card('v1.0.3','Latest')}<div class="pagination" aria-label="Release list pagination"><a class="next_page" href="/MonsterXia/scrcpy-harmony/releases?page=2">Next</a></div></html>`,
    `<html>${card('v2.0.0-rc.1','Pre-release')}<div class="pagination" aria-label="Release list pagination"><span class="next_page disabled" aria-disabled="true">Next</span></div></html>`,
  ]
}

test('REST limit plus multiple HTML pages chooses a newer version on the last page', async () => {
  const f = fixture({ beta: true, rateLimited: true, htmlPages: fallbackPages() })
  assert.equal((await f.provider.getLatestVersion()).version, '2.0.0-rc.1')
  assert.ok(f.requests.some(r => r.path.endsWith('releases?page=2')))
})

test('cancellation while reading the second fallback page aborts without selecting a partial version', async () => {
  const f = fixture({ beta: true, rateLimited: true, htmlPages: fallbackPages(), hangingPath: 'releases?page=2' })
  const task = f.provider.getLatestVersion()
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(f.requests.some(r => r.path.endsWith('releases?page=2')))
  f.cancel()
  await assert.rejects(task, /cancel/i)
  assert.equal(f.requests.some(r => r.path.includes('/download/')), false)
})
