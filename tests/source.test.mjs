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

function makeSourceWithStub(stub, overrides = {}) {
  const client = createClient({
    host: "myorg.atlassian.net",
    email: "ada@example.com",
    token: "secret",
    fetch: stub.fetch,
  });
  return createSource({
    host: "myorg.atlassian.net",
    jql: "project = SHOP",
    field_mapping: {
      size: "customfield_10016",
      parents: "customfield_10014",
    },
    _client: client,
    ...overrides,
  });
}

test("createSource throws if host missing", () => {
  assert.throws(
    () => createSource({ jql: "project = SHOP" }),
    /`host` is required/,
  );
});

test("createSource throws if jql missing", () => {
  assert.throws(
    () => createSource({ host: "x.atlassian.net" }),
    /`jql` is required/,
  );
});

test("createSource validates the jql at construction time", () => {
  assert.throws(
    () =>
      createSource({
        host: "x.atlassian.net",
        jql: 'status = "Ready',
        _client: { myself: async () => null, searchJqlAll: async () => [] },
      }),
    /unbalanced double quotes/,
  );
});

test("healthcheck calls GET /myself and resolves on success", async () => {
  const stub = createFetchStub();
  stub.on("GET", "/rest/api/3/myself", { body: fx("myself.json") });
  const source = makeSourceWithStub(stub);
  await source.healthcheck();
  stub.assertExhausted();
});

test("healthcheck propagates auth failures", async () => {
  const stub = createFetchStub();
  stub.on("GET", "/rest/api/3/myself", {
    status: 401,
    body: { errorMessages: ["Authentication failed"] },
  });
  const source = makeSourceWithStub(stub);
  await assert.rejects(() => source.healthcheck(), /Authentication failed/);
});

test("listAvailable maps Jira issues to BacklogItems", async () => {
  const stub = createFetchStub();
  stub.on("POST", "/rest/api/3/search/jql", { body: fx("search-page-1.json") });
  stub.on("POST", "/rest/api/3/search/jql", { body: fx("search-page-2.json") });
  const source = makeSourceWithStub(stub);

  const items = await source.listAvailable();
  assert.equal(items.length, 3);

  const shop1 = items.find((i) => i.id === "SHOP-1");
  assert.equal(shop1.title, "Add bulk order endpoint");
  assert.equal(shop1.status, "Ready for Dev");
  assert.equal(shop1.priority, "High");
  assert.equal(shop1.size, "medium"); // 5 story points → medium bucket
  assert.deepEqual(shop1.parents, ["SHOP-100"]);
  assert.deepEqual(shop1.metadata.labels, ["api"]);
  assert.deepEqual(shop1.metadata.components, ["Orders"]);
});

test("listAvailable bucket: 2 SP → small, 5 SP → medium, 13 SP → large", async () => {
  const stub = createFetchStub();
  stub.on("POST", "/rest/api/3/search/jql", { body: fx("search-page-1.json") });
  stub.on("POST", "/rest/api/3/search/jql", { body: fx("search-page-2.json") });
  const source = makeSourceWithStub(stub);
  const items = await source.listAvailable();
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(byId["SHOP-1"].size, "medium"); // 5
  assert.equal(byId["SHOP-2"].size, "large"); // 13
  assert.equal(byId["SHOP-3"].size, "small"); // 2
});

test("listAvailable filter.statuses adds a status clause to the JQL", async () => {
  const stub = createFetchStub();
  let capturedJql;
  stub.on("POST", "/rest/api/3/search/jql", (req) => {
    capturedJql = req.body.jql;
    return { body: fx("search-page-2.json") };
  });
  const source = makeSourceWithStub(stub);
  await source.listAvailable({ statuses: ["Ready for Dev", "Refined"] });
  assert.match(capturedJql, /\(project = SHOP\) AND status in \("Ready for Dev", "Refined"\)/);
});

test("pickNext returns the highest priority item", async () => {
  const stub = createFetchStub();
  stub.on("POST", "/rest/api/3/search/jql", { body: fx("search-page-1.json") });
  stub.on("POST", "/rest/api/3/search/jql", { body: fx("search-page-2.json") });
  const source = makeSourceWithStub(stub);
  const next = await source.pickNext();
  // Highest priority across the three fixtures is SHOP-3 (Highest).
  assert.equal(next.id, "SHOP-3");
});

test("pickNext returns null when no issues match", async () => {
  const stub = createFetchStub();
  stub.on("POST", "/rest/api/3/search/jql", {
    body: { isLast: true, issues: [] },
  });
  const source = makeSourceWithStub(stub);
  const next = await source.pickNext();
  assert.equal(next, null);
});

test("materialize / markStatus / attachPR throw Phase-not-yet-shipped errors", async () => {
  const stub = createFetchStub();
  const source = makeSourceWithStub(stub);
  await assert.rejects(() => source.materialize({ id: "SHOP-1" }, "/tmp"), /Phase 2/);
  await assert.rejects(() => source.markStatus("SHOP-1", "shipped"), /Phase 3/);
  await assert.rejects(() => source.attachPR("SHOP-1", "https://x"), /Phase 4/);
});

test("source-loader integration: env-var auth flow when no _client injected", async () => {
  // Save and clear env to verify env-reading.
  const oldEmail = process.env.JIRA_EMAIL;
  const oldToken = process.env.JIRA_API_TOKEN;
  process.env.JIRA_EMAIL = "set-via-env@example.com";
  process.env.JIRA_API_TOKEN = "env-token";
  try {
    const source = createSource({
      host: "myorg.atlassian.net",
      jql: "project = SHOP",
    });
    // createSource should not have thrown — env was found.
    assert.ok(source);
    assert.equal(typeof source.healthcheck, "function");
  } finally {
    process.env.JIRA_EMAIL = oldEmail;
    process.env.JIRA_API_TOKEN = oldToken;
  }
});

test("source-loader: missing env var produces a clear error", () => {
  const oldEmail = process.env.JIRA_EMAIL;
  delete process.env.JIRA_EMAIL;
  try {
    assert.throws(
      () =>
        createSource({
          host: "myorg.atlassian.net",
          jql: "project = SHOP",
        }),
      /JIRA_EMAIL is required/,
    );
  } finally {
    process.env.JIRA_EMAIL = oldEmail;
  }
});
