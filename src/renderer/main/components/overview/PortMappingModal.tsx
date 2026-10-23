import { t } from 'common/util'
import LunaModal from 'luna-modal/react'
import { observer } from 'mobx-react-lite'
import { createPortal } from 'react-dom'
import Style from './PortMappingModal.module.scss'
import LunaToolbar, {
  LunaToolbarButton,
  LunaToolbarInput,
  LunaToolbarSelect,
  LunaToolbarSeparator,
  LunaToolbarSpace,
} from 'luna-toolbar/react'
import LunaDataGrid from 'luna-data-grid/react'
import { useEffect, useRef, useState } from 'react'
import isStrBlank from 'licia/isStrBlank'
import store from '../../store'
import ToolbarIcon from 'share/renderer/components/ToolbarIcon'
import { IModalProps } from 'share/common/types'
import { notify } from 'share/renderer/lib/util'
import { normalizePort } from '../../lib/util'

export default observer(function PortMappingModal(props: IModalProps) {
  const portForwarding = useRef(true)
  const [local, setLocal] = useState('')
  const [remote, setRemote] = useState('')
  const [selected, setSelected] = useState<any>(null)
  const [data, setData] = useState<
    {
      local: string
      remote: string
    }[]
  >([])
  const connectKey = store.target?.key
  const { visible } = props
  const refresh = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    let active = true
    let requestId = 0

    function clear() {
      setData([])
      setSelected(null)
    }

    refresh.current = async () => {
      if (
        !active ||
        !visible ||
        !connectKey ||
        store.target?.key !== connectKey
      ) {
        return
      }
      const id = ++requestId
      const forwarding = portForwarding.current
      const isCurrent = () =>
        active &&
        id === requestId &&
        store.target?.key === connectKey &&
        portForwarding.current === forwarding

      // Rows and selection belong to one device/direction/read. IPC itself is
      // not cancellable; only the latest visible session may publish its result.
      clear()
      try {
        const rows = forwarding
          ? await main.listForwards(connectKey)
          : await main.listReverses(connectKey)
        if (isCurrent()) setData(rows)
      } catch {
        if (isCurrent()) {
          clear()
          notify(t('commonErr'), { icon: 'error' })
        }
      }
    }

    clear()
    refresh.current()
    return () => {
      active = false
    }
  }, [connectKey, visible])

  return createPortal(
    <LunaModal
      title={t('portMapping')}
      visible={props.visible}
      onClose={props.onClose}
    >
      <div className={Style.container}>
        <LunaToolbar className={Style.toolbar}>
          <LunaToolbarSelect
            keyName="portForwarding"
            onChange={(val) => {
              portForwarding.current = val === 'forward'
              refresh.current()
            }}
            value={portForwarding.current ? 'forward' : 'reverse'}
            options={{
              [t('portForwarding')]: 'forward',
              [t('portReversing')]: 'reverse',
            }}
          />
          <LunaToolbarInput
            keyName="local"
            className={Style.local}
            value={local}
            placeholder={t('local')}
            onChange={(val) => setLocal(val)}
          />
          <LunaToolbarInput
            keyName="remote"
            className={Style.remote}
            value={remote}
            placeholder={t('remote')}
            onChange={(val) => setRemote(val)}
          />
          <LunaToolbarButton
            state="hover"
            disabled={isStrBlank(local) || isStrBlank(remote) || !store.target}
            onClick={async () => {
              if (!store.target) {
                return
              }
              const l = normalizePort(local)
              const r = normalizePort(remote)
              const refreshAfterWrite = refresh.current
              try {
                if (portForwarding.current) {
                  await main.forward(store.target.key, l, r)
                } else {
                  await main.reverse(store.target.key, r, l)
                }
              } catch {
                notify(t('commonErr'), { icon: 'error' })
                return
              }
              refreshAfterWrite()
            }}
          >
            {t('add')}
          </LunaToolbarButton>
          <LunaToolbarSpace />
          <ToolbarIcon
            icon="delete"
            title={t('delete')}
            onClick={async () => {
              if (!store.target || !selected) {
                return
              }
              const refreshAfterWrite = refresh.current
              try {
                if (portForwarding.current) {
                  await main.removeForward(
                    store.target.key,
                    selected.local,
                    selected.remote,
                  )
                } else {
                  await main.removeReverse(
                    store.target.key,
                    selected.remote,
                    selected.local,
                  )
                }
              } catch {
                notify(t('commonErr'), { icon: 'error' })
                return
              }
              refreshAfterWrite()
            }}
            disabled={!store.target || !selected}
          />
          <LunaToolbarSeparator />
          <ToolbarIcon
            icon="refresh"
            title={t('refresh')}
            onClick={() => refresh.current()}
            disabled={!store.target}
          />
        </LunaToolbar>
        <LunaDataGrid
          onSelect={async (node) => setSelected(node.data)}
          onDeselect={() => setSelected(null)}
          className={Style.grid}
          data={data}
          minHeight={250}
          maxHeight={250}
          selectable={true}
          columns={columns}
        />
      </div>
    </LunaModal>,
    document.body,
  )
})

const columns = [
  {
    id: 'local',
    title: t('local'),
    sortable: true,
  },
  {
    id: 'remote',
    title: t('remote'),
    sortable: true,
  },
]
