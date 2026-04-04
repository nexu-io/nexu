param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,

  [int]$PollIntervalMs = 100,

  [int]$AutoTerminateAfterMs = 5000,

  [string]$LogPath = ""
)

$ErrorActionPreference = "Stop"

function Write-Log {
  param(
    [string]$Message
  )

  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"
  $line = "$timestamp | $Message"
  Write-Output $line
  if ($script:ResolvedLogPath) {
    Add-Content -LiteralPath $script:ResolvedLogPath -Value $line
  }
}

function Get-ZoneIdentifier {
  param(
    [string]$Path
  )

  try {
    return Get-Content -LiteralPath $Path -Stream Zone.Identifier -ErrorAction Stop
  } catch {
    return $null
  }
}

function Get-TrackedProcess {
  param(
    [int]$ProcessId,
    [datetime]$StartBoundary,
    [string]$ExpectedPath
  )

  $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($proc) {
    return $proc
  }

  $expectedLeaf = [System.IO.Path]::GetFileName($ExpectedPath)
  $candidates = Get-CimInstance Win32_Process -Filter "Name = '$expectedLeaf'" |
    Where-Object {
      $_.ExecutablePath -eq $ExpectedPath -and
      $_.CreationDate -and
      ([Management.ManagementDateTimeConverter]::ToDateTime($_.CreationDate) -ge $StartBoundary.AddSeconds(-1))
    } |
    Sort-Object CreationDate

  if ($candidates.Count -gt 0) {
    return Get-Process -Id $candidates[0].ProcessId -ErrorAction SilentlyContinue
  }

  return $null
}

function Get-SecurityProcessSnapshot {
  $names = @("MsMpEng", "smartscreen", "MpCmdRun")
  return Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $names -contains $_.ProcessName } |
    Select-Object ProcessName, Id, CPU, StartTime
}

$resolvedInstallerPath = (Resolve-Path -LiteralPath $InstallerPath).Path
$script:ResolvedLogPath = if ($LogPath) {
  [System.IO.Path]::GetFullPath($LogPath)
} else {
  Join-Path $env:TEMP ("nexu-installer-launch-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")
}

"" | Set-Content -LiteralPath $script:ResolvedLogPath

$fileInfo = Get-Item -LiteralPath $resolvedInstallerPath
$signature = Get-AuthenticodeSignature -FilePath $resolvedInstallerPath
$zoneIdentifier = Get-ZoneIdentifier -Path $resolvedInstallerPath

Write-Log "Installer path: $resolvedInstallerPath"
Write-Log "Installer size bytes: $($fileInfo.Length)"
Write-Log "Installer last write: $($fileInfo.LastWriteTime.ToString('o'))"
Write-Log "Signature status: $($signature.Status)"
Write-Log "Signature subject: $($signature.SignerCertificate.Subject)"
if ($zoneIdentifier) {
  Write-Log "Zone.Identifier present"
  foreach ($line in $zoneIdentifier) {
    Write-Log "Zone.Identifier: $line"
  }
} else {
  Write-Log "Zone.Identifier absent"
}

$launchAt = Get-Date
Write-Log "Launching installer"
$started = Start-Process -FilePath $resolvedInstallerPath -PassThru
Write-Log "Start-Process returned pid=$($started.Id)"

$windowSeenAt = $null
$exitSeenAt = $null
$lastPid = $started.Id
$securityLogged = $false
$terminatedByScript = $false

while ($true) {
  Start-Sleep -Milliseconds $PollIntervalMs
  $tracked = Get-TrackedProcess -ProcessId $lastPid -StartBoundary $launchAt -ExpectedPath $resolvedInstallerPath

  if (-not $tracked) {
    $exitSeenAt = Get-Date
    Write-Log "Installer process no longer found"
    break
  }

  $lastPid = $tracked.Id

  if (-not $windowSeenAt -and $tracked.MainWindowHandle -ne 0) {
    $windowSeenAt = Get-Date
    Write-Log "First installer window handle observed pid=$($tracked.Id) title='$($tracked.MainWindowTitle)'"
  }

  if (-not $securityLogged) {
    $security = Get-SecurityProcessSnapshot
    if ($security) {
      foreach ($item in $security) {
        Write-Log "Security process seen: $($item.ProcessName) pid=$($item.Id) cpu=$($item.CPU) started=$($item.StartTime.ToString('o'))"
      }
      $securityLogged = $true
    }
  }

  if ($tracked.HasExited) {
    $exitSeenAt = Get-Date
    Write-Log "Installer process exited code=$($tracked.ExitCode)"
    break
  }

  if (-not $terminatedByScript -and ((Get-Date) - $launchAt).TotalMilliseconds -ge $AutoTerminateAfterMs) {
    try {
      Stop-Process -Id $tracked.Id -Force -ErrorAction Stop
      $terminatedByScript = $true
      $exitSeenAt = Get-Date
      Write-Log "Installer process force-terminated by script after ${AutoTerminateAfterMs}ms"
      break
    } catch {
      Write-Log "Failed to terminate installer process: $($_.Exception.Message)"
    }
  }
}

$afterLaunchMs = [int]((Get-Date) - $launchAt).TotalMilliseconds
Write-Log "Elapsed since launch at script end: ${afterLaunchMs}ms"

if ($windowSeenAt) {
  $windowDelayMs = [int]($windowSeenAt - $launchAt).TotalMilliseconds
  Write-Log "Time to first visible installer window: ${windowDelayMs}ms"
} else {
  Write-Log "Time to first visible installer window: not observed"
}

if ($exitSeenAt) {
  $exitDelayMs = [int]($exitSeenAt - $launchAt).TotalMilliseconds
  Write-Log "Time to installer exit/disappearance: ${exitDelayMs}ms"
}

Write-Log "TerminatedByScript: $terminatedByScript"

Write-Log "Timing log saved to $script:ResolvedLogPath"
