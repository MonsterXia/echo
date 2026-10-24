import type { BaseWindow, BrowserWindow } from 'electron'

// Native selectAll/delete act on the empty IME textarea rather than the phone.
// Give the screencast document the decision; other windows keep native editing.
export function editWindow(command: 'selectAll' | 'delete',
  focused: BaseWindow | undefined, screencast: BrowserWindow | null | undefined) {
  const contents = (focused as BrowserWindow | undefined)?.webContents
  if (!contents) return
  if (focused === screencast) contents.send('screencastEdit', command)
  else contents[command]()
}
