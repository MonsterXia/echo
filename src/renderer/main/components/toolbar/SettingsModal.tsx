import LunaModal from 'luna-modal/react'
import LunaSetting, {
  LunaSettingButton,
  LunaSettingCheckbox,
  LunaSettingSelect,
  LunaSettingSeparator,
  LunaSettingTitle,
} from 'luna-setting/react'
import { t } from 'common/util'
import Style from './SettingsModal.module.scss'
import { createPortal } from 'react-dom'
import { observer } from 'mobx-react-lite'
import store from '../../store'
import { IModalProps } from 'share/common/types'
import SettingPath from 'share/renderer/components/SettingPath'
import debounce from 'licia/debounce'
import { notify } from 'share/renderer/lib/util'

const notifyRequireReload = debounce(() => {
  notify(t('requireReload'), { icon: 'info' })
}, 1000)

export default observer(function SettingsModal(props: IModalProps) {
  async function onChange(key, val) {
    try {
      await store.settings.set(key, val)
      if (key === 'language') notifyRequireReload()
    } catch {
      notify(t('settingsSaveFailed'), { icon: 'error' })
    }
  }

  return createPortal(
    <LunaModal
      title={t('settings')}
      width={400}
      visible={props.visible}
      onClose={props.onClose}
    >
      <LunaSetting className={Style.settings} onChange={onChange}>
        <LunaSettingTitle title={t('appearance')} />
        <LunaSettingSelect
          keyName="language"
          value={store.settings.language}
          title={t('language')}
          description={t('languageRestartHint')}
          options={{
            [t('sysPreference')]: 'system',
            English: 'en-US',
            '简体中文': 'zh-CN',
          }}
        />
        <LunaSettingSelect
          keyName="theme"
          value={store.settings.theme}
          title={t('theme')}
          options={{
            [t('sysPreference')]: 'system',
            [t('light')]: 'light',
            [t('dark')]: 'dark',
          }}
        />
        <LunaSettingSeparator />
        <LunaSettingTitle title="HDC" />
        <SettingPath
          title={t('hdcPath')}
          value={store.settings.hdcPath}
          onChange={(val) => {
            notifyRequireReload()
            store.settings.set('hdcPath', val)
          }}
          options={{
            properties: ['openFile'],
          }}
        />
        <LunaSettingCheckbox
          keyName="killHdcWhenExit"
          value={store.settings.killHdcWhenExit}
          description={t('killHdcWhenExit')}
        />
        <LunaSettingButton
          description={t('restartApp')}
          onClick={() => main.relaunch()}
        />
      </LunaSetting>
    </LunaModal>,
    document.body
  )
})
