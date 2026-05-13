import { test } from "node:test";
import assert from "node:assert/strict";
import { createSource } from "../src/index.mjs";
import { createClient } from "../src/client.mjs";
import { createFetchStub } from "./stub-fetch.mjs";

function makeSource(stub) {
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
  });
}

test("attachPR posts a Jira comment with the PR url as a link", async () => {
  const stub = createFetchStub();
  let posted;
  stub.on("POST", /\/rest\/api\/3\/issue\/SHOP-1\/comment/, (req) => {
    posted = req.body;
    return { status: 201, body: { id: "5001" } };
  });
  const source = makeSource(stub);
  const result = await source.attachPR("SHOP-1", "https://github.com/org/repo/pull/42");
  assert.equal(result.commented, true);
  assert.equal(result.prUrl, "https://github.com/org/repo/pull/42");

  // ADF check
  const adf = posted.body;
  assert.equal(adf.type, "doc");
  const inner = adf.content[0].content;
  assert.equal(inner.length, 2);
  assert.equal(inner[0].text, "Shipped via ");
  assert.equal(inner[1].text, "https://github.com/org/repo/pull/42");
  assert.deepEqual(inner[1].marks, [
    { type: "link", attrs: { href: "https://github.com/org/repo/pull/42" } },
  ]);
  stub.assertExhausted();
});

test("attachPR throws on missing arguments", async () => {
  const stub = createFetchStub();
  const source = makeSource(stub);
  await assert.rejects(() => source.attachPR(), /needs an itemId/);
  await assert.rejects(() => source.attachPR("SHOP-1"), /needs a prUrl/);
});
