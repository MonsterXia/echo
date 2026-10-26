import { useEffect, useRef, useState } from 'react'
import type { UpdateAction, UpdateState } from 'common/types'
import { t } from 'common/util'
import icon from '../assets/icon.png'
import Style from './App.module.scss'

export default function UpdateApp() {
  const [state, setState] = useState<UpdateState>({ status: 'checking', productName: PRODUCT_NAME, currentVersion: VERSION })
  const [acting, setActing] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let active = true
    let received = false
    const update = (value: UpdateState) => { if (active) { received = true; setState(value) } }
    const unsubscribe = main.on('updateState', update)
    void main.getUpdateState().then((value) => {
      if (active && !received) setState(value)
    }).catch(() => {
      if (active) setState(value => ({ ...value, status: 'error' }))
    })
    return () => { active = false; unsubscribe() }
  }, [])
  useEffect(() => { panel.current?.focus() }, [state.status])

  async function act(action: UpdateAction) {
    if (acting) return
    setActing(true)
    try { await main.updateAction(action) }
    catch { setState(value => ({ ...value, status: 'error' })) }
    finally { setActing(false) }
  }

  const checking = state.status === 'checking'
  const available = state.status === 'available'
  const title = checking ? t('checkingForUpdates') : t(available ? 'updateFoundTitle' : state.status === 'error' ? 'updateFailedTitle' : state.status === 'unavailable' ? 'updateUnsupportedTitle' : 'updateCurrentTitle')
  const description = state.status === 'error' ? t('updateFailedDescription')
    : state.status === 'unavailable' ? t('updateUnsupportedDescription', { version: state.latestVersion }) : available
    ? t('updateFoundDescription', { name: state.productName, version: state.latestVersion })
    : state.latestVersion && state.latestVersion !== state.currentVersion
      ? t('updateNoNewerDescription', { version: state.latestVersion })
      : t('updateCurrentDescription', { name: state.productName, version: state.currentVersion })

  return <div
    ref={panel}
    tabIndex={-1}
    className={`${Style.panel} ${checking ? Style.checking : Style.result} ${available ? Style.withSecondary : ''}`}
    role="dialog"
    aria-labelledby="update-heading"
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); void act(checking ? 'cancel' : 'close') }
      else if (event.key === 'Enter' && event.target === event.currentTarget) {
        event.preventDefault(); void act(checking ? 'cancel' : available ? 'openRelease' : 'close')
      }
    }}
  >
    {checking && <header>{t('softwareUpdate')}</header>}
    <div className={Style.content}>
      <img className={Style.icon} src={icon} alt="" />
      <section aria-live="polite">
        <h1 id="update-heading">{title}</h1>
        {checking ? <div className={Style.progress} role="progressbar" aria-label={t('checkingForUpdates')}><span /></div>
          : <p>{description}</p>}
      </section>
    </div>
    <div className={Style.actions}>
      {checking ? <button disabled={acting} onClick={() => void act('cancel')}>{t('updateCancel')}</button>
        : <>
          <button className={Style.primary} disabled={acting} onClick={() => void act(available ? 'openRelease' : 'close')}>{t(available ? 'updateOpenReleases' : 'updateOK')}</button>
          {available && <button disabled={acting} onClick={() => void act('close')}>{t('updateLater')}</button>}
        </>}
    </div>
  </div>
}
