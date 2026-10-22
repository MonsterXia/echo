import singleton from 'licia/singleton'
import axios from 'axios'
import { shell, forwardTcp } from './base'
import { handleEvent } from 'share/main/lib/util'
import { IpcGetWebviews } from 'common/types'

const getWebviews: IpcGetWebviews = singleton(
  async (connectKey, pid) => {
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      return []
    }

    const result: string = await shell(connectKey, 'cat /proc/net/unix')
    const socketName = `webview_devtools_remote_${pid}`
    // /proc/net/unix: Num RefCount Protocol Flags Type St Inode Path.
    // Match the whole abstract path, never a PID prefix or the last scanned row.
    const found = result.split('\n').some((line) => {
      const fields = line.trim().split(/\s+/)
      return (
        fields.length === 8 &&
        /^[\da-f]+:$/i.test(fields[0]) &&
        fields.slice(1, 6).every((value) => /^[\da-f]+$/i.test(value)) &&
        /^\d+$/.test(fields[6]) &&
        fields[7] === `@${socketName}`
      )
    })
    if (!found) {
      return []
    }

    const port = await forwardTcp(connectKey, `localabstract:${socketName}`)
    // Use a total HTTP deadline, not a socket-idle timeout that a slow stream
    // can keep extending. Shell/forward lifecycle still belongs to base.ts.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    try {
      const { data } = await axios.get(`http://127.0.0.1:${port}/json`, {
        signal: controller.signal,
        proxy: false,
        maxRedirects: 0,
        responseType: 'json',
        transitional: { silentJSONParsing: false },
      })
      if (
        !Array.isArray(data) ||
        !data.every(
          (item) => item && typeof item === 'object' && !Array.isArray(item)
        )
      ) {
        throw new Error('Invalid WebView target list')
      }

      return data
    } finally {
      clearTimeout(timer)
    }
  },
  (connectKey, pid) => JSON.stringify([connectKey, pid])
)

export function init() {
  handleEvent('getWebviews', getWebviews)
}
