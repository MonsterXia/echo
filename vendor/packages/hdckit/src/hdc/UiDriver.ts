import path from 'path'
import trim from 'licia/trim'
import contain from 'licia/contain'
import Target from './Target'
import cmpVersion from 'licia/cmpVersion'
import toNum from 'licia/toNum'
import getPort from 'licia/getPort'
import sleep from 'licia/sleep'
import net, { Socket } from 'node:net'
import { randomInt } from 'node:crypto'
import Emitter from 'licia/Emitter'
import singleton from 'licia/singleton'

const SDK_PATH = path.join(
  __dirname,
  '../../uitestkit_sdk/uitest_agent_v1.1.0.so'
)
const SDK_VERSION = '1.1.0'
const AGENT_PATH = '/data/local/tmp/agent.so'

export default class UiDriver extends Emitter {
  protected allowDaemonRestart = true
  private readonly target: Target
  private connection: Connection = null
  private driverName: string = ''
  private port: number = 0
  private sdkVersion = SDK_VERSION
  private sdkPath = SDK_PATH
  private captureScreenCallback: (sessionId: number, message: Buffer) => void =
    null
  constructor(target: Target, sdkPath?: string, sdkVersion?: string) {
    super()
    this.target = target
    if (sdkPath) {
      this.sdkPath = sdkPath
    }
    if (sdkVersion) {
      this.sdkVersion = sdkVersion
    }
  }
  async start() {
    let launched = false
    let uiTestPid = trim(await this.shell('pidof uitest'))
    if (uiTestPid && !/^\d+(?:\s+\d+)*$/.test(uiTestPid)) throw new Error('UITest process inventory unconfirmed')
    const shouldUpdateSdk = await this.shouldUpdateSdk()
    if (uiTestPid && shouldUpdateSdk && !this.allowDaemonRestart) {
      throw Object.assign(new Error('Background preparation cannot replace an existing UITest daemon'), {
        code: 'UITEST_SDK_UPDATE_REQUIRED',
      })
    }
    if (!uiTestPid || shouldUpdateSdk) {
      await this.shell('param set persist.ace.testmode.enabled 1')

      if (shouldUpdateSdk) {
        if (uiTestPid) {
          await this.shell(`kill -9 ${uiTestPid}`)
          uiTestPid = ''
        }
        await this.updateSdk()
      }

      if (!uiTestPid) {
        await this.shell('uitest start-daemon singleness')
        launched = true
      }
    }

    this.port = await this.forwardTcp(8012)
    return launched
  }
  async stop() {
    if (this.connection) {
      this.connection.end()
      this.connection = null
    }
    const uiTestPid = trim(await this.shell('pidof uitest'))
    if (uiTestPid && !/^\d+(?:\s+\d+)*$/.test(uiTestPid)) throw new Error('UITest process inventory unconfirmed')
    if (uiTestPid) {
      await this.shell(`kill -9 ${uiTestPid}`)
    }
  }
  protected closeControlConnection() {
    this.connection?.end()
    this.connection = null
  }
  // Caller must first confirm that the old device control process has ended.
  protected clearStoppedCapture() {
    this.closeControlConnection()
    if (this.captureScreenCallback) this.off('message', this.captureScreenCallback)
    this.captureScreenCallback = null
    this.driverName = ''
  }
  async startCaptureScreen(
    callback: (message: Buffer) => void,
    options: { scale: number } = { scale: 1 }
  ) {
    if (options.scale >= 1 || options.scale <= 0) {
      delete options.scale
    }
    const { sessionId } = await this.send('Captures', 'startCaptureScreen', {
      options,
    })
    if (this.captureScreenCallback) {
      throw new Error('Capture screen is already started')
    }
    this.captureScreenCallback = (id, message) => {
      if (id === sessionId) {
        callback(message)
      }
    }
    this.on('message', this.captureScreenCallback)
  }
  async stopCaptureScreen() {
    await this.send('Captures', 'stopCaptureScreen', {}, 3000)
    if (this.captureScreenCallback) {
      this.off('message', this.captureScreenCallback)
      this.captureScreenCallback = null
    }
  }
  captureLayout() {
    return this.send('Captures', 'captureLayout').then(({ result }) => result)
  }
  getDisplaySize() {
    return this.send('CtrlCmd', 'getDisplaySize').then(({ result }) => result)
  }
  async touchDown(x: number, y: number) {
    await this.send('Gestures', 'touchDown', { x, y })
  }
  async touchMove(x: number, y: number) {
    await this.send('Gestures', 'touchMove', { x, y })
  }
  async touchUp(x: number, y: number) {
    await this.send('Gestures', 'touchUp', { x, y })
  }
  async inputText(text: string, x = 0, y = 0) {
    await this.send('callHypiumApi', 'inputText', [{ x, y }, text])
  }
  private send = async (
    method: string,
    api: string,
    args: any = {},
    timeout = 10000
  ): Promise<any> => {
    // A missing reply has an unknown device-side result. Never replay input
    // or kill UITest here (the native video extension may share that process).
    const connection = await this.getConnection()
    const module = 'com.ohos.devicetest.hypiumApiHelper'
    const params = method === 'callHypiumApi'
      ? { api: `Driver.${api}`, this: this.driverName, args, message_type: 'hypium' }
      : { api, args }
    return connection.sendMessage({ module, method, params }, timeout)
  }

