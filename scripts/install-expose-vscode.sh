#!/usr/bin/env bash
set -euo pipefail

OWNER="getExposed"
REPO="expose-vscode"
ASSET_RE='\.vsix$'

# Choose which command to use to install
# - VS Code:   code
# - VSCodium:  codium
# You can override by running: CODE_BIN=codium ./install-expose-vscode.sh
CODE_BIN="${CODE_BIN:-code}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing dependency: $1" >&2; exit 1; }; }

need curl
need "$CODE_BIN"

API="https://api.github.com/repos/${OWNER}/${REPO}/releases/latest"

echo "Fetching latest release info..."
json="$(curl -fsSL -H "Accept: application/vnd.github+json" -H "User-Agent: expose-vscode-installer" "$API")"

# Extract first .vsix download URL
# Prefer python if available, otherwise attempt with sed/grep.
dl_url=""
if command -v python3 >/dev/null 2>&1; then
  dl_url="$(python3 - <<'PY'
import json, sys, re
data=json.loads(sys.stdin.read())
assets=data.get("assets") or []
for a in assets:
    url=a.get("browser_download_url","")
    name=a.get("name","")
    if url and re.search(r"\.vsix$", name, re.I):
        print(url)
        break
PY
<<<"$json")"
else
  # Fallback: crude extraction (works if the JSON format stays typical)
  dl_url="$(printf '%s' "$json" | grep -Eo 'https://[^"]+\.vsix' | head -n1 || true)"
fi

if [[ -z "${dl_url}" ]]; then
  echo "Could not find a .vsix asset in the latest release." >&2
  echo "Release JSON fetched from: $API" >&2
  exit 1
fi

file="$(basename "$dl_url")"

echo "Downloading: $dl_url"
curl -fL --retry 3 --retry-delay 1 -o "$file" "$dl_url"

echo "Installing VSIX with: $CODE_BIN --install-extension $file"
"$CODE_BIN" --install-extension "$file"

echo "Done. You may need to reload the window in your editor."
