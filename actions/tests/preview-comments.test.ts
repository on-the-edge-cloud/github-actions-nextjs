import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { resolve } from "node:path";
import test from "node:test";
import { actionsRoot } from "./test-helpers.js";

for (const existing of [false, true]) {
  test(`preview comment ${existing ? "updates" : "creates"}`, async () => {
    const requests: { method: string | undefined; url: string | undefined; body: string }[] = [];
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      requests.push({ method: request.method, url: request.url, body });
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(request.method === "GET"
        ? existing ? [{ id: 123, user: { type: "Bot" }, body: "Preview listo: https://old.example" }] : []
        : { id: 123 }));
    });
    server.listen(0, "127.0.0.1");
    try {
      await once(server, "listening");
      const address = server.address();
      assert(address && typeof address !== "string");
      const child = spawn(process.execPath, [resolve(actionsRoot, "run.mjs"), resolve(actionsRoot, "comment-preview/comment-preview.ts")], {
        env: {
          ...process.env,
          GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
          GITHUB_REPOSITORY: "owner/app",
          GITHUB_TOKEN: "test-token",
          PR_NUMBER: "42",
          PREVIEW_URL: "https://new.example",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.stdout.resume();
      const [status] = await once(child, "close");
      assert.equal(status, 0, stderr);
      assert.deepEqual(requests, [
        { method: "GET", url: "/repos/owner/app/issues/42/comments", body: "" },
        {
          method: existing ? "PATCH" : "POST",
          url: existing ? "/repos/owner/app/issues/comments/123" : "/repos/owner/app/issues/42/comments",
          body: JSON.stringify({ body: "Preview listo: https://new.example" }),
        },
      ]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
}
