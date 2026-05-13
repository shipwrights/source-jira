import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../src/client.mjs";
import { createSource } from "../src/index.mjs";
import { createFetchStub } from "./stub-fetch.mjs";

function makeClient(stub) {
  return createClient({
    host: "x.atlassian.net",
    email: "ada@example.com",
    token: "secret",
    fetch: stub.fetch,
  });
}

function makeSource(stub, overrides = {}) {
  return createSource({
    host: "x.atlassian.net",
    jql: "project = X",
    _client: makeClient(stub),
    ...overrides,
  });
}

// ----- client.boards -----

test("client.boards hits the Agile API base (not /rest/api/3)", async () => {
  const stub = createFetchStub();
  stub.on("GET", "/rest/agile/1.0/board", (req) => {
    assert.equal(req.query?.projectKeyOrId, "NVC");
    return { body: { values: [{ id: 1, name: "NVC board", type: "scrum" }] } };
  });
  const client = makeClient(stub);
  const result = await client.boards({ projectKeyOrId: "NVC" });
  assert.equal(result.values.length, 1);
  assert.equal(result.values[0].name, "NVC board");
});

test("client.boards passes through type filter", async () => {
  const stub = createFetchStub();
  stub.on("GET", "/rest/agile/1.0/board", (req) => {
    assert.equal(req.query?.type, "scrum");
    return { body: { values: [] } };
  });
  await makeClient(stub).boards({ projectKeyOrId: "NVC", type: "scrum" });
});

// ----- client.sprintsForBoard -----

test("client.sprintsForBoard fetches active sprints", async () => {
  const stub = createFetchStub();
  stub.on("GET", "/rest/agile/1.0/board/42/sprint", (req) => {
    assert.equal(req.query?.state, "active");
    return {
      body: {
        values: [
          { id: 100, name: "NVC Sprint 12", state: "active" },
        ],
      },
    };
  });
  const r = await makeClient(stub).sprintsForBoard(42, { state: "active" });
  assert.equal(r.values[0].name, "NVC Sprint 12");
});

// ----- client.assignIssue -----

test("client.assignIssue sends PUT /issue/<key>/assignee with accountId", async () => {
  const stub = createFetchStub();
  stub.on("PUT", "/rest/api/3/issue/NVC-1/assignee", (req) => {
    assert.equal(req.body.accountId, "u-123");
    return { status: 204 };
  });
  const r = await makeClient(stub).assignIssue("NVC-1", "u-123");
  assert.equal(r, null);
});

test("client.assignIssue with null accountId unassigns", async () => {
  const stub = createFetchStub();
  stub.on("PUT", "/rest/api/3/issue/NVC-1/assignee", (req) => {
    assert.equal(req.body.accountId, null);
    return { status: 204 };
  });
  await makeClient(stub).assignIssue("NVC-1", null);
});

// ----- source.currentUser caches -----

test("source.currentUser fetches /myself once and caches the result", async () => {
  const stub = createFetchStub();
  stub.on("GET", "/rest/api/3/myself", {
    body: {
      accountId: "u-me",
      displayName: "Ada Lovelace",
      emailAddress: "ada@example.com",
    },
    persist: true,
  });
  const source = makeSource(stub);
  const me1 = await source.currentUser();
  const me2 = await source.currentUser();
  const me3 = await source.currentUser();
  assert.equal(me1.accountId, "u-me");
  assert.equal(me2.accountId, "u-me");
  assert.equal(me3.accountId, "u-me");
  const myselfCalls = stub.history.filter((r) => r.path === "/rest/api/3/myself");
  assert.equal(myselfCalls.length, 1, "only one /myself call across three currentUser() calls");
});

// ----- source.assignToCurrentUser -----

test("source.assignToCurrentUser self-assigns the issue", async () => {
  const stub = createFetchStub();
  stub.on("GET", "/rest/api/3/myself", {
    body: { accountId: "u-me", displayName: "Ada", emailAddress: "ada@example.com" },
  });
  stub.on("PUT", "/rest/api/3/issue/NVC-1/assignee", (req) => {
    assert.equal(req.body.accountId, "u-me");
    return { status: 204 };
  });
  const source = makeSource(stub);
  const r = await source.assignToCurrentUser("NVC-1");
  assert.equal(r.assigned, true);
  assert.equal(r.accountId, "u-me");
  assert.equal(r.displayName, "Ada");
});

test("source.assignToCurrentUser throws on missing itemId", async () => {
  const stub = createFetchStub();
  const source = makeSource(stub);
  await assert.rejects(() => source.assignToCurrentUser(), /needs an itemId/);
});

// ----- BacklogItem now exposes assigneeAccountId -----

test("listAvailable surfaces assigneeAccountId in metadata (used by loop's safety check)", async () => {
  const stub = createFetchStub();
  stub.on("POST", "/rest/api/3/search/jql", {
    body: {
      isLast: true,
      issues: [
        {
          id: "1001",
          key: "NVC-1",
          self: "https://x.atlassian.net/rest/api/3/issue/1001",
          fields: {
            summary: "demo",
            status: { name: "To Do", statusCategory: { key: "new" } },
            priority: { name: "High" },
            assignee: { displayName: "Maria E.", accountId: "u-maria" },
            reporter: { displayName: "Ada", accountId: "u-ada" },
            labels: [],
            components: [],
            created: "2026-05-13T10:00:00.000Z",
            updated: "2026-05-13T10:00:00.000Z",
          },
        },
      ],
    },
  });
  const source = makeSource(stub);
  const items = await source.listAvailable();
  assert.equal(items.length, 1);
  assert.equal(items[0].metadata.assignee, "Maria E.");
  assert.equal(items[0].metadata.assigneeAccountId, "u-maria");
});
