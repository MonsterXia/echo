import net from 'node:net'
import { once } from 'node:events'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'

type Stage = 'connect' | 'handshake' | 'ready' | 'send' | 'read'

export interface FiniteShellOptions {
  // Explicit endpoint of an already running server; no service lifecycle here.
  host: string
  port: number
  timeoutMs: number
  signal?: AbortSignal
}

export class FiniteShellError extends Error {
  constructor(
    public readonly code: string,
    public readonly stage: Stage
  ) {
    super(`${code} during ${stage}`)
    this.name = 'FiniteShellError'
  }
}

const MAX_BYTES = 16 * 1024 * 1024
const MAX_TIMEOUT = 2 ** 31 - 1

// Opt-in adapter, not yet wired to base.shell. Wire framing follows the locked
// hdckit 0.12.1 protocol: uint32-BE length, 12-byte banner + 32-byte target reply,
// ready probe on its own channel, then one finite shell command ending at EOF.
// No hdckit private state, automatic server start, shared socket or command retry.
export async function runFiniteShell(
  connectKey: string,
  command: string,
  options: FiniteShellOptions
): Promise<string> {
  if (
    !connectKey.trim() ||
    connectKey.includes('\0') ||
    Buffer.byteLength(connectKey) > 32
  ) {
    throw new TypeError('Invalid connectKey (1–32 UTF-8 bytes, no NUL)')
  }
  if (
    !Number.isInteger(options.timeoutMs) ||
    options.timeoutMs <= 0 ||
    options.timeoutMs > MAX_TIMEOUT
  ) {
    throw new RangeError('Invalid timeoutMs')
  }
  if (!net.isIP(options.host)) throw new TypeError('host must be an IP address')
  if (
    !Number.isInteger(options.port) ||
    options.port <= 0 ||
    options.port > 65535
  ) {
    throw new RangeError('Invalid port')
  }
  if (
    !command.trim() ||
    command.includes('\0') ||
    Buffer.byteLength(command) + 6 > MAX_BYTES
  ) {
    throw new TypeError('Invalid command')
  }

  let stage: Stage = 'connect'
  const controller = new AbortController()
  const { signal } = controller
  const deadline = performance.now() + options.timeoutMs
  const timeout = () =>
    controller.abort(new FiniteShellError('HDC_COMMAND_TIMEOUT', stage))
  const abort = () =>
    controller.abort(new FiniteShellError('HDC_COMMAND_ABORTED', stage))
  const timer = setTimeout(timeout, options.timeoutMs)
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) abort()

  function check() {
    // A busy event loop can delay the timer; never send a new frame after the
    // budget has expired merely because its timer callback has not run yet.
    if (performance.now() >= deadline) timeout()
    signal.throwIfAborted()
  }
  function protocolError() {
    return new FiniteShellError('HDC_COMMAND_PROTOCOL', stage)
  }

  async function exchange(cmd: string, probing: boolean): Promise<Buffer> {
    check()
    stage = 'connect'
    const socket = new net.Socket()
    const closed = new Promise<void>((resolve) => socket.once('close', resolve))
    // Keep errors handled between connect, writes and iterator reads as well.
    const onError = () => {}
    socket.on('error', onError)
    const destroy = () => socket.destroy(signal.reason)
    signal.addEventListener('abort', destroy, { once: true })
    const frames = readFrames(socket, protocolError)
    try {
      check()
      const connected = once(socket, 'connect', { signal })
      socket.connect({ host: options.host, port: options.port })
      socket.setNoDelay(true)
      await connected
      check()
      stage = 'handshake'
      const hello = await frames.next()
      check()
      if (
        hello.done ||
        // Legacy hello and the full hello observed on a real HDC server.
        // Keep unsupported lengths rejected; trailing bytes are never echoed.
        (hello.value.length !== 16 && hello.value.length !== 44) ||
        hello.value.subarray(0, 8).toString() !== 'OHOS HDC'
      ) {
        throw protocolError()
      }
      const reply = Buffer.alloc(44)
      hello.value.copy(reply, 0, 0, 12)
      reply.write(connectKey, 12)
      await write(reply)
      check()
      stage = probing ? 'ready' : 'send'
      await write(Buffer.from(`shell ${cmd}`))
      check()
      stage = probing ? 'ready' : 'read'
      const output: Buffer[] = []
      let size = 0
      for await (const frame of frames) {
        check()
        size += frame.length
        if (size > MAX_BYTES) throw protocolError()
        if (frame.length) output.push(frame)
      }
      check()
      return Buffer.concat(output, size)
    } finally {
      // Wait for local close before exposing completion. Destroy rather than
      // half-close; the peer's FIN/EOF is not required for cancellation.
      socket.destroy()
      await frames.return(undefined).catch(() => undefined)
      await closed
      signal.removeEventListener('abort', destroy)
      socket.removeAllListeners()
    }

    async function write(data: Buffer) {
      check()
      await new Promise<void>((resolve, reject) => {
        const aborted = () => finish(signal.reason)
        const finish = (error?: unknown) => {
          signal.removeEventListener('abort', aborted)
          if (error) reject(error)
          else resolve()
        }
        signal.addEventListener('abort', aborted, { once: true })
        const header = Buffer.alloc(4)
        header.writeUInt32BE(data.length)
        try {
          socket.write(Buffer.concat([header, data]), finish)
        } catch (error) {
          finish(error)
        }
      })
    }
  }

  try {
    while (true) {
      const ready = await exchange('echo ready\n', true)
      check()
      if (!ready.toString().includes('E000004')) break
      stage = 'ready'
      await delay(1000, undefined, { signal })
    }
    const result = await exchange(command, false)
    check()
    return result.toString()
  } catch (error) {
    // Preserve the first cancellation reason, even if close/error/EOF races it.
    if (signal.aborted) throw signal.reason
    throw error
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}

async function* readFrames(socket: net.Socket, error: () => Error) {
  let buffered: Buffer = Buffer.alloc(0)
  for await (const chunk of socket) {
    buffered = Buffer.concat([buffered, chunk])
    while (buffered.length >= 4) {
      const size = buffered.readUInt32BE(0)
      if (size > MAX_BYTES) throw error()
      if (buffered.length < size + 4) break
      const frame = buffered.subarray(4, size + 4)
      buffered = buffered.subarray(size + 4)
      yield frame
    }
  }
  // A clean EOF is only successful between complete frames, never mid-frame.
  if (buffered.length) throw error()
}
