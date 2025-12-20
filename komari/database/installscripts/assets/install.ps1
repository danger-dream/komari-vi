# Windows PowerShell installation script for Komari Agent

function Log-Info { param([string]$Message) Write-Host "$Message" -ForegroundColor Cyan }
function Log-Success { param([string]$Message) Write-Host "$Message" -ForegroundColor Green }
function Log-Warning { param([string]$Message) Write-Host "[WARNING] $Message" -ForegroundColor Yellow }
function Log-Error { param([string]$Message) Write-Host "[ERROR] $Message" -ForegroundColor Red }
function Log-Step { param([string]$Message) Write-Host "$Message" -ForegroundColor Magenta }
function Log-Config { param([string]$Message) Write-Host "- $Message" -ForegroundColor White }

$InstallDir = Join-Path $Env:ProgramFiles "Komari"
$ServiceName = "komari-agent"
$GitHubProxy = ""
$KomariArgs = @()
$InstallVersion = ""
$Endpoint = ""
$Token = ""

for ($i = 0; $i -lt $args.Count; $i++) {
    switch ($args[$i]) {
        "--install-dir" { $InstallDir = $args[$i + 1]; $i++; continue }
        "--install-service-name" { $ServiceName = $args[$i + 1]; $i++; continue }
        "--install-ghproxy" { $GitHubProxy = $args[$i + 1]; $i++; continue }
        "--install-version" { $InstallVersion = $args[$i + 1]; $i++; continue }
        "-e" { $Endpoint = $args[$i + 1]; $KomariArgs += @("-e", $Endpoint); $i++; continue }
        "-t" { $Token = $args[$i + 1]; $KomariArgs += @("-t", $Token); $i++; continue }
        Default { $KomariArgs += $args[$i] }
    }
}

if ($Endpoint -eq "" -or $Token -eq "") {
    Log-Error "Missing required arguments: -e <endpoint> -t <token>"
    exit 1
}
$Endpoint = $Endpoint.TrimEnd('/')

if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    Log-Error "Please run this script as Administrator."
    exit 1
}

switch ($env:PROCESSOR_ARCHITECTURE) {
    'AMD64' { $arch = 'amd64' }
    'ARM64' { $arch = 'arm64' }
    'x86' { $arch = '386' }
    Default { Log-Error "Unsupported architecture: $env:PROCESSOR_ARCHITECTURE"; exit 1 }
}

Log-Step "Ensuring installation directory exists: $InstallDir"
New-Item -ItemType Directory -Path $InstallDir -Force -ErrorAction SilentlyContinue | Out-Null

# nssm 部分暂时仍依赖外网（后续可在面板“附件管理”里托管）
$nssmExeToUse = Join-Path $InstallDir "nssm.exe"
$nssmCmd = Get-Command nssm -ErrorAction SilentlyContinue
if (-not $nssmCmd) {
    if (Test-Path $nssmExeToUse) {
        $env:Path = "$($InstallDir);$($env:Path)"
        $nssmCmd = Get-Command nssm -ErrorAction SilentlyContinue
    }
}
if (-not $nssmCmd) {
    Log-Info "nssm not found. Attempting to download to $InstallDir..."
    $NssmVersion = "2.24"
    $NssmZipUrl = "https://nssm.cc/release/nssm-$NssmVersion.zip"
    $TempNssmZipPath = Join-Path $env:TEMP "nssm-$NssmVersion.zip"
    $TempExtractDir = Join-Path $env:TEMP "nssm_extract_temp"
    try {
        Invoke-WebRequest -Uri $NssmZipUrl -OutFile $TempNssmZipPath -UseBasicParsing
        if (Test-Path $TempExtractDir) { Remove-Item -Recurse -Force $TempExtractDir }
        New-Item -ItemType Directory -Path $TempExtractDir -Force | Out-Null
        Expand-Archive -Path $TempNssmZipPath -DestinationPath $TempExtractDir -Force
        $NssmArchSubDir = Join-Path "nssm-$NssmVersion" "win32"
        $NssmSourceExePath = Join-Path (Join-Path $TempExtractDir $NssmArchSubDir) "nssm.exe"
        Copy-Item -Path $NssmSourceExePath -Destination $nssmExeToUse -Force
        $env:Path = "$($InstallDir);$($env:Path)"
        $nssmCmd = Get-Command nssm -ErrorAction SilentlyContinue
        if (-not $nssmCmd) { throw "nssm still not in PATH" }
    }
    catch {
        Log-Error "Failed to download or configure nssm: $_"
        exit 1
    }
    finally {
        if (Test-Path $TempNssmZipPath) { Remove-Item $TempNssmZipPath -Force -ErrorAction SilentlyContinue }
        if (Test-Path $TempExtractDir) { Remove-Item $TempExtractDir -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

Log-Step "Installation configuration:"
Log-Config "Service name: $ServiceName"
Log-Config "Install directory: $InstallDir"
Log-Config "Agent arguments: $($KomariArgs -join ' ')"
if ($InstallVersion -ne "") { Log-Config "Specified agent version: $InstallVersion" } else { Log-Config "Agent version: Current" }

$AgentPath = Join-Path $InstallDir "komari-agent.exe"

function Uninstall-Previous {
    Log-Step "Checking for existing service..."
    $serviceStatus = nssm status $ServiceName 2>&1
    if ($serviceStatus -notmatch "SERVICE_STOPPED" -and $serviceStatus -notmatch "does not exist") {
        nssm stop $ServiceName 2>&1 | Out-Null
    }
    nssm remove $ServiceName confirm 2>&1 | Out-Null
    if (Test-Path $AgentPath) { Remove-Item $AgentPath -Force }
}
Uninstall-Previous

$DownloadUrl = "$Endpoint/api/public/agent/package?token=$Token&os=windows&arch=$arch"
if ($InstallVersion -ne "") {
    $DownloadUrl = "$DownloadUrl&version=$InstallVersion"
}

Log-Step "Downloading Komari Agent from Komari panel..."
Log-Info "URL: $DownloadUrl"
try {
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $AgentPath -UseBasicParsing
}
catch {
    Log-Error "Download failed: $_"
    exit 1
}
Log-Success "Downloaded and saved to $AgentPath"

Log-Step "Configuring Windows service with nssm..."
$argString = $KomariArgs -join ' '
$quotedAgentPath = "`"$AgentPath`""
nssm install $ServiceName $quotedAgentPath $argString
nssm set $ServiceName DisplayName "Komari Agent Service"
nssm set $ServiceName Start SERVICE_AUTO_START
nssm set $ServiceName AppExit Default Restart
nssm set $ServiceName AppRestartDelay 5000
nssm start $ServiceName
Log-Success "Service $ServiceName installed and started using nssm."

Log-Success "Komari Agent installation completed!"
Log-Config "Service name: $ServiceName"
Log-Config "Arguments: $argString"

