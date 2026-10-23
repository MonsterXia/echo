const assert = require('node:assert/strict')
const { test } = require('node:test')
const { screencastMain } = require('./helpers/screencast-main.cjs')

test('show focuses the existing live screencast window', () => {
  const h = screencastMain()
  h.show()
  h.show()
  assert.equal(h.windows.length, 1)
  assert.equal(h.windows[0].focuses, 1)
})

test('normal close restores main and permits reopening', () => {
  const h = screencastMain()
  h.show()
  h.close()
  assert.equal(h.mainShows(), 1)
  h.show()
  assert.equal(h.windows.length, 2)
})

test('direct destruction restores main without requiring a close event', () => {
  const h = screencastMain()
  h.show()
  h.windows[0].destroy()
  assert.equal(h.mainShows(), 1)
})

test('direct destruction releases the singleton so show creates a fresh window', () => {
  const h = screencastMain()
  h.show()
  h.windows[0].destroy()
  h.show()
  assert.equal(h.windows.length, 2)
})

test('repeated close after destruction is harmless and does not restore main twice', () => {
  const h = screencastMain()
  h.show()
  h.windows[0].destroy()
  h.close()
  h.close()
  assert.equal(h.mainShows(), 1)
})
