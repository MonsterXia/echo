export function loadImage(
  url: string,
  signal?: AbortSignal
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const cleanup = () => {
      img.onload = null
      img.onerror = null
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      img.src = ''
      reject(new Error('Image loading cancelled'))
    }
    img.onload = () => {
      cleanup()
      resolve(img)
    }
    img.onerror = (error) => {
      cleanup()
      reject(error)
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    img.src = url
  })
}
