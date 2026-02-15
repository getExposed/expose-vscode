import * as vscode from "vscode";
import { spawn, spawnSync, ChildProcessWithoutNullStreams } from "child_process";
import * as os from "os";
import * as path from "path";
import * as fsp from "fs/promises";
import { ensureExpose } from "./installer";

type ExposeFileConfig = Partial<{
  configVersion: number;

  // core execution
  path: string;
  cwd: string;
  autoInstall: boolean;

  // docker
  composeFile: string;
  composeService: string;

  // expose flags
  sshHost: string;
  sshPort: number;
  localHost: string;
  localPort: number;
  bindPort: number;
  id: string;
  password: string; // discouraged; prefer secret storage
  keepAlive: boolean;
  autoReconnect: boolean;

  // extra args
  args: string[];
}>;

const SECRET_KEY_PASSWORD = "expose.password";

let proc: ChildProcessWithoutNullStreams | undefined;
let output: vscode.OutputChannel;
let status: vscode.StatusBarItem;
let configWatcher: vscode.FileSystemWatcher | undefined;

export function activate(context: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel("Expose Agent");

  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.text = "$(play) Expose";
  status.command = "expose.startAgent";
  status.tooltip = "Start Expose Agent";
  status.show();

  context.subscriptions.push(status, output);

  context.subscriptions.push(
    vscode.commands.registerCommand("expose.startAgent", () => startAgent(context)),
    vscode.commands.registerCommand("expose.stopAgent", stopAgent),
    vscode.commands.registerCommand("expose.run", () => runOnce(context)),
    vscode.commands.registerCommand("expose.installOrUpdate", () => installOrUpdate(context)),
    vscode.commands.registerCommand("expose.createConfigFile", () => createConfigFile()),
    vscode.commands.registerCommand("expose.setPassword", () => setPassword(context)),
    vscode.commands.registerCommand("expose.clearPassword", () => clearPassword(context)),
    { dispose: deactivate }
  );

  // watch config file if configured
  setupConfigWatcher(context).catch(() => {});
}

export function deactivate() {
  stopAgent();
  configWatcher?.dispose();
  configWatcher = undefined;
}

function getCfg<T = any>(key: string): T | undefined {
  return vscode.workspace.getConfiguration().get<T>(key);
}

function workspaceFolderPath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function resolveVars(p: string): string {
  const folder = workspaceFolderPath();
  if (folder && p.includes("${workspaceFolder}")) {
    return p.replaceAll("${workspaceFolder}", folder);
  }
  return p;
}

async function readExposeConfigFile(): Promise<ExposeFileConfig | undefined> {
  const cfgPath = (getCfg<string>("expose.configFile") || "").trim();
  if (!cfgPath) return undefined;

  const resolved = resolveVars(cfgPath);
  try {
    const raw = await fsp.readFile(resolved, "utf8");
    const parsed = JSON.parse(raw) as ExposeFileConfig;
    return parsed;
  } catch {
    vscode.window.showWarningMessage(`Expose: could not read config file: ${resolved}`);
    return undefined;
  }
}

async function getPassword(context: vscode.ExtensionContext): Promise<string> {
  // Secret storage wins
  const secret = (await context.secrets.get(SECRET_KEY_PASSWORD)) || "";
  if (secret.trim()) return secret.trim();

  // optional legacy fallback (discouraged)
  const legacy = (getCfg<string>("expose.legacyPassword") || "").trim();
  return legacy;
}

async function setupConfigWatcher(context: vscode.ExtensionContext) {
  configWatcher?.dispose();
  configWatcher = undefined;

  const cfgPath = (getCfg<string>("expose.configFile") || "").trim();
  if (!cfgPath) return;

  const resolved = resolveVars(cfgPath);
  const folder = workspaceFolderPath();
  if (!folder) return;

  const pattern = new vscode.RelativePattern(folder, path.relative(folder, resolved));
  configWatcher = vscode.workspace.createFileSystemWatcher(pattern);

  const onChange = async () => {
    const autoRestart = !!getCfg<boolean>("expose.autoRestartOnConfigChange");
    if (!autoRestart) return;
    if (!proc) return;

    output.appendLine("[config] changed; restarting agent...");
    await restartAgent(context);
  };

  configWatcher.onDidChange(onChange);
  configWatcher.onDidCreate(onChange);
  configWatcher.onDidDelete(onChange);

  context.subscriptions.push(configWatcher);
}

