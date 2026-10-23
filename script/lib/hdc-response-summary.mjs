const COMMANDS = new Set([
  'alive',
  'list targets',
  'fport ls',
  'shell echo ready\n',
  'shell param get',
  'shell SP_daemon -deviceinfo',
  'shell uname -a',
  'shell cat /proc/meminfo',
  'shell hidumper -s RenderService -a screen',
])

// These patterns have no internal occurrence of their first byte, so a failed
// prefix can only restart at the current byte. No response bytes are retained.
function advance(pattern, position, byte) {
  return byte === pattern.charCodeAt(position)
    ? position + 1
    : byte === pattern.charCodeAt(0) ? 1 : 0
}

function whitespace(byte) {
  return byte === 32 || (byte >= 9 && byte <= 13)
}

/** Summarize complete HDC payloads without retaining or exposing their text. */
export function createResponseSummary(command) {
  if (!COMMANDS.has(command)) throw new TypeError('Unsupported diagnostic command')
  const shell = command.startsWith('shell ')
  const echo = command === 'shell echo ready\n'
  let bytes = 0
  let frames = 0
  let failPosition = 0
  let errorPosition = 0
  let targetPosition = 0
  let codePosition = 0
  let commandError = false
  let targetNotReady = false
  // Echo accepts only ASCII whitespace around the exact word "ready".
  let readyPosition = 0
  let readyInvalid = false

  return {
    accept(payload) {
      if (!Buffer.isBuffer(payload)) throw new TypeError('Expected a payload Buffer')
      bytes += payload.length
      frames += 1
      if (!shell) return
      for (let index = 0; index < payload.length; index += 1) {
        const byte = payload[index]
        if (!targetNotReady) {
          targetPosition = advance('[E000004]', targetPosition, byte)
          if (targetPosition === 9) targetNotReady = true
        }
        if (!commandError) {
          failPosition = advance('[Fail]', failPosition, byte)
          const lower = byte >= 65 && byte <= 90 ? byte + 32 : byte
          errorPosition = advance('error:', errorPosition, lower)
          if (codePosition === 0) codePosition = byte === 91 ? 1 : 0
          else if (codePosition === 1 && byte === 69) codePosition = 2
          else if (codePosition >= 2 && codePosition <= 7 && byte >= 48 && byte <= 57) codePosition += 1
          else if (codePosition === 8 && byte === 93) commandError = true
          else codePosition = byte === 91 ? 1 : 0
          if (failPosition === 6 || errorPosition === 6) commandError = true
        }
        if (echo && !readyInvalid) {
          if (readyPosition === 0 && whitespace(byte)) continue
          if (readyPosition === 5 && whitespace(byte)) continue
          if (readyPosition < 5 && byte === 'ready'.charCodeAt(readyPosition)) readyPosition += 1
          else readyInvalid = true
        }
      }
    },
    result() {
      let category = 'unclassified'
      if (shell) {
        if (targetNotReady) category = 'target-not-ready'
        else if (commandError) category = 'command-error'
        else if (bytes === 0) category = 'empty-output'
        else if (echo) category = !readyInvalid && readyPosition === 5 ? 'echo-ready' : 'echo-unexpected-output'
        else category = 'output'
      }
      return { category, bytes, frames }
    },
  }
}
