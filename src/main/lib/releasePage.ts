import { parse, DefaultTreeAdapterMap } from 'parse5'

type Node = DefaultTreeAdapterMap['node']
export interface ReleaseRecord {
  tag_name: string
  draft: boolean
  prerelease: boolean
  name?: string
  body?: string
}
const repository = 'MonsterXia/scrcpy-harmony'
const attr = (node: Node, name: string) => 'attrs' in node ? node.attrs.find(a => a.name === name)?.value : undefined
const hasClass = (node: Node, name: string) => (attr(node, 'class') || '').split(/\s+/).includes(name)
function nodes(root: Node): Node[] {
  const result: Node[] = [], pending = [root]
  while (pending.length) {
    const node = pending.pop()!
    result.push(node)
    if ('childNodes' in node) pending.push(...[...node.childNodes].reverse())
  }
  return result
}
const text = (node: Node) => nodes(node).map(n => 'value' in n ? n.value : '').join('').trim()

// Read only GitHub's release-card headers, never badges/links in release notes.
// Unknown/truncated markup fails closed rather than implying a complete list.
export function parseReleasePage(html: string, page: number) {
  if (!html.includes('</html>')) throw new Error('Incomplete release page')
  const all = nodes(parse(html))
  const sections = all.filter(n => n.nodeName === 'section' && attr(n, 'data-release-anchor'))
  if (!sections.length) throw new Error('No recognized release cards')
  const releases: ReleaseRecord[] = sections.map(section => {
    const link = nodes(section).find(n => n.nodeName === 'a' && hasClass(n, 'Link--primary') && attr(n, 'href')?.startsWith(`/${repository}/releases/tag/`))
    const linkParent = link && 'parentNode' in link ? link.parentNode : undefined
    const header = linkParent && 'parentNode' in linkParent ? linkParent.parentNode : undefined
    if (!link || !header || attr(header, 'data-turbo-frame') !== 'repo-content-turbo-frame') throw new Error('Unknown release header')
    const tag = decodeURIComponent(attr(link, 'href')!.slice(`/${repository}/releases/tag/`.length))
    if (attr(section, 'data-release-anchor') !== `release-${tag}`) throw new Error('Mismatched release anchor')
    const labels = nodes(header).filter(n => hasClass(n, 'Label')).map(text)
    if (labels.some(label => !['Pre-release', 'Latest', 'Draft'].includes(label))) throw new Error('Unknown release label')
    return { tag_name: tag, draft: labels.includes('Draft'), prerelease: labels.includes('Pre-release'), name: text(link) }
  })
  const pagination = all.find(n => attr(n, 'aria-label') === 'Release list pagination' && hasClass(n, 'pagination'))
  if (!pagination && sections.length >= 10) throw new Error('Missing release pagination')
  const next = pagination && nodes(pagination).find(n => n.nodeName === 'a' && hasClass(n, 'next_page'))
  if (next) {
    const url = new URL(attr(next, 'href') || '', 'https://github.com')
    if (url.origin !== 'https://github.com' || url.pathname !== `/${repository}/releases` || url.search !== `?page=${page + 1}`) throw new Error('Unexpected release pagination link')
  } else if (pagination && !nodes(pagination).some(n => n.nodeName === 'span' && hasClass(n, 'next_page') && attr(n, 'aria-disabled') === 'true')) {
    throw new Error('Unconfirmed end of release pages')
  }
  return { releases, hasNext: !!next }
}
