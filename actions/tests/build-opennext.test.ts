import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { resolveOpenNext } from "../build-opennext/build-opennext.js";
import openNextConfig from "../build-opennext/open-next.config.js";
import { actionsRoot, execute, fixture } from "./test-helpers.js";

test("OpenNext uses the platform package and configuration by default", () => fixture(workspace => {
  const build = resolveOpenNext(join(workspace, "app"));
  assert.equal(build.config, resolve(actionsRoot, "build-opennext/open-next.config.ts"));
  assert(build.cli.startsWith(resolve(actionsRoot, "node_modules/@opennextjs/aws")));
  assert.deepEqual(openNextConfig, {
    default: {},
    imageOptimization: {
      install: { packages: ["sharp@0.35.5"], arch: "x64", os: "linux", libc: "glibc", nodeVersion: "22" },
    },
  });
}));

for (const customConfig of [false, true]) {
  for (const entrypoint of ["exports", "main"]) {
    test(`OpenNext uses the client's ${entrypoint} package ${customConfig ? "and config" : "with platform config"}`, () => fixture(workspace => {
      const directory = join(workspace, "app");
      const packageDirectory = join(directory, "node_modules/@opennextjs/aws");
      mkdirSync(packageDirectory, { recursive: true });
      writeFileSync(join(directory, "package.json"), "{}");
      writeFileSync(join(packageDirectory, "package.json"), JSON.stringify({
        name: "@opennextjs/aws",
        ...(entrypoint === "exports" ? { exports: { "./index.js": "./cli.cjs" } } : { main: "./cli.cjs" }),
      }));
      writeFileSync(join(packageDirectory, "cli.cjs"), 'process.stdout.write(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }));');
      if (customConfig) writeFileSync(join(directory, "open-next.config.ts"), "export default { default: {} };");
      const result = execute("build-opennext", {
        GITHUB_WORKSPACE: workspace,
        WORKING_DIRECTORY: "app",
        OPENNEXT_BUILD_COMMAND: "",
      });
      assert.equal(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout) as { cwd: string; args: string[] };
      assert.equal(output.cwd, directory);
      assert.deepEqual(output.args.slice(0, 2), ["build", "--config-path"]);
      assert.equal(resolve(directory, output.args[2]), customConfig
        ? join(directory, "open-next.config.ts")
        : resolve(actionsRoot, "build-opennext/open-next.config.ts"));
    }));
  }
}

test("OpenNext custom config requires a client dependency", () => fixture(workspace => {
  writeFileSync(join(workspace, "app/open-next.config.ts"), "export default { default: {} };");
  const result = execute("build-opennext", {
    GITHUB_WORKSPACE: workspace,
    WORKING_DIRECTORY: "app",
    OPENNEXT_BUILD_COMMAND: "",
  });
  assert.notEqual(result.status, 0);
  assert(result.stderr.includes("requires @opennextjs/aws installed in the application"));
}));

test("OpenNext command override replaces the managed build", () => fixture(workspace => {
  writeFileSync(join(workspace, "app/open-next.config.ts"), "invalid custom configuration");
  const result = execute("build-opennext", {
    GITHUB_WORKSPACE: workspace,
    WORKING_DIRECTORY: "app",
    OPENNEXT_BUILD_COMMAND: 'printf "%s" "$PWD"',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, join(workspace, "app"));
}));

test("OpenNext propagates override failures", () => fixture(workspace => {
  const result = execute("build-opennext", {
    GITHUB_WORKSPACE: workspace,
    WORKING_DIRECTORY: "app",
    OPENNEXT_BUILD_COMMAND: "false | true",
  });
  assert.notEqual(result.status, 0);
}));
