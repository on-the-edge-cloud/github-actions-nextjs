import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseDocument, stringify } from "yaml";
import { resolveOpenNext } from "./build-opennext/build-opennext.js";
import openNextConfig from "./build-opennext/open-next.config.js";
import { nextVersion, updateReadme } from "./release/release.js";

const actionsRoot = dirname(fileURLToPath(import.meta.url));

function fixture(run: (workspace: string) => void): void {
  const workspace = mkdtempSync(join(tmpdir(), "nextjs-actions-"));
  try {
    mkdirSync(join(workspace, "app"));
    run(workspace);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

function execute(action: string, env: Record<string, string>) {
  return spawnSync(process.execPath, [resolve(actionsRoot, "run.mjs"), resolve(actionsRoot, action, `${action}.ts`)], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function stub(workspace: string, command: string, body = ""): Record<string, string> {
  const bin = join(workspace, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, command), `#!${process.execPath}\nconst fs = require("node:fs");\nfs.appendFileSync(process.env.COMMAND_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");\n${body}\n`, { mode: 0o755 });
  return { PATH: `${bin}:${process.env.PATH}`, COMMAND_LOG: join(workspace, "commands") };
}

function commands(workspace: string): string[][] {
  return readFileSync(join(workspace, "commands"), "utf8").trim().split("\n").map(line => JSON.parse(line) as string[]);
}

test("release versions continue from v1.8 and increment numerically", () => {
  assert.equal(nextVersion([]), "v1.9");
  assert.equal(nextVersion(["v1", "v1.3", "v1.8"]), "v1.9");
  assert.equal(nextVersion(["v1.9", "v1.10", "v1.8"]), "v1.11");
  assert.equal(nextVersion(["v1.8", "v1.9.0", "v999-test"]), "v1.9");
});

test("release updates only this repository's workflow versions in README", () => {
  const text = [
    "uses: owner/platform/.github/workflows/nextjs-preview.yml@v1",
    "uses: owner/platform/.github/workflows/nextjs-production.yml@v1.8",
    "uses: another/platform/.github/workflows/nextjs-production.yml@v1.4",
    "Terraform module v1.4",
  ].join("\n");
  assert.equal(updateReadme(text, "owner/platform", "v1.9"), text
    .replace("nextjs-preview.yml@v1\n", "nextjs-preview.yml@v1.9\n")
    .replace("nextjs-production.yml@v1.8", "nextjs-production.yml@v1.9"));
});

test("release workflow runs on main pushes with write permission", () => {
  const document = parseDocument(readFileSync(resolve(actionsRoot, "../.github/workflows/release.yml"), "utf8"), { uniqueKeys: true });
  assert.deepEqual(document.errors, []);
  const workflow = document.toJS();
  assert.deepEqual(workflow.on.push.branches, ["main"]);
  assert.equal(workflow.permissions.contents, "write");
  assert(workflow.jobs.release.steps.some((step: { uses?: string }) => step.uses === "./actions/release"));
});

test("release publishes README commit and annotated tag once per push", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "nextjs-release-test-"));
  const repository = join(workspace, "repository");
  const origin = join(workspace, "origin.git");
  const runGit = (args: string[]) => {
    const result = spawnSync("git", args, { cwd: repository, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const published = new Map<string, string>();
  const releases: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.method === "GET") {
      const url = published.get(request.url?.split("/").at(-1) ?? "");
      response.statusCode = url ? 200 : 404;
      response.end(JSON.stringify(url ? { html_url: url } : { message: "Not Found" }));
    } else {
      let body = "";
      for await (const chunk of request) body += chunk;
      const release = JSON.parse(body) as { tag_name: string };
      releases.push(release);
      const url = `https://example.test/releases/${release.tag_name}`;
      published.set(release.tag_name, url);
      response.statusCode = 201;
      response.end(JSON.stringify({ html_url: url }));
    }
  });
  try {
    mkdirSync(repository);
    runGit(["init", "--bare", origin]);
    runGit(["init", "-b", "main"]);
    runGit(["config", "user.name", "Test"]);
    runGit(["config", "user.email", "test@example.test"]);
    writeFileSync(join(repository, "README.md"), "uses: owner/platform/.github/workflows/nextjs-production.yml@v1.8\n");
    mkdirSync(join(repository, "docs"));
    writeFileSync(join(repository, "docs/README.md"), "uses: owner/platform/.github/workflows/nextjs-preview.yml@v1\n");
    runGit(["add", "README.md", "docs/README.md"]);
    runGit(["commit", "-m", "Initial platform"]);
    runGit(["tag", "v1.8"]);
    runGit(["remote", "add", "origin", origin]);
    runGit(["push", "origin", "main", "--tags"]);
    let source = runGit(["rev-parse", "HEAD"]);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address !== "string");
    for (const attempt of [1, 2, 3]) {
      if (attempt === 3) {
        writeFileSync(join(repository, "change.txt"), "Next push");
        runGit(["add", "change.txt"]);
        runGit(["commit", "-m", "Next platform change"]);
        runGit(["push", "origin", "HEAD:refs/heads/main"]);
        source = runGit(["rev-parse", "HEAD"]);
      }
      const child: ReturnType<typeof spawn> = spawn(process.execPath, [resolve(actionsRoot, "run.mjs"), resolve(actionsRoot, "release/release.ts")], {
        env: {
          ...process.env,
          GITHUB_WORKSPACE: repository,
          GITHUB_REPOSITORY: "owner/platform",
          GITHUB_SHA: source,
          GITHUB_TOKEN: "test-token",
          GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
          GITHUB_OUTPUT: join(workspace, `outputs-${attempt}`),
          GITHUB_STEP_SUMMARY: join(workspace, "summary"),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk; });
      child.stdout?.resume();
      const [status]: unknown[] = await once(child, "close");
      assert.equal(status, 0, stderr);
      assert(readFileSync(join(workspace, `outputs-${attempt}`), "utf8").includes(`version=${attempt === 3 ? "v1.10" : "v1.9"}\n`));
    }
    assert.equal(releases.length, 2);
    assert.equal(releases[0].tag_name, "v1.9");
    assert.equal(releases[1].tag_name, "v1.10");
    assert.equal(releases[0].generate_release_notes, true);
    assert.equal(runGit(["cat-file", "-t", "v1.9"]), "tag");
    assert.equal(runGit(["rev-parse", "v1.10^{}"]), runGit(["rev-parse", "refs/remotes/origin/main"]));
    assert(runGit(["show", "v1.9:README.md"]).includes("@v1.9"));
    assert(runGit(["show", "v1.9:docs/README.md"]).includes("@v1.9"));
    assert(runGit(["show", "v1.10:README.md"]).includes("@v1.10"));
    assert(runGit(["show", "v1.10:docs/README.md"]).includes("@v1.10"));
    assert(runGit(["log", "-1", "--format=%s"]).includes("[skip ci]"));
    assert.deepEqual(runGit(["tag", "--list"]).split("\n"), ["v1.10", "v1.8", "v1.9"]);
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    rmSync(workspace, { recursive: true, force: true });
  }
});

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

