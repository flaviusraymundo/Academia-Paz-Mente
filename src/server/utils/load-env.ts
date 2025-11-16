import fs from "node:fs";
import path from "node:path";

const envFiles = [".env.local", ".env"];

function parseValue(raw: string) {
  let value = raw.trim();
  if (!value) return "";
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
    value = value.slice(1, -1);
  }
  return value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
}

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const rawValue = trimmed.slice(eqIndex + 1);
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    process.env[key] = parseValue(rawValue);
  }
}

for (const name of envFiles) {
  const resolved = path.join(process.cwd(), name);
  loadEnvFile(resolved);
}
