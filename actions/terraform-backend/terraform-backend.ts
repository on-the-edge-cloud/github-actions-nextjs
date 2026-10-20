import { execute, required } from "../lib.js";

const mode = required("TF_VAR_deployment_type");
if (mode !== "ssr" && mode !== "static") throw new Error("Deployment type must be ssr or static.");
const pr = process.env.TF_VAR_pr_number ?? "";
if (pr !== "" && !/^[1-9][0-9]*$/.test(pr)) throw new Error("PR number must be a positive integer.");
const key = `nextjs/${required("GITHUB_REPOSITORY")}/${mode}/${pr || "production"}.tfstate`;

execute("terraform", [
  `-chdir=${required("TERRAFORM_ROOT")}`,
  "init", "-reconfigure", "-input=false",
  `-backend-config=bucket=${required("STATE_BUCKET")}`,
  `-backend-config=key=${key}`,
  `-backend-config=region=${required("STATE_REGION")}`,
  "-backend-config=use_lockfile=true",
]);