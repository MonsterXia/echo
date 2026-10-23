import fs from 'node:fs'
import path from 'node:path'

// npm file dependencies resolve outside node_modules; include their CJS sources.
export const commonjsInclude = [/node_modules/, /vendor[\\/]packages/]

export function browserVendorImports(root) {
  const dirs = ['src/renderer', 'src/common', 'src/share/renderer', 'src/share/common']
  for (const name of fs.readdirSync(path.join(root, 'vendor/packages'))) {
    if (name.startsWith('luna-')) dirs.push(`vendor/packages/${name}/src`)
  }
  const imports = new Set()
  function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) scan(file)
      else if (/\.(ts|tsx|js)$/.test(file) && !file.endsWith('.d.ts')) {
        const source = fs.readFileSync(file, 'utf8')
        for (const match of source.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"](licia\/[^'"]+)['"]/g)) {
          imports.add(match[1])
        }
      }
    }
  }
  for (const dir of dirs) scan(path.join(root, dir))
  return [...imports].sort()
}

export function reloadVendor(root) {
  return {
    name: 'local-dependency-reload',
    configureServer(server) {
      let timer
      const stamp = path.join(root, 'vendor/.build-stamp')
      server.watcher.add(stamp)
      const changed = (file) => {
        const absolute = path.resolve(file)
        if (absolute !== stamp) return
        clearTimeout(timer)
        timer = setTimeout(() => server.restart(true).catch(server.config.logger.error), 200)
      }
      server.watcher.on('change', changed).on('add', changed).on('unlink', changed)
      server.httpServer?.once('close', () => {
        clearTimeout(timer)
        for (const event of ['change', 'add', 'unlink']) server.watcher.off(event, changed)
      })
    },
  }
}
