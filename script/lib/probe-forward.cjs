// A UiDriver can reuse a preexisting forwarding rule. A probe may release
// only the mapping it created; never remove a rule owned by the application.
exports.releaseProbeForward = async function (target, port, initialForwards) {
  if (target && port && !initialForwards.some(item => item.local === `tcp:${port}`)) {
    await target.removeForward(`tcp:${port}`, 'tcp:8012')
  }
}
