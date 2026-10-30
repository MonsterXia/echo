import { setTimeout as delay } from 'node:timers/promises'
import manifest from '../../../../vendor/native-video/manifest.json'

type Run = (command: string) => Promise<string>
interface Candidate { pid: string; started: string; name: string; command: string; hash: string; inode: string }
const socketPath = '@scrcpy_grpc_socket'
const marker = '\nCROSS_HOST_READ_COMPLETE'
const commandPattern = /^(?:\/system\/bin\/)?uitest start-daemon singleness --extension-name (scrcpy_harmony_[a-f0-9]{16}\.so) -scale [1-5] -frameRate (?:60|120) -bitRate 8 -p 5011 -iFrameInterval 1000 -repeatInterval 100$/

async function inventory(run: Run, command: string) {
  const output = (await run(`${command} && echo CROSS_HOST_READ_COMPLETE`)).trim()
  if (!output.endsWith(marker)) throw new Error('Cross-host recovery inventory incomplete')
  return output.slice(0, -marker.length).split(/\r?\n/)
}

async function inspect(run: Run): Promise<Candidate | undefined> {
  const [header, ...rows] = await inventory(run, 'cat /proc/net/unix')
  if (!/^\s*Num\s+RefCount\s+(?:Protocol|Proto)\s+Flags\s+Type\s+(?:St|State)\s+Inode\s+Path\s*$/.test(header)) {
    throw new Error('Cross-host recovery socket inventory unconfirmed')
  }
  const sockets = rows.filter(row => row.trim()).map(row => {
    const match = /^\s*[a-f\d]+:\s+([a-f\d]+)\s+([a-f\d]+)\s+([a-f\d]+)\s+([a-f\d]+)\s+([a-f\d]+)\s+(\d+)(?:\s+(.*))?$/i.exec(row)
    if (!match) throw new Error('Cross-host recovery socket inventory unconfirmed')
    return match
  }).filter(row => row[7] === socketPath)
  // Accepted and pending peers retain the listener's address in /proc/net/unix.
  // Exactly one unconnected stream listener is the only reclaimable state.
  if (sockets.length !== 1) return
  const socket = sockets[0]
  if (parseInt(socket[3], 16) !== 0x10000 || parseInt(socket[4], 16) !== 1 || parseInt(socket[5], 16) !== 1) return
  for (const file of ['tcp', 'tcp6']) {
    const [header, ...rows] = await inventory(run, `cat /proc/net/${file}`)
    if (!/^\s*sl\s+local_address\s+(?:rem|remote)_address\s+st\b/.test(header)) throw new Error('Cross-host recovery TCP inventory unconfirmed')
    const address = file === 'tcp' ? /^[a-f\d]{8}:[a-f\d]{4}$/i : /^[a-f\d]{32}:[a-f\d]{4}$/i
    for (const row of rows.filter(row => row.trim())) {
      const [slot, local, remote, state] = row.trim().split(/\s+/)
      if (!/^\d+:$/.test(slot) || !address.test(local) || !address.test(remote) || !/^0[1-9a-c]$/i.test(state)) {
        throw new Error('Cross-host recovery TCP inventory unconfirmed')
      }
      if ((/:1f4c$/i.test(local) || /:1f4c$/i.test(remote)) && ['01', '02', '03'].includes(state)) return
    }
  }
  const [psHeader, ...processes] = await inventory(run, 'ps -ef')
  if (!/^\s*(UID|USER)\s+PID\s+PPID\b/.test(psHeader)) throw new Error('Cross-host recovery process inventory unconfirmed')
  const candidates = processes.filter(row => row.trim()).map(row => {
    const match = /^\S+\s+([1-9]\d*)\s+\d+\s+\S+\s+\S+\s+\S+\s+\S+\s+(.+)$/.exec(row.trim())
    if (!match) throw new Error('Cross-host recovery process inventory unconfirmed')
    return { pid: match[1], command: match[2], match: commandPattern.exec(match[2]) }
  }).filter(row => row.match)
  if (candidates.length !== 1) return
  const { pid, command, match } = candidates[0]
  const name = match![1]
  const stat = await run(`cat /proc/${pid}/stat`)
  const started = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19]
  if (!stat.startsWith(`${pid} (`) || !/^\d+$/.test(started || '')) throw new Error('Cross-host recovery identity unconfirmed')
  const hash = (await run(`sha256sum /data/local/tmp/${name}`)).trim().split(/\s+/)[0]
  if (!manifest.libraries.some(library => library.sha256 === hash)) return
  return { pid, started, name, command, hash, inode: socket[6] }
}

