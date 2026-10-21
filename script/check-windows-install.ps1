$ErrorActionPreference = 'Stop'

# NSIS may replace an existing installation with the same app ID. Only install
# on the disposable GitHub-hosted runner, never on a developer's workstation.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows') {
  throw 'Installation smoke checks require a disposable GitHub-hosted Windows runner'
}

$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$installer = (Resolve-Path "release/$($pkg.version)/$($pkg.productName)-$($pkg.version)-win-x64.exe").Path
$installDir = Join-Path $env:RUNNER_TEMP ('Scrcpy Harmony Installed ' + [guid]::NewGuid())
$executable = Join-Path $installDir "$($pkg.productName).exe"
$installerProcess = Start-Process -FilePath $installer -ArgumentList "/S /currentuser /D=$installDir" -WindowStyle Hidden -PassThru
if (!$installerProcess.WaitForExit(120000)) {
  Stop-Process -Id $installerProcess.Id -Force
  throw 'NSIS installation timed out'
}
if ($installerProcess.ExitCode -ne 0) {
  throw "NSIS installation failed: $($installerProcess.ExitCode)"
}
if (!(Test-Path -LiteralPath $executable -PathType Leaf)) {
  throw "Installed executable is missing: $executable"
}

try {
  node script/smoke-app.mjs $executable
  if ($LASTEXITCODE -ne 0) { throw 'Installed application startup check failed' }
} finally {
  # HDC can outlive the UI; the runner is isolated and has no user's devices.
  $hdc = Join-Path $installDir 'resources/hdc/hdc.exe'
  if (Test-Path -LiteralPath $hdc) { & $hdc kill }
}
