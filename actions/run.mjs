import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const runner = resolve(root, "node_modules/tsx/dist/cli.mjs");

if (!existsSync(runner)) {
  const install = spawnSync("npm", ["ci", "--prefix", root], { stdio: "inherit" });
  if (install.error) throw install.error;
  if (install.status !== 0) process.exit(install.status ?? 1);
}

const result = spawnSync(process.execPath, [runner, ...process.argv.slice(2)], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);