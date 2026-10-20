import { getOctokit } from "@actions/github";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { required, summary, writeValues } from "../lib.js";

export function nextVersion(tags: string[]): string {
  let major = 1;
  let minor = 8;
  for (const tag of tags) {
    const match = /^v(\d+)\.(\d+)$/.exec(tag);
    if (!match) continue;
    const candidateMajor = Number(match[1]);
    const candidateMinor = Number(match[2]);
    if (candidateMajor > major || (candidateMajor === major && candidateMinor > minor)) {
      major = candidateMajor;
      minor = candidateMinor;
    }
  }
  return `v${major}.${minor + 1}`;
}

export function updateReadme(text: string, repository: string, version: string): string {
  const escaped = repository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const reference = new RegExp(`(${escaped}/\\.github/workflows/nextjs-(?:preview|production)\\.yml)@[a-zA-Z0-9_./-]+`, "g");
  return text.replace(reference, `$1@${version}`);
}

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trimEnd();
}

function sourceTag(source: string): string | undefined {
  const refs = git(["for-each-ref", "--format=%(refname:short)%00%(contents)%00", "refs/tags"]).split("\0");
  for (let index = 0; index + 1 < refs.length; index += 2) {
    const name = refs[index].trim();
    if (/^v\d+\.\d+$/.test(name) && refs[index + 1].split("\n").includes(`Source-Commit: ${source}`)) return name;
  }
}

async function publish(): Promise<void> {
  process.chdir(required("GITHUB_WORKSPACE"));
  const repository = required("GITHUB_REPOSITORY");
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) throw new Error("GITHUB_REPOSITORY must contain owner/repository.");
  const source = required("GITHUB_SHA");
  const github = getOctokit(required("GITHUB_TOKEN"));
  git(["config", "user.name", "github-actions[bot]"]);
  git(["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);

  let version: string | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    git(["fetch", "origin", "main:refs/remotes/origin/main", "--tags"]);
    version = sourceTag(source);
    if (version) break;

    git(["switch", "--detach", "refs/remotes/origin/main"]);
    git(["merge-base", "--is-ancestor", source, "HEAD"]);
    version = nextVersion(git(["tag", "--list", "v*"]).split("\n"));
    const readmes = git(["ls-files", "-z"]).split("\0").filter(file => /(^|\/)readme\.md$/i.test(file));
    for (const file of readmes) {
      const original = readFileSync(file, "utf8");
      const updated = updateReadme(original, repository, version);
      if (updated !== original) writeFileSync(file, updated);
    }
    if (readmes.length) git(["add", "--", ...readmes]);
    git(["commit", "--allow-empty", "-m", `chore: release ${version} [skip ci]`]);
    git(["tag", "-a", version, "-m", `Release ${version}\n\nSource-Commit: ${source}`]);
    const pushed = spawnSync("git", ["push", "--atomic", "origin", "HEAD:refs/heads/main", `refs/tags/${version}`], { stdio: "inherit" });
    if (pushed.error) throw pushed.error;
    if (pushed.status === 0) break;
    git(["tag", "-d", version]);
    version = undefined;
  }
  if (!version) throw new Error("Could not publish the release commit and tag after three attempts. Check branch permissions or concurrent pushes.");

  let release: { html_url: string };
  try {
    release = (await github.rest.repos.getReleaseByTag({ owner, repo, tag: version })).data;
  } catch (error) {
    if ((error as { status?: number }).status !== 404) throw error;
    release = (await github.rest.repos.createRelease({
      owner, repo, tag_name: version, name: version, generate_release_notes: true,
    })).data;
  }
  writeValues("GITHUB_OUTPUT", { version, "release-url": release.html_url });
  summary(`### Release ${version}\n${release.html_url}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await publish();