for (const filename of ["nextjs-app.yml", "nextjs-app-minimal.yml"]) {
  for (const command of ["deploy", "destroy"]) {
    test(`read config example ${filename}/${command}`, () => fixture(workspace => {
      const example = readFileSync(resolve(actionsRoot, `../examples/${filename}`), "utf8");
      const config = parseDocument(example).toJS();
      assert.deepEqual(Object.keys(config), ["app"]);
      if (filename === "nextjs-app-minimal.yml") assert.deepEqual(Object.keys(config.app), ["aws-region"]);
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
        "app-slug": filename === "nextjs-app.yml" ? "my-nextjs-app" : "example-app",
        "aws-region": "eu-north-1",
        "deployment-type": "ssr",
        "node-version": "22",
        "install-command": "npm ci",
        "lint-command": "npm run lint",
        "test-command": filename === "nextjs-app.yml" ? "npm test" : "",
        "build-command": "",
        "opennext-build-command": "",
        "smoke-test-command": "",
      });
      if (filename === "nextjs-app.yml") {
        const inputs = Object.keys(config.app).map(name => name === "directory" ? "app-directory" : name === "slug" ? "app-slug" : name);
        assert.deepEqual(inputs.sort(), Object.keys(values).sort());
      }
    }));
  }
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

for (const mode of ["ssr", "static"]) {
  for (const pr of ["", "42"]) {
    for (const command of ["deploy", "destroy"]) {
      test(`prepare ${mode}/${pr || "production"}/${command}`, () => fixture(workspace => {
        const result = execute("prepare-terraform", {
          GITHUB_WORKSPACE: workspace,
          GITHUB_ENV: join(workspace, "env"),
          GITHUB_STEP_SUMMARY: join(workspace, "summary"),
          APP_DIRECTORY: "app",
          APP_SLUG: "example",
          AWS_REGION: "eu-north-1",
          DEPLOYMENT_TYPE: mode,
          PR_NUMBER: pr,
          COMMAND: command,
        });
        assert.equal(result.status, 0, result.stderr);
        const values = readFileSync(join(workspace, "env"), "utf8");
        assert(values.includes(`TF_VAR_app_directory=${join(workspace, "app")}\n`));
        assert(values.includes(`TERRAFORM_ROOT=${join(workspace, ".platform/terraform")}\n`));
        assert(values.includes(`TF_VAR_deployment_type=${mode}\n`));
        assert(values.includes(`TF_VAR_pr_number=${pr}\n`));
        assert(values.includes("TF_VAR_app_slug=example\n"));
        assert(readFileSync(join(workspace, "summary"), "utf8").includes(pr ? "Preview workflow" : "Production workflow"));
      }));
    }
  }
}

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

