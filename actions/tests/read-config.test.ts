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
      "package-manager": "npm",
      "cache-dependency-path": "",
      "install-command": "npm ci",
      "lint-command": "",
      "test-command": "",
      "build-command": "",
      "opennext-build-command": "",
      "smoke-test-command": "",
      "aws-region": "eu-north-1",
      "deployment-type": "ssr",
    });
  }));
}

for (const [name, packageManager, lockfile, lockContents, expectedManager, expectedInstall] of [
  ["Yarn 4", "yarn@4.4.1", "yarn.lock", "", "yarn", "yarn install --immutable"],
  ["Yarn Classic", "yarn@1.22.22", "yarn.lock", "", "yarn", "yarn install --frozen-lockfile"],
  ["Yarn Classic lockfile", undefined, "yarn.lock", "# yarn lockfile v1\n", "yarn", "yarn install --frozen-lockfile"],
  ["modern Yarn lockfile", undefined, "yarn.lock", "__metadata:\n  version: 8\n", "yarn", "yarn install --immutable"],
  ["npm", "npm@10.9.9", "package-lock.json", "{}", "npm", "npm ci"],
  ["Yarn without lockfile", "yarn@4.4.1", "", "", "yarn", "yarn install --immutable"],
  ["npm without lockfile", undefined, "", "", "npm", "npm ci"],
] as const) {
test(`read config detects ${name} and uses its lockfile and commands`, () => fixture(workspace => {
  if (lockfile) writeFileSync(join(workspace, "app", lockfile), lockContents);
  writeFileSync(join(workspace, "app/package.json"), JSON.stringify({ packageManager, scripts: { lint: "eslint .", test: "node --test" } }));
  writeFileSync(join(workspace, "nextjs-app.yml"), stringify({
    app: { directory: "app", "aws-region": "eu-north-1" },
  }));
  const result = execute("read-config", {
    GITHUB_WORKSPACE: workspace,
    GITHUB_REPOSITORY: "owner/example-app",
    GITHUB_OUTPUT: join(workspace, "outputs"),
    CONFIG_PATH: "nextjs-app.yml",
    COMMAND: "deploy",
  });
  assert.equal(result.status, 0, result.stderr);
  const values = Object.fromEntries(readFileSync(join(workspace, "outputs"), "utf8").trim().split("\n").map(line => {
    const position = line.indexOf("=");
    return [line.slice(0, position), line.slice(position + 1)];
  }));
  assert.equal(values["package-manager"], expectedManager);
  assert.equal(values["cache-dependency-path"], lockfile ? `app/${lockfile}` : "");
  assert.equal(values["install-command"], expectedInstall);
  assert.equal(values["lint-command"], `${expectedManager} run lint`);
  assert.equal(values["test-command"], `${expectedManager} run test`);
}));
}

for (const packageManager of ["npm@10.9.9", "yarn@4.4.1"]) {
  for (const scripts of [{ build: "next build" }, { lint: "eslint ." }, { test: "node --test" }, { lint: "", test: "  " }]) {
    test(`read config detects optional scripts ${JSON.stringify(scripts)} with ${packageManager}`, () => fixture(workspace => {
      writeFileSync(join(workspace, "app/package.json"), JSON.stringify({ packageManager, scripts }));
      writeFileSync(join(workspace, "nextjs-app.yml"), stringify({
        app: { directory: "app", "aws-region": "eu-north-1" },
      }));
      const result = execute("read-config", {
        GITHUB_WORKSPACE: workspace,
        GITHUB_REPOSITORY: "owner/example-app",
        GITHUB_OUTPUT: join(workspace, "outputs"),
        CONFIG_PATH: "nextjs-app.yml",
        COMMAND: "deploy",
      });
      assert.equal(result.status, 0, result.stderr);
      const outputs = readFileSync(join(workspace, "outputs"), "utf8");
      const manager = packageManager.split("@")[0];
      assert(outputs.includes(`lint-command=${scripts.lint?.trim() ? `${manager} run lint` : ""}\n`));
      assert(outputs.includes(`test-command=${scripts.test?.trim() ? `${manager} run test` : ""}\n`));
    }));
  }
  for (const override of ["", "custom-check"]) {
    test(`read config preserves optional command override ${JSON.stringify(override)} with ${packageManager}`, () => fixture(workspace => {
      writeFileSync(join(workspace, "app/package.json"), JSON.stringify({ packageManager, scripts: { lint: "eslint .", test: "node --test" } }));
      writeFileSync(join(workspace, "nextjs-app.yml"), stringify({
        app: { directory: "app", "aws-region": "eu-north-1", "lint-command": override, "test-command": override },
      }));
      const result = execute("read-config", {
        GITHUB_WORKSPACE: workspace,
        GITHUB_REPOSITORY: "owner/example-app",
        GITHUB_OUTPUT: join(workspace, "outputs"),
        CONFIG_PATH: "nextjs-app.yml",
        COMMAND: "deploy",
      });
      assert.equal(result.status, 0, result.stderr);
      const outputs = readFileSync(join(workspace, "outputs"), "utf8");
      assert(outputs.includes(`lint-command=${override}\n`));
      assert(outputs.includes(`test-command=${override}\n`));
    }));
  }
}

