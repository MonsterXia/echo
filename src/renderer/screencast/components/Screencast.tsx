import { observer } from 'mobx-react-lite'
import store from '../store'
import { useEffect, useRef, useState } from 'react'
import Style from './Screencast.module.scss'
import endWith from 'licia/endWith'
import { LoadingBar } from 'share/renderer/components/loading'
import { installBundles } from '../../lib/util'
import { fitWindow } from '../lib/fitWindow'

export default observer(function Screencast() {
  const { target, screencastClient } = store
  const screenContainerRef = useRef<HTMLDivElement>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    preload.setTitle(target.name)
    let disposed = false
    let stopFitting = () => {}

    async function start() {
      await screencastClient.ready
      if (disposed || !screenContainerRef.current) return
      screenContainerRef.current.appendChild(screencastClient.canvas)
      stopFitting = fitWindow(screencastClient.canvas, screenContainerRef.current)
      setIsLoading(false)
    }
    start()

    return () => {
      disposed = true
      stopFitting()
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
      {isLoading && <LoadingBar />}
    </div>
  )
})
