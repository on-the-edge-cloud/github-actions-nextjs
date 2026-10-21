import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const actionsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function fixture(run: (workspace: string) => void): void {
  const workspace = mkdtempSync(join(tmpdir(), "nextjs-actions-"));
  try {
    mkdirSync(join(workspace, "app"));
    run(workspace);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

export function execute(action: string, env: Record<string, string>) {
  return spawnSync(process.execPath, [resolve(actionsRoot, "run.mjs"), resolve(actionsRoot, action, action + ".ts")], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

export function stub(workspace: string, command: string, body = ""): Record<string, string> {
  const bin = join(workspace, "bin");
  mkdirSync(bin, { recursive: true });
  const script = [
    "#!" + process.execPath,
    "const fs = require(" + JSON.stringify("node:fs") + ");",
    "fs.appendFileSync(process.env.COMMAND_LOG, JSON.stringify(process.argv.slice(2)) + \"\\n\");",
    body,
  ].join(String.fromCharCode(10));
  writeFileSync(join(bin, command), script, { mode: 0o755 });
  return { PATH: bin + ":" + process.env.PATH, COMMAND_LOG: join(workspace, "commands") };
}

export function commands(workspace: string): string[][] {
  return readFileSync(join(workspace, "commands"), "utf8").trim().split(String.fromCharCode(10)).map(line => JSON.parse(line) as string[]);
}
