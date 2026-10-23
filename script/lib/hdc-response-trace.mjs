import { createResponseSummary } from './hdc-response-summary.mjs'

const MAX_FRAME_BYTES = 16 * 1024 * 1024
const EMPTY_PAYLOAD = Buffer.alloc(0)

/** Observe framed response bytes without changing input or controlling transport. */
export function createResponseTrace(command) {
  const summary = createResponseSummary(command)
  const header = Buffer.alloc(4)
  let headerBytes = 0
  let payload = null
  let payloadBytes = 0
  let invalidFraming = false
  let parsingDisabled = false

  function disable() {
    parsingDisabled = true
    headerBytes = 0
    payload = null
    payloadBytes = 0
  }

  return {
    accept(chunk) {
      if (parsingDisabled) return
      if (!Buffer.isBuffer(chunk)) throw new TypeError('Expected a response Buffer')
      let offset = 0
      while (offset < chunk.length) {
        if (payload === null) {
          const count = Math.min(4 - headerBytes, chunk.length - offset)
          chunk.copy(header, headerBytes, offset, offset + count)
          headerBytes += count
          offset += count
          if (headerBytes < 4) continue
          const size = header.readUInt32BE(0)
          headerBytes = 0
          if (size > MAX_FRAME_BYTES) {
            invalidFraming = true
            disable()
            return
          }
          if (size === 0) {
            summary.accept(EMPTY_PAYLOAD)
            continue
          }
          // Retain at most one bounded frame, never a view of the input chunk.
          payload = Buffer.allocUnsafe(size)
        }
        const count = Math.min(payload.length - payloadBytes, chunk.length - offset)
        chunk.copy(payload, payloadBytes, offset, offset + count)
        payloadBytes += count
        offset += count
        if (payloadBytes === payload.length) {
          summary.accept(payload)
          payload = null
          payloadBytes = 0
        }
      }
    },
    disable,
    result() {
      return {
        response: summary.result(),
        // Disabled parsers discard pending data; the separate flags explain why.
        partialFrameAtClose: headerBytes > 0 || payload !== null,
        invalidFraming,
        parsingDisabled,
      }
    },
  }
}