for (const repository of ["owner/app-one", "owner/app-two"]) {
  for (const mode of ["ssr", "static"]) {
    for (const pr of ["", "12", "13"]) {
      test(`backend ${repository}/${mode}/${pr || "production"}`, () => fixture(workspace => {
        const result = execute("terraform-backend", {
          ...stub(workspace, "terraform"),
          TERRAFORM_ROOT: join(workspace, ".platform/terraform"),
          GITHUB_REPOSITORY: repository,
          TF_VAR_deployment_type: mode,
          TF_VAR_pr_number: pr,
          STATE_BUCKET: "on-the-edge-terraform-state",
          STATE_REGION: "eu-north-1",
        });
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(commands(workspace), [[
          `-chdir=${join(workspace, ".platform/terraform")}`,
          "init", "-reconfigure", "-input=false",
          "-backend-config=bucket=on-the-edge-terraform-state",
          `-backend-config=key=nextjs/${repository}/${mode}/${pr || "production"}.tfstate`,
          "-backend-config=region=eu-north-1",
          "-backend-config=use_lockfile=true",
        ]]);
      }));
    }
  }
}

for (const environment of ["preview", "production"]) {
  test(`outputs ${environment}`, () => fixture(workspace => {
    const result = execute("deployment-outputs", {
      ...stub(workspace, "terraform", 'process.stdout.write(process.argv.at(-1) === "preview_url" ? "https://example.cloudfront.net" : "EDISTRIBUTION");'),
      TERRAFORM_ROOT: workspace,
      DEPLOYMENT_ENVIRONMENT: environment,
      GITHUB_OUTPUT: join(workspace, "outputs"),
      GITHUB_STEP_SUMMARY: join(workspace, "summary"),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(workspace, "outputs"), "utf8"), "url=https://example.cloudfront.net\ndistribution-id=EDISTRIBUTION\n");
    assert.deepEqual(commands(workspace), [
      [`-chdir=${workspace}`, "output", "-raw", "preview_url"],
      [`-chdir=${workspace}`, "output", "-raw", "cloudfront_distribution_id"],
    ]);
  }));
}

test("CloudFront creates an invalidation before waiting", () => fixture(workspace => {
  const result = execute("invalidate-cloudfront", {
    ...stub(workspace, "aws", 'if (process.argv.includes("create-invalidation")) process.stdout.write("IINVALIDATION\\n");'),
    DISTRIBUTION_ID: "EDISTRIBUTION",
    GITHUB_OUTPUT: join(workspace, "outputs"),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(workspace, "outputs"), "utf8"), "invalidation-id=IINVALIDATION\n");
  assert.deepEqual(commands(workspace), [
    ["cloudfront", "create-invalidation", "--distribution-id", "EDISTRIBUTION", "--paths", "/*", "--query", "Invalidation.Id", "--output", "text"],
    ["cloudfront", "wait", "invalidation-completed", "--distribution-id", "EDISTRIBUTION", "--id", "IINVALIDATION"],
  ]);
}));

test("backend propagates Terraform failures", () => fixture(workspace => {
  const result = execute("terraform-backend", {
    ...stub(workspace, "terraform", "process.exit(7);"),
    TERRAFORM_ROOT: workspace,
    GITHUB_REPOSITORY: "owner/app",
    TF_VAR_deployment_type: "ssr",
    TF_VAR_pr_number: "",
    STATE_BUCKET: "state",
    STATE_REGION: "eu-north-1",
  });
  assert.equal(result.status, 7);
}));

test("CloudFront does not wait after a failed create", () => fixture(workspace => {
  const result = execute("invalidate-cloudfront", {
    ...stub(workspace, "aws", "process.exit(1);"),
    DISTRIBUTION_ID: "EDISTRIBUTION",
    GITHUB_OUTPUT: join(workspace, "outputs"),
  });
  assert.notEqual(result.status, 0);
  assert.equal(commands(workspace).length, 1);
}));

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

