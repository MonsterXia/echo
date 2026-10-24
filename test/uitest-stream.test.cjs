const assert = require('node:assert/strict')
const { test } = require('node:test')
const { loadConnection, packet } = require('./helpers/uitest-stream.cjs')

function fixture() {
  const Connection = loadConnection()
  const connection = new Connection()
  const frames = []
  connection.setOnMessage((id, data) => frames.push([id, data.toString()]))
  return { connection, frames }
}

test('uitest delivers every frame coalesced into one TCP chunk', () => {
  const { connection, frames } = fixture()
  connection.onData(Buffer.concat([packet(1, 'first'), packet(2, 'second'), packet(3, 'third')]))
  assert.deepEqual(frames, [[1, 'first'], [2, 'second'], [3, 'third']])
})

test('uitest preserves a partial next message at every possible TCP split', () => {
  const first = packet(1, 'first')
  const second = packet(2, 'second')
  for (let split = 1; split < second.length; split++) {
    const { connection, frames } = fixture()
    connection.onData(first.subarray(0, 10))
    connection.onData(Buffer.concat([first.subarray(10), second.subarray(0, split)]))
    connection.onData(second.subarray(split))
    assert.deepEqual(frames, [[1, 'first'], [2, 'second']], `split ${split}`)
  }
})

test('uitest resolves a control response following a JPEG in the same chunk', async () => {
  const { connection, frames } = fixture()
  let requestId
  connection.socket = { write(bytes) { requestId = bytes.readUInt32BE(Buffer.byteLength('_uitestkit_rpc_message_head_')) } }
  const response = connection.sendMessage({ method: 'getDisplaySize' })
  connection.onData(Buffer.concat([
    packet(1001, 'jpeg'),
    packet(requestId, JSON.stringify({ result: { width: 1080, height: 2400 } })),
    packet(1001, 'next-jpeg'),
  ]))
  assert.equal(connection.resolves.size, 0, 'control reply must not be lost')
  assert.deepEqual((await response).result, { width: 1080, height: 2400 })
  assert.deepEqual(frames, [[1001, 'jpeg'], [1001, 'next-jpeg']])
})

test('uitest handles bytewise fragmentation and separate complete messages', () => {
  const { connection, frames } = fixture()
  for (const byte of packet(1, 'fragmented')) connection.onData(Buffer.from([byte]))
  connection.onData(packet(2, 'complete'))
  assert.deepEqual(frames, [[1, 'fragmented'], [2, 'complete']])
})
