import * as vscode from "vscode";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { createHash } from "crypto";

type GHAsset = { id: number; name: string; browser_download_url: string };
type GHRelease = { tag_name: string; assets: GHAsset[] };

const OWNER = "getExposed";
const REPO = "expose";
const API_LATEST = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;

function pickAsset(assets: GHAsset[]): GHAsset | undefined {
  const osPart =
    process.platform === "win32"
      ? "windows"
      : process.platform === "darwin"
        ? "darwin"
        : process.platform === "linux"
          ? "linux"
          : process.platform;

  const archPart =
    process.arch === "x64"
      ? "amd64"
      : process.arch === "arm64"
        ? "arm64"
        : process.arch === "arm"
          ? "arm"
          : process.arch;

  const candidates = [
    `expose_${osPart}_${archPart}`,
    `expose-${osPart}-${archPart}`,
    `expose_${archPart}_${osPart}`
  ];

  for (const want of candidates) {
    const hit = assets.find(a => a.name === want) || assets.find(a => a.name.includes(want));
    if (hit) return hit;
  }

  return assets.find(a => /expose/i.test(a.name) && a.name.includes(osPart) && a.name.includes(archPart));
}

async function httpJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "expose-vscode",
      "Accept": "application/vnd.github+json"
    }
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function download(url: string, toFile: string): Promise<void> {
  const res = await fetch(url, { headers: { "User-Agent": "expose-vscode" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fsp.writeFile(toFile, buf);
}

async function sha256File(file: string): Promise<string> {
  const h = createHash("sha256");
  const s = fs.createReadStream(file);
  return new Promise((resolve, reject) => {
    s.on("data", d => h.update(d));
    s.on("error", reject);
    s.on("end", () => resolve(h.digest("hex")));
  });
}

export async function ensureExpose(
  context: vscode.ExtensionContext,
  opts: { installIfMissing?: boolean } = { installIfMissing: true }
): Promise<string> {
  const cfg = vscode.workspace.getConfiguration();
  const userPath = (cfg.get<string>("expose.path") || "").trim();
  if (userPath) return userPath;

  const binDir = vscode.Uri.joinPath(context.globalStorageUri, "bin").fsPath;
  await fsp.mkdir(binDir, { recursive: true });

  const binName = process.platform === "win32" ? "expose.exe" : "expose";
  const binPath = path.join(binDir, binName);

  if (fs.existsSync(binPath)) return binPath;

  if (!opts.installIfMissing) {
    throw new Error("Expose not installed");
  }

  const rel: GHRelease = await httpJson(API_LATEST);
  const asset = pickAsset(rel.assets || []);
  if (!asset) {
    throw new Error(`No release asset found for ${process.platform}/${process.arch}`);
  }

  const tmpFile = path.join(binDir, asset.name);
  await download(asset.browser_download_url, tmpFile);

  const hash = await sha256File(tmpFile);
  console.log(`[expose-vscode] downloaded ${asset.name} sha256=${hash}`);

  await fsp.copyFile(tmpFile, binPath);
  if (process.platform !== "win32") {
    await fsp.chmod(binPath, 0o755);
  }

  return binPath;
}
