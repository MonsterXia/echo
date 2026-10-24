import { observer } from 'mobx-react-lite'
import { createPortal } from 'react-dom'
import LunaToolbar, {
  LunaToolbarSelect,
  LunaToolbarSeparator,
  LunaToolbarSpace,
  LunaToolbarText,
} from 'luna-toolbar/react'
import ToolbarIcon from 'share/renderer/components/ToolbarIcon'
import { t } from 'common/util'
import Style from './Toolbar.module.scss'
import store from '../store'
import download from 'licia/download'
import toStr from 'licia/toStr'
import toNum from 'licia/toNum'
import fullscreen from 'licia/fullscreen'
import LunaModal from 'luna-modal'
import { useEffect, useRef, useState } from 'react'
import { notify } from 'share/renderer/lib/util'

const KEYCODE_HOME = 1
const KEYCODE_BACK = 2
const KEYCODE_VOLUME_UP = 16
const KEYCODE_VOLUME_DOWN = 17
const KEYCODE_POWER = 18
const AUTO_HIDE_DELAY = 2000

export default observer(function Toolbar() {
  const { target, screencastClient } = store
  const [expanded, setExpanded] = useState(false)
  const [buttonVisible, setButtonVisible] = useState(true)
  const toggle = useRef<HTMLButtonElement>(null)
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const keyboardInteraction = useRef(false)
  const [isInputPending, setIsInputPending] = useState(false)
  const [captureStatus, setCaptureStatus] = useState<{
    codec: 'H.264' | 'JPEG' | null
    fps: number | null
  }>({ codec: null, fps: null })
  const inputSession = useRef<{ active: boolean; pending: boolean } | null>(
    null,
  )

  useEffect(() => {
    if ((!expanded && !buttonVisible) || hovered || editing || isInputPending)
      return
    const timer = setTimeout(() => {
      if (expanded) setExpanded(false)
      else setButtonVisible(false)
    }, AUTO_HIDE_DELAY)
    return () => clearTimeout(timer)
  }, [expanded, buttonVisible, hovered, editing, isInputPending])

  useEffect(() => {
    const session = { active: true, pending: false }
    inputSession.current = session
    setIsInputPending(false)
    return () => {
      // Invalidate UI continuations; an already sent write is not cancelled.
      session.active = false
    }
  }, [target])

  useEffect(() => {
    if (!expanded || !screencastClient) return
    let previous = screencastClient.getCaptureStats()
    let previousTime = performance.now()
    setCaptureStatus({ codec: previous.codec, fps: null })
    const timer = setInterval(() => {
      const current = screencastClient.getCaptureStats()
      const now = performance.now()
      const elapsed = now - previousTime
      setCaptureStatus({
        codec: current.codec,
        fps:
          current.codec &&
          current.generation === previous.generation &&
          elapsed > 0
            ? (Math.max(0, current.frames - previous.frames) * 1000) / elapsed
            : null,
      })
      previous = current
      previousTime = now
    }, 1000)
    return () => clearInterval(timer)
  }, [expanded, screencastClient])

  async function captureScreenshot() {
    const canvas = screencastClient.canvas
    const dataUrl = canvas.toDataURL('image/png')
    const blob = await fetch(dataUrl).then((res) => res.blob())
    download(blob, 'screenshot.png', 'image/png')
  }

  async function toggleFullscreen() {
    fullscreen.toggle(screencastClient.canvas)
  }

  function inputKey(keyCode: number) {
    return () => main.inputKey(target.key, keyCode)
  }

  async function inputText() {
    const session = inputSession.current
    if (!target || !session?.active || session.pending) return
    const isCurrent = () => session.active && store.target === target
    if (!isCurrent()) return

    session.pending = true
    setIsInputPending(true)
    try {
      const text = await LunaModal.prompt(t('inputText'), '')
      if (text && isCurrent()) {
        await main.inputText(target.key, text)
      }
    } catch {
      if (isCurrent()) notify(t('commonErr'), { icon: 'error' })
    } finally {
      if (isCurrent()) {
        session.pending = false
        setIsInputPending(false)
      }
    }
  }

  return (
    <div
      className={Style.overlay}
      onMouseEnter={() => {
        setHovered(true)
        setButtonVisible(true)
      }}
      onMouseLeave={() => setHovered(false)}
      onPointerDownCapture={(event) => {
        keyboardInteraction.current = false
        setEditing(
          (event.target as HTMLElement).matches('select, input, textarea'),
        )
      }}
      onFocusCapture={(event) => {
        setButtonVisible(true)
        setEditing(
          keyboardInteraction.current ||
            event.target.matches('select, input, textarea'),
        )
      }}
      onBlurCapture={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget) &&
          !toggle.current?.contains(event.relatedTarget)
        )
          setEditing(false)
      }}
      onKeyDownCapture={() => {
        keyboardInteraction.current = true
        setEditing(true)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && expanded) {
          event.preventDefault()
          event.stopPropagation()
          setExpanded(false)
          toggle.current?.focus()
        }
      }}
    >
      {createPortal(
        <div className={Style.entry}>
          <button
            ref={toggle}
            type="button"
            className={Style.toggle}
            data-visible={expanded || buttonVisible}
            aria-label={t(
              expanded ? 'hideScreencastTools' : 'showScreencastTools',
            )}
            title={t(expanded ? 'hideScreencastTools' : 'showScreencastTools')}
            aria-expanded={expanded}
            aria-controls="screencast-tools"
            onClick={() => setExpanded(!expanded)}
          >
            <span aria-hidden="true">{expanded ? '×' : '⋯'}</span>
          </button>
        </div>,
        document.body,
      )}
      <div
        id="screencast-tools"
        data-visible={expanded}
        aria-hidden={!expanded}
        inert={!expanded}
        className={Style.panel}
      >
        <LunaToolbar className={Style.container}>
          <ToolbarIcon
            icon="power"
            title={t('power')}
            onClick={inputKey(KEYCODE_POWER)}
          />
          <ToolbarIcon
            icon="volume"
            title={t('volumeUp')}
            onClick={inputKey(KEYCODE_VOLUME_UP)}
          />
          <ToolbarIcon
            icon="volume-down"
            title={t('volumeDown')}
            onClick={inputKey(KEYCODE_VOLUME_DOWN)}
          />
          <LunaToolbarSeparator />
          <ToolbarIcon
            icon="back"
            title={t('back')}
            onClick={inputKey(KEYCODE_BACK)}
          />
          <ToolbarIcon
            icon="circle"
            title={t('home')}
            onClick={inputKey(KEYCODE_HOME)}
          />
          <ToolbarIcon
            icon="text"
            title={t('inputText')}
            disabled={!target || isInputPending}
            onClick={inputText}
          />
          <LunaToolbarSeparator />
          <ToolbarIcon
            icon="camera"
            title={t('screenshot')}
            onClick={captureScreenshot}
          />
          <LunaToolbarSeparator />
          <ToolbarIcon
            icon="pin"
            title={t('alwaysOnTop')}
            state={store.alwaysOnTop ? 'hover' : ''}
            onClick={() => {
              store.setAlwaysOnTop(!store.alwaysOnTop)
            }}
          />
          <ToolbarIcon
            icon="fullscreen"
            title={t('fullscreen')}
            onClick={toggleFullscreen}
          />
          <LunaToolbarSpace />
          <div className={Style.details}>
            <span
              className={Style.status}
              data-capture-status
              title={t('screencastStatusHint')}
            >
              <span>{captureStatus.codec || t('screencastWaiting')}</span>
              <span>
                {captureStatus.fps === null
                  ? '—'
                  : captureStatus.fps.toFixed(1)}{' '}
                FPS
              </span>
            </span>
            <LunaToolbarText text={t('scale') + ':'} />
            <LunaToolbarSelect
              className={Style.resolution}
              keyName="scale"
              onChange={(val) => {
                store.setScale(toNum(val))
                if (!keyboardInteraction.current) setEditing(false)
              }}
              title={t('screencastScaleHint')}
              value={toStr(store.scale)}
              options={{
                [t('screencastOriginalScale')]: '1',
                [t('screencastSmoothScale')]: '0.5',
              }}
            />
          </div>
        </LunaToolbar>
      </div>
    </div>
  )
})
