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
$outLog = Join-Path $usageDir 'watcher.out.log'
$errLog = Join-Path $usageDir 'watcher.err.log'
$monitorScript = Join-Path $ProjectRoot 'scripts\codex-session-monitor.mjs'

New-Item -ItemType Directory -Path $usageDir -Force | Out-Null

function Write-LaunchState {
    param([hashtable]$State)
    $State.generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    $State.projectRoot = [string]$ProjectRoot
    $State | ConvertTo-Json -Depth 4 | Set-Content -Path $stateFile -Encoding UTF8
}

if (-not (Test-Path $monitorScript)) {
    Write-LaunchState @{
        status = 'missing-monitor-script'
        monitorScript = $monitorScript
    }
    exit 0
}

if (Test-Path $pidFile) {
    $existingPidText = Get-Content -Path $pidFile -Raw -ErrorAction SilentlyContinue
    $existingPid = 0
    if ($null -eq $existingPidText) {
        $existingPidText = ''
    }

    if ([int]::TryParse($existingPidText.Trim(), [ref]$existingPid)) {
        $existingProcess = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
        if ($existingProcess) {
            $commandLine = ''
            try {
                $commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $existingPid").CommandLine
            } catch {
                $commandLine = ''
            }

            if ($commandLine -like '*codex-session-monitor.mjs*') {
                Write-LaunchState @{
                    status = 'already-running'
                    pid = $existingPid
                    commandLine = $commandLine
                }
                exit 0
            }
        }
    }

    Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    Write-LaunchState @{
        status = 'missing-node'
        message = 'node.exe was not found in PATH'
    }
    exit 0
}

$process = Start-Process `
    -FilePath $nodeCommand.Source `
    -ArgumentList @('scripts/codex-session-monitor.mjs', 'watch', '--repo', [string]$ProjectRoot) `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -PassThru

Set-Content -Path $pidFile -Value $process.Id -NoNewline -Encoding ASCII
Start-Sleep -Milliseconds 500

$startedProcess = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
Write-LaunchState @{
    status = if ($startedProcess) { 'started' } else { 'exited-after-start' }
    pid = $process.Id
    node = $nodeCommand.Source
    outLog = $outLog
    errLog = $errLog
}
