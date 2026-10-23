const { screencastMain } = require('./screencast-main.cjs')

// Keep the production sender-bound IPC coordinator and real hdckit methods.
exports.captureHandlers = function (send) {
  const h = screencastMain(send)
  h.show()
  return {
    ...h,
    frames: h.attempts,
    create: h.create,
    start: (id, scale = 0.5, generation = 1) =>
      id ? h.startSession(id, scale, generation) : h.start(),
    stop: (id) => (id ? h.stopSession(id) : h.stop()),
  }
}
