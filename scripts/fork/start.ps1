param([switch]$Web, [switch]$Desktop)
$ErrorActionPreference = 'Stop'
$forkRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$forkHome = Join-Path $env:USERPROFILE '.g3code'
if (!(Test-Path -LiteralPath (Join-Path $forkHome 'userdata\statev2.sqlite'))) {
  throw 'Import your data first: node scripts/fork/snapshot.mjs "$env:USERPROFILE\.g3code"'
}
if (!(Test-Path -LiteralPath (Join-Path $forkHome 'snapshot-report.json'))) {
  throw 'The data import did not finish. Keep this snapshot offline until it is validated.'
}
Set-Location -LiteralPath $forkRoot
$githubCliDirectory = Join-Path $env:ProgramFiles 'GitHub CLI'
if (Test-Path -LiteralPath (Join-Path $githubCliDirectory 'gh.exe')) {
  $env:PATH = $githubCliDirectory + ';' + $env:PATH
}
if (!$env:GH_TOKEN) {
  $env:GCM_INTERACTIVE = 'never'
  $githubCredential = "protocol=https`nhost=github.com`n`n" | git credential fill 2>$null
  if ($LASTEXITCODE -eq 0) {
    foreach ($githubLine in $githubCredential) {
      if ($githubLine.StartsWith('password=')) { $env:GH_TOKEN = $githubLine.Substring(9) }
    }
  }
}
if ($Web) {
  & pnpm exec vp run dev --home-dir $forkHome --no-seed
  exit $LASTEXITCODE
}
$electronPath = Join-Path $forkRoot 'apps\desktop\node_modules\electron\dist\electron.exe'
$desktopEntry = Join-Path $forkRoot 'apps\desktop\dist-electron\boot.cjs'
if (!(Test-Path -LiteralPath $electronPath) -or !(Test-Path -LiteralPath $desktopEntry)) {
  throw 'Build the desktop app first: pnpm exec vp run build:desktop'
}
foreach ($variable in @('ELECTRON_RUN_AS_NODE', 'VITE_DEV_SERVER_URL', 'VITE_HTTP_URL', 'VITE_WS_URL', 'T3CODE_PORT', 'T3CODE_MODE', 'T3_SERVICE_LAUNCHER_CONTEXT', 'T3_BOOT_SERVICE_UNIT')) {
  Remove-Item -LiteralPath ('Env:' + $variable) -ErrorAction SilentlyContinue
}
$env:T3CODE_HOME = $forkHome
$env:T3CODE_DESKTOP_USER_DATA_DIR = Join-Path $forkHome 'desktop-profile'
$env:T3CODE_DESKTOP_APP_USER_MODEL_ID = 'com.glowdotjpeg.g3code'
$env:T3CODE_DISABLE_AUTO_UPDATE = 'true'
$env:T3CODE_TELEMETRY_ENABLED = 'false'
$launchLogs = Join-Path $forkHome 'userdata\logs'
New-Item -ItemType Directory -Path $launchLogs -Force | Out-Null
$desktopProcess = Start-Process -FilePath $electronPath -ArgumentList ('"' + $desktopEntry + '"') -WorkingDirectory (Join-Path $forkRoot 'apps\desktop') -RedirectStandardOutput (Join-Path $launchLogs 'desktop-stdout.log') -RedirectStandardError (Join-Path $launchLogs 'desktop-stderr.log') -PassThru
$desktopProcess.Id | Set-Content -LiteralPath (Join-Path $forkHome 'desktop.pid')
