export interface H264Metadata {
  timestamp: number
  config?: boolean
  keyFrame?: boolean
}

function nalUnits(data: Uint8Array) {
  const starts: Array<{ start: number; body: number }> = []
  for (let i = 0; i + 3 < data.length; i++) {
    if (data[i] || data[i + 1]) continue
    const prefix = data[i + 2] === 1 ? 3 : data[i + 2] === 0 && data[i + 3] === 1 ? 4 : 0
    if (prefix) {
      starts.push({ start: i, body: i + prefix })
      i += prefix - 1
    }
  }
  return starts.map((entry, i) => ({
    ...entry,
    type: data[entry.body] & 31,
    data: data.subarray(entry.start, starts[i + 1]?.start ?? data.length),
  }))
}

export default class H264Decoder {
  private decoder?: VideoDecoder
  private sps?: Uint8Array
  private pps?: Uint8Array
  private codec?: string
  private waitingForKey = true
  private destroyed = false
  constructor(
    private output: (frame: VideoFrame) => void,
    private error: (error: Error) => void,
  ) {}
  push(data: Uint8Array, metadata: H264Metadata) {
    if (this.destroyed) return
    try {
      const units = nalUnits(data)
      for (const unit of units) {
        if (unit.type !== 7 && unit.type !== 8) continue
        const previous = unit.type === 7 ? this.sps : this.pps
        if (previous?.length === unit.data.length && previous.every((b, i) => b === unit.data[i])) continue
        this.reset()
        if (unit.type === 7) {
          this.sps = unit.data.slice()
          if (unit.body + 3 >= data.length) throw new Error('Truncated H.264 SPS')
          this.codec = 'avc1.' + Array.from(data.subarray(unit.body + 1, unit.body + 4))
            .map((b) => b.toString(16).padStart(2, '0')).join('')
        } else this.pps = unit.data.slice()
      }
      if (metadata.config || !this.codec || !this.sps || !this.pps) return
      const key = metadata.keyFrame || units.some((unit) => unit.type === 5)
      if (this.decoder && this.decoder.decodeQueueSize >= 4) this.reset()
      if (this.waitingForKey && !key) return
      if (!this.decoder) {
        const decoder = new VideoDecoder({
          output: (frame) => {
            if (this.destroyed || this.decoder !== decoder) frame.close()
            else this.output(frame)
          },
          error: (error) => {
            if (this.destroyed || this.decoder !== decoder) return
            this.reset()
            this.error(error)
          },
        })
        this.decoder = decoder
        decoder.configure({ codec: this.codec, optimizeForLatency: true })
      }
      let chunkData = data
      if (this.waitingForKey) {
        chunkData = new Uint8Array(this.sps.length + this.pps.length + data.length)
        chunkData.set(this.sps)
        chunkData.set(this.pps, this.sps.length)
        chunkData.set(data, this.sps.length + this.pps.length)
      }
      this.decoder.decode(new EncodedVideoChunk({
        type: key ? 'key' : 'delta', timestamp: metadata.timestamp, data: chunkData,
      }))
      this.waitingForKey = false
    } catch (error) {
      this.reset()
      this.error(error as Error)
    }
  }
  private reset() {
    if (this.decoder?.state !== 'closed') this.decoder?.close()
    this.decoder = undefined
    this.waitingForKey = true
  }
  destroy() {
    this.destroyed = true
    this.reset()
    this.sps = this.pps = undefined
  }
}
