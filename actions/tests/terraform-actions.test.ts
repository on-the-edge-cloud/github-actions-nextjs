import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { commands, execute, fixture, stub } from "./test-helpers.js";

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
        assert(values.includes("TF_VAR_domain=\n"));
        assert(values.includes("TF_VAR_acm_certificate_arn=\n"));
        assert(readFileSync(join(workspace, "summary"), "utf8").includes(pr ? "Preview workflow" : "Production workflow"));
      }));
    }
  }
}

for (const mode of ["ssr", "static"]) {
  for (const pr of ["", "42"]) {
    for (const command of ["deploy", "destroy"]) {
      test(`prepare custom domain ${mode}/${pr || "production"}/${command}`, () => fixture(workspace => {
        const certificateArn = "arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012";
        const result = execute("prepare-terraform", {
          GITHUB_WORKSPACE: workspace,
          GITHUB_ENV: join(workspace, "env"),
          GITHUB_STEP_SUMMARY: join(workspace, "summary"),
          APP_DIRECTORY: "app", APP_SLUG: "example", AWS_REGION: "eu-north-1",
          DEPLOYMENT_TYPE: mode, PR_NUMBER: pr, COMMAND: command,
          DOMAIN: "ontheedge.cloud", ACM_CERTIFICATE_ARN: certificateArn,
        });
        assert.equal(result.status, 0, result.stderr);
        const values = readFileSync(join(workspace, "env"), "utf8");
        assert(values.includes(`TF_VAR_domain=${pr ? "" : "ontheedge.cloud"}\n`));
        assert(values.includes(`TF_VAR_acm_certificate_arn=${pr ? "" : certificateArn}\n`));
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
