// Synthetic transport only: keep the real client, React components and CSS.
import { createRoot } from 'react-dom/client'
import App from '../../../src/renderer/screencast/App'
import ScreencastClient from '../../../src/renderer/screencast/lib/ScreencastClient'
import { i18n } from '../../../src/common/util'
import 'luna-toolbar/css'
import 'luna-modal/css'
import '../../../src/share/renderer/luna.scss'
import '../../../src/renderer/luna.scss'
import '../../../src/share/renderer/main.scss'
import '../../../src/renderer/main.scss'
import '../../../src/renderer/icon.css'

const events = new Map()
const calls: unknown[] = []
let displaySize = { width: 1080, height: 2400 }
Object.assign(window, {
  main: {
    stopCaptureScreen: async () => {},
    startCaptureScreen: async () => {},
    getDisplaySize: async () => displaySize,
    on: (name, callback) => {
      events.set(name, callback)
      return () => events.delete(name)
    },
    touchDown: (...args) => calls.push(args),
    touchMove: () => {},
    touchUp: () => {},
    inputKey: () => {},
    inputText: () => {},
  },
  preload: { setTitle: () => {}, getPathForFile: () => '' },
})
const state = (globalThis as any).displayStore
state.target = { key: 'synthetic', name: '合成画面 / Synthetic' }
state.scale = 1
state.setScale = (value) => {
  state.scale = value
}
state.setAlwaysOnTop = () => {}
state.screencastClient = new ScreencastClient('synthetic')
i18n.locale('zh-CN')
document.body.classList.add('platform-windows')
createRoot(document.getElementById('app')!).render(<App />)
;(window as any).displayTest = {
  calls,
  async frame(width, height, scale = 1) {
    displaySize = { width, height }
    const source = document.createElement('canvas')
    source.width = width * scale
    source.height = height * scale
    const ctx = source.getContext('2d')!
    ctx.fillStyle = '#e8f0f4'
    ctx.fillRect(0, 0, source.width, source.height)
    ctx.strokeStyle = '#156082'
    ctx.lineWidth = 8
    ctx.strokeRect(4, 4, source.width - 8, source.height - 8)
    ctx.fillStyle = '#17354a'
    ctx.font = `${32 * scale}px "Microsoft YaHei", sans-serif`
    for (let y = 80 * scale; y < source.height; y += 100 * scale) {
      ctx.fillText('合成文字 ABC 0123 — JPEG', 20 * scale, y)
    }
    const blob = await new Promise<Blob>((resolve) =>
      source.toBlob(resolve, 'image/jpeg', 0.85),
    )
    events.get('captureScreen')(
      'synthetic',
      new Uint8Array(await blob.arrayBuffer()),
    )
    await state.screencastClient.ready
    // Wait for async decode + display-size lookup on subsequent frames too.
    while (state.screencastClient.isDrawing)
      await new Promise((resolve) => setTimeout(resolve, 10))
  },
}
