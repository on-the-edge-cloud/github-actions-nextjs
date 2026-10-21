import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { parseDocument } from "yaml";
import { actionsRoot } from "./test-helpers.js";

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
