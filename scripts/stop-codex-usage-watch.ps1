param(
    [string]$ProjectRoot
)

$ErrorActionPreference = 'Stop'

if (-not $ProjectRoot) {
    $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
} else {
    $ProjectRoot = (Resolve-Path $ProjectRoot).Path
}

$usageDir = Join-Path $ProjectRoot '.codex-usage'
$pidFile = Join-Path $usageDir 'watcher.pid'
$stateFile = Join-Path $usageDir 'watcher-launch.json'

function Write-LaunchState {
    param([hashtable]$State)
    New-Item -ItemType Directory -Path $usageDir -Force | Out-Null
    $State.generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    $State.projectRoot = [string]$ProjectRoot
    $State | ConvertTo-Json -Depth 4 | Set-Content -Path $stateFile -Encoding UTF8
}

if (-not (Test-Path $pidFile)) {
    Write-LaunchState @{
        status = 'not-running'
        reason = 'missing-pid-file'
    }
    exit 0
}

$pidText = Get-Content -Path $pidFile -Raw -ErrorAction SilentlyContinue
if ($null -eq $pidText) {
    $pidText = ''
}

$watcherPid = 0
if (-not [int]::TryParse($pidText.Trim(), [ref]$watcherPid)) {
    Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
    Write-LaunchState @{
        status = 'not-running'
        reason = 'invalid-pid-file'
    }
    exit 0
}

$process = Get-Process -Id $watcherPid -ErrorAction SilentlyContinue
if (-not $process) {
    Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
    Write-LaunchState @{
        status = 'not-running'
        reason = 'stale-pid-file'
        pid = $watcherPid
    }
    exit 0
}

$commandLine = ''
try {
    $commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $watcherPid").CommandLine
} catch {
    $commandLine = ''
}

if ($commandLine -notlike '*codex-session-monitor.mjs*') {
    Write-LaunchState @{
        status = 'not-stopped'
        reason = 'pid-does-not-match-monitor'
        pid = $watcherPid
        commandLine = $commandLine
    }
    exit 1
}

Stop-Process -Id $watcherPid -Force
Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue

Write-LaunchState @{
    status = 'stopped'
    pid = $watcherPid
}
