import I18n from 'licia/I18n'
import enUS from './langs/en-US.json'
import zhCN from './langs/zh-CN.json'
import types from 'licia/types'
import keys from 'licia/keys'
import contain from 'licia/contain'
import unique from 'licia/unique'
import concat from 'licia/concat'
import each from 'licia/each'

const langs = {
  'en-US': enUS,
  'zh-CN': zhCN,
}

let locales = keys(langs)

export const i18n = new I18n('en-US', langs)
const fallback = new I18n('en-US', { 'en-US': { ...enUS } })

export function init(langs: types.PlainObj<any>) {
  locales = unique(concat(locales, keys(langs)))
  each(langs, (lang, locale) => {
    i18n.set(locale, lang)
    if (locale === 'en-US') fallback.set(locale, lang)
  })
}

export function hasLocale(locale: string) {
  return contain(locales, locale)
}

export function t(path: string | string[], data?: types.PlainObj<any>) {
  return i18n.t(path, data) || fallback.t(path, data) || (Array.isArray(path) ? path.join('.') : path)
}

// Only English and Simplified Chinese are translated. Regional Chinese locales
// use Simplified Chinese; unsupported languages fall back at the caller.
export function resolveLocale(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const locale = value.trim().replace(/_/g, '-').toLowerCase()
  const exact = locales.find((item) => item.toLowerCase() === locale)
  if (exact) return exact
  const language = locale.split('-')[0]
  if (language === 'zh') return 'zh-CN'
  if (language === 'en') return 'en-US'
}
