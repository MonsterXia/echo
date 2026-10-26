const assert = require('node:assert/strict')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const fs = require('node:fs'), vm = require('node:vm')
const compiled = { exports: {} }
vm.runInNewContext(transformSync(fs.readFileSync('src/main/lib/releasePage.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code, { module: compiled, exports: compiled.exports, require, URL })
const { parseReleasePage } = compiled.exports
const card = (tag, label = '', notes = '') => `<section data-release-anchor="release-${tag}"><div data-turbo-frame="repo-content-turbo-frame"><span><a class="Link--primary Link" href="/MonsterXia/scrcpy-harmony/releases/tag/${tag}">${tag}</a></span><span>${label ? `<span class="Label">${label}</span>` : ''}</span></div><div>${notes}</div></section>`
const page = body => `<html><body>${body}</body></html>`
const pagination = content => `<div class="pagination" aria-label="Release list pagination">${content}</div>`

test('release headers preserve official prerelease flags and ignore similar release-note content', () => {
  const parsed = parseReleasePage(page(card('v1.0.4', 'Pre-release') + card('v1.0.3', 'Latest', '<span class="Label">Pre-release</span>') + card('v1.0.2')), 1)
  assert.deepEqual(Array.from(parsed.releases, r => [r.tag_name, r.prerelease]), [['v1.0.4', true], ['v1.0.3', false], ['v1.0.2', false]])
  assert.equal(parsed.hasNext, false)
})

test('pagination must be the next page in this repository and a disabled next confirms completion', () => {
  const base = card('v1.0.3')
  assert.equal(parseReleasePage(page(base + pagination('<a class="next_page" href="/MonsterXia/scrcpy-harmony/releases?page=2">Next</a>')), 1).hasNext, true)
  assert.equal(parseReleasePage(page(base + pagination('<span class="next_page disabled" aria-disabled="true">Next</span>')), 2).hasNext, false)
  assert.throws(() => parseReleasePage(page(base + pagination('<a class="next_page" href="https://example.com/">Next</a>')), 1), /Unexpected/)
  assert.throws(() => parseReleasePage(page(base + pagination('<a class="next_page" href="/MonsterXia/scrcpy-harmony/releases?page=2">Next</a>')), 2), /Unexpected/)
})

test('truncation, changed headers and missing pagination cannot imply a stable/latest result', () => {
  assert.throws(() => parseReleasePage(page(card('v1.0.3')).replace('</html>', ''), 1), /Incomplete/)
  assert.throws(() => parseReleasePage(page(card('v1.0.3', 'Unknown')), 1), /Unknown/)
  assert.throws(() => parseReleasePage(page(card('v1.0.3').replace('repo-content-turbo-frame', 'changed')), 1), /Unknown/)
  assert.throws(() => parseReleasePage(page(card('v1.0.3').repeat(10)), 1), /pagination/)
})
