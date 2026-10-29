import http2 from 'node:http2'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash, randomBytes } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import getPort from 'licia/getPort'
import path from 'node:path'
import { GrpcMessages, NativeVideoFrame, parseVideoReply } from './nativeVideoProtocol'
import { loadNativeLibraries, supportsNativeVideo } from './nativeVideoResources'
import { NativeVideoPreference } from './nativeVideoPreference'
import { NativeOwner, NativeVideoOwnership } from './nativeVideoOwnership'

const execute = promisify(execFile)
const REMOTE_SOCKET = 'localabstract:scrcpy_grpc_socket'
// Match HOScrcpy's native target. A 60 request only delivered ~34 FPS on the
// measured device; 120 delivered ~60 FPS without reducing the image size.
const NATIVE_FRAME_RATE = 120

class NativeVideoFirstFrameTimeout extends Error {
  constructor() {
    super('Native video first frame timeout (the display may be idle)')
    this.name = 'NativeVideoFirstFrameTimeout'
  }
}

const isFirstFrameTimeout = (error: unknown) =>
  error instanceof Error && error.name === 'NativeVideoFirstFrameTimeout'

export async function connectNativeVideo(
  port: number,
  receive: (frame: NativeVideoFrame) => void,
  failed: (error: Error) => void,
) {
  const session = http2.connect(`http://127.0.0.1:${port}`)
  let stopping = false
  let ready = false
  let reported = false
  let rejectStart: (error: Error) => void
  let firstFrameTimer: ReturnType<typeof setTimeout>
  const fail = (error: Error) => {
    if (stopping || reported) return
    reported = true
    clearTimeout(firstFrameTimer)
    if (ready) { failed(error); session.destroy() }
    else rejectStart(error)
  }
  const request = (method: string) => session.request({
    ':method': 'POST', ':path': `/ScrcpyService/${method}`,
    'content-type': 'application/grpc', te: 'trailers',
  })
  session.on('error', fail)
  let stream: http2.ClientHttp2Stream
  const stop = async () => {
    if (stopping) return
    stopping = true
    clearTimeout(firstFrameTimer)
    try {
      if (session.destroyed || session.closed) throw new Error('Native video connection lost before stop')
      await new Promise<void>((resolve, reject) => {
        const end = request('onEnd')
        let status: string | undefined
        const timer = setTimeout(() => {
          reject(new Error('Native video stop timeout'))
          end.close()
        }, 2000)
        const check = (headers: http2.IncomingHttpHeaders) => {
          if (headers['grpc-status'] !== undefined) status = String(headers['grpc-status'])
        }
        end.on('response', check)
        end.on('trailers', check)
        end.on('error', reject)
        end.on('end', () => {
          if (status === '0') resolve()
          else reject(new Error('Native video gRPC stop unconfirmed'))
        })
        end.on('close', () => { clearTimeout(timer); reject(new Error('Native stop connection closed')) })
        end.resume()
        end.end(Buffer.alloc(5))
      })
    } finally {
      stream?.close()
      session.destroy()
    }
  }
  try {
    await new Promise<void>((resolve, reject) => {
      rejectStart = reject
      firstFrameTimer = setTimeout(() => fail(new NativeVideoFirstFrameTimeout()), 5000)
      stream = request('onStart')
      const parser = new GrpcMessages((bytes) => {
        const frame = parseVideoReply(bytes)
        if (!frame) return
        receive(frame)
        if (!ready && !frame.config) { ready = true; clearTimeout(firstFrameTimer); resolve() }
      })
      stream.on('response', (headers) => {
        if (headers[':status'] !== 200 || (headers['grpc-status'] && headers['grpc-status'] !== '0')) {
          fail(new Error('Native video gRPC start rejected'))
        }
      })
      stream.on('data', (bytes) => {
        if (stopping || reported) return
        try { parser.push(bytes) } catch (error) { fail(error as Error) }
      })
      stream.on('error', fail)
      stream.on('end', () => fail(new Error('Native video stream ended')))
      stream.on('close', () => fail(new Error('Native video stream closed')))
      stream.end(Buffer.alloc(5))
    })
  } catch (error) {
    // onStart may have created a virtual screen without sending any video.
    // Give that encoder its normal teardown before the owned process is killed.
    try { await stop() } catch { /* NativeVideo.stop still confirms process exit */ }
    throw error
  }
  return { stop }
}

interface Options { bin?: string; host?: string; port: number; connectKey: string; resourcesDir?: string; cacheDir?: string }

