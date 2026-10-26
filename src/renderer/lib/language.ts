import { i18n } from 'common/util'
import LunaModal from 'luna-modal'

// Run before lazy-loading pages: module-level table columns also call t().
export function applyLanguage(language: string) {
  i18n.locale(language)
  LunaModal.i18n.locale(language)
  document.documentElement.lang = language
}
