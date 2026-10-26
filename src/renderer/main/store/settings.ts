import { action, makeObservable, observable, runInAction } from 'mobx'
import isUndef from 'licia/isUndef'
import { resolveLocale } from 'share/common/i18n'

export class Settings {
  language = 'system'
  theme = 'light'
  hdcPath = ''
  killHdcWhenExit = false
  constructor() {
    makeObservable(this, {
      language: observable,
      theme: observable,
      hdcPath: observable,
      killHdcWhenExit: observable,
      set: action,
    })

    this.init()
  }
  async init() {
    const names = ['language', 'theme', 'hdcPath', 'killHdcWhenExit']
    for (let i = 0, len = names.length; i < len; i++) {
      const name = names[i]
      const val = await main.getSettingsStore(name)
      if (!isUndef(val)) {
        runInAction(() => (this[name] = name === 'language' ? resolveLocale(val) || 'system' : val))
      }
    }
  }
  async set(name: string, val: any) {
    await main.setSettingsStore(name, val)
    runInAction(() => {
      this[name] = val
    })
  }
}
