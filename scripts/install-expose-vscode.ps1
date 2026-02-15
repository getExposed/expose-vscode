param(
  [string]$Owner = "getExposed",
  [string]$Repo  = "expose-vscode",
  [string]$CodeBin = "code"   # use "codium" for VSCodium
)

$ErrorActionPreference = "Stop"

$api = "https://api.github.com/repos/$Owner/$Repo/releases/latest"

Write-Host "Fetching latest release info..."
$headers = @{
  "Accept" = "application/vnd.github+json"
  "User-Agent" = "expose-vscode-installer"
}
$rel = Invoke-RestMethod -Uri $api -Headers $headers

$asset = $rel.assets | Where-Object { $_.name -match '\.vsix$' } | Select-Object -First 1
if (-not $asset) {
  throw "Could not find a .vsix asset in the latest release."
}

$dlUrl = $asset.browser_download_url
$file  = Split-Path -Leaf $dlUrl

Write-Host "Downloading: $dlUrl"
Invoke-WebRequest -Uri $dlUrl -OutFile $file

Write-Host "Installing VSIX with: $CodeBin --install-extension $file"
& $CodeBin --install-extension $file

Write-Host "Done. You may need to reload the window in your editor."
