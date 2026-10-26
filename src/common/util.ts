import zhCN from './langs/zh-CN.json'
import enUS from './langs/en-US.json'
import { init as initI18n } from 'share/common/i18n'
export { t, i18n } from 'share/common/i18n'

const langs = {
  'zh-CN': zhCN,
  'en-US': enUS,
}

initI18n(langs)
