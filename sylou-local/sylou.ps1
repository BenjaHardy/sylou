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
# What a person types to run this, for the messages below.
$ScriptName = ".\sylou.cmd"

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
# The facts only this computer can tell us, for `doctor`
#
# Each one is wrapped on its own: a fact that cannot be read becomes nothing,
# and doctor says it could not look rather than guessing. Nothing here decides
# anything - the rules all live in the tools image (D4).
# ---------------------------------------------------------------------------

function Get-PackageRelease {
    $file = Join-Path $PackageDir "VERSION"
    $release = @{ version = $null; date = $null }
    if (Test-Path $file) {
        foreach ($line in Get-Content $file) {
            $parts = $line.Split("=", 2)
            if ($parts.Count -eq 2) {
                if ($parts[0].Trim() -eq "version") { $release.version = $parts[1].Trim() }
                if ($parts[0].Trim() -eq "date") { $release.date = $parts[1].Trim() }
            }
        }
    }
    return $release
}

function Get-Listeners([int[]]$Ports) {
    $found = @()
    try {
        foreach ($connection in (Get-NetTCPConnection -State Listen -ErrorAction Stop)) {
            if ($Ports -notcontains $connection.LocalPort) { continue }
            $name = $null
            try { $name = (Get-Process -Id $connection.OwningProcess -ErrorAction Stop).ProcessName } catch { }
            $found += @{ address = $connection.LocalAddress; port = $connection.LocalPort; process = $name }
        }
    } catch { }
    # The comma matters: a function that returns an empty array in PowerShell
    # returns nothing at all, and "nothing" would read as "could not look".
    return ,$found
}

# Docker Desktop keeps its settings in a file this account can read. The name
# of the port-binding setting has changed between versions, so this looks for
# one that mentions binding rather than assuming today's spelling.
function Get-PortBinding {
    $file = Join-Path $env:APPDATA "Docker\settings-store.json"
    if (-not (Test-Path $file)) { return $null }
    try {
        $settings = Get-Content $file -Raw | ConvertFrom-Json
        foreach ($property in $settings.PSObject.Properties) {
            if ($property.Name -match "Bind" -and $property.Name -match "(Port|Ip|Address)") {
                return "$($property.Name): $($property.Value)"
            }
        }
    } catch { }
    return $null
}

function Get-FirewallFacts {
    try {
        $programs = Get-NetFirewallApplicationFilter -All -ErrorAction Stop |
            Where-Object { $_.Program -and $_.Program -match "docker|ollama|wsl" }
        $count = 0
        foreach ($filter in $programs) {
            $rule = $null
            try { $rule = $filter | Get-NetFirewallRule -ErrorAction Stop } catch { }
            if ($null -ne $rule -and $rule.Enabled -eq "True" -and $rule.Direction -eq "Inbound" -and $rule.Action -eq "Allow") {
                $count++
            }
        }
        return @{ inboundAllowForDocker = $count }
    } catch {
        return $null
    }
}

# Without administrator rights the usual commands refuse, and this property
# does not: 1 means protected, 7 means encrypted with the protection off -
# two very different things (A0).
function Get-BitLockerProtection {
    try {
        $drive = (Get-Item $PackageDir).PSDrive.Root
        $shell = New-Object -ComObject Shell.Application
        $value = $shell.NameSpace($drive).Self.ExtendedProperty("System.Volume.BitLockerProtection")
        if ($null -ne $value) { return [int]$value }
    } catch { }
    return $null
}

