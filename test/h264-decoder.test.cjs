const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const { transformSync } = require('esbuild')
const config = new Uint8Array([0, 0, 0, 1, 0x67, 0x64, 0, 0x28, 0, 0, 0, 1, 0x68, 1])
const key = new Uint8Array([0, 0, 0, 1, 0x65, 1])
const delta = new Uint8Array([0, 0, 1, 0x41, 1])
function fixture() {
  const decoders = [], outputs = [], errors = []
  class VideoDecoder {
    state = 'unconfigured'
    decodeQueueSize = 0
    chunks = []
    constructor(callbacks) { this.callbacks = callbacks; decoders.push(this) }
    configure(options) { this.options = options; this.state = 'configured' }
    decode(chunk) { this.chunks.push(chunk) }
    close() { this.state = 'closed' }
  }
  const context = vm.createContext({ module: { exports: {} }, exports: {}, VideoDecoder, Uint8Array,
    EncodedVideoChunk: class { constructor(options) { Object.assign(this, options) } },
  })
  const file = path.resolve(__dirname, '../src/renderer/screencast/lib/H264Decoder.ts')
  vm.runInContext(transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' }).code, context)
  const decoder = new context.module.exports.default((frame) => outputs.push(frame), (error) => errors.push(error))
  return { decoder, decoders, outputs, errors }
}
test('H264 waits for configuration and a keyframe then prepends SPS/PPS', () => {
  const f = fixture()
  f.decoder.push(delta, { timestamp: 1 })
  assert.equal(f.decoders.length, 0)
  f.decoder.push(config, { config: true, timestamp: 2 })
  f.decoder.push(delta, { timestamp: 3 })
  f.decoder.push(key, { timestamp: 4 })
  assert.equal(f.decoders[0].options.codec, 'avc1.640028')
  assert.equal(f.decoders[0].chunks.length, 1)
  assert.equal(f.decoders[0].chunks[0].type, 'key')
  assert.deepEqual([...f.decoders[0].chunks[0].data], [...config, ...key])
})
test('H264 overload drops reference chain until next keyframe with bounded decoder queue', () => {
  const f = fixture()
  f.decoder.push(config, { config: true, timestamp: 0 })
  f.decoder.push(key, { timestamp: 1 })
  f.decoders[0].decodeQueueSize = 4
  f.decoder.push(delta, { timestamp: 2 })
  f.decoder.push(delta, { timestamp: 3 })
  assert.equal(f.decoders[0].state, 'closed')
  f.decoder.push(key, { timestamp: 4 })
  assert.equal(f.decoders.at(-1).chunks.length, 1)
  assert.equal(f.decoders.at(-1).chunks[0].type, 'key')
})
test('H264 disposal closes late video frames and cannot restart decoding', () => {
  const f = fixture()
  f.decoder.push(config, { config: true, timestamp: 0 })
  f.decoder.push(key, { timestamp: 1 })
  let closed = 0
  f.decoder.destroy()
  f.decoders[0].callbacks.output({ close: () => closed++ })
  f.decoder.push(key, { timestamp: 2 })
  assert.equal(closed, 1)
  assert.equal(f.outputs.length, 0)
  assert.equal(f.decoders.length, 1)
})

test('changed SPS invalidates old outputs and waits for a new keyframe', () => {
  const f = fixture()
  f.decoder.push(config, { config: true, timestamp: 0 })
  f.decoder.push(key, { timestamp: 1 })
  const next = config.slice(); next[7] = 0x29
  f.decoder.push(next, { config: true, timestamp: 2 })
  let closed = 0
  f.decoders[0].callbacks.output({ close: () => closed++ })
  f.decoder.push(delta, { timestamp: 3 })
  assert.equal(f.decoders.length, 1)
  assert.equal(closed, 1)
  f.decoder.push(key, { timestamp: 4 })
  assert.equal(f.decoders[1].options.codec, 'avc1.640029')
})
