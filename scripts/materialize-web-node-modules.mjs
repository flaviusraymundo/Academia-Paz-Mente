import { rm, stat, symlink } from "node:fs/promises";
import { resolve } from "node:path";

const rootNodeModules = resolve("node_modules");
const webNodeModules = resolve("web/node_modules");

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function main() {
  if (!(await exists(rootNodeModules))) {
    throw new Error("node_modules raiz ausente; rode npm install primeiro");
  }

  await rm(webNodeModules, { recursive: true, force: true });
  const type = process.platform === "win32" ? "junction" : "dir";
  await symlink(rootNodeModules, webNodeModules, type);
  console.info("[materialize-web-node-modules] link recriado:", webNodeModules, "->", rootNodeModules);
}

main().catch((err) => {
  console.error("[materialize-web-node-modules] falhou:", err);
  process.exitCode = 1;
});
