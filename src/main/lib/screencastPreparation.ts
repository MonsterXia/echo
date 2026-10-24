import { app } from 'electron'
import { deviceEvents } from './hdc'
import { getMainStore, getScreencastStore } from './store'
import { prepareTarget, cancelCapturePreparation, shutdownCaptures } from './hdc/uitest'
import { CaptureWarmup } from './hdc/captureWarmup'

export function init() {
  const store = getMainStore()
  const screencast = getScreencastStore()
  const online = new Set<string>()
  const warmup = new CaptureWarmup({
    prepare: prepareTarget,
    cancel: cancelCapturePreparation,
    onError: () => console.error('Screencast preparation failed; foreground capture may retry'),
  })
  const select = () => {
    const key = store.get('target')?.key
    warmup.select(typeof key === 'string' && key.length <= 1024 ? key : undefined, screencast.get('scale'))
  }
  store.on('change', (name) => { if (name === 'target') select() })
  screencast.on('change', (name) => { if (name === 'scale') select() })
  const update = () => warmup.setTargets([...online])
  deviceEvents.on('targets', (keys: string[]) => {
    online.clear()
    for (const key of keys) online.add(key)
    update()
  })
  deviceEvents.on('add', (key: string) => { online.add(key); update() })
  deviceEvents.on('remove', (key: string) => { online.delete(key); update() })
  select()

  let shuttingDown = false
  let cleaned = false
  // Run before the optional HDC shutdown listener. Keep the transport alive
  // until queued preparation and cleanup finish, including a late upload.
  app.prependListener('before-quit', (event) => {
    if (cleaned) return
    event.preventDefault()
    if (shuttingDown) return
    shuttingDown = true
    void warmup.dispose().then(shutdownCaptures).catch(() => {
      console.error('Capture cleanup failed during shutdown; device state is unconfirmed')
    }).finally(() => { cleaned = true; app.quit() })
  })
}
