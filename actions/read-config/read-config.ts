import { readFileSync, realpathSync } from "node:fs";
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
const command = process.env.COMMAND;

if (!requestedConfigPath || !command) {
  throw new Error("CONFIG_PATH and COMMAND are required.");
}

if (command !== "deploy" && command !== "destroy") {
  throw new Error("Command must be deploy or destroy.");
}

const configPath = realpathSync(resolve(workspace, requestedConfigPath));
const configRelativePath = relative(workspace, configPath);
if (isAbsolute(configRelativePath) || configRelativePath === ".." || configRelativePath.startsWith(`..${sep}`)) {
  throw new Error("Configuration must be inside the checked-out repository.");
}

const document = parseDocument(readFileSync(configPath, "utf8"), { uniqueKeys: true, schema: "core" });
if (document.errors.length > 0) {
  throw new Error(`Invalid YAML configuration: ${document.errors.map((error) => error.message).join("; ")}`);
}

const config = document.toJS() as Partial<AppConfig> | null;
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
const slug = config.app.slug ?? repositoryName;
if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 24) {
  throw new Error("app.slug must use lowercase letters, digits and single hyphens, and be at most 24 characters.");
}
const region = config.app["aws-region"];
if (!region || !/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region)) {
  throw new Error("app.aws-region is invalid.");
}

const deploymentType = config.app["deployment-type"] ?? "ssr";
if (deploymentType !== "static" && deploymentType !== "ssr") {
  throw new Error("app.deployment-type must be either static or ssr.");
}

const outputs: Record<string, string> = {
  "app-directory": appDirectory,
  "app-slug": slug,
  "node-version": config.app["node-version"] ?? "22",
  "install-command": config.app["install-command"] ?? "npm ci",
  "lint-command": config.app["lint-command"] ?? "npm run lint",
  "test-command": config.app["test-command"] ?? "",
  "build-command": config.app["build-command"] ?? "",
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