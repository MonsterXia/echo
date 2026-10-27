import { useEffect } from 'react'
import { installDroppedBundles } from './util'

// One owner per window, including toolbar/empty areas and fullscreen children.
export default function useHapDrop(connectKey?: string) {
  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      if (Array.from(event.dataTransfer?.types || []).includes('Files')) {
        event.preventDefault()
      }
    }
    const onDrop = (event: DragEvent) => {
      if (event.defaultPrevented || !event.dataTransfer?.files.length) return
      event.preventDefault()
      void installDroppedBundles(connectKey, Array.from(event.dataTransfer.files))
    }
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('drop', onDrop)
    }
  }, [connectKey])
}
