import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const webDir = path.join(repoRoot, "web");
const target = path.join(webDir, "node_modules");
const source = path.join(repoRoot, "node_modules");

async function ensureSymlink() {
  try {
    await fs.access(source);
  } catch {
    console.warn("[ensure-web-node-modules] node_modules raíz não encontrado; rode npm install primeiro.");
    return;
  }

  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) {
      const current = await fs.readlink(target);
      const resolved = path.resolve(webDir, current);
      if (resolved === source) {
        console.log("[ensure-web-node-modules] link existente reutilizado");
        return;
      }
      await fs.rm(target, { recursive: true, force: true });
    } else {
      console.log("[ensure-web-node-modules] diretório físico já existe; nada a fazer");
      return;
    }
  } catch (err) {
    if ((err)?.code !== "ENOENT") {
      throw err;
    }
  }

  const relative = path.relative(webDir, source) || "..";
  const type = process.platform === "win32" ? "junction" : "dir";
  await fs.symlink(relative, target, type);
  console.log("[ensure-web-node-modules] link criado", `${target} -> ${relative}`);
}

ensureSymlink().catch((err) => {
  console.error("[ensure-web-node-modules] falhou:", err);
  process.exitCode = 1;
});
