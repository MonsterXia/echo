import { BrowserWindow, screen } from 'electron'
import * as window from 'share/main/lib/window'
import { getScreencastStore } from '../lib/store'
import once from 'licia/once'
import { handleEvent } from 'share/main/lib/util'
import { IpcGetStore, IpcSetStore } from 'share/common/types'
import { IpcSetScreencastAlwaysOnTop } from 'common/types'

const store = getScreencastStore()

let win: BrowserWindow | null = null

export function showWin() {
  if (win) {
    win.focus()
    return
  }

  initIpc()

  win = window.create({
    name: 'screencast',
    minWidth: 320,
    minHeight: 320,
    width: 500,
    height: 640,
  })

  // The shared factory may restore bounds from a larger display. Constrain
  // the result in DIP, after restoration and before the window is shown.
  const bounds = win.getBounds()
  const area = screen.getDisplayMatching(bounds).workArea
  const width = Math.min(bounds.width, area.width)
  const height = Math.min(bounds.height, area.height)
  win.setMinimumSize(Math.min(320, area.width), Math.min(320, area.height))
  win.setBounds({
    x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)),
    width,
    height,
  })

  win.on('close', () => {
    win?.destroy()
  })

  // destroy() can bypass close; release the singleton on actual destruction.
  win.on('closed', () => {
    win = null
    const mainWin = window.getWin('main')
    if (mainWin) {
      mainWin.show()
    }
  })

  window.loadPage(win, { page: 'screencast' })
}

export function closeWin() {
  if (win) {
    win.close()
  }
}

const initIpc = once(() => {
  handleEvent('setScreencastStore', <IpcSetStore>(
    ((name, val) => store.set(name, val))
  ))
  handleEvent('getScreencastStore', <IpcGetStore>((name) => store.get(name)))
  handleEvent('setScreencastAlwaysOnTop', <IpcSetScreencastAlwaysOnTop>((
    alwaysOnTop
  ) => {
    if (win) {
      win.setAlwaysOnTop(alwaysOnTop)
    }
  }))
})
