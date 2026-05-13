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

test("markStatus transitions the issue for a mapped Shipwright status", async () => {
  const stub = createFetchStub();
  stub.on("GET", /\/rest\/api\/3\/issue\/SHOP-1\/transitions/, { body: fx("transitions.json") });
  stub.on("POST", /\/rest\/api\/3\/issue\/SHOP-1\/transitions/, (req) => {
    assert.equal(req.body.transition.id, "31"); // 31 → Done
    return { status: 204 };
  });

  const source = makeSource(stub);
  const result = await source.markStatus("SHOP-1", "shipped");
  assert.equal(result.transitioned, true);
  assert.equal(result.transitionId, "31");
  assert.equal(result.targetStatus, "Done");
  stub.assertExhausted();
});

test("markStatus respects user-supplied status_mapping override", async () => {
  const stub = createFetchStub();
  stub.on("GET", /\/rest\/api\/3\/issue\/SHOP-1\/transitions/, { body: fx("transitions.json") });
  stub.on("POST", /\/rest\/api\/3\/issue\/SHOP-1\/transitions/, (req) => {
    assert.equal(req.body.transition.id, "21"); // 21 → In Review
    return { status: 204 };
  });
  const source = makeSource(stub, {
    status_mapping: {
      shipped: "In Review", // intentionally remap shipped
    },
  });
  const result = await source.markStatus("SHOP-1", "shipped");
  assert.equal(result.targetStatus, "In Review");
});

test("markStatus throws when the target transition isn't reachable", async () => {
  const stub = createFetchStub();
  // Manufacture transitions where 'Done' isn't reachable
  stub.on("GET", /\/rest\/api\/3\/issue\/SHOP-1\/transitions/, {
    body: {
      transitions: [
        { id: "11", name: "Start", to: { name: "In Progress" } },
      ],
    },
  });
  const source = makeSource(stub);
  await assert.rejects(
    () => source.markStatus("SHOP-1", "shipped"),
    /cannot transition.*not reachable.*Available transitions: \[In Progress\]/,
  );
});

test("markStatus posts a comment for middle states (no transition)", async () => {
  const stub = createFetchStub();
  let postedBody;
  stub.on("POST", /\/rest\/api\/3\/issue\/SHOP-1\/comment/, (req) => {
    postedBody = req.body;
    return { status: 201, body: { id: "10000" } };
  });
  const source = makeSource(stub);
  const result = await source.markStatus("SHOP-1", "built");
  assert.equal(result.transitioned, false);
  assert.equal(result.commented, true);
  // ADF body should be a doc with a paragraph mentioning "built"
  assert.equal(postedBody.body.type, "doc");
  const textNodes = postedBody.body.content[0].content;
  const fullText = textNodes.filter((n) => n.type === "text").map((n) => n.text).join("");
  assert.match(fullText, /Shipwrights moved this issue to status: built/);
});

test("markStatus matches transition by name when 'to.name' isn't present", async () => {
  const stub = createFetchStub();
  // Some Jira workflows return the transition without a 'to' field —
  // fall back to matching the transition's own name.
  stub.on("GET", /\/rest\/api\/3\/issue\/SHOP-1\/transitions/, {
    body: {
      transitions: [{ id: "99", name: "Done" }],
    },
  });
  stub.on("POST", /\/rest\/api\/3\/issue\/SHOP-1\/transitions/, (req) => {
    assert.equal(req.body.transition.id, "99");
    return { status: 204 };
  });
  const source = makeSource(stub);
  const r = await source.markStatus("SHOP-1", "shipped");
  assert.equal(r.transitionId, "99");
});

test("markStatus throws on missing arguments", async () => {
  const stub = createFetchStub();
  const source = makeSource(stub);
  await assert.rejects(() => source.markStatus(), /needs an itemId/);
  await assert.rejects(() => source.markStatus("SHOP-1"), /needs a status/);
});
