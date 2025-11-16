import { mkdir, copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const source = resolve("src/server/package.json");
const target = resolve("dist/server/package.json");

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