  private getConnection = singleton(async (): Promise<Connection> => {
    let { connection } = this

    if (!connection) {
      const launched = await this.start()
      const deadline = Date.now() + 3000
      // Only retry the read-only bootstrap handshake after our own launch.
      // HDC may accept TCP before the device daemon is ready. User RPCs are
      // never replayed and existing-server failures retain their normal path.
      for (;;) {
        connection = new Connection()
        const candidate = connection
        connection.setOnClose(() => {
          if (this.connection === candidate) this.connection = null
        })
        connection.setOnMessage((sessionId, message) => {
          this.emit('message', sessionId, message)
        })
        try {
          await connection.connect(this.port, launched ? Math.max(1, Math.min(1000, deadline - Date.now())) : 3000)
          const { result } = await connection.sendMessage(
            {
              module: 'com.ohos.devicetest.hypiumApiHelper',
              method: 'callHypiumApi',
              params: {
                api: 'Driver.create',
                this: null,
                args: [],
                message_type: 'hypium',
              },
            },
            launched ? Math.max(1, Math.min(1000, deadline - Date.now())) : 1000
          )
          this.driverName = result
          this.connection = connection
          break
        } catch (error) {
          connection.end()
          if (!launched || Date.now() >= deadline) throw error
          await sleep(Math.min(50, deadline - Date.now()))
        }
      }
    }

    return connection
  })
  private async forwardTcp(p: number) {
    const { target } = this
    const remote = `tcp:${p}`
    const forwards = await target.listForwards()

    for (let i = 0, len = forwards.length; i < len; i++) {
      const forward = forwards[i]
      if (forward.remote === remote) {
        return toNum(forward.local.replace('tcp:', ''))
      }
    }

    const port = await getPort()
    const local = `tcp:${port}`
    await target.forward(local, remote)

    return port
  }
  private async shouldUpdateSdk() {
    const output = trim(await this.shell(
      `if [ -f ${AGENT_PATH} ]; then grep -a UITEST_AGENT_LIBRARY ${AGENT_PATH}; result=$?; [ "$result" -le 1 ] && echo UITEST_AGENT_INSPECTED; elif [ ! -e ${AGENT_PATH} ]; then echo UITEST_AGENT_MISSING; fi`
    ))
    if (output === 'UITEST_AGENT_MISSING') return true
    if (!output.endsWith('UITEST_AGENT_INSPECTED')) throw new Error('UITest SDK inspection unconfirmed')
    const result = trim(output.slice(0, -'UITEST_AGENT_INSPECTED'.length))
    if (!contain(result, 'UITEST_AGENT_LIBRARY')) {
      return true
    }
    const deviceSdkVersion = getSdkVersion(result)
    if (!/^\d+(?:\.\d+)+$/.test(deviceSdkVersion)) throw new Error('UITest SDK version unconfirmed')
    return cmpVersion(deviceSdkVersion, this.sdkVersion) < 0
  }
  private async updateSdk() {
    await this.shell(`rm ${AGENT_PATH}`)
    await this.target.sendFile(this.sdkPath, AGENT_PATH)
  }
  private async shell(command: string) {
    const connection = await this.target.shell(command)
    const output = (await connection.readAll()).toString()
    if (/\[Fail\]|\[E\d{6}\]|permission denied/i.test(output)) throw new Error('UITest device command failed')
    return output
  }
}

const HEADER_BYTES = Buffer.from('_uitestkit_rpc_message_head_')
const TAILER_BYTES = Buffer.from('_uitestkit_rpc_message_tail_')

type OnMessage = (sessionId: number, message: Buffer) => void

class UiTestTransportError extends Error {
  readonly code = 'UITEST_TRANSPORT'
}

