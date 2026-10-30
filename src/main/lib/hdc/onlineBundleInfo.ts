import axios from 'axios'
import { Agent } from 'node:https'

interface OnlineBundleInfo { name?: string; icon?: string }
const INFO_URL = 'https://web-drcn.hispace.dbankcloud.com/edge/webedge/appinfo'
const REQUEST_TIMEOUT = 3000
const RETRY_DELAY = 30000
const cache = new Map<string, { value: OnlineBundleInfo; expires: number }>()
const pending = new Map<string, Promise<OnlineBundleInfo>>()
let active: Promise<void> | undefined
let retryAfter = 0

function cached(name: string) {
  const entry = cache.get(name)
  if (entry && entry.expires > Date.now()) return entry.value
  cache.delete(name)
}

function remember(name: string, value: OnlineBundleInfo) {
  if (cache.size >= 500) cache.delete(cache.keys().next().value!)
  cache.set(name, {
    value,
    expires: Date.now() + (value.name || value.icon ? 3600000 : 300000),
  })
  return value
}

function failureCode(error: unknown) {
  const { code, response } = (error || {}) as { code?: string; response?: { status?: number } }
  const status = response?.status
  if (Number.isInteger(status) && status! >= 400 && status! <= 599) return `HTTP_${status}`
  return ['ETIMEDOUT', 'ECONNABORTED', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN',
    'ERR_CANCELED', 'ERR_NETWORK', 'ERR_BAD_RESPONSE', 'INVALID_RESPONSE'].includes(code || '') ? code! : 'NETWORK_ERROR'
}

async function request(name: string): Promise<OnlineBundleInfo> {
  // A single service request at a time also makes the first failure open the
  // cooldown for concurrent batches, rather than timing out once per app.
  while (active) await active
  const existing = cached(name)
  if (existing) return existing
  if (Date.now() < retryAfter) return {}
  let release!: () => void
  active = new Promise<void>(resolve => { release = resolve })
  const controller = new AbortController()
  // Axios's CONNECT agent forwards these connection options to net/tls. Its
  // request signal alone cannot cancel a proxy socket awaiting the handshake.
  // Keep the agent and its signal request-scoped, never abort a shared agent.
  const agentOptions = { keepAlive: false, signal: controller.signal }
  const httpsAgent = new Agent(agentOptions)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(Object.assign(new Error('Store deadline exceeded'), { code: 'ETIMEDOUT' }))
        controller.abort()
      }, REQUEST_TIMEOUT)
    })
    const { data } = await Promise.race([axios.post(INFO_URL, {
      pkgName: name, appId: name, locale: 'zh_CN', countryCode: 'CN', orderApp: 1,
    }, {
      timeout: REQUEST_TIMEOUT,
      signal: controller.signal,
      httpsAgent,
      maxContentLength: 256 * 1024,
    }), deadline])
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw Object.assign(new Error('Invalid store response'), { code: 'INVALID_RESPONSE' })
    }
    const value: OnlineBundleInfo = {}
    if (typeof data.name === 'string' && data.name.trim() && data.name.length <= 256 && !Array.from(data.name as string).some(char => char.charCodeAt(0) < 32)) value.name = data.name.trim()
    if (typeof data.icon === 'string' && data.icon.trim() && data.icon.length <= 8192) value.icon = data.icon.trim()
    return remember(name, value)
  } catch (error) {
    const code = failureCode(error)
    if (code === 'HTTP_404') remember(name, {})
    else retryAfter = Date.now() + RETRY_DELAY
    // Never expose Axios request/config objects, proxy credentials or URLs to
    // the caller's logger. A missing store entry isn't a device metadata error.
    throw new Error(`Application store metadata unavailable (${code})`)
  } finally {
    clearTimeout(timer)
    controller.abort()
    httpsAgent.destroy()
    active = undefined
    release()
  }
}

export function getOnlineBundleInfo(name: string): Promise<OnlineBundleInfo> {
  const existing = cached(name)
  if (existing) return Promise.resolve(existing)
  const inFlight = pending.get(name)
  if (inFlight) return inFlight
  const task = request(name).finally(() => { pending.delete(name) })
  pending.set(name, task)
  return task
}
