const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { transformSync } = require('esbuild')

const sourcePath = path.resolve(__dirname, '../../vendor/packages/hdckit/src/hdc/UiDriver.ts')
function loadTransport(source = fs.readFileSync(sourcePath, 'utf8')) {
  // Expose the actual private transport only in the test build.
  const code = transformSync(source + '\nexport { Connection }', { loader: 'ts', format: 'cjs' }).code
  const module = new Module(sourcePath, moduleForPaths)
  module.filename = sourcePath
  module.paths = Module._nodeModulePaths(path.dirname(sourcePath))
  module._compile(code, sourcePath)
  return module.exports
}
function loadConnection(source) { return loadTransport(source).Connection }
const moduleForPaths = module
function packet(id, payload) {
  const header = Buffer.from('_uitestkit_rpc_message_head_')
  const meta = Buffer.alloc(8)
  const body = Buffer.from(payload)
  meta.writeUInt32BE(id, 0)
  meta.writeUInt32BE(body.length, 4)
  return Buffer.concat([header, meta, body, Buffer.from('_uitestkit_rpc_message_tail_')])
}
module.exports = { loadConnection, loadTransport, packet, sourcePath }