async function setPassword(context: vscode.ExtensionContext) {
  const value = await vscode.window.showInputBox({
    title: "Expose Password",
    prompt: "Stored securely in VS Code Secret Storage.",
    password: true
  });
  if (value === undefined) return;

  await context.secrets.store(SECRET_KEY_PASSWORD, value);
  vscode.window.showInformationMessage("Expose password saved to Secret Storage.");
}

async function clearPassword(context: vscode.ExtensionContext) {
  await context.secrets.delete(SECRET_KEY_PASSWORD);
  vscode.window.showInformationMessage("Expose password removed from Secret Storage.");
}

async function createConfigFile() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showWarningMessage("Expose: open a workspace folder first.");
    return;
  }

  const uri = vscode.Uri.joinPath(folder.uri, ".expose.json");
  const defaultCfg: ExposeFileConfig = {
    configVersion: 1,
    cwd: "${workspaceFolder}",
    autoInstall: true,
    sshHost: "getexposed.io",
    sshPort: 2200,
    localHost: "localhost",
    localPort: 7500,
    bindPort: 0,
    keepAlive: false,
    autoReconnect: false,
    args: []
  };

  await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(defaultCfg, null, 2), "utf8"));
  await vscode.window.showTextDocument(uri);

  await vscode.workspace.getConfiguration().update(
    "expose.configFile",
    uri.fsPath,
    vscode.ConfigurationTarget.Workspace
  );

  vscode.window.showInformationMessage("Expose: created .expose.json and set expose.configFile (workspace).");
}

async function installOrUpdate(context: vscode.ExtensionContext): Promise<string | undefined> {
  try {
    const p = await ensureExpose(context, { installIfMissing: true });
    vscode.window.showInformationMessage(`Expose installed at ${p}`);
    return p;
  } catch (e: any) {
    vscode.window.showErrorMessage(`Failed to install Expose: ${e?.message || e}`);
    return undefined;
  }
}

async function resolveBinary(context: vscode.ExtensionContext, fileCfg?: ExposeFileConfig): Promise<string | undefined> {
  const userPath = (fileCfg?.path ?? getCfg<string>("expose.path") ?? "").trim();
  if (userPath) return resolveVars(userPath);

  // Try previously-installed copy (even if auto-install is off)
  try {
    const p = await ensureExpose(context, { installIfMissing: false });
    if (p) return p;
  } catch {}

  const autoInstall = !!(fileCfg?.autoInstall ?? getCfg<boolean>("expose.autoInstall"));
  if (!autoInstall) return undefined;

  return await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Installing Expose" },
    async () => await ensureExpose(context, { installIfMissing: true })
  );
}

async function resolveCwd(fileCfg?: ExposeFileConfig): Promise<string> {
  const setting = (fileCfg?.cwd ?? getCfg<string>("expose.cwd") ?? "").trim();
  if (setting) {
    const resolved = resolveVars(setting);
    return resolved || os.homedir();
  }
  return workspaceFolderPath() || os.homedir();
}

function buildArgsFromConfig(fileCfg: ExposeFileConfig, password: string): string[] {
  const args: string[] = [];

  const sshHost = (fileCfg.sshHost ?? getCfg<string>("expose.sshHost") ?? "getexposed.io").trim();
  const sshPort = fileCfg.sshPort ?? getCfg<number>("expose.sshPort") ?? 2200;

  const localHost = (fileCfg.localHost ?? getCfg<string>("expose.localHost") ?? "localhost").trim();
  const localPort = fileCfg.localPort ?? getCfg<number>("expose.localPort") ?? 7500;

  const bindPort = fileCfg.bindPort ?? getCfg<number>("expose.bindPort") ?? 0;

  const id = (fileCfg.id ?? getCfg<string>("expose.id") ?? "").trim();

  const keepAlive = !!(fileCfg.keepAlive ?? getCfg<boolean>("expose.keepAlive"));
  const autoReconnect = !!(fileCfg.autoReconnect ?? getCfg<boolean>("expose.autoReconnect"));

  // flags (matches your original)
  if (sshHost) args.push("-s", sshHost);
  if (sshPort) args.push("-p", String(sshPort));
  if (localHost) args.push("-ls", localHost);
  if (localPort) args.push("-lp", String(localPort));
  args.push("-bp", String(bindPort || 0));

  if (id) args.push("-id", id);

  // password precedence: SecretStorage > config file password > legacy setting
  const filePassword = (fileCfg.password ?? "").trim();
  const finalPassword = (password || filePassword).trim();
  if (finalPassword) args.push("-pw", finalPassword);

  if (keepAlive) args.push("-a");
  if (autoReconnect) args.push("-r");

  const extraFromFile = fileCfg.args ?? [];
  const extraFromSettings = getCfg<string[]>("expose.args") ?? [];
  for (const e of [...extraFromFile, ...extraFromSettings]) {
    if (e && e.trim()) args.push(e.trim());
  }

  return args;
}

