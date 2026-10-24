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
import { useEffect, useRef, useState } from 'react'

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
  const [captureStatus, setCaptureStatus] = useState<{
    codec: 'H.264' | 'JPEG' | null
    fps: number | null
    upgrading: boolean
    canRetryVideo: boolean
  }>({ codec: null, fps: null, upgrading: false, canRetryVideo: false })

  useEffect(() => {
    if ((!expanded && !buttonVisible) || hovered || editing)
      return
    const timer = setTimeout(() => {
      if (expanded) setExpanded(false)
      else setButtonVisible(false)
    }, AUTO_HIDE_DELAY)
    return () => clearTimeout(timer)
  }, [expanded, buttonVisible, hovered, editing])

  useEffect(() => {
    if (!expanded || !screencastClient) return
    let previous = screencastClient.getCaptureStats()
    let previousTime = performance.now()
    setCaptureStatus({ ...previous, fps: null })
    const timer = setInterval(() => {
      const current = screencastClient.getCaptureStats()
      const now = performance.now()
      const elapsed = now - previousTime
      setCaptureStatus({
        codec: current.codec,
        upgrading: current.upgrading,
        canRetryVideo: current.canRetryVideo,
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
    fullscreen.toggle(screencastClient.canvas.parentElement || screencastClient.canvas)
  }

  function inputKey(keyCode: number) {
    return () => main.inputKey(target.key, keyCode)
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
            {captureStatus.codec === 'JPEG' && (
              <button
                type="button"
                className={Style.retryVideo}
                disabled={!captureStatus.canRetryVideo}
                title={t('screencastRetryVideoHint')}
                onClick={() => {
                  void screencastClient.retryVideo()
                  setCaptureStatus(status => ({ ...status, ...screencastClient.getCaptureStats() }))
                }}
              >
                {t(captureStatus.upgrading ? 'screencastSwitchingVideo' : 'screencastRetryVideo')}
              </button>
            )}
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
