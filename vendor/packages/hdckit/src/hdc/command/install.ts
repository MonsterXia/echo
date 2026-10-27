import ExecCommand from '../ExecCommand'
import path from 'path'
import contain from 'licia/contain'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

export class InstallCommand extends ExecCommand<void> {
  async execute(hap: string) {
    let source = path.resolve(hap)
    let temporary: string | undefined
    try {
      // Native HDC ignores .HAP/.Hap even on case-insensitive host filesystems.
      if (/\.hap$/i.test(source) && !source.endsWith('.hap')) {
        temporary = await mkdtemp(path.join(tmpdir(), 'hdckit-install-'))
        const staged = path.join(temporary, 'package.hap')
        await copyFile(source, staged)
        source = staged
      }
      const { stdout } = await this.run(['install', '-r', source])
      if (!contain(stdout, 'install bundle successfully')) {
        throw new Error(stdout)
      }
    } finally {
      if (temporary) {
        await rm(temporary, { recursive: true, force: true }).catch((error) => {
          console.warn('Failed to remove temporary installation package', error)
        })
      }
    }
  }
}

export class UninstallCommand extends ExecCommand<void> {
  async execute(bundleName: string) {
    const { stdout } = await this.run(['uninstall', bundleName])
    if (!contain(stdout, 'uninstall bundle successfully')) {
      throw new Error('Uninstall bundle failed')
    }
  }
}
