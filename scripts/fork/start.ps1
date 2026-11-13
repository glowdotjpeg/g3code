param([switch]$Desktop)
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
$forkMode = if ($Desktop) { 'dev:desktop' } else { 'dev' }
& pnpm exec vp run $forkMode --home-dir $forkHome --no-seed
exit $LASTEXITCODE
