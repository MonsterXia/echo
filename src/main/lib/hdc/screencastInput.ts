import { runFiniteShell } from './finiteShell'
import type { ScreencastInputAction } from 'common/types'

export function validateScreencastInput(action: ScreencastInputAction) {
  if (!action || typeof action !== 'object') throw new Error('Invalid input')
  if (action.type === 'text') {
    if (typeof action.text !== 'string' || action.text.includes('\0') ||
      Buffer.byteLength(action.text, 'utf8') > 65536) throw new Error('Invalid input text')
  } else if (action.type === 'keys') {
    if (!Array.isArray(action.keys) || action.keys.length < 1 || action.keys.length > 3 ||
      action.keys.some(key => !Number.isInteger(key) || key < 2000 || key > 2117)) {
      throw new Error('Invalid input keys')
    }
  } else throw new Error('Invalid input action')
}

export async function sendScreencastInput(connectKey: string, action: ScreencastInputAction,
  endpoint: { host?: string; port: number }, signal?: AbortSignal) {
  validateScreencastInput(action)
  if (action.type === 'text' && !action.text) return
  // Single-quote all text; quotes, newlines, dollars and shell operators remain
  // data. The focus-only command never clicks a coordinate or clears the field.
  const command = action.type === 'text'
    ? `uitest uiInput text '${action.text.replace(/'/g, "'\"'\"'")}'`
    : `uinput -K ${action.keys.map(key => `-d ${key}`).join(' ')} ${[...action.keys].reverse().map(key => `-u ${key}`).join(' ')}`
  const output = await runFiniteShell(connectKey, `${command}; printf '\\nSH_INPUT_EXIT:%s\\n' "$?"`, {
    host: endpoint.host || '127.0.0.1', port: endpoint.port, timeoutMs: 10000, signal,
  })
  if (!/\nSH_INPUT_EXIT:0\r?\n?$/.test(output) ||
    /\[Fail\]|\[E\d{6}\]|error|failed|not support|invalid|illegal|permission denied/i.test(
      output.replace(/^No Error\r?$/gm, '').replace(/\nSH_INPUT_EXIT:0\r?\n?$/, ''))) {
    throw new Error('Device input failed')
  }
}
