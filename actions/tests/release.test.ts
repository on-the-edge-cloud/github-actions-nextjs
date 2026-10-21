import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { parseDocument } from "yaml";
import { nextVersion, updateReadme } from "../release/release.js";
import { actionsRoot } from "./test-helpers.js";

test("release versions continue from v1.8 and increment numerically", () => {
  assert.equal(nextVersion([]), "v1.9");
  assert.equal(nextVersion(["v1", "v1.3", "v1.8"]), "v1.9");
  assert.equal(nextVersion(["v1.9", "v1.10", "v1.8"]), "v1.11");
  assert.equal(nextVersion(["v1.8", "v1.9.0", "v999-test"]), "v1.9");
});

test("release updates only this repository's workflow versions in README", () => {
  const text = [
    "uses: owner/platform/.github/workflows/nextjs-preview.yml@v1",
    "uses: owner/platform/.github/workflows/nextjs-production.yml@v1.8",
    "uses: another/platform/.github/workflows/nextjs-production.yml@v1.4",
    "Terraform module v1.4",
  ].join("\n");
  assert.equal(updateReadme(text, "owner/platform", "v1.9"), text
    .replace("nextjs-preview.yml@v1\n", "nextjs-preview.yml@v1.9\n")
    .replace("nextjs-production.yml@v1.8", "nextjs-production.yml@v1.9"));
});

test("release workflow runs on main pushes with write permission", () => {
  const document = parseDocument(readFileSync(resolve(actionsRoot, "../.github/workflows/release.yml"), "utf8"), { uniqueKeys: true });
  assert.deepEqual(document.errors, []);
  const workflow = document.toJS();
  assert.deepEqual(workflow.on.push.branches, ["main"]);
  assert.equal(workflow.permissions.contents, "write");
  assert(workflow.jobs.release.steps.some((step: { uses?: string }) => step.uses === "./actions/release"));
});

test("release publishes README commit and annotated tag once per push", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "nextjs-release-test-"));
  const repository = join(workspace, "repository");
  const origin = join(workspace, "origin.git");
  const runGit = (args: string[]) => {
    const result = spawnSync("git", args, { cwd: repository, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const published = new Map<string, string>();
  const releases: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.method === "GET") {
      const url = published.get(request.url?.split("/").at(-1) ?? "");
      response.statusCode = url ? 200 : 404;
      response.end(JSON.stringify(url ? { html_url: url } : { message: "Not Found" }));
    } else {
      let body = "";
      for await (const chunk of request) body += chunk;
      const release = JSON.parse(body) as { tag_name: string };
      releases.push(release);
      const url = `https://example.test/releases/${release.tag_name}`;
      published.set(release.tag_name, url);
      response.statusCode = 201;
      response.end(JSON.stringify({ html_url: url }));
    }
  });
  try {
    mkdirSync(repository);
    runGit(["init", "--bare", origin]);
    runGit(["init", "-b", "main"]);
    runGit(["config", "user.name", "Test"]);
    runGit(["config", "user.email", "test@example.test"]);
    writeFileSync(join(repository, "README.md"), "uses: owner/platform/.github/workflows/nextjs-production.yml@v1.8\n");
    mkdirSync(join(repository, "docs"));
    writeFileSync(join(repository, "docs/README.md"), "uses: owner/platform/.github/workflows/nextjs-preview.yml@v1\n");
    runGit(["add", "README.md", "docs/README.md"]);
    runGit(["commit", "-m", "Initial platform"]);
    runGit(["tag", "v1.8"]);
    runGit(["remote", "add", "origin", origin]);
    runGit(["push", "origin", "main", "--tags"]);
    let source = runGit(["rev-parse", "HEAD"]);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address !== "string");
    for (const attempt of [1, 2, 3]) {
      if (attempt === 3) {
        writeFileSync(join(repository, "change.txt"), "Next push");
        runGit(["add", "change.txt"]);
        runGit(["commit", "-m", "Next platform change"]);
        runGit(["push", "origin", "HEAD:refs/heads/main"]);
        source = runGit(["rev-parse", "HEAD"]);
      }
      const child: ReturnType<typeof spawn> = spawn(process.execPath, [resolve(actionsRoot, "run.mjs"), resolve(actionsRoot, "release/release.ts")], {
        env: {
          ...process.env,
          GITHUB_WORKSPACE: repository,
          GITHUB_REPOSITORY: "owner/platform",
          GITHUB_SHA: source,
          GITHUB_TOKEN: "test-token",
          GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
          GITHUB_OUTPUT: join(workspace, `outputs-${attempt}`),
          GITHUB_STEP_SUMMARY: join(workspace, "summary"),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk; });
      child.stdout?.resume();
      const [status]: unknown[] = await once(child, "close");
      assert.equal(status, 0, stderr);
      assert(readFileSync(join(workspace, `outputs-${attempt}`), "utf8").includes(`version=${attempt === 3 ? "v1.10" : "v1.9"}\n`));
    }
    assert.equal(releases.length, 2);
    assert.equal(releases[0].tag_name, "v1.9");
    assert.equal(releases[1].tag_name, "v1.10");
    assert.equal(releases[0].generate_release_notes, true);
    assert.equal(runGit(["cat-file", "-t", "v1.9"]), "tag");
    assert.equal(runGit(["rev-parse", "v1.10^{}"]), runGit(["rev-parse", "refs/remotes/origin/main"]));
    assert(runGit(["show", "v1.9:README.md"]).includes("@v1.9"));
    assert(runGit(["show", "v1.9:docs/README.md"]).includes("@v1.9"));
    assert(runGit(["show", "v1.10:README.md"]).includes("@v1.10"));
    assert(runGit(["show", "v1.10:docs/README.md"]).includes("@v1.10"));
    assert(runGit(["log", "-1", "--format=%s"]).includes("[skip ci]"));
    assert.deepEqual(runGit(["tag", "--list"]).split("\n"), ["v1.10", "v1.8", "v1.9"]);
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    rmSync(workspace, { recursive: true, force: true });
  }
});
