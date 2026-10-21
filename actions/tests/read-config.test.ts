import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { parseDocument, stringify } from "yaml";
import { actionsRoot, execute, fixture } from "./test-helpers.js";

for (const command of ["deploy", "destroy"]) {
  test(`read config ${command} uses the shared runtime`, () => fixture(workspace => {
    writeFileSync(join(workspace, "nextjs-app.yml"), stringify({
      app: { directory: "app", "aws-region": "eu-north-1" },
    }));
    const result = execute("read-config", {
      GITHUB_WORKSPACE: workspace,
      GITHUB_REPOSITORY: "owner/example-app",
      GITHUB_OUTPUT: join(workspace, "outputs"),
      CONFIG_PATH: "nextjs-app.yml",
      COMMAND: command,
    });
    assert.equal(result.status, 0, result.stderr);
    const values = Object.fromEntries(readFileSync(join(workspace, "outputs"), "utf8").trim().split("\n").map(line => {
      const position = line.indexOf("=");
      return [line.slice(0, position), line.slice(position + 1)];
    }));
    assert.deepEqual(values, {
      "app-directory": "app",
      "app-slug": "example-app",
      "node-version": "22",
      "install-command": "npm ci",
      "lint-command": "npm run lint",
      "test-command": "",
      "build-command": "",
      "opennext-build-command": "",
      "allow-unsupported-next-version": "true",
      "smoke-test-command": "",
      "aws-region": "eu-north-1",
      "deployment-type": "ssr",
    });
  }));
}

test("read config uses a direct AWS region without a config file", () => fixture(workspace => {
  const result = execute("read-config", {
    GITHUB_WORKSPACE: workspace,
    GITHUB_REPOSITORY: "owner/example-app",
    GITHUB_OUTPUT: join(workspace, "outputs"),
    AWS_REGION: "eu-north-1",
    COMMAND: "deploy",
  });
  assert.equal(result.status, 0, result.stderr);
  const values = Object.fromEntries(readFileSync(join(workspace, "outputs"), "utf8").trim().split("\n").map(line => {
    const position = line.indexOf("=");
    return [line.slice(0, position), line.slice(position + 1)];
  }));
  assert.equal(values["app-directory"], ".");
  assert.equal(values["app-slug"], "example-app");
  assert.equal(values["aws-region"], "eu-north-1");
  assert.equal(values["deployment-type"], "ssr");
}));

for (const [name, app, command, message] of [
  ["invalid mode", { directory: "app", "aws-region": "eu-north-1", "deployment-type": "invalid" }, "deploy", "app.deployment-type"],
  ["directory traversal", { directory: "..", "aws-region": "eu-north-1" }, "deploy", "app.directory"],
  ["invalid command", { directory: "app", "aws-region": "eu-north-1" }, "invalid", "Command must be deploy or destroy"],
] as const) {
  test(`read config rejects ${name}`, () => fixture(workspace => {
    writeFileSync(join(workspace, "nextjs-app.yml"), stringify({ app }));
    const result = execute("read-config", {
      GITHUB_WORKSPACE: workspace,
      GITHUB_REPOSITORY: "owner/example-app",
      GITHUB_OUTPUT: join(workspace, "outputs"),
      CONFIG_PATH: "nextjs-app.yml",
      COMMAND: command,
    });
    assert.notEqual(result.status, 0);
    assert(result.stderr.includes(message), result.stderr);
  }));
}

test("read config preserves build and smoke test overrides", () => fixture(workspace => {
  writeFileSync(join(workspace, "nextjs-app.yml"), stringify({
    app: { directory: "app", "aws-region": "eu-north-1", "smoke-test-command": "npm run smoke", "opennext-build-command": "npm run custom:build", "allow-unsupported-next-version": true },
  }));
  const result = execute("read-config", {
    GITHUB_WORKSPACE: workspace,
    GITHUB_REPOSITORY: "owner/example-app",
    GITHUB_OUTPUT: join(workspace, "outputs"),
    CONFIG_PATH: "nextjs-app.yml",
    COMMAND: "deploy",
  });
  assert.equal(result.status, 0, result.stderr);
  assert(readFileSync(join(workspace, "outputs"), "utf8").includes("smoke-test-command=npm run smoke\n"));
  assert(readFileSync(join(workspace, "outputs"), "utf8").includes("opennext-build-command=npm run custom:build\n"));
  assert(readFileSync(join(workspace, "outputs"), "utf8").includes("allow-unsupported-next-version=true\n"));
}));

