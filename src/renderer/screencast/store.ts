import BaseStore from 'share/renderer/store/BaseStore'
import { ITarget } from 'common/types'
import { action, makeObservable, observable, runInAction } from 'mobx'
import ScreencastClient from './lib/ScreencastClient'

function normalizeScale(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0.5 ||
    value > 1
  )
    return 1
  // Preserve the native integer-divisor behavior of legacy saved ratios:
  // 0.5/0.6 become smooth; 0.7/0.8/0.9/1 become original.
  return Math.round(1 / value) >= 2 ? 0.5 : 1
}

class Store extends BaseStore {
  target!: ITarget
  screencastClient!: ScreencastClient
  alwaysOnTop = false
  scale = 1
  constructor() {
    super()

    makeObservable(this, {
      alwaysOnTop: observable,
      target: observable,
      scale: observable,
      setAlwaysOnTop: action,
      setScale: action,
    })

    this.init()
    this.bindEvent()
  }
  setAlwaysOnTop(val: boolean) {
    this.alwaysOnTop = val
    main.setScreencastStore('alwaysOnTop', val)
    main.setScreencastAlwaysOnTop(val)
  }
  setScale(scale: number) {
    const next = normalizeScale(scale)
    if (next === this.scale) return
    this.scale = next
    this.screencastClient.start()
    main.setScreencastStore('scale', next)
  }
  async setTarget(target: ITarget | null) {
    if (target === null) {
      main.closeScreencast()
    } else {
      runInAction(() => (this.target = target))
      if (this.screencastClient) {
        this.screencastClient.destroy()
      }
      this.screencastClient = new ScreencastClient(this.target.key)
    }
  }
  private async init() {
    const alwaysOnTop = await main.getScreencastStore('alwaysOnTop')
    if (alwaysOnTop) {
      main.setScreencastAlwaysOnTop(true)
      runInAction(() => (this.alwaysOnTop = true))
    }
    const scale = await main.getScreencastStore('scale')
    runInAction(() => (this.scale = normalizeScale(scale)))
    const target = await main.getMainStore('target')
    this.setTarget(target)
  }
  private bindEvent() {
    main.on('changeMainStore', (name: string, val: any) => {
      if (name === 'target') {
        this.setTarget(val)
      }
    })
  }
}

export default new Store()
