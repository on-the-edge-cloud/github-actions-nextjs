import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

export function required(name: string): string {
  const value = process.env[name];
  if (!value || /[\r\n]/.test(value)) {
    throw new Error(`${name} must be a non-empty single-line value.`);
  }
  return value;
}

export function writeValues(fileVariable: string, values: Record<string, string>): void {
  for (const [name, value] of Object.entries(values)) {
    if (/[\r\n]/.test(value)) throw new Error(`${name} must be a single-line value.`);
  }
  appendFileSync(required(fileVariable), Object.entries(values).map(([name, value]) => `${name}=${value}\n`).join(""));
}

export function summary(text: string): void {
  appendFileSync(required("GITHUB_STEP_SUMMARY"), text);
}

export function capture(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

export function execute(command: string, args: string[], cwd?: string): void {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}