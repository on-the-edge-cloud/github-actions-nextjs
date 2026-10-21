import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { required, summary, writeValues } from "../lib.js";

const workspace = realpathSync(required("GITHUB_WORKSPACE"));
const appRoot = realpathSync(resolve(workspace, required("APP_DIRECTORY")));
const appRelative = relative(workspace, appRoot);
if (isAbsolute(appRelative) || appRelative === ".." || appRelative.startsWith(`..${sep}`)) {
  throw new Error("Application directory must be inside the checked-out repository.");
}

const slug = required("APP_SLUG");
const region = required("AWS_REGION");
const mode = required("DEPLOYMENT_TYPE");
if (mode !== "ssr" && mode !== "static") throw new Error("Deployment type must be ssr or static.");
const pr = process.env.PR_NUMBER ?? "";
if (pr !== "" && !/^[1-9][0-9]*$/.test(pr)) throw new Error("PR number must be a positive integer.");
const command = required("COMMAND");
if (command !== "deploy" && command !== "destroy") throw new Error("Command must be deploy or destroy.");

writeValues("GITHUB_ENV", {
  TERRAFORM_ROOT: resolve(workspace, ".platform/terraform"),
  TF_IN_AUTOMATION: "true",
  TF_INPUT: "false",
  TF_VAR_app_slug: slug,
  TF_VAR_deployment_type: mode,
  TF_VAR_aws_region: region,
  TF_VAR_pr_number: pr,
  TF_VAR_app_directory: appRoot,
  TF_VAR_domain: pr ? "" : process.env.DOMAIN ?? "",
});

const title = pr ? "Preview workflow" : "Production workflow";
console.log(`::notice title=${title}::${command} for ${slug}, mode ${mode}${pr ? `, PR ${pr}` : ""}`);
summary(`### ${title}\n- App: \`${slug}\`\n${pr ? `- PR: #${pr}\n` : ""}- Region: \`${region}\`\n- Deployment type: \`${mode}\`\n`);