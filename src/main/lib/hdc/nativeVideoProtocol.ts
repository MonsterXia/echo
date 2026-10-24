// HOScrcpy's protobuf payload map, transported as uncompressed gRPC messages.
// Only the fields needed for video are decoded; unknown fields are skipped.
export interface NativeVideoFrame {
  data: Buffer
  timestamp: number
  config: boolean
  keyFrame: boolean
}

const MAX_MESSAGE = 8 * 1024 * 1024

export class GrpcMessages {
  private header = Buffer.alloc(5)
  private body?: Buffer
  private offset = 0
  constructor(private receive: (message: Buffer) => void) {}
  push(chunk: Buffer) {
    while (chunk.length) {
      const target = this.body || this.header
      const size = Math.min(target.length - this.offset, chunk.length)
      chunk.copy(target, this.offset, 0, size)
      chunk = chunk.subarray(size)
      this.offset += size
      if (this.offset !== target.length) continue
      this.offset = 0
      if (this.body) {
        this.body = undefined
        this.receive(target)
      } else {
        if (this.header[0]) throw new Error('Unexpected compressed gRPC video')
        const length = this.header.readUInt32BE(1)
        if (length > MAX_MESSAGE) throw new Error('gRPC video message too large')
        if (length) this.body = Buffer.allocUnsafe(length)
        else this.receive(Buffer.alloc(0))
      }
    }
  }
}

function fields(bytes: Buffer) {
  let offset = 0
  const output = new Map<number, Array<Buffer | number>>()
  const varint = () => {
    let value = 0n
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (offset >= bytes.length) throw new Error('truncated protobuf varint')
      const byte = bytes[offset++]
      value |= BigInt(byte & 127) << shift
      if (!(byte & 128)) {
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new Error('protobuf integer exceeds safe range')
        }
        return Number(value)
      }
    }
    throw new Error('Invalid protobuf varint')
  }
  while (offset < bytes.length) {
    const tag = varint()
    const field = Math.floor(tag / 8)
    const wire = tag & 7
    if (!field) throw new Error('Invalid protobuf field')
    let value: Buffer | number
    if (wire === 0) value = varint()
    else {
      const length = wire === 2 ? varint() : wire === 1 ? 8 : wire === 5 ? 4 : -1
      if (length < 0) throw new Error('Unsupported protobuf wire type')
      if (length > bytes.length - offset) throw new Error('truncated protobuf field')
      value = bytes.subarray(offset, offset + length)
      offset += length
    }
    const values = output.get(field) || []
    values.push(value)
    output.set(field, values)
  }
  return output
}

export function parseVideoReply(message: Buffer): NativeVideoFrame | null {
  const payload = new Map<string, Map<number, Array<Buffer | number>>>()
  for (const entry of fields(message).get(3) || []) {
    if (!Buffer.isBuffer(entry)) continue
    const pair = fields(entry)
    const key = pair.get(1)?.[0]
    const value = pair.get(2)?.[0]
    if (Buffer.isBuffer(key) && Buffer.isBuffer(value)) {
      payload.set(key.toString(), fields(value))
    }
  }
  const data = payload.get('data')?.get(5)?.[0]
  if (!Buffer.isBuffer(data) || !data.length) return null
  const timestamp = payload.get('pts')?.get(1)?.[0] ?? 0
  const flags = payload.get('flags')?.get(1)?.[0] ?? 0
  if (typeof timestamp !== 'number' || typeof flags !== 'number') {
    throw new Error('Invalid video timestamp or flags')
  }
  return { data, timestamp, config: !!(flags & 1), keyFrame: !!(flags & 2) }
}