async function startAgent(context: vscode.ExtensionContext) {
  if (proc) {
    vscode.window.showInformationMessage("Expose agent is already running.");
    return;
  }

  const fileCfg = (await readExposeConfigFile()) ?? {};
  const composeFile = (fileCfg.composeFile ?? getCfg<string>("expose.composeFile") ?? "").trim();
  const composeService = (fileCfg.composeService ?? getCfg<string>("expose.composeService") ?? "expose").trim();

  const cwd = await resolveCwd(fileCfg);
  const password = await getPassword(context);

  output.clear();
  output.show(true);

  try {
    if (composeFile) {
      const resolvedCompose = resolveVars(composeFile);
      const args = ["compose", "-f", resolvedCompose, "up", composeService];
      output.appendLine(`$ docker ${args.join(" ")}`);
      proc = spawn("docker", args, { cwd, env: process.env });
    } else {
      const binPath = await resolveBinary(context, fileCfg);
      if (!binPath) {
        vscode.window.showWarningMessage("Expose: no expose.path set and auto-install is disabled.");
        return;
      }

      const args = buildArgsFromConfig(fileCfg, password);
      output.appendLine(`$ ${binPath} ${args.join(" ")}`);
      proc = spawn(binPath, args, { cwd, env: process.env });
    }

    wireProcess(proc);
    status.text = "$(debug-stop) Expose (running)";
    status.command = "expose.stopAgent";
    status.tooltip = "Stop Expose Agent";
  } catch (e: any) {
    vscode.window.showErrorMessage(`Expose: failed to start: ${e?.message || e}`);
    proc = undefined;
    status.text = "$(play) Expose";
    status.command = "expose.startAgent";
    status.tooltip = "Start Expose Agent";
  }
}

async function restartAgent(context: vscode.ExtensionContext) {
  stopAgent();
  await startAgent(context);
}

function stopAgent() {
  if (!proc) return;

  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(proc.pid), "/t", "/f"]);
    } else {
      proc.kill("SIGINT");
      setTimeout(() => proc && proc.kill("SIGKILL"), 1500);
    }
  } catch {
    // noop
  } finally {
    proc = undefined;
    status.text = "$(play) Expose";
    status.command = "expose.startAgent";
    status.tooltip = "Start Expose Agent";
  }
}

async function runOnce(context: vscode.ExtensionContext) {
  const fileCfg = (await readExposeConfigFile()) ?? {};
  const cwd = await resolveCwd(fileCfg);
  const password = await getPassword(context);

  const binPath = await resolveBinary(context, fileCfg);
  if (!binPath) {
    vscode.window.showWarningMessage("Expose: no expose.path set and auto-install is disabled.");
    return;
  }

  const input = await vscode.window.showInputBox({
    title: "Expose: extra arguments",
    placeHolder: "Optional extra args, e.g. --version"
  });
  if (input === undefined) return;

  const argsInput = input.trim() ? input.trim().split(/\s+/) : [];
  const base = buildArgsFromConfig(fileCfg, password);
  const args = [...base, ...argsInput];

  output.show(true);
  output.appendLine(`$ ${binPath} ${args.join(" ")}`);

  const child = spawn(binPath, args, { cwd, env: process.env });
  wireProcess(child);
}

function wireProcess(child: ChildProcessWithoutNullStreams) {
  child.on("error", err => {
    output.appendLine(`\n[process error] ${String(err)}`);
    if (child === proc) {
      proc = undefined;
      status.text = "$(play) Expose";
      status.command = "expose.startAgent";
      status.tooltip = "Start Expose Agent";
    }
  });

  child.stdout.on("data", d => output.append(d.toString()));
  child.stderr.on("data", d => output.append(d.toString()));

  child.on("close", code => {
    output.appendLine(`\n[process exited with code ${code}]`);
    if (child === proc) {
      proc = undefined;
      status.text = "$(play) Expose";
      status.command = "expose.startAgent";
      status.tooltip = "Start Expose Agent";
    }
  });
}
