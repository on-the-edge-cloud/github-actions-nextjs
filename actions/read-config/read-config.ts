import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { parseDocument } from "yaml";
import { writeValues } from "../lib.js";

type AppConfig = {
  app: {
    slug?: string;
    directory?: string;
    "node-version"?: string;
    "install-command"?: string;
    "lint-command"?: string;
    "test-command"?: string;
    "build-command"?: string;
    "opennext-build-command"?: string;
    "smoke-test-command"?: string;
    "aws-region"?: string;
    "deployment-type"?: "static" | "ssr";
  };
};

const workspace = realpathSync(process.env.GITHUB_WORKSPACE ?? process.cwd());
const requestedConfigPath = process.env.CONFIG_PATH;
const requestedRegion = process.env.AWS_REGION;
const command = process.env.COMMAND;

if ((!requestedConfigPath && !requestedRegion) || !command) {
  throw new Error("Either CONFIG_PATH or AWS_REGION, and COMMAND, are required.");
}

if (command !== "deploy" && command !== "destroy") {
  throw new Error("Command must be deploy or destroy.");
}

let config: Partial<AppConfig> | null;
if (requestedConfigPath) {
  const configPath = realpathSync(resolve(workspace, requestedConfigPath));
  const configRelativePath = relative(workspace, configPath);
  if (isAbsolute(configRelativePath) || configRelativePath === ".." || configRelativePath.startsWith(`..${sep}`)) {
    throw new Error("Configuration must be inside the checked-out repository.");
  }

  const document = parseDocument(readFileSync(configPath, "utf8"), { uniqueKeys: true, schema: "core" });
  if (document.errors.length > 0) {
    throw new Error(`Invalid YAML configuration: ${document.errors.map((error) => error.message).join("; ")}`);
  }
  config = document.toJS() as Partial<AppConfig> | null;
} else {
  config = { app: {} };
}

if (!config || typeof config !== "object" || !config.app || typeof config.app !== "object" || Array.isArray(config.app)) {
  throw new Error("Configuration must contain an app mapping.");
}
if (Object.keys(config).some(key => key !== "app")) {
  throw new Error("Configuration only supports the app mapping. Move deployment settings into app.");
}

const appDirectory = config.app.directory ?? ".";
if (isAbsolute(appDirectory) || appDirectory.split(/[\\/]/).includes("..")) {
  throw new Error("app.directory must be a relative path without '..'.");
}

const appRoot = realpathSync(resolve(workspace, appDirectory));
const appRelativePath = relative(workspace, appRoot);
if (isAbsolute(appRelativePath) || appRelativePath === ".." || appRelativePath.startsWith(`..${sep}`)) {
  throw new Error("Application directory must be inside the checked-out repository.");
}

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/").at(-1);
const slug = config.app.slug ?? repositoryName
  ?.toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 24)
  .replace(/-+$/g, "");
if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 24) {
  throw new Error("app.slug must use lowercase letters, digits and single hyphens, and be at most 24 characters.");
}
const region = requestedRegion || config.app["aws-region"];
if (!region || !/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region)) {
  throw new Error("app.aws-region is invalid.");
}

const deploymentType = config.app["deployment-type"] ?? "ssr";
if (deploymentType !== "static" && deploymentType !== "ssr") {
  throw new Error("app.deployment-type must be either static or ssr.");
}
const packagePath = resolve(appRoot, "package.json");
const packageJson = existsSync(packagePath)
  ? JSON.parse(readFileSync(packagePath, "utf8")) as { packageManager?: unknown; scripts?: Record<string, unknown> }
  : {};
const packageManagerVersion = packageJson.packageManager;
const scriptCommand = (name: string): string => {
  const script = packageJson.scripts?.[name];
  return typeof script === "string" && script.trim() ? `${packageManager} run ${name}` : "";
};
const yarnLockPath = resolve(appRoot, "yarn.lock");
const packageManager = typeof packageManagerVersion === "string"
  ? (packageManagerVersion.startsWith("yarn@") ? "yarn" : "npm")
  : (existsSync(yarnLockPath) ? "yarn" : "npm");
const lockfile = packageManager === "yarn" ? "yarn.lock" : "package-lock.json";
const modernYarn = packageManager === "yarn" && (typeof packageManagerVersion === "string"
  ? !packageManagerVersion.startsWith("yarn@1.")
  : existsSync(resolve(appRoot, ".yarnrc.yml")) || /(?:^|\n)__metadata:/.test(readFileSync(yarnLockPath, "utf8")));

const outputs: Record<string, string> = {
  "app-directory": appDirectory,
  "app-slug": slug,
  "node-version": config.app["node-version"] ?? "22",
  "package-manager": packageManager,
  "cache-dependency-path": existsSync(resolve(appRoot, lockfile)) ? `${appDirectory}/${lockfile}` : "",
  "install-command": config.app["install-command"] ?? (packageManager === "yarn"
    ? `yarn install --${modernYarn ? "immutable" : "frozen-lockfile"}` : "npm ci"),
  "lint-command": config.app["lint-command"] ?? scriptCommand("lint"),
  "test-command": config.app["test-command"] ?? scriptCommand("test"),
  "build-command": config.app["build-command"] ?? (deploymentType === "static" ? `${packageManager} run build` : ""),
  "opennext-build-command": config.app["opennext-build-command"] ?? "",
  "smoke-test-command": config.app["smoke-test-command"] ?? "",
  "aws-region": region,
  "deployment-type": deploymentType,
};

for (const [name, value] of Object.entries(outputs)) {
  if (typeof value !== "string" || /[\r\n]/.test(value)) {
    throw new Error(`${name} must be a single-line string.`);
  }
}

writeValues("GITHUB_OUTPUT", outputs);