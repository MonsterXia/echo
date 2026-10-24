const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { transformSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

function load() {
  const file = path.resolve(__dirname, '../src/main/lib/hdc/nativeVideoProtocol.ts')
  const compiled = new Module(file, module)
  compiled.paths = module.paths
  compiled._compile(transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' }).code, file)
  return compiled.exports
}
function field(id, bytes) { return Buffer.concat([Buffer.from([id * 8 + 2, bytes.length]), bytes]) }
function entry(name, val) { return field(3, Buffer.concat([field(1, Buffer.from(name)), field(2, val)])) }
const message = Buffer.concat([
  entry('data', field(5, Buffer.from([0, 0, 0, 1, 0x65, 12]))),
  entry('pts', Buffer.from([8, 123])),
  entry('flags', Buffer.from([8, 2])),
])
function grpc(bytes) { const head = Buffer.alloc(5); head.writeUInt32BE(bytes.length, 1); return Buffer.concat([head, bytes]) }

test('native video extracts bytes and timestamp from protobuf payload map', () => {
  const { parseVideoReply } = load()
  const result = parseVideoReply(message)
  assert.deepEqual([...result.data], [0, 0, 0, 1, 0x65, 12])
  assert.equal(result.timestamp, 123)
  assert.equal(result.config, false)
  assert.equal(result.keyFrame, true)
})
test('native stream handles every header/body split and multiple replies', () => {
  const { GrpcMessages } = load()
  const bytes = Buffer.concat([grpc(message), grpc(message)])
  for (let i = 1; i < bytes.length; i++) {
    const messages = []
    const parser = new GrpcMessages((m) => messages.push(m))
    parser.push(bytes.subarray(0, i))
    parser.push(bytes.subarray(i))
    assert.equal(messages.length, 2, `split ${i}`)
    assert.deepEqual(messages[1], message)
  }
})
test('native stream rejects compression and oversized lengths before allocating a body', () => {
  const { GrpcMessages } = load()
  assert.throws(() => new GrpcMessages(() => {}).push(Buffer.from([1, 0, 0, 0, 1])), /compressed/)
  assert.throws(() => new GrpcMessages(() => {}).push(Buffer.from([0, 127, 255, 255, 255])), /large/)
})
test('native protobuf rejects truncated lengths and malformed varints', () => {
  const { parseVideoReply } = load()
  assert.throws(() => parseVideoReply(Buffer.from([26, 100, 0])), /truncated/)
  assert.throws(() => parseVideoReply(Buffer.from([128, 128])), /truncated/)
  assert.equal(parseVideoReply(Buffer.alloc(0)), null)
})
