import { GitHubProvider } from 'electron-updater/out/providers/GitHubProvider'
import { parseUpdateInfo, ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider'
import type { AppUpdater } from 'electron-updater'
import { CancellationError, CancellationToken } from 'builder-util-runtime'
import { eq, gt, prerelease, valid } from 'semver'

import { parseReleasePage, ReleaseRecord } from './releasePage'

const repository = 'MonsterXia/scrcpy-harmony'
const activeChecks = new Set<CancellationToken>()
let scheduledCheck: CancellationToken | undefined

// Register before AppUpdater's asynchronous staging/configuration work begins.
export function beginReleaseCheck() {
  const token = new CancellationToken()
  scheduledCheck = token
  activeChecks.add(token)
  return () => {
    activeChecks.delete(token)
    if (scheduledCheck === token) scheduledCheck = undefined
    token.dispose()
  }
}

export function cancelReleaseChecks() {
  for (const token of activeChecks) token.cancel()
}

// GitHubProvider's built-in prerelease channel matching excludes custom dev/rc
// channels. Select across published releases, then reuse its platform metadata
// and file resolution, including the separate macOS x64 channel.
export class ReleaseProvider extends GitHubProvider {
  private readonly includePrerelease: () => boolean
  private readonly metadataChannel: string

  constructor(_options: unknown, updater: AppUpdater, runtime: ProviderRuntimeOptions) {
    const channel = updater.channel || 'latest'
    super({ provider: 'github', owner: 'MonsterXia', repo: 'scrcpy-harmony', channel }, updater, runtime)
    this.includePrerelease = () => updater.allowPrerelease
    this.metadataChannel = this.getCustomChannelName(channel)
  }

  async getLatestVersion() {
    // Changes made while a check is running apply to the next check.
    const includePrerelease = this.includePrerelease()
    const token = scheduledCheck || new CancellationToken()
    if (token.cancelled) throw new CancellationError()
    activeChecks.add(token)
    const timer = setTimeout(() => token.cancel(), 30_000)
    try {
      let selected: ReleaseRecord | undefined
      const releases = await this.readReleases(token)
      for (const release of releases) {
        if (!release || typeof release.tag_name !== 'string' || typeof release.draft !== 'boolean' || typeof release.prerelease !== 'boolean') {
          throw new Error('Invalid release entry')
        }
        const version = valid(release.tag_name)
        if (release.draft || !version) continue
        if (!includePrerelease && (release.prerelease || prerelease(version))) continue
        if (!selected || gt(version, selected.tag_name) || (eq(version, selected.tag_name) && selected.prerelease && !release.prerelease)) selected = release
      }
      if (!selected) throw new Error('No eligible published release version')
      const filename = `${this.metadataChannel}.yml`
      const url = new URL(`https://github.com/${repository}/releases/download/${encodeURIComponent(selected.tag_name)}/${filename}`)
      const raw = await this.httpRequest(url, undefined, token)
      const info = parseUpdateInfo(raw, filename, url)
      if (!valid(info.version) || !eq(info.version, selected.tag_name)) throw new Error('Release metadata version does not match its tag')
      return { ...info, tag: selected.tag_name, releaseName: selected.name || selected.tag_name, releaseNotes: selected.body || '' }
    } finally {
      clearTimeout(timer)
      activeChecks.delete(token)
    }
  }

  private async readReleases(token: CancellationToken): Promise<ReleaseRecord[]> {
    try {
      const result: ReleaseRecord[] = []
      for (let page = 1; page <= 10; page++) {
        const raw = await this.httpRequest(
          new URL(`https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`),
          { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, token
        )
        const releases = JSON.parse(raw || 'null')
        if (!Array.isArray(releases)) throw new Error('Invalid releases response')
        result.push(...releases)
        if (releases.length < 100) return result
      }
      throw new Error('Release list exceeds the complete-check limit')
    } catch (error) {
      if (token.cancelled || ![403, 429].includes((error as { statusCode?: number }).statusCode || 0)) throw error
    }
    // Shared IPs can exhaust GitHub's unauthenticated REST quota. Its public
    // release pages have the same tags/flags and do not require credentials.
    const result: ReleaseRecord[] = []
    for (let page = 1; page <= 10; page++) {
      const raw = await this.httpRequest(new URL(`https://github.com/${repository}/releases?page=${page}`), { Accept: 'text/html', 'Accept-Language': 'en-US' }, token)
      const parsed = parseReleasePage(raw || '', page)
      result.push(...parsed.releases)
      if (!parsed.hasNext) return result
    }
    throw new Error('Release pages exceed the complete-check limit')
  }

}
