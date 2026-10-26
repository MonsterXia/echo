interface Identity { pid: string; started: string }

// Recovery is only for the control daemon observed by this application. A new
// process, another native extension or another TCP client must not be stopped.
export class ControlRecovery {
  private identity?: Identity
  constructor(private run: (command: string) => Promise<string>) {}
  private async readInventory(command: string, kind: string) {
    const output = (await this.run(`${command} && echo CONTROL_READ_COMPLETE`)).trim()
    const marker = '\nCONTROL_READ_COMPLETE'
    if (!output.endsWith(marker)) throw new Error(`Control ${kind} inventory unconfirmed`)
    return output.slice(0, -marker.length).trim()
  }
  private async inspect(): Promise<Identity | undefined> {
    const processes = await this.readInventory('ps -ef', 'process')
    const [header, ...entries] = processes.split(/\r?\n/)
    if (!/^\s*(UID|USER)\s+PID\s+PPID\b/.test(header) ||
      entries.some(line => !/^\S+\s+\d+\s+\d+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S/.test(line.trim()))) {
      throw new Error('Control process inventory unconfirmed')
    }
    const rows = entries.filter(line => /(?:^|\s)(?:\/system\/bin\/)?uitest start-daemon singleness\s*$/.test(line))
    if (!rows.length) return
    if (rows.length !== 1) throw new Error('Control process is ambiguous')
    const pid = rows[0].trim().split(/\s+/)[1]
    if (!/^\d+$/.test(pid)) throw new Error('Invalid control process')
    const stat = await this.run(`cat /proc/${pid}/stat`)
    const started = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19]
    if (!/^\d+$/.test(started || '')) throw new Error('Control process identity unconfirmed')
    return { pid, started }
  }
  async remember() {
    this.identity = await this.inspect()
  }
  async reset() {
    const previous = this.identity
    if (!previous) throw new Error('Control recovery requires a recorded process')
    const current = await this.inspect()
    if (!current) return // Its death, not a missing RPC reply, confirms release.
    if (current.pid !== previous.pid || current.started !== previous.started) {
      throw new Error('Control service changed; refusing to stop a replacement')
    }
    // A readable IPv4 table cannot prove that an unreadable IPv6 table has
    // no peers. Require each complete table and fail closed on unknown rows.
    for (const file of ['tcp', 'tcp6']) {
      const sockets = await this.readInventory(`cat /proc/net/${file}`, 'socket')
      const [header, ...entries] = sockets.split(/\r?\n/)
      const address = file === 'tcp' ? /^[\da-f]{8}:[\da-f]{4}$/i : /^[\da-f]{32}:[\da-f]{4}$/i
      if (!/^\s*sl\s+local_address\s+(?:rem|remote)_address\s+st\b/.test(header)) throw new Error('Control socket inventory unconfirmed')
      for (const line of entries) {
        const columns = line.trim().split(/\s+/)
        if (!/^\d+:$/.test(columns[0]) || !address.test(columns[1] || '') ||
          !address.test(columns[2] || '') || !/^[\da-f]{2}$/i.test(columns[3] || '')) {
          throw new Error('Control socket inventory unconfirmed')
        }
        if (/:1F4C$/i.test(columns[1]) && columns[3] === '01') {
          throw new Error('Control service is in use by another connection')
        }
      }
    }
    // Recheck start time on-device immediately before signalling; a recycled
    // PID must never be interpreted as the daemon we previously observed.
    const result = await this.run(`stat=$(cat /proc/${current.pid}/stat) || exit 1
rest=\${stat##*) }
set -- $rest
shift 19
[ "$1" = "${current.started}" ] || exit 1
kill -9 ${current.pid} && echo stopped`)
    if (result.trim() !== 'stopped') throw new Error('Control process stop unconfirmed')
    if (await this.inspect()) throw new Error('Control process stop unconfirmed')
  }
}
