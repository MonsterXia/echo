import { FC, PropsWithChildren, useState } from 'react'
import Toolbar from './components/toolbar/Toolbar'
import Style from './App.module.scss'
import { observer } from 'mobx-react-lite'
import store from './store'
import Overview from './components/overview/Overview'
import Screenshot from './components/screenshot/Screenshot'
import Application from './components/application/Application'
import Process from './components/process/Process'
import Shell from './components/shell/Shell'
import Layout from './components/layout/Layout'
import Webview from './components/webview/Webview'
import Hilog from './components/hilog/Hilog'
import useHapDrop from '../lib/useHapDrop'

export default observer(function App() {
  useHapDrop(store.target?.key)

  return (
    <>
      <Toolbar />
      {store.ready && (
        <div className={Style.workspace}>
          <div
            className={Style.panels}
            key={store.target ? store.target.key : ''}
          >
            <Panel panel="overview">
              <Overview />
            </Panel>
            <Panel panel="application">
              <Application />
            </Panel>
            <Panel panel="process">
              <Process />
            </Panel>
            <Panel panel="shell">
              <Shell />
            </Panel>
            <Panel panel="layout">
              <Layout />
            </Panel>
            <Panel panel="screenshot">
              <Screenshot />
            </Panel>
            <Panel panel="hilog">
              <Hilog />
            </Panel>
            <Panel panel="webview">
              <Webview />
            </Panel>
          </div>
        </div>
      )}
    </>
  )
})

interface IPanelProps {
  panel: string
}

const Panel: FC<PropsWithChildren<IPanelProps>> = observer(function Panel(
  props
) {
  const [used, setUsed] = useState(false)

  let visible = false

  if (store.panel === props.panel) {
    if (!used) {
      setUsed(true)
    }
    visible = true
  }

  const style: React.CSSProperties = {}
  if (!visible) {
    style.opacity = 0
    style.pointerEvents = 'none'
  }

  return (
    <div className={Style.panel} style={style}>
      {used ? props.children : null}
    </div>
  )
})
