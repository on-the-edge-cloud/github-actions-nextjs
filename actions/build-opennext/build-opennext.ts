import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execute, required } from "../lib.js";

type OpenNextBuild = {
  cli: string;
  config: string;
};

function resolveCli(loader: NodeJS.Require): string | undefined {
  for (const entry of ["@opennextjs/aws/index.js", "@opennextjs/aws"]) {
    try {
      return loader.resolve(entry);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "MODULE_NOT_FOUND" && code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
    }
  }
}

export function resolveOpenNext(directory: string): OpenNextBuild {
  const clientConfig = resolve(directory, "open-next.config.ts");
  const clientRequire = createRequire(resolve(directory, "package.json"));
  const clientCli = resolveCli(clientRequire);
  if (existsSync(clientConfig) && !clientCli) {
    throw new Error("A custom open-next.config.ts requires @opennextjs/aws installed in the application.");
  }

  const cli = clientCli ?? resolveCli(createRequire(import.meta.url));
  if (!cli) throw new Error("The platform OpenNext dependency is not installed.");
  return {
    cli,
    config: existsSync(clientConfig) ? clientConfig : fileURLToPath(new URL("./open-next.config.ts", import.meta.url)),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = realpathSync(resolve(required("GITHUB_WORKSPACE"), required("WORKING_DIRECTORY")));
  const command = process.env.OPENNEXT_BUILD_COMMAND ?? "";
  if (command !== "") {
    execute("bash", ["-euo", "pipefail", "-c", command], directory);
  } else {
    const build = resolveOpenNext(directory);
    const args = [build.cli, "build", "--config-path", relative(directory, build.config)];
    if (process.env.ALLOW_UNSUPPORTED_NEXT_VERSION !== "false") {
      args.push("--dangerously-use-unsupported-next-version");
    }
    execute(process.execPath, args, directory);
  }
}