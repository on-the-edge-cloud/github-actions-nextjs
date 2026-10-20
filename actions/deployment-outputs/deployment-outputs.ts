import { capture, required, summary, writeValues } from "../lib.js";

const environment = required("DEPLOYMENT_ENVIRONMENT");
if (environment !== "production" && environment !== "preview") throw new Error("Environment must be preview or production.");
const root = required("TERRAFORM_ROOT");
const url = capture("terraform", [`-chdir=${root}`, "output", "-raw", "preview_url"]);
const distribution = capture("terraform", [`-chdir=${root}`, "output", "-raw", "cloudfront_distribution_id"]);
if (!url || !distribution) throw new Error("Terraform must return a deployment URL and distribution ID.");
writeValues("GITHUB_OUTPUT", { url, "distribution-id": distribution });
const title = environment === "production" ? "Production deployed" : "Preview deployed";
summary(`### ${title}\n- URL: ${url}\n`);