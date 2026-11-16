# Sylou Local on Windows.
#
# Run it through sylou.cmd, which starts this with the execution policy
# bypassed for that one process: Windows refuses unsigned downloaded scripts
# by default, and a release is a downloaded file (D21).
#
#   .\sylou.cmd setup you@example.com   set the install up and make an account
#   .\sylou.cmd start | stop | status
#   .\sylou.cmd logs [service]
#   .\sylou.cmd add-user you@example.com
#   .\sylou.cmd reset-password you@example.com
#
# This script only gathers facts about your computer and calls Docker (D4):
# the secrets, the migrations and the accounts are made inside the tools
# image, so there is one implementation of each and one place to test it.

#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Command = "help",

    [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
    [string[]]$Rest = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$PackageDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigDir = Join-Path $PackageDir "config"
$SecretsDir = Join-Path $ConfigDir "secrets"
$SettingsFile = Join-Path $ConfigDir "settings.env"
$ExampleSettings = Join-Path $PackageDir "settings.example.env"

function Write-Step([string]$Text) { Write-Host "==> $Text" }
function Write-Note([string]$Text) { Write-Host "    $Text" }
function Write-Warn([string]$Text) { Write-Host "/!\ $Text" -ForegroundColor Yellow }
function Fail([string]$Text) { Write-Host "    $Text" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

function Get-Settings {
    $settings = @{ SYLOU_PORT = "8080"; SYLOU_IMAGE_TAG = "dev"; SYLOU_LOCAL_ONLY = "" }
    if (Test-Path $SettingsFile) {
        foreach ($line in Get-Content $SettingsFile) {
            $trimmed = $line.Trim()
            if ($trimmed -eq "" -or $trimmed.StartsWith("#")) { continue }
            $parts = $trimmed.Split("=", 2)
            if ($parts.Count -eq 2) { $settings[$parts[0].Trim()] = $parts[1].Trim() }
        }
    }
    return $settings
}

function Test-LocalOnly($Settings) {
    $value = ""
    if ($Settings.ContainsKey("SYLOU_LOCAL_ONLY")) { $value = "$($Settings.SYLOU_LOCAL_ONLY)" }
    return @("true", "1", "yes", "on") -contains $value.Trim().ToLower()
}

function Get-ComposeArgs($Settings) {
    $composeArgs = @("compose", "--project-directory", $PackageDir, "-f", (Join-Path $PackageDir "compose.yaml"))
    if (Test-LocalOnly $Settings) {
        $composeArgs += @("-f", (Join-Path $PackageDir "compose.local-only.yaml"), "--profile", "local-only")
    }
    if (Test-Path $SettingsFile) { $composeArgs += @("--env-file", $SettingsFile) }
    return $composeArgs
}

function Invoke-Compose($Settings, [string[]]$Arguments) {
    $all = (Get-ComposeArgs $Settings) + $Arguments
    # Out-Host, not the pipeline: whatever a PowerShell function writes to
    # the pipeline is part of what it returns, so without this the exit code
    # below would come back with every line Docker printed in front of it,
    # and "did it work?" would always be false.
    & docker @all | Out-Host
    return $LASTEXITCODE
}

# ---------------------------------------------------------------------------
# What this computer can tell us
# ---------------------------------------------------------------------------

function Test-DockerReady {
    $docker = Get-Command docker -ErrorAction SilentlyContinue
    if ($null -eq $docker) {
        Fail "Docker is not installed, or not on this account's PATH. Install Docker Desktop, then run setup again."
    }
    & docker version --format "{{.Server.Version}}" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Fail "Docker is installed but not running. Start Docker Desktop, wait for it to say it is running, then try again."
    }
}

function Test-PortFree([int]$Port) {
    $listener = $null
    try {
        $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        if ($null -ne $listener) { $listener.Stop() }
    }
}

# OneDrive, iCloud, Dropbox and Google Drive copy whatever is in them to
# somebody else's computer. An install's secrets and database belong on this
# one only.
function Get-SyncedFolderName([string]$Path) {
    $markers = @{
        "OneDrive"     = "OneDrive"
        "iCloud Drive" = "iCloudDrive"
        "Dropbox"      = "Dropbox"
        "Google Drive" = "GoogleDrive"
    }
    $full = (Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue)
    $text = if ($null -eq $full) { $Path } else { $full.Path }
    foreach ($name in $markers.Keys) {
        $needle = $markers[$name]
        if ($text -match [regex]::Escape($needle)) { return $name }
        if ($text -match [regex]::Escape(($needle -replace "([a-z])([A-Z])", '$1 $2'))) { return $name }
    }
    foreach ($variable in @("OneDrive", "OneDriveCommercial", "OneDriveConsumer")) {
        $root = [Environment]::GetEnvironmentVariable($variable)
        if ($root -and $text.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { return "OneDrive" }
    }
    return $null
}

# Your account alone may read this folder.
#
# The trap A0 hit: `icacls <folder> /inheritance:r /grant:r "*<SID>:(OI)(CI)F" /T`
# leaves every file inside with an empty access list - readable by nobody,
# not even its owner. The grant goes on the folder alone, and the files are
# then let inherit it.
function Protect-ConfigFolder([string]$Path) {
    $sid = ([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
    & icacls $Path /inheritance:r /grant:r "*${sid}:(OI)(CI)F" | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Warn "Could not lock $Path to your account alone (icacls said $LASTEXITCODE)." ; return }
    & icacls (Join-Path $Path "*") /reset /T /C /Q | Out-Null
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

function Invoke-Setup([string[]]$Arguments) {
    $email = ""
    if ($Arguments.Count -gt 0) { $email = $Arguments[0] }

    Write-Step "Checking Docker"
    Test-DockerReady
    Write-Note "Docker is running."

    $synced = Get-SyncedFolderName $PackageDir
    if ($null -ne $synced) {
        Write-Warn "This folder looks like it is inside $synced."
        Write-Note "Everything here - your writing, the database, this install's secrets - would be copied to"
        Write-Note "another computer and kept there. Move the folder somewhere that is not synced, then run setup again."
        Write-Note "If you know better than this check, run setup again with --allow-synced-folder."
        if (-not ($Arguments -contains "--allow-synced-folder")) { exit 1 }
    }

    if (-not (Test-Path $ConfigDir)) { New-Item -ItemType Directory -Path $ConfigDir | Out-Null }
    if (-not (Test-Path $SecretsDir)) { New-Item -ItemType Directory -Path $SecretsDir | Out-Null }
    if (-not (Test-Path $SettingsFile)) {
        Copy-Item $ExampleSettings $SettingsFile
        Write-Note "Settings written to config\settings.env - open it to add your API keys' files later."
    }

    $settings = Get-Settings
    $port = [int]$settings.SYLOU_PORT
    Write-Step "Checking the port"
    if (-not (Test-PortFree $port)) {
        Fail "Something is already listening on 127.0.0.1:$port. Stop it, or set SYLOU_PORT in config\settings.env to a free port."
    }
    Write-Note "127.0.0.1:$port is free."

    Write-Step "Locking this install's folder to your account"
    Protect-ConfigFolder $ConfigDir
    Write-Note "config\ is readable by your account only."

    if ($settings.SYLOU_IMAGE_TAG -eq "dev") {
        Write-Step "Building Sylou's own images (first time: several minutes)"
        if ((Invoke-Compose $settings @("build")) -ne 0) { Fail "The images could not be built." }
    }

    Write-Step "Making this install's secrets"
    $existing = @(Get-ChildItem -Path $SecretsDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Length -gt 0 })
    if ($existing.Count -gt 0) {
        Write-Note "This install already has its secrets; keeping them."
    } else {
        $image = "ghcr.io/benjahardy/sylou-tools:$($settings.SYLOU_IMAGE_TAG)"
        & docker run --rm -v "${SecretsDir}:/out" $image secrets
        if ($LASTEXITCODE -ne 0) { Fail "The secrets could not be made." }
        Protect-ConfigFolder $ConfigDir
    }

    Write-Step "Starting Sylou"
    if ((Invoke-Compose $settings @("up", "-d", "--wait")) -ne 0) {
        Fail "Sylou did not start. `".\sylou.cmd logs`" shows what each part said."
    }

    if ($email -ne "" -and -not $email.StartsWith("--")) {
        Write-Step "Making your account"
        Invoke-Compose $settings @("run", "--rm", "tools", "add-user", $email) | Out-Null
    } else {
        Write-Note "No account yet: run `".\sylou.cmd add-user you@example.com`" to make one."
    }

    Write-Host ""
    Write-Step "Sylou is running at http://localhost:$port"
    Write-Note "A tip worth taking: set OLLAMA_NO_CLOUD=1 in Ollama's settings, so a model name you mistype"
    Write-Note "is never answered by Ollama's cloud instead of your computer."
}

function Invoke-Start($Settings) {
    Test-DockerReady
    if ((Invoke-Compose $Settings @("up", "-d", "--wait")) -ne 0) { Fail "Sylou did not start." }
    Write-Step "Sylou is running at http://localhost:$($Settings.SYLOU_PORT)"
}

function Invoke-Stop($Settings) {
    Test-DockerReady
    Invoke-Compose $Settings @("down") | Out-Null
    Write-Step "Sylou is stopped. Your writing and settings stay where they are."
}

function Show-Usage {
    Write-Host @"
Sylou Local

  setup <email>            check this computer, make the secrets, start Sylou
                           and make your account
  start                    start it again
  stop                     stop it (nothing is deleted)
  status                   what is running
  logs [service]           what the parts are saying
  add-user <email>         make another account
  reset-password <email>   a one-time link to set a new password

Settings are in config\settings.env; your API keys are files in
config\secrets\. Sylou answers on http://localhost:8080 unless you change the
port there.
"@
}

$settings = Get-Settings

switch ($Command.ToLower()) {
    "setup" { Invoke-Setup $Rest }
    "start" { Invoke-Start $settings }
    "stop" { Invoke-Stop $settings }
    "status" { Test-DockerReady; Invoke-Compose $settings @("ps") | Out-Null }
    "logs" {
        Test-DockerReady
        $logArgs = @("logs", "--tail", "200")
        if ($Rest.Count -gt 0) { $logArgs += $Rest }
        Invoke-Compose $settings $logArgs | Out-Null
    }
    "add-user" {
        Test-DockerReady
        if ($Rest.Count -lt 1) { Fail "Give the email address for the new account: add-user you@example.com" }
        Invoke-Compose $settings @("run", "--rm", "tools", "add-user", $Rest[0]) | Out-Null
    }
    "reset-password" {
        Test-DockerReady
        if ($Rest.Count -lt 1) { Fail "Give the account's email address: reset-password you@example.com" }
        Invoke-Compose $settings @("run", "--rm", "tools", "reset-password", $Rest[0]) | Out-Null
    }
    default { Show-Usage }
}
