import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { execute, required } from "../lib.js";

const directory = realpathSync(resolve(required("GITHUB_WORKSPACE"), required("WORKING_DIRECTORY")));
execute("bash", ["-euo", "pipefail", "-c", required("RUN_COMMAND")], directory);