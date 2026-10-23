import fs from 'node:fs/promises'
import path from 'node:path'

export async function vendorNotices(root) {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'vendor/manifest.json'), 'utf8'))
  const sections = ['Scrcpy Harmony — third-party source notices\n\nLocal modifications do not replace upstream authorship or licenses.']
  for (const pkg of manifest.packages) {
    const license = await fs.readFile(path.join(root, 'vendor/packages', pkg.name, 'LICENSE'), 'utf8')
    sections.push(`${pkg.name} ${pkg.version}\n${pkg.repository}\nSource commit: ${pkg.gitHead}\n\n${license}`)
  }
  for (const source of manifest.sharedSources) {
    sections.push(`${source.path}\n${source.repository}\nSource commit: ${source.commit}\n${source.license}`)
  }
  return sections.join('\n\n' + '='.repeat(72) + '\n\n') + '\n'
}
