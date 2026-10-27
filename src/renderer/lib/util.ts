import { t } from 'common/util'
import isEmpty from 'licia/isEmpty'
import { isObservable, toJS } from 'mobx'
import { notify } from 'share/renderer/lib/util'
import escape from 'licia/escape'

export async function installDroppedBundles(connectKey: string | undefined, files: Iterable<File>) {
  if (!connectKey) {
    notify(t('installDropNoDevice'), { icon: 'error' })
    return false
  }
  const paths: string[] = []
  let unreadable = false
  for (const file of files) {
    try {
      const path = preload.getPathForFile(file)
      if (path.toLowerCase().endsWith('.hap')) paths.push(path)
    } catch {
      unreadable = true
    }
  }
  if (unreadable) notify(t('installDropReadFailed'), { icon: 'error' })
  if (paths.length === 0) {
    if (!unreadable) notify(t('installDropUnsupported'), { icon: 'error' })
    return false
  }
  return installBundles(connectKey, paths)
}

export async function setMainStore(name: string, val: any) {
  await main.setMainStore(name, isObservable(val) ? toJS(val) : val)
}

export async function installBundles(connectKey: string, hapPaths?: string[]) {
  let hasSuccess = false

  if (!hapPaths) {
    const { filePaths } = await main.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: t('hapFile'), extensions: ['hap'] }],
    })
    if (isEmpty(filePaths)) {
      return hasSuccess
    }
    hapPaths = filePaths
  }

  for (let i = 0, len = hapPaths!.length; i < len; i++) {
    const hapPath = hapPaths![i]
    notify(escape(t('bundleInstalling', { path: hapPath })), { icon: 'info' })
    try {
      await main.installBundle(connectKey, hapPath!)
      hasSuccess = true
      notify(escape(t('bundleInstalled', { path: hapPath })), { icon: 'success' })
    } catch {
      notify(t('installBundleErr'), { icon: 'error' })
    }
  }

  return hasSuccess
}