for (const existing of [false, true]) {
  test(`preview comment ${existing ? "updates" : "creates"}`, async () => {
    const requests: { method: string | undefined; url: string | undefined; body: string }[] = [];
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      requests.push({ method: request.method, url: request.url, body });
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(request.method === "GET"
        ? existing ? [{ id: 123, user: { type: "Bot" }, body: "Preview listo: https://old.example" }] : []
        : { id: 123 }));
    });
    server.listen(0, "127.0.0.1");
    try {
      await once(server, "listening");
      const address = server.address();
      assert(address && typeof address !== "string");
      const child = spawn(process.execPath, [resolve(actionsRoot, "run.mjs"), resolve(actionsRoot, "comment-preview/comment-preview.ts")], {
        env: {
          ...process.env,
          GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
          GITHUB_REPOSITORY: "owner/app",
          GITHUB_TOKEN: "test-token",
          PR_NUMBER: "42",
          PREVIEW_URL: "https://new.example",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.stdout.resume();
      const [status] = await once(child, "close");
      assert.equal(status, 0, stderr);
      assert.deepEqual(requests, [
        { method: "GET", url: "/repos/owner/app/issues/42/comments", body: "" },
        {
          method: existing ? "PATCH" : "POST",
          url: existing ? "/repos/owner/app/issues/comments/123" : "/repos/owner/app/issues/42/comments",
          body: JSON.stringify({ body: "Preview listo: https://new.example" }),
        },
      ]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
}

test("workflow callers match local action inputs and outputs", () => {
  for (const kind of ["preview", "production"]) {
    const file = resolve(actionsRoot, `../.github/workflows/nextjs-${kind}.yml`);
    const document = parseDocument(readFileSync(file, "utf8"), { uniqueKeys: true });
    assert.deepEqual(document.errors, []);
    const workflow = document.toJS();
    const steps = workflow.jobs[kind].steps;
    const build = steps.find((step: { name: string }) => step.name === "Build OpenNext");
    assert.equal(build.uses, "./.platform/actions/build-opennext");
    assert.equal(build.with.command, "${{ steps.config.outputs.opennext-build-command }}");
    assert.equal(build.with["working-directory"], "${{ steps.config.outputs.app-directory }}");
    const smoke = steps.find((step: { uses?: string }) => step.uses === "./.platform/actions/smoke-test");
    assert(smoke, `${kind} must run the platform smoke test`);
    assert.equal(smoke.with.url, `\${{ steps.${kind}.outputs.url }}`);
    assert.equal(smoke.with.command, "${{ steps.config.outputs.smoke-test-command }}");
    assert.equal(smoke.with["working-directory"], "${{ steps.config.outputs.app-directory }}");
    assert(steps.indexOf(smoke) > steps.findIndex((step: { name: string }) => step.name === "Invalidate CloudFront"));
    assert.equal(smoke.if, kind === "preview" ? "inputs.command == 'deploy'" : undefined);
    for (const step of steps.filter((step: { uses?: string }) => step.uses?.startsWith("./.platform/actions/"))) {
      const actionDirectory = step.uses.replace("./.platform/actions/", "");
      const actionDocument = parseDocument(readFileSync(resolve(actionsRoot, actionDirectory, "action.yml"), "utf8"), { uniqueKeys: true });
      assert.deepEqual(actionDocument.errors, []);
      const action = actionDocument.toJS();
      for (const name of Object.keys(step.with ?? {})) {
        assert(Object.hasOwn(action.inputs ?? {}, name), `${kind}/${step.name}: unknown input ${name}`);
      }
      for (const [name, input] of Object.entries(action.inputs ?? {}) as [string, { required?: boolean; default?: string }][]) {
        if (input.required && input.default === undefined) {
          assert(Object.hasOwn(step.with ?? {}, name), `${kind}/${step.name}: missing input ${name}`);
        }
      }
      if (step.id) {
        const references = new RegExp(`steps\\.${step.id}\\.outputs\\.([a-z0-9-]+)`, "g");
        for (const [, name] of readFileSync(file, "utf8").matchAll(references)) {
          assert(Object.hasOwn(action.outputs ?? {}, name), `${kind}/${step.name}: unknown output ${name}`);
        }
      }
    }
    const platform = steps.find((step: { with?: { repository?: string } }) => step.with?.repository === "on-the-edge-cloud/github-actions-nextjs");
    const module = steps.find((step: { with?: { repository?: string } }) => step.with?.repository === "on-the-edge-cloud/terraform-aws-nextjs");
    assert.equal(platform.with.ref, "main");
    assert.equal(module.with.ref, "v1.4");
    assert(!Object.hasOwn(workflow.on.workflow_call.inputs, "platform-ref"));
    if (kind === "production") {
      assert.equal(workflow.jobs.production.outputs["production-url"], "${{ steps.production.outputs.url }}");
    } else {
      const destroy = steps.find((step: { name: string }) => step.name === "Destroy preview");
      assert.equal(destroy.if, "inputs.command == 'destroy'");
      assert(destroy.run.includes('deploy_artifacts=false'));
      for (const step of steps.filter((step: { uses?: string }) => ["run-command", "build-opennext", "deployment-outputs", "invalidate-cloudfront", "smoke-test", "comment-preview"].some(action => step.uses === `./.platform/actions/${action}`))) {
        assert(step.if.includes("inputs.command == 'deploy'"), `${step.name} must not run during destroy`);
      }
    }
  }
});