test("read config preserves custom commands for Yarn", () => fixture(workspace => {
  writeFileSync(join(workspace, "yarn.lock"), "");
  writeFileSync(join(workspace, "nextjs-app.yml"), stringify({
    app: { "aws-region": "eu-north-1", "install-command": "yarn install --inline-builds", "lint-command": "yarn lint:custom" },
  }));
  const result = execute("read-config", {
    GITHUB_WORKSPACE: workspace,
    GITHUB_REPOSITORY: "owner/example-app",
    GITHUB_OUTPUT: join(workspace, "outputs"),
    CONFIG_PATH: "nextjs-app.yml",
    COMMAND: "deploy",
  });
  assert.equal(result.status, 0, result.stderr);
  const outputs = readFileSync(join(workspace, "outputs"), "utf8");
  assert(outputs.includes("install-command=yarn install --inline-builds\n"));
  assert(outputs.includes("lint-command=yarn lint:custom\n"));
}));

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

for (const [repository, expectedSlug] of [
  ["on-the-edge-cloud/ontheedge.cloud", "ontheedge-cloud"],
  ["owner/Example_APP", "example-app"],
  ["owner/--Example...__App--", "example-app"],
  ["owner/abcdefghijklmnopqrstuvwxyz", "abcdefghijklmnopqrstuvwx"],
  ["owner/abcdefghijklmnopqrstuvw-nextjs", "abcdefghijklmnopqrstuvw"],
] as const) {
  for (const command of ["deploy", "destroy"]) {
    test(`read config ${command} normalizes the repository slug for ${repository}`, () => fixture(workspace => {
      const result = execute("read-config", {
        GITHUB_WORKSPACE: workspace,
        GITHUB_REPOSITORY: repository,
        GITHUB_OUTPUT: join(workspace, "outputs"),
        AWS_REGION: "eu-north-1",
        COMMAND: command,
      });
      assert.equal(result.status, 0, result.stderr);
      assert(readFileSync(join(workspace, "outputs"), "utf8").includes(`app-slug=${expectedSlug}\n`));
    }));
  }
}

test("read config preserves an explicit slug instead of normalizing the repository name", () => fixture(workspace => {
  writeFileSync(join(workspace, "nextjs-app.yml"), stringify({
    app: { slug: "custom-app", "aws-region": "eu-north-1" },
  }));
  const result = execute("read-config", {
    GITHUB_WORKSPACE: workspace,
    GITHUB_REPOSITORY: "on-the-edge-cloud/ontheedge.cloud",
    GITHUB_OUTPUT: join(workspace, "outputs"),
    CONFIG_PATH: "nextjs-app.yml",
    COMMAND: "deploy",
  });
  assert.equal(result.status, 0, result.stderr);
  assert(readFileSync(join(workspace, "outputs"), "utf8").includes("app-slug=custom-app\n"));
}));

for (const [name, app, command, message] of [
  ...["ontheedge.cloud", "Example-app", "example--app", "-app", "app-", "", "abcdefghijklmnopqrstuvwxyz"].map(slug =>
    [`invalid explicit slug ${JSON.stringify(slug)}`, { slug, "aws-region": "eu-north-1" }, "deploy", "app.slug"] as const),
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
    app: { directory: "app", "aws-region": "eu-north-1", "smoke-test-command": "npm run smoke", "opennext-build-command": "npm run custom:build" },
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
      "package-manager": "npm",
      "cache-dependency-path": "",
      "install-command": "npm ci",
      "lint-command": "npm run lint",
      "test-command": "npm test",
      "build-command": "",
      "opennext-build-command": "",
      "smoke-test-command": "",
    });
    const inputs = Object.keys(config.app).map(name => name === "directory" ? "app-directory" : name === "slug" ? "app-slug" : name);
    assert.deepEqual(inputs.sort(), Object.keys(values).filter(name => !["package-manager", "cache-dependency-path"].includes(name)).sort());
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

