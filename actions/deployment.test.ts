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

for (const command of ["deploy", "destroy"]) {
  test(`read config ${command} uses the shared runtime`, () => fixture(workspace => {
    writeFileSync(join(workspace, "nextjs-app.yml"), stringify({
      app: { directory: "app" },
      preview: { "aws-region": "eu-north-1" },
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
      "workspace-prefix": "example-app",
      "node-version": "22",
      "install-command": "npm ci",
      "lint-command": "npm run lint",
      "test-command": "",
      "build-command": "",
      "opennext-build-command": "npm run opennext:build",
      "smoke-test-command": "",
      "aws-region": "eu-north-1",
      "deployment-type": "ssr",
    });
  }));
}

for (const [name, app, preview, command, message] of [
  ["invalid mode", { directory: "app" }, { "aws-region": "eu-north-1", "deployment-type": "invalid" }, "deploy", "preview.deployment-type"],
  ["directory traversal", { directory: ".." }, { "aws-region": "eu-north-1" }, "deploy", "app.directory"],
  ["invalid command", { directory: "app" }, { "aws-region": "eu-north-1" }, "invalid", "Command must be deploy or destroy"],
] as const) {
  test(`read config rejects ${name}`, () => fixture(workspace => {
    writeFileSync(join(workspace, "nextjs-app.yml"), stringify({ app, preview }));
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
      for (const step of steps.filter((step: { uses?: string }) => ["run-command", "deployment-outputs", "invalidate-cloudfront", "comment-preview"].some(action => step.uses === `./.platform/actions/${action}`))) {
        assert(step.if.includes("inputs.command == 'deploy'"), `${step.name} must not run during destroy`);
      }
    }
  }
});