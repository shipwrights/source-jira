import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient, JiraClientError } from "../src/client.mjs";
import { createFetchStub } from "./stub-fetch.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name) => JSON.parse(readFileSync(join(here, "fixtures", name), "utf8"));

test("client.myself returns the authenticated user", async () => {
  const stub = createFetchStub();
  stub.on("GET", "/rest/api/3/myself", { body: fx("myself.json") });
  const client = createClient({
    host: "myorg.atlassian.net",
    email: "ada@example.com",
    token: "secret",
    fetch: stub.fetch,
  });
  const me = await client.myself();
  assert.equal(me.displayName, "Ada Lovelace");
});

test("client sends Basic auth header with base64(email:token)", async () => {
  const stub = createFetchStub();
  stub.on("GET", "/rest/api/3/myself", { body: fx("myself.json") });
  const client = createClient({
    host: "myorg.atlassian.net",
    email: "ada@example.com",
    token: "shh-secret",
    fetch: stub.fetch,
  });
  await client.myself();
  const expected = `Basic ${Buffer.from("ada@example.com:shh-secret").toString("base64")}`;
  assert.equal(stub.history[0].headers.Authorization, expected);
});

test("client throws JiraClientError on 4xx with structured body", async () => {
  const stub = createFetchStub();
  stub.on("GET", "/rest/api/3/myself", {
    status: 401,
    body: { errorMessages: ["Authentication failed"] },
  });
  const client = createClient({
    host: "myorg.atlassian.net",
    email: "ada@example.com",
    token: "wrong",
    fetch: stub.fetch,
  });
  await assert.rejects(
    () => client.myself(),
    (err) => {
      assert.ok(err instanceof JiraClientError);
      assert.equal(err.status, 401);
      assert.match(err.message, /Authentication failed/);
      return true;
    },
  );
});

test("client throws helpful error when host is missing", () => {
  assert.throws(
    () => createClient({ email: "x", token: "y" }),
    /host is required/,
  );
});

test("searchJql paginates via nextPageToken until isLast", async () => {
  const stub = createFetchStub();
  stub.on("POST", "/rest/api/3/search/jql", (req) => {
    return { body: fx("search-page-1.json") };
  });
  stub.on("POST", "/rest/api/3/search/jql", (req) => {
    assert.equal(req.body.nextPageToken, "page-2-token");
    return { body: fx("search-page-2.json") };
  });

  const client = createClient({
    host: "myorg.atlassian.net",
    email: "ada@example.com",
    token: "secret",
    fetch: stub.fetch,
  });

  const all = await client.searchJqlAll({ jql: "project = SHOP" });
  const keys = all.map((i) => i.key);
  assert.deepEqual(keys, ["SHOP-1", "SHOP-2", "SHOP-3"]);
  stub.assertExhausted();
});

test("searchJql yields issues one-by-one via async iteration", async () => {
  const stub = createFetchStub();
  stub.on("POST", "/rest/api/3/search/jql", { body: fx("search-page-1.json") });
  stub.on("POST", "/rest/api/3/search/jql", { body: fx("search-page-2.json") });

  const client = createClient({
    host: "myorg.atlassian.net",
    email: "ada@example.com",
    token: "secret",
    fetch: stub.fetch,
  });

  const seen = [];
  for await (const issue of client.searchJql({ jql: "project = SHOP" })) {
    seen.push(issue.key);
  }
  assert.deepEqual(seen, ["SHOP-1", "SHOP-2", "SHOP-3"]);
});

test("searchJql requires jql parameter", async () => {
  const stub = createFetchStub();
  const client = createClient({
    host: "myorg.atlassian.net",
    email: "ada@example.com",
    token: "secret",
    fetch: stub.fetch,
  });
  await assert.rejects(
    async () => {
      for await (const _ of client.searchJql({})) break;
    },
    /requires a `jql` string/,
  );
});

test("client sends Accept: application/json on every request", async () => {
  const stub = createFetchStub();
  stub.on("GET", "/rest/api/3/myself", { body: fx("myself.json") });
  const client = createClient({
    host: "myorg.atlassian.net",
    email: "ada@example.com",
    token: "secret",
    fetch: stub.fetch,
  });
  await client.myself();
  assert.equal(stub.history[0].headers.Accept, "application/json");
});
