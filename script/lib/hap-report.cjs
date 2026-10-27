// Finalization is separate so device/cleanup failures can be exercised without HDC.
async function finishInstallReport({ report, close, cleanup, inspect, write,
  formatError = error => String(error.message || error) }) {
  const originalError = report.error
  const errors = []
  for (const [stage, action] of [['close', close], ['cleanup', cleanup], ['inspect', inspect]]) {
    try {
      const value = await action()
      if (stage === 'inspect') report.finallyInstalled = !!value
    } catch (error) {
      if (stage === 'inspect') report.finallyInstalled = null
      errors.push({ stage, message: formatError(error) })
    }
  }
  if (errors.length) {
    report.passed = false
    report.finalizationErrors = errors
  }
  await write(report)
  // Preserve the original exception already propagating through the caller's
  // finally block, but do not exit successfully if only finalization failed.
  if (errors.length && !originalError) throw Error('HAP acceptance finalization failed; see report')
}
function parseTestBundleDump(text, bundleName) {
  if (text.trim() === 'error: failed to get information and the parameters may be wrong.') return null
  if (!text.includes('{')) throw Error('Unexpected bundle dump response: ' + text.slice(0, 160))
  const d = JSON.parse(text.slice(text.indexOf('{')))
  if (d.applicationInfo?.bundleName !== bundleName) throw Error('Unexpected bundle name in test package dump')
  return { installTime: d.installTime, updateTime: d.updateTime,
    bundleName: d.applicationInfo.bundleName, versionName: d.applicationInfo.versionName,
    versionCode: d.applicationInfo.versionCode, debug: d.applicationInfo.debug }
}
module.exports = { finishInstallReport, parseTestBundleDump }
