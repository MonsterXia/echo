// The actual frame may rotate independently of the device's touch coordinates.
// Observe canvas dimensions, not every frame, and measure the real UI chrome.
export function fitWindow(canvas: HTMLCanvasElement, container: HTMLElement) {
  let disposed = false
  let lastRatio = 0
  let lastInset = -1
  let scheduled = 0
  const update = () => {
    scheduled = 0
    if (disposed || !canvas.width || !canvas.height) return
    const rect = container.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const ratio = canvas.width / canvas.height
    const width = Math.min(rect.width, rect.height * ratio)
    // Explicit proportional CSS dimensions also upscale low-resolution frames.
    // The canvas rect remains the visible image rect used for touch mapping.
    canvas.style.width = `${width}px`
    canvas.style.height = `${width / ratio}px`
    if (document.fullscreenElement) return
    const inset = Math.round(window.innerHeight - rect.height)
    if (Math.abs(ratio - lastRatio) / ratio < 0.002 && inset === lastInset) return
    lastRatio = ratio
    lastInset = inset
    void main.fitScreencast(canvas.width, canvas.height, inset).catch(console.error)
  }
  const schedule = () => {
    if (!disposed && !scheduled) scheduled = requestAnimationFrame(update)
  }
  const dimensions = new MutationObserver(schedule)
  dimensions.observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] })
  const layout = new ResizeObserver(schedule)
  layout.observe(container)
  document.addEventListener('fullscreenchange', schedule)
  schedule()
  return () => {
    disposed = true
    cancelAnimationFrame(scheduled)
    dimensions.disconnect()
    layout.disconnect()
    document.removeEventListener('fullscreenchange', schedule)
  }
}
