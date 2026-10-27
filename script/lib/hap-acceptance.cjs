// This function is serialized into the renderer by the live probe.
function measureNotice(el) {
  const win = el.ownerDocument.defaultView
  const r = el.getBoundingClientRect()
  let stylesVisible = el.isConnected
  for (let parent = el; parent; parent = parent.parentElement) {
    const style = win.getComputedStyle(parent)
    if (style.display === 'none' || style.visibility === 'hidden' ||
      style.visibility === 'collapse' || style.opacity === '0') stylesVisible = false
  }
  return {
    visible: stylesVisible && r.width > 0 && r.height > 0,
    fits: r.left >= 0 && r.right <= win.innerWidth && r.top >= 0 && r.bottom <= win.innerHeight,
    insideFullscreen: !el.ownerDocument.fullscreenElement || el.ownerDocument.fullscreenElement.contains(el),
    noMarkupInjection: !el.querySelector('test'),
    width: r.width, viewport: win.innerWidth,
  }
}
function freshListAfter(lists, successSeq) {
  return lists.findLast(list => list.startedSeq > successSeq && list.completed && list.success)
}
module.exports = { measureNotice, freshListAfter }
