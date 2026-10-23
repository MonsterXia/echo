const assert = require('node:assert/strict')
const net = require('node:net')
const { load } = require('./overview-fixture.cjs')

// Existing enumeration/UI fixtures keep the real finite module and only allow
// their own random loopback listener. No submodule imports or HDC process calls.
module.exports = function loopbackFinite(port) {
  class Socket extends net.Socket {
    connect(options) {
      assert.equal(options.host, '127.0.0.1')
      assert.equal(options.port, port)
      return super.connect(options)
    }
  }
  return load('src/main/lib/hdc/finiteShell.ts', { 'node:net': { Socket, isIP: net.isIP } })
}