class Connection {
  socket!: Socket
  private onMessage: OnMessage
  private ended = false
  private onClose?: () => void
  private sequence = randomInt(0, 0x7fffffff)
  private connectReject?: (error: Error) => void
  private connectTimer?: ReturnType<typeof setTimeout>
  private timers = new Map<number, ReturnType<typeof setTimeout>>()
  private resolves: Map<number, (value?: any) => void> = new Map()
  private rejects: Map<number, (reason?: any) => void> = new Map()
  private buffer: Buffer = Buffer.alloc(0)
  connect(port: number, timeout = 3000) {
    const socket = net.connect({
      host: '127.0.0.1',
      port,
    })
    socket.setNoDelay(true)

    this.socket = socket

    return new Promise((resolve, reject) => {
      this.connectReject = reject
      this.connectTimer = setTimeout(() => this.fail(new Error('UITest connection timed out')), timeout)
      socket.once('connect', () => {
        clearTimeout(this.connectTimer)
        this.connectReject = undefined
        if (this.ended) return
        socket.on('data', this.onData)
        resolve(null)
      })
      socket.on('error', error => this.fail(error))
      socket.once('end', () => this.fail(new Error('UITest connection ended')))
      socket.once('close', () => this.fail(new Error('UITest connection closed')))
    })
  }
  setOnMessage(onMessage: OnMessage) {
    this.onMessage = onMessage
  }
  setOnClose(onClose: () => void) {
    this.onClose = onClose
  }
  sendMessage(
    message: any,
    timeout = 10000
  ): Promise<{ sessionId: number; result: any }> {
    if (this.ended) return Promise.reject(new UiTestTransportError('UITest connection closed'))
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 2147483647) {
      return Promise.reject(new Error('Invalid UITest request timeout'))
    }
    // Identify the RPC, never its arguments (which may contain typed text).
    const api = [message.method, message.params?.api]
      .filter(value => typeof value === 'string' && /^[\w.]{1,80}$/.test(value)).join('.') || 'request'
    message = JSON.stringify(message)
    // Identical commands in one clock tick must not overwrite pending requests.
    const sessionId = ++this.sequence
    if (sessionId > 0xffffffff) {
      this.end()
      return Promise.reject(new Error('UITest request IDs exhausted'))
    }
    const sessionIdBuf = Buffer.alloc(4)
    sessionIdBuf.writeUInt32BE(sessionId, 0)
    return new Promise((resolve, reject) => {
      this.resolves.set(sessionId, resolve)
      this.rejects.set(sessionId, error => reject(error instanceof UiTestTransportError
        ? new UiTestTransportError(`${error.message} [${api}]`) : error))
      this.timers.set(sessionId, setTimeout(() => {
        this.fail(new Error('UITest request timed out'))
      }, timeout))
      try {
        this.sendRawMessage(sessionIdBuf, Buffer.from(message))
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }
  sendRawMessage(sessonId: Buffer, message: Buffer) {
    if (this.ended) {
      throw new Error('ended')
    }
    const buffers: Buffer[] = []
    buffers.push(HEADER_BYTES)
    buffers.push(sessonId)
    const len = Buffer.alloc(4)
    len.writeUInt32BE(message.length, 0)
    buffers.push(len)
    buffers.push(message)
    buffers.push(TAILER_BYTES)
    this.socket.write(Buffer.concat(buffers))
  }
  end() {
    this.fail(new Error('UITest connection closed'))
  }
  private fail(error: Error) {
    if (this.ended) return
    error = new UiTestTransportError(error.message)
    this.ended = true
    clearTimeout(this.connectTimer)
    this.connectReject?.(error)
    this.connectReject = undefined
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    for (const reject of this.rejects.values()) reject(error)
    this.resolves.clear()
    this.rejects.clear()
    this.buffer = Buffer.alloc(0)
    this.socket?.destroy()
    this.onClose?.()
  }
  private onData = (data: Buffer) => {
    if (this.ended) return
    let buffer = this.buffer
    buffer = Buffer.concat([buffer, data])

    while (buffer.length >= HEADER_BYTES.length + 8) {
      const headerBytes = buffer.subarray(0, HEADER_BYTES.length)
      if (headerBytes.compare(HEADER_BYTES) !== 0) {
        buffer = Buffer.alloc(0)
        break
      }

      if (buffer.length < HEADER_BYTES.length + 8) {
        break
      }

      const sessionId = buffer.readUInt32BE(HEADER_BYTES.length)
      const len = buffer.readUInt32BE(HEADER_BYTES.length + 4)

      const totalLength = HEADER_BYTES.length + 8 + len + TAILER_BYTES.length
      if (buffer.length < totalLength) {
        break
      }

      const start = HEADER_BYTES.length + 8
      const end = start + len
      const message = buffer.subarray(start, end)

      const tailerBytes = buffer.subarray(end, end + TAILER_BYTES.length)
      if (tailerBytes.compare(TAILER_BYTES) !== 0) {
        buffer = Buffer.alloc(0)
        break
      }

      const resolve = this.resolves.get(sessionId)
      const reject = this.rejects.get(sessionId)
      if (resolve) {
        clearTimeout(this.timers.get(sessionId))
        this.timers.delete(sessionId)
        try {
          const result = JSON.parse(message.toString())
          if (result.exception) {
            reject(new Error(result.exception.message))
          } else {
            resolve({ sessionId, result: result.result })
          }
          // eslint-disable-next-line
        } catch (e) {
          resolve({ sessionId, result: message })
        }
        this.resolves.delete(sessionId)
        this.rejects.delete(sessionId)
      } else if (this.onMessage) {
        this.onMessage(sessionId, message)
      }

      // Consume the merged input, including this data event. Using the old
      // buffer here discards coalesced messages and partial next frames.
      buffer = buffer.subarray(totalLength)
    }

    this.buffer = buffer
  }
}

function getSdkVersion(raw: string) {
  return trim(raw.slice(raw.indexOf('@v') + 2))
}
