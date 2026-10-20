import { capture, execute, required, writeValues } from "../lib.js";

const distribution = required("DISTRIBUTION_ID");
const id = capture("aws", [
  "cloudfront", "create-invalidation",
  "--distribution-id", distribution,
  "--paths", "/*",
  "--query", "Invalidation.Id", "--output", "text",
]);
if (!id || id === "None") throw new Error("CloudFront did not return an invalidation ID.");
writeValues("GITHUB_OUTPUT", { "invalidation-id": id });
execute("aws", ["cloudfront", "wait", "invalidation-completed", "--distribution-id", distribution, "--id", id]);