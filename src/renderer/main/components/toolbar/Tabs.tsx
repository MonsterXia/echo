import LunaTab, { LunaTabItem } from 'luna-tab/react'
import { observer } from 'mobx-react-lite'
import map from 'licia/map'
import { t } from 'common/util'
import Style from './Tabs.module.scss'
import store from '../../store'

export default observer(function Panels() {
  const tabItems = map(
    {
      overview: t('overview'),
      application: t('application'),
      process: t('process'),
      shell: t('shell'),
      layout: t('layout'),
      screenshot: t('screenshot'),
      hilog: t('hilog'),
      webview: t('webview'),
    },
    (title, panel) => {
      return (
        <LunaTabItem
          key={panel}
          id={panel}
          title={title}
          selected={panel === store.panel}
        />
      )
    }
  )

  return (
    <LunaTab
      className={Style.container}
      height={31}
      onSelect={(panel) => store.selectPanel(panel)}
    >
      {tabItems}
    </LunaTab>
  )
})