// Recheck on the device immediately before signalling, without awk, tr, /proc
// fd access or host shell quoting. All interpolated values have strict grammars.
function stopCommand(owner: Candidate) {
  return `
check_unix() {
  table=$(cat /proc/net/unix) || return 1
  first=1; matches=0
  while read -r num ref protocol flags type st inode socket; do
    if [ "$first" = 1 ]; then
      [ "$num $ref $flags $type $inode $socket" = 'Num RefCount Flags Type Inode Path' ] || return 1
      case "$protocol" in Protocol|Proto) ;; *) return 1;; esac
      case "$st" in St|State) ;; *) return 1;; esac
      first=0; continue
    fi
    [ -n "$num" ] || continue
    case "$num" in *:) ;; *) return 1;; esac
    for hex in "\${num%:}" "$ref" "$protocol" "$flags" "$type" "$st"; do
      case "$hex" in ''|*[!0-9a-fA-F]*) return 1;; esac
    done
    case "$inode" in ''|*[!0-9]*) return 1;; esac
    if [ "$socket" = '${socketPath}' ]; then
      [ "$((0x$flags))" = 65536 ] && [ "$((0x$type))" = 1 ] && [ "$((0x$st))" = 1 ] && [ "$inode" = '${owner.inode}' ] || return 1
      matches=$((matches + 1))
    fi
  done <<RECOVERY_UNIX
$table
RECOVERY_UNIX
  [ "$first" = 0 ] && [ "$matches" = 1 ]
}
check_tcp() {
  table=$(cat /proc/net/$1) || return 1
  first=1
  while read -r slot local remote st rest; do
    if [ "$first" = 1 ]; then
      [ "$slot $local $st" = 'sl local_address st' ] || return 1
      case "$remote" in rem_address|remote_address) ;; *) return 1;; esac
      first=0; continue
    fi
    [ -n "$slot" ] || continue
    case "$slot" in *:) ;; *) return 1;; esac
    case "\${slot%:}" in ''|*[!0-9]*) return 1;; esac
    case "$st" in 0[1-9]|0[a-cA-C]) ;; *) return 1;; esac
    [ "\${#st}" = 2 ] || return 1
    for address in "$local" "$remote"; do
      ip=\${address%:*}; port=\${address##*:}
      case "$ip$port" in *[!0-9a-fA-F]*) return 1;; esac
      [ "\${#ip}" = "$2" ] && [ "\${#port}" = 4 ] || return 1
      case "$port:$st" in 1[Ff]4[Cc]:01|1[Ff]4[Cc]:02|1[Ff]4[Cc]:03) return 1;; esac
    done
  done <<RECOVERY_TCP
$table
RECOVERY_TCP
  [ "$first" = 0 ]
}
# All hosts using this recovery share a device-owned advisory lock. Keep the
# inode in place: unlinking a lock file can create two independently held locks.
# Harmony shell closes nonstandard fds on exec; stdin survives into flock.
# This script reads only explicit here-documents, never its original stdin.
command -v flock >/dev/null 2>&1 || { echo CROSS_HOST_SKIPPED; exit 0; }
exec 0<>/data/local/tmp/scrcpy_harmony_recovery.lock || exit 1
attempt=0
until flock -xn 0; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 4 ] || { echo CROSS_HOST_SKIPPED; exit 0; }
  sleep 1
done
processes=$(ps -ef) || exit 1
first=1; found=0
while read -r user pid ppid cpu stime tty time command; do
  if [ "$first" = 1 ]; then
    case "$user" in UID|USER) ;; *) exit 1;; esac
    [ "$pid $ppid" = 'PID PPID' ] || exit 1
    first=0; continue
  fi
  [ -n "$user" ] || continue
  case "$pid:$ppid" in *[!0-9:]*) exit 1;; esac
  [ -n "$pid" ] && [ -n "$ppid" ] && [ -n "$command" ] || exit 1
  if [ "$pid" = '${owner.pid}' ]; then
    [ "$command" = '${owner.command}' ] || exit 1
    found=$((found + 1))
  fi
done <<RECOVERY_PS
$processes
RECOVERY_PS
[ "$first" = 0 ] || exit 1
[ "$found" != 0 ] || { echo CROSS_HOST_ALREADY_GONE; exit 0; }
[ "$found" = 1 ] || exit 1
digest=$(sha256sum /data/local/tmp/${owner.name}) || exit 1
set -- $digest
[ "$1" = '${owner.hash}' ] || exit 1
stat=$(cat /proc/${owner.pid}/stat) || exit 1
case "$stat" in '${owner.pid} ('*) ;; *) exit 1;; esac
rest=\${stat##*) }
set -- $rest
shift 19 || exit 1
[ "$1" = '${owner.started}' ] || exit 1
check_unix && check_tcp tcp 8 && check_tcp tcp6 32 || exit 1
kill -9 ${owner.pid} && echo CROSS_HOST_STOPPED
`.trim()
}

