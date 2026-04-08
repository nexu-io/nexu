param(
  [Parameter(Mandatory = $true)]
  [string]$SourceInstallerPath,

  [Parameter(Mandatory = $true)]
  [ValidateSet("baseline", "unblock", "selfsigned")]
  [string]$Variant,

  [string]$OutputDirectory = "$env:USERPROFILE\Downloads",

  [int]$AutoTerminateAfterMs = 5000,

  [string]$ResultsDirectory = "$env:TEMP\nexu-installer-experiments"
)

$ErrorActionPreference = "Stop"

function Write-ExperimentLog {
  param([string]$Message)
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"
  $line = "$timestamp | $Message"
  Write-Output $line
  Add-Content -LiteralPath $script:MasterLogPath -Value $line
}

function New-ExperimentCopy {
  param(
    [string]$VariantName
  )

  $sourceLeaf = [System.IO.Path]::GetFileNameWithoutExtension($script:ResolvedSourceInstaller)
  $targetPath = Join-Path $OutputDirectory ("${sourceLeaf}-${VariantName}.exe")
  Copy-Item -Force -LiteralPath $script:ResolvedSourceInstaller -Destination $targetPath
  return $targetPath
}

function Get-ZoneState {
  param([string]$Path)

  try {
    return Get-Content -LiteralPath $Path -Stream Zone.Identifier -ErrorAction Stop
  } catch {
    return @()
  }
}

function Write-MetadataSnapshot {
  param(
    [string]$VariantName,
    [string]$TargetPath
  )

  $file = Get-Item -LiteralPath $TargetPath
  $signature = Get-AuthenticodeSignature -FilePath $TargetPath
  $zone = Get-ZoneState -Path $TargetPath
  $metadataPath = Join-Path $ResultsDirectory ("${VariantName}-metadata.txt")

  @(
    "Variant: $VariantName"
    "Path: $TargetPath"
    "Length: $($file.Length)"
    "LastWriteTime: $($file.LastWriteTime.ToString('o'))"
    "SignatureStatus: $($signature.Status)"
    "SignatureType: $($signature.SignatureType)"
    "SignerSubject: $($signature.SignerCertificate.Subject)"
    "ZoneIdentifierPresent: $([bool]($zone.Count -gt 0))"
  ) | Set-Content -LiteralPath $metadataPath

  if ($zone.Count -gt 0) {
    Add-Content -LiteralPath $metadataPath -Value "ZoneIdentifierContents:"
    Add-Content -LiteralPath $metadataPath -Value $zone
  }

  Write-ExperimentLog "Metadata written for $VariantName -> $metadataPath"
}

function Invoke-TimingRun {
  param(
    [string]$VariantName,
    [string]$TargetPath
  )

  $timingScript = Join-Path $script:RepoScriptsDir "windows-installer-first-run-timing.ps1"
  $timingLogPath = Join-Path $ResultsDirectory ("${VariantName}-timing.log")

  Write-ExperimentLog "Starting timing run for $VariantName"
  powershell -ExecutionPolicy Bypass -File $timingScript -InstallerPath $TargetPath -AutoTerminateAfterMs $AutoTerminateAfterMs -LogPath $timingLogPath
  Write-ExperimentLog "Timing run finished for $VariantName -> $timingLogPath"
}

function New-SelfSignedCodeSigningCert {
  param(
    [string]$VariantName,
    [string]$TargetPath
  )

  $cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject "CN=Nexu Local Test" `
    -CertStoreLocation "Cert:\CurrentUser\My"

  $password = ConvertTo-SecureString "nexu-local-test" -AsPlainText -Force
  $pfxPath = Join-Path $ResultsDirectory ("${VariantName}.pfx")

  Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $password | Out-Null

  Write-ExperimentLog "Created self-signed cert -> $pfxPath"
  Write-ExperimentLog "Manual step may be required if you want to import it into Trusted Publishers/Root for local trust simulation"

  return @{ PfxPath = $pfxPath; Password = $password }
}

function Sign-Installer {
  param(
    [string]$TargetPath,
    [string]$PfxPath,
    [securestring]$Password
  )

  $plainPassword = [System.Net.NetworkCredential]::new("user", $Password).Password
  $signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if (-not $signtool) {
    $sdkSigntool = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
      Sort-Object FullName -Descending |
      Select-Object -First 1

    if (-not $sdkSigntool) {
      throw "signtool.exe not found on PATH or under Windows Kits"
    }

    $signtool = @{ Source = $sdkSigntool.FullName }
  }

  & $signtool.Source sign /fd SHA256 /f $PfxPath /p $plainPassword $TargetPath
  Write-ExperimentLog "Signed installer -> $TargetPath"
}

$script:ResolvedSourceInstaller = (Resolve-Path -LiteralPath $SourceInstallerPath).Path
$script:RepoScriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
New-Item -ItemType Directory -Force -Path $ResultsDirectory | Out-Null
$script:MasterLogPath = Join-Path $ResultsDirectory ("experiment-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")

Write-ExperimentLog "Source installer: $script:ResolvedSourceInstaller"
Write-ExperimentLog "Variant: $Variant"
Write-ExperimentLog "Output directory: $OutputDirectory"
Write-ExperimentLog "Results directory: $ResultsDirectory"

if ($Variant -eq "baseline") {
  $baselinePath = New-ExperimentCopy -VariantName "baseline"
  Write-MetadataSnapshot -VariantName "baseline" -TargetPath $baselinePath
  Invoke-TimingRun -VariantName "baseline" -TargetPath $baselinePath
}

if ($Variant -eq "unblock") {
  $unblockPath = New-ExperimentCopy -VariantName "unblock"
  Unblock-File -LiteralPath $unblockPath
  Write-ExperimentLog "Applied Unblock-File to $unblockPath"
  Write-MetadataSnapshot -VariantName "unblock" -TargetPath $unblockPath
  Invoke-TimingRun -VariantName "unblock" -TargetPath $unblockPath
}

if ($Variant -eq "selfsigned") {
  $selfSignedPath = New-ExperimentCopy -VariantName "selfsigned"
  $certInfo = New-SelfSignedCodeSigningCert -VariantName "selfsigned" -TargetPath $selfSignedPath
  Sign-Installer -TargetPath $selfSignedPath -PfxPath $certInfo.PfxPath -Password $certInfo.Password
  Write-MetadataSnapshot -VariantName "selfsigned" -TargetPath $selfSignedPath
  Invoke-TimingRun -VariantName "selfsigned" -TargetPath $selfSignedPath
}

Write-ExperimentLog "Experiment complete"
