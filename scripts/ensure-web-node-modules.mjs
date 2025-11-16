import { lstat, rm, symlink } from "node:fs/promises";
import { resolve } from "node:path";

const rootNodeModules = resolve("node_modules");
const webNodeModules = resolve("web/node_modules");

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (err) {
    if ((err && typeof err === "object" && "code" in err && err.code === "ENOENT") || err?.code === "ENOENT") {
      return false;
    }
    throw err;
  }
}

async function ensureSymlink() {
  if (!(await exists(rootNodeModules))) {
    console.warn("[ensure-web-node-modules] root node_modules ausente; pulando");
    return;
  }

  try {
    const stats = await lstat(webNodeModules);
    if (stats.isSymbolicLink() || stats.isDirectory()) {
      return;
    }
    await rm(webNodeModules, { recursive: true, force: true });
  } catch (err) {
    if (err?.code !== "ENOENT") {
      throw err;
    }
  }

  await symlink(rootNodeModules, webNodeModules, process.platform === "win32" ? "junction" : "dir");
  console.info("[ensure-web-node-modules] link criado:", webNodeModules, "->", rootNodeModules);
}

ensureSymlink().catch((err) => {
  console.error("[ensure-web-node-modules] falhou:", err);
  process.exitCode = 1;
});
