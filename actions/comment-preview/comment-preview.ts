import { getOctokit } from "@actions/github";
import { required } from "../lib.js";

type PreviewComment = {
  id: number;
  body?: string | null;
  user?: { type: string } | null;
};

type CommentsResponse = {
  data: PreviewComment[];
};

const [owner, repo] = required("GITHUB_REPOSITORY").split("/");
if (!owner || !repo) throw new Error("GITHUB_REPOSITORY must contain owner/repository.");
const pr = required("PR_NUMBER");
if (!/^[1-9][0-9]*$/.test(pr)) throw new Error("PR number must be a positive integer.");
const github = getOctokit(required("GITHUB_TOKEN"));
const issue_number = Number(pr);
const body = `Preview listo: ${required("PREVIEW_URL")}`;
const comments: CommentsResponse = await github.rest.issues.listComments({ owner, repo, issue_number });
const existing: PreviewComment | undefined = comments.data.find((comment: PreviewComment) =>
  comment.user?.type === "Bot" && comment.body?.startsWith("Preview listo: https://"),
);

if (existing) {
  await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
} else {
  await github.rest.issues.createComment({ owner, repo, issue_number, body });
}