export async function recoverDisconnectedNative(run: Run) {
  let owner: Candidate
  try {
    const candidate = await inspect(run)
    if (!candidate) return false
    owner = candidate
    // Allow a new host's pending control/video connection to become visible.
    await delay(1000)
    const confirmed = await inspect(run)
    if (JSON.stringify(confirmed) !== JSON.stringify(owner)) return false
  } catch {
    // Some firmware restricts /proc inspection while UITest control/JPEG still
    // works. An optional read-only check may decline takeover, not disable it.
    console.warn('Cross-host native recovery skipped: device inspection unavailable')
    return false
  }
  // From this point a command may have changed the device. Keep every failure
  // visible until cleanup is confirmed; never treat it as an optional probe.
  const stopped = (await run(stopCommand(owner))).trim()
  if (stopped === 'CROSS_HOST_SKIPPED') return false
  // A competing recovery finished before we acquired the device lock. It owns
  // any remaining file cleanup; do not fail initialization or delete its file.
  if (stopped === 'CROSS_HOST_ALREADY_GONE') return true
  if (stopped !== 'CROSS_HOST_STOPPED') throw new Error('Cross-host native stop unconfirmed')
  const [header, ...processes] = await inventory(run, 'ps -ef')
  if (!/^\s*(UID|USER)\s+PID\s+PPID\b/.test(header) ||
    processes.filter(row => row.trim()).some(row => !/^\S+\s+\d+\s+\d+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S/.test(row.trim()))) {
    throw new Error('Cross-host native stop inventory unconfirmed')
  }
  if (processes.some(row => row.trim().split(/\s+/)[1] === owner.pid)) throw new Error('Cross-host native process still present')
  // The random library belongs to the verified process. Never touch another
  // host's forwarding table, control daemon, journal or unrelated extensions.
  await run(`rm -f /data/local/tmp/${owner.name}`)
  if ((await run(`test ! -e /data/local/tmp/${owner.name} && echo removed`)).trim() !== 'removed') throw new Error('Cross-host native file removal unconfirmed')
  console.info('Recovered disconnected native capture from another desktop session')
  return true
}
