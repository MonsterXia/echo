// Own resources until every acquisition has settled, including acquisitions
// finishing after the verification deadline. Cleanup failures fail the probe.
export async function runLiveProbe({ verify, cleanup = async () => {}, timeoutMs = 120000 }) {
  const controller = new AbortController()
  const resources = [], acquisitions = [], errors = [], cleanupErrors = []
  const timer = setTimeout(() => controller.abort(new Error('Verification deadline exceeded')), timeoutMs)
  const { signal } = controller
  async function step(operation) {
    signal.throwIfAborted()
    let abort
    const interrupted = new Promise((_, reject) => {
      abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
    })
    try {
      const value = await Promise.race([Promise.resolve().then(() => {
        signal.throwIfAborted()
        return operation()
      }), interrupted])
      signal.throwIfAborted()
      return value
    } finally { signal.removeEventListener('abort', abort) }
  }
  function acquire(create, release) {
    signal.throwIfAborted()
    const acquisition = Promise.resolve().then(() => {
      signal.throwIfAborted()
      return create()
    }).then(value => {
      resources.push(() => release(value))
      return value
    })
    acquisitions.push(acquisition)
    return step(() => acquisition)
  }
  try { await verify({ step, acquire, signal }) }
  catch (error) { errors.push(error) }
  finally {
    clearTimeout(timer)
    // An aborted step cannot resume verification, but a launch or mkdtemp can
    // still finish. Register and release that late resource before returning.
    await Promise.allSettled(acquisitions)
    for (const release of resources.reverse()) {
      try { await release() } catch (error) { errors.push(error); cleanupErrors.push(error) }
    }
    try { await cleanup() } catch (error) { errors.push(error); cleanupErrors.push(error) }
  }
  return { passed: errors.length === 0, errors, cleanupPassed: cleanupErrors.length === 0 }
}

function deadline(task, ms, message) {
  let timer
  return Promise.race([task, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })]).finally(() => clearTimeout(timer))
}

export async function closeOwnedApplication(application, timeoutMs = 10000) {
  const child = application.process()
  let onExit
  const exited = child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve()
    : new Promise(resolve => { onExit = resolve; child.once('exit', onExit) })
  try {
    try {
      await deadline(Promise.resolve().then(() => application.close()), timeoutMs, 'Application close deadline exceeded')
      await deadline(exited, timeoutMs, 'Application exit deadline exceeded')
    } catch (error) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
        await deadline(exited, timeoutMs, 'Killed application did not exit')
      }
      // A forced shutdown is a verification failure even when cleanup succeeds.
      throw error
    }
  } finally { if (onExit) child.removeListener('exit', onExit) }
}
