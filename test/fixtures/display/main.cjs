const { app, screen } = require('electron')
app.setPath('userData', process.env.DISPLAY_USER_DATA)
app.commandLine.appendSwitch(
  'force-device-scale-factor',
  process.env.DISPLAY_DSF,
)
app.whenReady().then(() => {
  const actual = screen.getPrimaryDisplay()
  const workArea = JSON.parse(process.env.DISPLAY_WORK_AREA)
  const simulated = {
    ...actual,
    workArea,
    workAreaSize: { width: workArea.width, height: workArea.height },
  }
  global.displayEvidence = {
    runtimeDisplayBeforeWorkAreaStub: {
      bounds: actual.bounds,
      workArea: actual.workArea,
      scaleFactor: actual.scaleFactor,
    },
    simulatedWorkArea: workArea,
  }
  screen.getDisplayNearestPoint = () => simulated
  screen.getDisplayMatching = () => simulated
  screen.getPrimaryDisplay = () => simulated
  // Optional persisted bounds exercise the real shared window restoration.
  global.displayWindowData = JSON.parse(
    process.env.DISPLAY_SAVED_BOUNDS || '{}',
  )
  require('../../../dist/display/main/index.cjs').showWin()
})
app.on('window-all-closed', () => app.quit())
