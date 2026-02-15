# Expose Agent (VS Code / OpenVSCode)

Run the **getExposed/expose** agent from VS Code or OpenVSCode Server. If you don't set a path, the extension can **auto-install the latest `expose`** from GitHub Releases for your OS/arch.

> ⚠️ This is a **workspace** extension (runs on the server/remote). It won’t work on `vscode.dev` / `github.dev`.

---

## Install (from GitHub Releases)

This extension is distributed as a **.vsix** on GitHub Releases.

### Option A — VS Code / VSCodium UI
1. Download the latest `.vsix` from [GitHub Releases](https://github.com/getExposed/expose-vscode/releases/latest/).
2. Open **Extensions**.
3. Click **…** → **Install from VSIX…**
4. Select the `.vsix`, then reload the window if prompted.


> Note: GitHub “latest” download URLs work best when the asset name is stable. If your VSIX name includes the version (common), use the scripts below (they discover the latest asset automatically).

## Install via scripts (recommended)

These scripts fetch the latest GitHub Release, download the .vsix, and install it using your editor’s CLI.

### macOS / Linux (bash)
#### Pipe to bash (quick):
```bash
curl -fsSL https://raw.githubusercontent.com/getExposed/expose-vscode/main/scripts/install-expose-vscode.sh | bash
```

#### VSCodium:
```bash
curl -fsSL https://raw.githubusercontent.com/getExposed/expose-vscode/main/scripts/install-expose-vscode.sh | CODE_BIN=codium bash
```

#### Safer: download then run:
```bash
curl -fsSLO https://raw.githubusercontent.com/getExposed/expose-vscode/main/scripts/install-expose-vscode.sh
bash ./install-expose-vscode.sh
```

### Windows (PowerShell)
#### Pipe to PowerShell (quick):
```powershell
iwr -useb https://raw.githubusercontent.com/getExposed/expose-vscode/main/scripts/install-expose-vscode.ps1 | iex
```

#### VSCodium:
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "iwr -useb https://raw.githubusercontent.com/getExposed/expose-vscode/main/scripts/install-expose-vscode.ps1 | iex; .\install-expose-vscode.ps1 -CodeBin codium"
```

> Remote note: If you’re using Remote-SSH / Dev Containers / Codespaces / OpenVSCode Server, install the VSIX in that same environment (run the script on the remote machine/container).

## Features
- Start/stop the Expose agent and stream logs to an Output Channel
- Run one-off commands with extra arguments
- Auto-install the latest matching Expose binary from GitHub Releases
- Optional Docker Compose mode (`docker compose up`)
- Optional **JSON config file** support (e.g. `.expose.json`)
- Store the agent password securely using **VS Code Secret Storage**

## Commands
- **Expose: Start Agent**
- **Expose: Stop Agent**
- **Expose: Run Command…**
- **Expose: Install/Update Agent**
- **Expose: Create .expose.json**
- **Expose: Set Password (Secret Storage)**
- **Expose: Clear Password (Secret Storage)**

## Settings

### Core
- `expose.path` (string): Absolute path to an existing Expose binary. Leave empty to use the installed copy or auto-install.
- `expose.autoInstall` (boolean, default: `true`): If no path is set, automatically download the latest expose for your OS/arch from GitHub Releases.
- `expose.cwd` (string, default: `${workspaceFolder}`): Working directory for the agent process. Supports `${workspaceFolder}`.
- `expose.args` (string[], default: `[]`): Extra arguments appended to the generated args.

### Optional config file
- `expose.configFile` (string, default: `""`): Optional path to a JSON config file (e.g. `${workspaceFolder}/.expose.json`). Values in this file override VS Code settings.
- `expose.autoRestartOnConfigChange` (boolean, default: `true`): If the agent is running and the config file changes, automatically restart the agent.

### Expose connection/flags
These settings are used to build the Expose CLI arguments:
- `expose.sshHost` (string, default: `getexposed.io`)
- `expose.sshPort` (number, default: `2200`)
- `expose.localHost` (string, default: `localhost`)
- `expose.localPort` (number, default: `7500`)
- `expose.bindPort` (number, default: `0`)
- `expose.id` (string, default: `""`)
- `expose.keepAlive` (boolean, default: `false`) → adds `-a`
- `expose.autoReconnect` (boolean, default: `false`) → adds `-r`

### Password storage
- Use **Expose: Set Password (Secret Storage)** to store the password securely.
- The password is read from Secret Storage when starting/running Expose.
- `expose.legacyPassword` (string): **Deprecated.** Avoid storing passwords in settings.json.

## Config File (`.expose.json`)

If you set `expose.configFile`, the extension will load it as JSON and use it to override VS Code settings.

Example `.vscode/settings.json`:
```json
{
  "expose.configFile": "${workspaceFolder}/.expose.json"
}
```

Example `.expose.json`:

```json
{
  "configVersion": 1,
  "cwd": "${workspaceFolder}",
  "autoInstall": true,
  "sshHost": "getexposed.io",
  "sshPort": 2200,
  "localHost": "localhost",
  "localPort": 7500,
  "bindPort": 0,
  "id": "",
  "keepAlive": false,
  "autoReconnect": false,
  "args": []
}
```

Precedence (highest → lowest):
- Password from Secret Storage
- Values in .expose.json (if configured)
- VS Code settings (settings.json)
- Built-in defaults

## OpenVSCode / Remote Environments

This extension is tagged with "extensionKind": ["workspace"], so it runs where Node APIs are available (OpenVSCode Server, Remote-SSH, Codespaces, Dev Containers). It won’t run as a web extension in purely browser-hosted editors.

## Development
- npm install
- Press F5 in VS Code to launch the extension host
- Run “Expose: Start Agent”

## Notes
- Current Expose releases often publish raw binaries named like expose_linux_amd64, expose_darwin_arm64, expose_windows_amd64, etc. The extension picks the one matching your platform and installs it under the extension’s global storage.
- If asset names change or releases switch to archives, update src/installer.ts accordingly.
- In Remote environments, installation happens on the remote side (because extensionKind: workspace).