export class NativeVideo {
  private name?: string
  private port?: number
  private stream?: Awaited<ReturnType<typeof connectNativeVideo>>
  private forwarded = false
  private preferred?: string
  private preference?: NativeVideoPreference
  private preferenceIdentity?: string
  private prepared?: { divisor: number; candidate?: { file: string } }
  private ownership?: NativeVideoOwnership
  private recorded?: Omit<NativeOwner, 'hostPid'>
  private recoveredOwner?: NativeOwner
  constructor(private options: Options) {
    if (options.cacheDir) {
      const key = createHash('sha256').update(JSON.stringify([
        options.host || '127.0.0.1', options.port, options.connectKey,
      ])).digest('hex')
      this.ownership = new NativeVideoOwnership(path.join(options.cacheDir, 'sessions', key))
    }
  }
  async recoverOrphans() {
    await this.ownership?.recover(async owner => {
      const stale = new NativeVideo({ ...this.options, cacheDir: undefined })
      stale.run = args => this.run(args)
      stale.name = owner.name
      stale.recoveredOwner = owner
      // Verify any recorded forward still refers to this device and socket.
      if (owner.port) {
        const inventory = await this.run(['fport', 'ls'])
        if (inventory !== '[Empty]') {
          const rows = inventory.split(/\r?\n/).filter(Boolean).map(line => line.trim().split(/\s+/))
          if (!rows.length || rows.some(row => row.length !== 4 || row[3] !== '[Forward]')) {
            throw new Error('Native forward inventory unconfirmed')
          }
          stale.forwarded = rows.some(row => row[0] === this.options.connectKey &&
            row[1] === `tcp:${owner.port}` && row[2] === REMOTE_SOCKET)
          if (stale.forwarded) stale.port = owner.port
        }
      }
      await stale.stop()
    })
  }
  private async readStartTime(pid: string) {
    const stat = await this.shell(`cat /proc/${pid}/stat`)
    const started = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19]
    if (!stat.startsWith(`${pid} (`) || !/^\d+$/.test(started || '')) {
      throw new Error('Native process identity unconfirmed')
    }
    return started
  }
  private async recoveredSocketIsFree() {
    const inventory = await this.shell('cat /proc/net/unix && echo NATIVE_SOCKET_READ_COMPLETE')
    if (!inventory.endsWith('\nNATIVE_SOCKET_READ_COMPLETE')) throw new Error('Native socket inventory unconfirmed')
    const rows = inventory.slice(0, -'\nNATIVE_SOCKET_READ_COMPLETE'.length).split(/\r?\n/)
    if (!/^\s*Num\s+RefCount\s+Protocol\s+Flags\s+Type\s+St\s+Inode\s+Path\s*$/.test(rows.shift() || '') ||
      rows.filter(row => row.trim()).some(row => !/^\s*[a-f0-9]+:\s+[a-f0-9]+\s+[a-f0-9]+\s+[a-f0-9]+\s+[a-f0-9]+\s+[a-f0-9]+\s+\d+(?:\s+.*)?$/i.test(row))) {
      throw new Error('Native socket inventory unconfirmed')
    }
    return !inventory.includes('@scrcpy_grpc_socket')
  }
  private async run(args: string[]) {
    const { bin = 'hdc', host = '127.0.0.1', port, connectKey } = this.options
    const { stdout, stderr } = await execute(bin, ['-s', `${host}:${port}`, '-t', connectKey, ...args], {
      windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024,
    })
    if (/\[Fail\]|\[E\d{6}\]|permission denied|Error loading|\berror:|\bfailed\b/i.test(`${stdout}\n${stderr}`)) throw new Error('Native video device command failed')
    return stdout.trim()
  }
  private shell(command: string) { return this.run(['shell', command]) }
  private async candidates() {
    if (!this.options.resourcesDir) {
      // Compatibility for callers without packaged resources. Normal app
      // startup always supplies resourcesDir and never depends on this file.
      const available = await this.shell('test -f /data/local/tmp/libscreen_casting.z.so && echo available')
      return available === 'available' ? [undefined] : []
    }
    const [architecture, version, firmware] = await Promise.all([
      this.shell('uname -m'),
      this.shell('uitest --version'),
      this.shell('param get const.product.software.version').catch(() => ''),
    ])
    if (!supportsNativeVideo(architecture, version)) return []
    const identity = [this.options.connectKey, architecture, version, firmware]
    if (this.preferenceIdentity !== JSON.stringify(identity)) this.preferred = undefined
    this.preferenceIdentity = JSON.stringify(identity)
    // Do not persist a guess if the firmware cannot be identified.
    this.preference = new NativeVideoPreference(firmware ? this.options.cacheDir : undefined,
      identity)
    this.preferred = await this.preference.load() || this.preferred
    return loadNativeLibraries(this.options.resourcesDir, this.preferred)
  }
  private openStream(receive: (frame: NativeVideoFrame) => void, failed: (error: Error) => void) {
    return connectNativeVideo(this.port!, receive, failed)
  }
  async available() {
    return !(await this.shell('cat /proc/net/unix')).includes('@scrcpy_grpc_socket')
  }
  async prepare(scale: number, valid = () => true) {
    return this.launch(scale, () => {}, () => {}, true, valid)
  }
  async start(scale: number, receive: (frame: NativeVideoFrame) => void, failed: (error: Error) => void) {
    if (this.prepared?.divisor === this.divisor(scale)) {
      try {
        await this.activate(receive, failed)
        return true
      }
      catch (error) {
        console.warn('Prepared native video activation failed:', error)
        if (isFirstFrameTimeout(error)) { await this.stop(); return false }
        this.preferred = undefined
        await this.preference?.clear()
        await this.stop()
      }
    }
    return this.launch(scale, receive, failed)
  }
  private divisor(scale: number) { return Math.max(1, Math.min(5, Math.round(1 / scale))) }
  private async activate(receive: (frame: NativeVideoFrame) => void, failed: (error: Error) => void) {
    // Both a cold launch and a standby may lose their process while HDC sets
    // up the forward. Do not send onStart to a replacement socket owner.
    if (!(await this.ownedPids()).length) throw new Error('Native process exited before activation')
    const candidate = this.prepared?.candidate
    this.stream = await this.openStream(receive, failed)
    if (candidate) {
      this.preferred = candidate.file
      await this.preference?.save(candidate.file)
    }
    this.prepared = undefined
  }
  private async launch(scale: number, receive: (frame: NativeVideoFrame) => void,
    failed: (error: Error) => void, prepareOnly = false, valid = () => true) {
    if (this.prepared) await this.stop()
    if (!valid()) return false
    let candidates: Awaited<ReturnType<NativeVideo['candidates']>>
    try {
      candidates = await this.candidates()
      if (!candidates.length) {
        console.warn('Native video has no compatible resources for this device')
        return false
      }
    } catch (error) {
      console.warn('Native video preparation failed:', error)
      return false // no device resources have been created yet
    }
    for (const candidate of candidates) {
      if (!valid()) return false
      const check = () => { if (!valid()) throw new Error('Native preparation cancelled') }
      try {
        // Another tool may claim the fixed socket during a failed candidate's
        // cleanup, so preflight every attempt before creating any resources.
        if (!(await this.available())) {
          console.warn('Native video socket occupied by another session')
          return false
        }
        this.name = `scrcpy_harmony_${randomBytes(8).toString('hex')}.so`
        const remote = `/data/local/tmp/${this.name}`
        if (candidate) {
          // Use the platform's native path separators. HDC on Windows can
          // misinterpret mixed-separator source paths as directory transfers.
          await this.run(['file', 'send', path.normalize(candidate.path), remote])
          check()
          const digest = (await this.shell(`sha256sum ${remote}`)).split(/\s+/)[0]
          if (digest !== candidate.sha256) throw new Error('Deployed native library integrity check failed')
        } else {
          await this.shell(`cp /data/local/tmp/libscreen_casting.z.so ${remote}`)
        }
        check()
        const divisor = this.divisor(scale)
        await this.shell(`uitest start-daemon singleness --extension-name ${this.name} -scale ${divisor} -frameRate ${NATIVE_FRAME_RATE} -bitRate 8 -p 5011 -iFrameInterval 1000 -repeatInterval 100`)
        let listening = false
        let missingProcess = false
        for (let i = 0; i < 15; i++) {
          check()
          if ((await this.shell('cat /proc/net/unix')).includes('@scrcpy_grpc_socket')) {
            if (!(await this.ownedPids()).length) throw new Error('Native process exited before listening')
            listening = true
            break
          }
          // The daemon launcher can report success even when dlopen fails.
          // Confirm absence twice to allow the child to appear after launch.
          if (i > 0) {
            const alive = (await this.ownedPids()).length > 0
            if (!alive && missingProcess) throw new Error('Native video extension exited before listening')
            missingProcess = !alive
          }
          await delay(100)
        }
        if (!listening) throw new Error('Native video service unavailable')
        check()
        if (this.ownership) {
          const pids = await this.ownedPids()
          if (pids.length !== 1) throw new Error('Native process identity is ambiguous')
          this.recorded = { name: this.name, devicePid: pids[0], started: await this.readStartTime(pids[0]) }
          await this.ownership.save(this.recorded)
        }
        this.port = await getPort()
        if (this.recorded) {
          this.recorded.port = this.port
          await this.ownership!.save(this.recorded)
        }
        this.forwarded = true
        await this.run(['fport', `tcp:${this.port}`, REMOTE_SOCKET])
        check()
        this.prepared = { divisor, candidate }
        if (prepareOnly) {
          if (!(await this.ownedPids()).length) throw new Error('Native process exited during preparation')
          // A listening library is a useful in-memory hint after expiry, but
          // persist it only once an actual onStart stream has succeeded.
          if (candidate) this.preferred = candidate.file
        } else await this.activate(receive, failed)
        return true
      } catch (error) {
        if (valid()) console.warn('Native video candidate failed:', candidate?.file || 'device library', error)
        // No screen update is not evidence of an incompatible library. Keep a
        // proven preference and use the already-running JPEG preview instead
        // of waiting through the same timeout with every remaining candidate.
        if (isFirstFrameTimeout(error)) { await this.stop(); return false }
        if (candidate?.file === this.preferred) {
          this.preferred = undefined
          await this.preference?.clear()
        }
        // A failed candidate may have started a process. Confirm its cleanup
        // before probing another signed library or falling back to JPEG.
        await this.stop()
        if (!valid()) return false
      }
    }
    return false
  }
  private async ownedPids() {
    if (!this.name) return []
    let processes = await this.shell(this.recoveredOwner ? 'ps -ef && echo NATIVE_READ_COMPLETE' : 'ps -ef')
    if (this.recoveredOwner) {
      if (!processes.endsWith('\nNATIVE_READ_COMPLETE')) throw new Error('Native process inventory unconfirmed')
      processes = processes.slice(0, -'\nNATIVE_READ_COMPLETE'.length)
      const rows = processes.split(/\r?\n/).slice(1).filter(line => line.trim())
      if (rows.some(line => !/^\S+\s+\d+\s+\d+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S/.test(line.trim()))) {
        throw new Error('Native process inventory unconfirmed')
      }
    }
    if (!/^\s*(UID|USER)\s+PID\s+PPID\b/m.test(processes)) throw new Error('Native process inventory unconfirmed')
    return processes.split(/\r?\n/).filter((line) =>
      line.includes(`uitest start-daemon singleness --extension-name ${this.name} `),
    ).map((line) => line.trim().split(/\s+/)[1]).filter((pid) => /^\d+$/.test(pid))
  }
  async stop() {
    if (this.stream) {
      // A lost gRPC stop reply is compensated by confirming the owned process
      // has exited below. Never kill other uitest instances.
      try { await this.stream.stop() } catch { /* confirm via process exit */ }
      this.stream = undefined
    }
    const pids = await this.ownedPids()
    if (this.recoveredOwner && pids.length) {
      const owner = this.recoveredOwner
      if (pids.length !== 1 || pids[0] !== owner.devicePid || await this.readStartTime(pids[0]) !== owner.started) {
        throw new Error('Native process changed; refusing to stop a replacement')
      }
      const result = await this.shell(`stat=$(cat /proc/${owner.devicePid}/stat) || exit 1
rest=\${stat##*) }
set -- $rest
shift 19
[ "$1" = "${owner.started}" ] || exit 1
kill -9 ${owner.devicePid} && echo stopped`)
      if (result !== 'stopped') throw new Error('Native process stop unconfirmed')
    } else for (const pid of pids) await this.shell(`kill -9 ${pid}`)
    if (pids.length && (await this.ownedPids()).length) throw new Error('Native video process stop unconfirmed')
    if (this.recoveredOwner && this.forwarded && !await this.recoveredSocketIsFree()) {
      throw new Error('Native socket is still occupied; refusing to remove a possibly reused forward')
    }
    if (this.forwarded) {
      try {
        await this.run(['fport', 'rm', `tcp:${this.port}`, REMOTE_SOCKET])
      } catch (error) {
        // A disconnected/restarted HDC server may already have removed it.
        // Only a valid inventory confirming absence releases ownership.
        const inventory = await this.run(['fport', 'ls'])
        if (inventory !== '[Empty]') {
          const entries = inventory.split(/\r?\n/).filter(Boolean).map((line) => line.trim().split(/\s+/))
          if (!entries.length || entries.some((entry) =>
            entry.length !== 4 || entry[3] !== '[Forward]' ||
            (entry[1] === `tcp:${this.port}` && entry[2] === REMOTE_SOCKET),
          )) throw error
        }
      }
      this.forwarded = false
    }
    if (this.name) {
      await this.shell(`rm -f /data/local/tmp/${this.name}`)
      if (await this.shell(`test ! -e /data/local/tmp/${this.name} && echo removed`) !== 'removed') {
        throw new Error('Native file removal unconfirmed')
      }
      await this.ownership?.clear(this.name)
      this.name = undefined
    }
    this.recorded = undefined
    this.port = undefined
    this.prepared = undefined
  }
}