for (const command of ["deploy", "destroy"]) {
  test(`read config complete example/${command}`, () => fixture(workspace => {
    const example = readFileSync(resolve(actionsRoot, "../examples/nextjs-app.yml"), "utf8");
    const config = parseDocument(example).toJS();
    assert.deepEqual(Object.keys(config), ["app"]);
    writeFileSync(join(workspace, "nextjs-app.yml"), example);
    const result = execute("read-config", {
      GITHUB_WORKSPACE: workspace,
      GITHUB_REPOSITORY: "owner/example-app",
      GITHUB_OUTPUT: join(workspace, "outputs"),
      CONFIG_PATH: "nextjs-app.yml",
      COMMAND: command,
    });
    assert.equal(result.status, 0, result.stderr);
    const values = Object.fromEntries(readFileSync(join(workspace, "outputs"), "utf8").trim().split("\n").map(line => {
      const position = line.indexOf("=");
      return [line.slice(0, position), line.slice(position + 1)];
    }));
    assert.deepEqual(values, {
      "app-directory": ".",
      "app-slug": "my-nextjs-app",
      "aws-region": "eu-north-1",
      "deployment-type": "ssr",
      "node-version": "22",
      "install-command": "npm ci",
      "lint-command": "npm run lint",
      "test-command": "npm test",
      "build-command": "",
      "opennext-build-command": "",
      "allow-unsupported-next-version": "true",
      "smoke-test-command": "",
    });
    const inputs = Object.keys(config.app).map(name => name === "directory" ? "app-directory" : name === "slug" ? "app-slug" : name);
    assert.deepEqual(inputs.sort(), Object.keys(values).sort());
  }));
}

for (const app of [{}, { "aws-region": "eu-west-1", "deployment-type": "static" }]) {
  test(`read config rejects legacy preview ${Object.keys(app).length ? "with" : "without"} app settings`, () => fixture(workspace => {
    writeFileSync(join(workspace, "nextjs-app.yml"), stringify({
      app,
      preview: { "aws-region": "eu-north-1", "deployment-type": "ssr" },
    }));
    const result = execute("read-config", {
      GITHUB_WORKSPACE: workspace,
      GITHUB_REPOSITORY: "owner/example-app",
      GITHUB_OUTPUT: join(workspace, "outputs"),
      CONFIG_PATH: "nextjs-app.yml",
      COMMAND: "deploy",
    });
    assert.notEqual(result.status, 0);
    assert(result.stderr.includes("Configuration only supports the app mapping"), result.stderr);
  }));
}

for (const [name, app, message] of [
  ["invalid shared region", { "aws-region": "invalid" }, "app.aws-region"],
  ["invalid shared mode", { "aws-region": "eu-north-1", "deployment-type": "invalid" }, "app.deployment-type"],
  ["missing region", {}, "app.aws-region"],
] as const) {
  test(`read config rejects ${name}`, () => fixture(workspace => {
    writeFileSync(join(workspace, "nextjs-app.yml"), stringify({ app }));
    const result = execute("read-config", {
      GITHUB_WORKSPACE: workspace,
      GITHUB_REPOSITORY: "owner/example-app",
      GITHUB_OUTPUT: join(workspace, "outputs"),
      CONFIG_PATH: "nextjs-app.yml",
      COMMAND: "deploy",
    });
    assert.notEqual(result.status, 0);
    assert(result.stderr.includes(message), result.stderr);
  }));
}

