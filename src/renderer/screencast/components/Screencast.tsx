import { observer } from 'mobx-react-lite'
import store from '../store'
import { useEffect, useRef, useState } from 'react'
import Style from './Screencast.module.scss'
import endWith from 'licia/endWith'
import { LoadingBar } from 'share/renderer/components/loading'
import { installBundles } from '../../lib/util'
import { fitWindow } from '../lib/fitWindow'
import ScreencastInput from '../lib/ScreencastInput'
import { t } from 'common/util'
import { notify } from 'share/renderer/lib/util'
import contextMenu from 'share/renderer/lib/contextMenu'
import type { CaptureState } from '../lib/ScreencastClient'

export default observer(function Screencast() {
  const { target, screencastClient } = store
  const screenContainerRef = useRef<HTMLDivElement>(null)
  const [captureState, setCaptureState] = useState<CaptureState>('loading')

  useEffect(() => {
    preload.setTitle(target.name)
    let disposed = false
    let stopFitting = () => {}
    let keyboard: ScreencastInput | undefined
    const offState = screencastClient.subscribeState(setCaptureState)
    const offEdit = main.on('screencastEdit', (command: string) => {
      if (disposed || (command !== 'selectAll' && command !== 'delete')) return
      if (!keyboard?.edit(command)) document.execCommand(command)
    })
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault()
      if (!keyboard || disposed) return
      const run = (action: (input: ScreencastInput) => void) => () => {
        if (!keyboard || disposed) return
        keyboard.focus()
        action(keyboard)
      }
      contextMenu(event, [
        { label: t('screencastCopy'), click: run(input => input.copy()) },
        { label: t('screencastCut'), click: run(input => input.copy(true)) },
        { label: t('screencastPaste'), click: run(input => input.paste()) },
        { type: 'separator' },
        { label: t('screencastPasteHost'), click: run(input => input.paste('host')) },
        { label: t('screencastPastePhone'), click: run(input => input.paste('phone')) },
      ])
    }

    async function start() {
      await screencastClient.ready
      if (disposed || !screenContainerRef.current) return
      screenContainerRef.current.appendChild(screencastClient.canvas)
      keyboard = new ScreencastInput(screencastClient.canvas,
        action => screencastClient.input(action),
        () => notify(t('screencastInputFailed'), { icon: 'error' }))
      keyboard.element.setAttribute('aria-label', t('screencastKeyboard'))
      keyboard.mount(screenContainerRef.current)
      screencastClient.canvas.addEventListener('contextmenu', onContextMenu)
      screencastClient.canvas.title = t('screencastKeyboardHint')
      stopFitting = fitWindow(screencastClient.canvas, screenContainerRef.current)
    }
    start()

    return () => {
      disposed = true
      offState()
      offEdit()
      stopFitting()
      keyboard?.destroy()
      screencastClient.canvas.removeEventListener('contextmenu', onContextMenu)
      screencastClient.destroy()
    }
  }, [])

  async function onDrop(e: React.DragEvent) {
    e.preventDefault()

    const files = e.dataTransfer.files
    const hapPaths: string[] = []
    for (let i = 0, len = files.length; i < len; i++) {
      const path = preload.getPathForFile(files[i])
      if (!endWith(path, '.hap')) {
        continue
      }
      hapPaths.push(path)
    }
    await installBundles(target.key, hapPaths)
  }

  return (
    <div
      ref={screenContainerRef}
      className={Style.container}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {captureState === 'loading' && <LoadingBar />}
      {captureState === 'failed' && (
        <div className={Style.error} role="alert">
          <p>{t('screencastStartFailed')}</p>
          <button onClick={() => { void screencastClient.start() }}>{t('screencastRetry')}</button>
        </div>
      )}
    </div>
  )
})
