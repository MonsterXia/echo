import Screencast from './components/Screencast'
import Toolbar from './components/Toolbar'
import { observer } from 'mobx-react-lite'
import store from './store'
import useHapDrop from '../lib/useHapDrop'

export default observer(function App() {
  useHapDrop(store.target?.key)
  return (
    <>
      <Toolbar />
      {store.target && <Screencast key={store.target.key} />}
    </>
  )
})
