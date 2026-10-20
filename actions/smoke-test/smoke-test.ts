import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { execute, required } from "../lib.js";

type HealthResponse = {
  status?: unknown;
  timestamp?: unknown;
};

const baseUrl = required("BASE_URL");
const deploymentType = required("DEPLOYMENT_TYPE");
assert.ok(deploymentType === "ssr" || deploymentType === "static", "Deployment type must be ssr or static");

async function request(path: string): Promise<Response> {
  const response = await fetch(new URL(path, baseUrl), {
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200, `${path}: expected HTTP 200`);
  return response;
}

function timestamp(html: string): string {
  const match = html.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
  assert.ok(match, "Expected a server-rendered timestamp");
  return match[0];
}

const command = process.env.SMOKE_TEST_COMMAND ?? "";
if (command !== "") {
  process.env.PREVIEW_URL = baseUrl;
  process.env.PRODUCTION_URL = baseUrl;
  const directory = realpathSync(resolve(required("GITHUB_WORKSPACE"), required("WORKING_DIRECTORY")));
  execute("bash", ["-euo", "pipefail", "-c", command], directory);
} else if (deploymentType === "static") {
  const response = await request("/");
  await response.text();
  console.log(`Static smoke check passed: ${baseUrl}`);
} else {
  const firstSsr = await request("/ssr/");
  assert.match(firstSsr.headers.get("cache-control") ?? "", /no-store|private/);
  const firstTimestamp = timestamp(await firstSsr.text());
  const secondTimestamp = timestamp(await (await request("/ssr/")).text());
  assert.notEqual(firstTimestamp, secondTimestamp, "SSR must render on every request");

  const healthResponse = await request("/api/health/");
  assert.match(healthResponse.headers.get("cache-control") ?? "", /no-store/);
  const health = await healthResponse.json() as HealthResponse;
  assert.equal(health.status, "ok");
  assert.equal(typeof health.timestamp, "string", "Expected a health timestamp");
  assert.ok(Number.isFinite(Date.parse(health.timestamp as string)), "Expected a valid health timestamp");

  const isrResponse = await request("/isr/");
  const isrCacheControl = isrResponse.headers.get("cache-control") ?? "";
  const isrMaxAgeMatch = isrCacheControl.match(/(?:^|,)\s*s-maxage=(\d+)(?:,|$)/);
  assert.ok(isrMaxAgeMatch, `Expected an ISR cache lifetime, received: ${isrCacheControl}`);
  const isrMaxAge = Number(isrMaxAgeMatch[1]);
  assert.ok(isrMaxAge <= 60, `Expected ISR cache lifetime <= 60 seconds, received: ${isrMaxAge}`);
  const firstIsr = timestamp(await isrResponse.text());
  const secondIsr = timestamp(await (await request("/isr/")).text());
  if (isrMaxAge > 5) {
    assert.equal(firstIsr, secondIsr, "ISR must reuse the cached page within its TTL");
  } else {
    console.log(`ISR cache expires in ${isrMaxAge}s; skipped timestamp stability check near revalidation.`);
  }

  console.log(`SSR, API and ISR cache smoke checks passed: ${baseUrl}`);
}