function Get-SecretsFacts {
    $facts = @{ path = $SecretsDir; ownerOnly = $null; syncedTo = (Get-SyncedFolderName $PackageDir) }
    if (-not (Test-Path $SecretsDir)) { return $facts }
    try {
        $me = ([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
        $others = @()
        foreach ($rule in (Get-Acl $SecretsDir).Access) {
            $sid = $rule.IdentityReference
            try { $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { $sid = "$($rule.IdentityReference)" }
            if ($sid -ne $me) { $others += $sid }
        }
        $facts.ownerOnly = ($others.Count -eq 0)
    } catch { }
    return $facts
}

function Get-LastBackup {
    $file = Join-Path $ConfigDir "last-backup.json"
    if (-not (Test-Path $file)) { return $null }
    try { return (Get-Content $file -Raw | ConvertFrom-Json) } catch { return $null }
}

function Get-OllamaFacts($Settings) {
    $url = ""
    if ($Settings.ContainsKey("OLLAMA_URL")) { $url = "$($Settings.OLLAMA_URL)".Trim() }
    $names = @()
    if ($Settings.ContainsKey("OLLAMA_MODELS") -and "$($Settings.OLLAMA_MODELS)".Trim() -ne "") {
        $names = "$($Settings.OLLAMA_MODELS)".Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }
    }
    if ($url -eq "" -and $names.Count -eq 0) { return $null }

    # Docker reaches Ollama by a name of its own; from here it is this computer.
    $here = "http://127.0.0.1:11434"
    $facts = @{ reachable = $false; address = $url; noCloud = ($env:OLLAMA_NO_CLOUD -eq "1"); models = @(); listeners = (Get-Listeners @(11434)) }
    try {
        $version = Invoke-RestMethod -Uri "$here/api/version" -TimeoutSec 3 -ErrorAction Stop
        $facts.reachable = $true
        $facts.version = $version.version
    } catch {
        return $facts
    }
    foreach ($name in $names) {
        $model = @{ name = $name }
        try {
            $shown = Invoke-RestMethod -Uri "$here/api/show" -Method Post -TimeoutSec 10 -ErrorAction Stop `
                -Body (ConvertTo-Json @{ model = $name }) -ContentType "application/json"
            foreach ($property in $shown.model_info.PSObject.Properties) {
                if ($property.Name -match "context_length$") { $model.contextLength = [int]$property.Value }
            }
            if ($shown.details.family -eq "cloud" -or "$($shown.capabilities)" -match "cloud") { $model.cloud = $true }
        } catch { }
        $facts.models += $model
    }
    return $facts
}

function Get-HostFacts($Settings) {
    $release = Get-PackageRelease
    $port = 8080
    if ($Settings.ContainsKey("SYLOU_PORT")) { $port = [int]$Settings.SYLOU_PORT }

    $engine = $null
    $compose = $null
    try { $engine = (& docker version --format "{{.Server.Version}}") | Select-Object -First 1 } catch { }
    try { $compose = (& docker compose version --short) | Select-Object -First 1 } catch { }

    $backup = Get-LastBackup
    return @{
        platform = "windows"
        packageVersion = $release.version
        packageDate = $release.date
        port = $port
        docker = @{ engine = $engine; compose = $compose }
        portBinding = (Get-PortBinding)
        listeners = (Get-Listeners @($port))
        firewall = (Get-FirewallFacts)
        bitLockerProtection = (Get-BitLockerProtection)
        secrets = (Get-SecretsFacts)
        lastBackup = $(if ($null -eq $backup) { $null } else { @{ at = $backup.at; path = $backup.path } })
        ollama = (Get-OllamaFacts $Settings)
    }
}

function Invoke-Doctor($Settings) {
    Test-DockerReady
    $facts = Get-HostFacts $Settings | ConvertTo-Json -Depth 8 -Compress
    $all = (Get-ComposeArgs $Settings) + @("run", "--rm", "-T", "tools", "doctor")
    $facts | & docker @all
    exit $LASTEXITCODE
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

function Confirm-Step([string]$Question, [string[]]$Arguments) {
    if ($Arguments -contains "--yes") { return $true }
    $answer = Read-Host "$Question Type yes to continue"
    return ($answer -eq "yes")
}

function Invoke-Backup($Settings, [string[]]$Arguments) {
    Test-DockerReady
    if ($Arguments.Count -lt 1 -or $Arguments[0].StartsWith("--")) {
        Fail "Give the folder to back up into, for example: backup D:\sylou-backups"
    }
    $folder = [System.IO.Path]::GetFullPath($Arguments[0])
    if (-not (Test-Path $folder)) { New-Item -ItemType Directory -Path $folder -Force | Out-Null }
    $target = Join-Path $folder ("sylou-" + (Get-Date -Format "yyyy-MM-dd-HHmm"))
    New-Item -ItemType Directory -Path $target -Force | Out-Null

    Write-Step "Backing up"
    $all = (Get-ComposeArgs $Settings) + @("run", "--rm", "-v", "${target}:/backup", "dump")
    & docker @all | Out-Host
    if ($LASTEXITCODE -ne 0) { Fail "The backup did not finish. Nothing was written to $target." }

    # Doctor reads this to say how long ago the last backup was.
    $record = @{ at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"); path = $target }
    $record | ConvertTo-Json -Compress | Set-Content -Path (Join-Path $ConfigDir "last-backup.json") -Encoding ascii
    Write-Step "Backed up to $target"
    Write-Note "This install's secrets are not in it. Keep config\secrets\ too, or the backup opens nothing."
}

function Invoke-Restore($Settings, [string[]]$Arguments) {
    Test-DockerReady
    if ($Arguments.Count -lt 1 -or $Arguments[0].StartsWith("--")) {
        Fail "Give the backup folder to restore from, for example: restore D:\sylou-backups\sylou-2026-11-16-1830"
    }
    $folder = [System.IO.Path]::GetFullPath($Arguments[0])
    if (-not (Test-Path (Join-Path $folder "data.sql"))) {
        Fail "There is no data.sql in $folder, so that is not a backup this can read."
    }

    Write-Warn "Restoring replaces what this install holds now with what the backup holds."
    Write-Note "Everyone signs in again afterwards: sessions are not part of a backup."
    if (-not (Confirm-Step "Restore from ${folder}?" $Arguments)) { Fail "Nothing was changed." }

    Write-Step "Making sure the install is running and migrated"
    if ((Invoke-Compose $Settings @("up", "-d", "--wait")) -ne 0) { Fail "The install did not start." }

    Write-Step "Restoring"
    $all = (Get-ComposeArgs $Settings) + @("run", "--rm", "-v", "${folder}:/backup", "load")
    & docker @all | Out-Host
    if ($LASTEXITCODE -ne 0) { Fail "The restore stopped. The install is as it was before it started." }
    Write-Step "Restored. Sign in again at http://localhost:$($Settings.SYLOU_PORT)"
}

function Invoke-Update($Settings, [string[]]$Arguments) {
    Test-DockerReady
    if ($Arguments.Count -lt 1 -or $Arguments[0].StartsWith("--")) {
        Fail "Give a folder to back up into first: update D:\sylou-backups"
    }
    Invoke-Backup $Settings $Arguments

    $tag = "$($Settings.SYLOU_IMAGE_TAG)"
    if ($tag -eq "dev") {
        Write-Step "Building the images again"
        if ((Invoke-Compose $Settings @("build")) -ne 0) { Fail "The images could not be built." }
    } else {
        Write-Step "Downloading the images this release names"
        if ((Invoke-Compose $Settings @("pull")) -ne 0) { Fail "The images could not be downloaded." }
    }

    Write-Step "Starting the new version (the migrations run on the way up)"
    if ((Invoke-Compose $Settings @("up", "-d", "--wait")) -ne 0) {
        Fail "The new version did not start. Your backup is in the folder above."
    }
    Write-Step "Updated. Checking the install"
    Invoke-Doctor $Settings
}

function Set-Setting([string]$Name, [string]$Value) {
    if (-not (Test-Path $SettingsFile)) { Copy-Item $ExampleSettings $SettingsFile }
    $lines = @()
    $replaced = $false
    foreach ($line in Get-Content $SettingsFile) {
        if ($line -match "^\s*$Name\s*=") {
            $lines += "$Name=$Value"
            $replaced = $true
        } else {
            $lines += $line
        }
    }
    if (-not $replaced) { $lines += "$Name=$Value" }
    Set-Content -Path $SettingsFile -Value $lines -Encoding ascii
}

function Invoke-Models($Settings, [string[]]$Arguments) {
    Test-DockerReady
    if ($Arguments.Count -lt 1 -or $Arguments[0].StartsWith("--")) {
        Fail "Name the model to make a window for, for example: models mistral-nemo"
    }
    Write-Step "Looking for the largest window that runs on the graphics card"
    Write-Note "This makes a copy per size and loads it, so it takes a few minutes."
    Invoke-Compose $Settings @("run", "--rm", "models", "window", $Arguments[0]) | Out-Null
}

function Invoke-Rotate($Settings, [string[]]$Arguments) {
    Test-DockerReady
    Write-Warn "New secrets for this install."
    Write-Note "Everyone signs in again afterwards. Your writing, your projects and your documents are untouched."
    if (-not (Confirm-Step "Make new secrets?" $Arguments)) { Fail "Nothing was changed." }

    $staging = Join-Path $ConfigDir "secrets-new"
    if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
    New-Item -ItemType Directory -Path $staging -Force | Out-Null

    Write-Step "Making the new secrets"
    & docker run --rm -v "${staging}:/out" "ghcr.io/benjahardy/sylou-tools:$($Settings.SYLOU_IMAGE_TAG)" secrets | Out-Host
    if ($LASTEXITCODE -ne 0) { Fail "The new secrets could not be made. Nothing was changed." }

    # Your API keys are yours, not this install's: they carry over.
    foreach ($name in @("anthropic_api_key", "mistral_api_key", "deepseek_api_key", "brave_search_api_key")) {
        $from = Join-Path $SecretsDir $name
        if (Test-Path $from) { Copy-Item $from (Join-Path $staging $name) -Force }
    }

    Write-Step "Making sure the install is running"
    if ((Invoke-Compose $Settings @("up", "-d", "--wait")) -ne 0) { Fail "The install did not start. Nothing was changed." }

    Write-Step "Telling the database about the new passwords"
    $all = (Get-ComposeArgs $Settings) + @("run", "--rm", "-v", "${staging}:/new", "rotate")
    & docker @all | Out-Host
    if ($LASTEXITCODE -ne 0) { Fail "The database kept its old passwords. Nothing was changed." }

    Write-Step "Putting the new secrets in place"
    $old = Join-Path $ConfigDir ("secrets-old-" + (Get-Date -Format "yyyy-MM-dd-HHmm"))
    Move-Item $SecretsDir $old
    Move-Item $staging $SecretsDir
    Protect-ConfigFolder $ConfigDir

    Write-Step "Starting again with them"
    Invoke-Compose $Settings @("down") | Out-Null
    if ((Invoke-Compose $Settings @("up", "-d", "--wait")) -ne 0) {
        Fail "Sylou did not start with the new secrets. The old ones are in $old."
    }
    Write-Step "Done. Sign in again at http://localhost:$($Settings.SYLOU_PORT)"
    Write-Note "The old secrets are in $old. Delete that folder once you are sure."
}

function Invoke-LocalOnly($Settings, [string[]]$Arguments) {
    Test-DockerReady
    $state = ""
    if ($Arguments.Count -gt 0) { $state = "$($Arguments[0])".ToLower() }
    if ($state -ne "on" -and $state -ne "off") { Fail "Say which: local-only on, or local-only off" }

    if ($state -eq "on") {
        Set-Setting "SYLOU_LOCAL_ONLY" "true"
        Write-Step "Local-only mode on"
        Write-Note "No service that holds or reads your writing has a way out now. The one route left goes to"
        Write-Note "Ollama on this computer; cloud models and web search say they are unavailable."
    } else {
        Set-Setting "SYLOU_LOCAL_ONLY" ""
        # A service kept behind a profile is not an orphan, so the restart
        # would leave the relay running: it has to be taken away by name.
        Invoke-Compose $Settings @("--profile", "local-only", "rm", "-s", "-f", "relay") | Out-Null
        Write-Step "Local-only mode off"
        Write-Note "The functions may reach the AI providers you have keys for again."
    }

    $updated = Get-Settings
    Write-Step "Starting again"
    if ((Invoke-Compose $updated @("up", "-d", "--wait", "--remove-orphans")) -ne 0) {
        Fail "Sylou did not start again. `"$ScriptName logs`" shows what each part said."
    }
}

function Invoke-RemoveInstall($Settings, [string[]]$Arguments) {
    Test-DockerReady
    Write-Warn "This deletes everything this install holds: your writing, the projects, the documents, the accounts."
    Write-Note "The settings and secrets in config\ stay where they are. A backup is the only way back."
    if (-not (Confirm-Step "Delete this install's data?" $Arguments)) { Fail "Nothing was deleted." }
    Invoke-Compose $Settings @("down", "-v", "--remove-orphans") | Out-Null
    Write-Step "Deleted. `"$ScriptName setup`" makes a fresh install in this folder."
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
  doctor                   check this install and the computer around it
  backup <folder>          everything you have written, into a folder you pick
  restore <folder>         a backup, back into this install
  update <folder>          back up, then start the new version
  models <model>           the largest window that runs on your graphics card
  rotate                   new secrets for this install
  local-only on|off        this computer and nothing else
  remove                   delete this install's data (not its settings)
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
    "doctor" { Invoke-Doctor $settings }
    "backup" { Invoke-Backup $settings $Rest }
    "restore" { Invoke-Restore $settings $Rest }
    "update" { Invoke-Update $settings $Rest }
    "models" { Invoke-Models $settings $Rest }
    "rotate" { Invoke-Rotate $settings $Rest }
    "local-only" { Invoke-LocalOnly $settings $Rest }
    "remove" { Invoke-RemoveInstall $settings $Rest }
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
