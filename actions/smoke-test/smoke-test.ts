import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { execute, required } from "../lib.js";

const command = process.env.SMOKE_TEST_COMMAND ?? "";
if (command !== "") {
  const baseUrl = required("BASE_URL");
  process.env.PREVIEW_URL = baseUrl;
  process.env.PRODUCTION_URL = baseUrl;
  const directory = realpathSync(resolve(required("GITHUB_WORKSPACE"), required("WORKING_DIRECTORY")));
  execute("bash", ["-euo", "pipefail", "-c", command], directory);
} else {
  console.log("No smoke test command configured; skipping.");
}