import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createSource } from "../src/index.mjs";
import { createClient } from "../src/client.mjs";
import { createFetchStub } from "./stub-fetch.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name) => JSON.parse(readFileSync(join(here, "fixtures", name), "utf8"));

function makeSource(stub, overrides = {}) {
  const client = createClient({
    host: "myorg.atlassian.net",
    email: "a@b.c",
    token: "secret",
    fetch: stub.fetch,
  });
  return createSource({
    host: "myorg.atlassian.net",
    jql: "project = SHOP",
    _client: client,
    ...overrides,
  });
}

// ---------- Field mapping auto-detection ----------

test("getFieldMapping returns explicit config without calling /field", async () => {
  const stub = createFetchStub();
  // No /field handler registered — would throw if called.
  const source = makeSource(stub, {
    field_mapping: { size: "customfield_99", parents: "customfield_98" },
  });
  const mapping = await source.getFieldMapping();
  assert.equal(mapping.size, "customfield_99");
  assert.equal(mapping.parents, "customfield_98");
});

test("getFieldMapping auto-detects Story Points + Epic Link via /field", async () => {
  const stub = createFetchStub();
  stub.on("GET", "/rest/api/3/field", { body: fx("fields.json") });
  const source = makeSource(stub); // no field_mapping in config
  const mapping = await source.getFieldMapping();
  assert.equal(mapping.size, "customfield_10016"); // Story Points
  assert.equal(mapping.parents, "customfield_10014"); // Epic Link
});

test("getFieldMapping merges: explicit size, auto-detected parents", async () => {
  const stub = createFetchStub();
  stub.on("GET", "/rest/api/3/field", { body: fx("fields.json") });
  const source = makeSource(stub, {
    field_mapping: { size: "customfield_99" }, // override size only
  });
  const mapping = await source.getFieldMapping();
  assert.equal(mapping.size, "customfield_99"); // explicit wins
  assert.equal(mapping.parents, "customfield_10014"); // auto-detected
});

test("getFieldMapping caches across calls (only one /field request)", async () => {
  const stub = createFetchStub();
  stub.on("GET", "/rest/api/3/field", { body: fx("fields.json"), persist: true });
  const source = makeSource(stub);
  await source.getFieldMapping();
  await source.getFieldMapping();
  await source.getFieldMapping();
  const fieldCalls = stub.history.filter((r) => r.path === "/rest/api/3/field");
  assert.equal(fieldCalls.length, 1, "should only call /field once");
});

test("getFieldMapping handles /field failure gracefully (falls back to explicit)", async () => {
  const stub = createFetchStub();
  stub.on("GET", "/rest/api/3/field", { status: 403, body: { errorMessages: ["forbidden"] } });
  const source = makeSource(stub, {
    field_mapping: { size: "customfield_99" }, // partial explicit
  });
  const mapping = await source.getFieldMapping();
  // size from config; parents stays undetected (no error thrown)
  assert.equal(mapping.size, "customfield_99");
  assert.equal(mapping.parents, undefined);
});

// ---------- Enhanced healthcheck ----------

test("healthcheck passes /myself + JQL dry-run + status mapping all green", async () => {
  const stub = createFetchStub();
  stub.on("GET", "/rest/api/3/myself", { body: { displayName: "Ada" } });
  stub.on("POST", "/rest/api/3/search/jql", (req) => {
    assert.equal(req.body.maxResults, 1); // dry-run, smallest legal value
    return { body: { isLast: true, issues: [] } };
  });
  stub.on("GET", "/rest/api/3/status", { body: fx("statuses.json") });
  const source = makeSource(stub, {
    status_mapping: { shipped: "Done", refined: "Ready for Dev" },
  });
  await source.healthcheck(); // no throw
  stub.assertExhausted();
});

test("healthcheck throws when JQL is invalid", async () => {
  const stub = createFetchStub();
  stub.on("GET", "/rest/api/3/myself", { body: { displayName: "Ada" } });
  stub.on("POST", "/rest/api/3/search/jql", {
    status: 400,
    body: { errorMessages: ["unexpected operator near 'project ='"] },
  });
  const source = makeSource(stub);
  await assert.rejects(() => source.healthcheck(), /jql:/);
});

test("healthcheck flags an unknown configured status_mapping target", async () => {
  const stub = createFetchStub();
  stub.on("GET", "/rest/api/3/myself", { body: { displayName: "Ada" } });
  stub.on("POST", "/rest/api/3/search/jql", { body: { isLast: true, issues: [] } });
  stub.on("GET", "/rest/api/3/status", { body: fx("statuses.json") });
  const source = makeSource(stub, {
    status_mapping: { shipped: "Not A Real Status" },
  });
  await assert.rejects(
    () => source.healthcheck(),
    /status_mapping\.shipped.*Not A Real Status.*not a known Jira status/,
  );
});

test("healthcheck bails early on auth failure (other checks skipped)", async () => {
  const stub = createFetchStub();
  stub.on("GET", "/rest/api/3/myself", {
    status: 401,
    body: { errorMessages: ["Authentication failed"] },
  });
  // No other handlers registered — assertion is the JQL/status calls should NOT happen.
  const source = makeSource(stub);
  await assert.rejects(() => source.healthcheck(), /auth:/);
});

test("healthcheck doesn't fail on /status access denied (soft check)", async () => {
  const stub = createFetchStub();
  stub.on("GET", "/rest/api/3/myself", { body: { displayName: "Ada" } });
  stub.on("POST", "/rest/api/3/search/jql", { body: { isLast: true, issues: [] } });
  stub.on("GET", "/rest/api/3/status", { status: 403, body: { errorMessages: ["forbidden"] } });
  const source = makeSource(stub, {
    status_mapping: { shipped: "Done" },
  });
  // Should pass — /status access denied is soft (we don't know if it's a misconfig
  // or just a permissions gap; we don't block on it).
  await source.healthcheck();
});
