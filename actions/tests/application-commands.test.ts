import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { execute, fixture } from "./test-helpers.js";

test("application commands run in the app directory with smoke-test variables", () => fixture(workspace => {
  mkdirSync(join(workspace, "app with spaces"));
  const result = execute("run-command", {
    GITHUB_WORKSPACE: workspace,
    WORKING_DIRECTORY: "app with spaces",
    RUN_COMMAND: 'printf "%s\\n%s\\n%s" "$PWD" "$PREVIEW_URL" "$PRODUCTION_URL"',
    PREVIEW_URL: "https://example.cloudfront.net",
    PRODUCTION_URL: "https://example.cloudfront.net",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${join(workspace, "app with spaces")}\nhttps://example.cloudfront.net\nhttps://example.cloudfront.net`);
}));

for (const command of ["false | true", "false; echo unexpected", 'echo "$MISSING_TEST_VARIABLE"', "exit 7"]) {
  test(`application command failure: ${command}`, () => fixture(workspace => {
    const result = execute("run-command", {
      GITHUB_WORKSPACE: workspace,
      WORKING_DIRECTORY: "app",
      RUN_COMMAND: command,
    });
    assert.notEqual(result.status, 0);
    assert(!result.stdout.includes("unexpected"));
    if (command === "exit 7") assert.equal(result.status, 7);
  }));
}

test("smoke test is skipped when no command is configured", () => {
  const result = execute("smoke-test", { SMOKE_TEST_COMMAND: "" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /skipping/);
});

test("smoke test command runs in the app directory with deployment URLs", () => fixture(workspace => {
  mkdirSync(join(workspace, "app with spaces"));
  const result = execute("smoke-test", {
    BASE_URL: "http://127.0.0.1:1",
    GITHUB_WORKSPACE: workspace,
    WORKING_DIRECTORY: "app with spaces",
    SMOKE_TEST_COMMAND: 'printf "%s\\n%s\\n%s\\n%s" "$PWD" "$PREVIEW_URL" "$PRODUCTION_URL" "$BASE_URL"',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${join(workspace, "app with spaces")}\nhttp://127.0.0.1:1\nhttp://127.0.0.1:1\nhttp://127.0.0.1:1`);
}));

for (const command of ["false | true", "false; echo unexpected", "exit 7"]) {
  test(`smoke test override propagates failure: ${command}`, () => fixture(workspace => {
    const result = execute("smoke-test", {
      BASE_URL: "http://127.0.0.1:1",
      GITHUB_WORKSPACE: workspace,
      WORKING_DIRECTORY: "app",
      SMOKE_TEST_COMMAND: command,
    });
    assert.notEqual(result.status, 0);
    assert(!result.stdout.includes("unexpected"));
    if (command === "exit 7") assert.equal(result.status, 7);
  }));
}
