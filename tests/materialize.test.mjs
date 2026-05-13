import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createSource } from "../src/index.mjs";
import { createClient } from "../src/client.mjs";
import { createFetchStub } from "./stub-fetch.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name) => JSON.parse(readFileSync(join(here, "fixtures", name), "utf8"));

function makeTmp() {
  return mkdtempSync(join(tmpdir(), "shipwrights-jira-mat-"));
}

function makeSource(stub) {
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
  });
}

test("materialize fetches the issue, renders ADF, writes an epic file", async () => {
  const stub = createFetchStub();
  stub.on("GET", /^\/rest\/api\/3\/issue\/SHOP-1/, { body: fx("issue-full.json") });

  const source = makeSource(stub);
  const dir = makeTmp();
  const result = await source.materialize(
    { id: "SHOP-1", title: "Add bulk order endpoint", priority: "High" },
    dir,
  );

  assert.equal(result.created, true);
  assert.ok(existsSync(result.epicFilePath));
  const content = readFileSync(result.epicFilePath, "utf8");

  // Frontmatter spot checks
  assert.match(content, /^id: SHOP-1$/m);
  assert.match(content, /^status: refined$/m);
  assert.match(content, /^priority: P1$/m); // Jira "High" → P1
  assert.match(content, /^size: medium$/m); // 5 SP → medium

  // Source provenance recorded
  assert.match(content, /^source:$/m);
  assert.match(content, /issue_key: SHOP-1/);

  // Description body present
  assert.match(content, /## Why/);
  assert.match(content, /Customers need to submit multiple orders/);

  // Acceptance extracted from "## Acceptance" heading
  assert.match(content, /^acceptance:$/m);
  assert.match(content, /POST `\/api\/orders\/bulk`/);

  // Code block rendered with language fence
  assert.match(content, /```ts\ntype BulkOrderRequest/);

  // Link mark rendered
  assert.match(content, /\[rate-limit policy\]\(https:\/\/example\.com\/docs\/rate-limits\)/);

  rmSync(dir, { recursive: true, force: true });
});

test("materialize maps Jira priority names to Shipwright codes", async () => {
  const cases = [
    ["Highest", "P0"],
    ["High", "P1"],
    ["Medium", "P2"],
    ["Low", "P3"],
    ["Lowest", "P3"],
  ];
  for (const [jiraPriority, expectedCode] of cases) {
    const stub = createFetchStub();
    const issue = JSON.parse(JSON.stringify(fx("issue-full.json")));
    issue.fields.priority = { name: jiraPriority };
    stub.on("GET", /^\/rest\/api\/3\/issue\/SHOP-1/, { body: issue });

    const source = makeSource(stub);
    const dir = makeTmp();
    const r = await source.materialize({ id: "SHOP-1", title: "x" }, dir);
    const c = readFileSync(r.epicFilePath, "utf8");
    assert.match(c, new RegExp(`^priority: ${expectedCode}$`, "m"), `expected ${expectedCode} for ${jiraPriority}`);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("materialize is idempotent on refined/idea status; preserves frontmatter", async () => {
  const stub = createFetchStub();
  stub.on("GET", /^\/rest\/api\/3\/issue\/SHOP-1/, {
    body: fx("issue-full.json"),
    persist: true,
  });
  const source = makeSource(stub);
  const dir = makeTmp();

  await source.materialize({ id: "SHOP-1", title: "Add bulk order endpoint" }, dir);
  const r2 = await source.materialize({ id: "SHOP-1", title: "Add bulk order endpoint" }, dir);

  // Second call: file exists already, returns created: false.
  assert.equal(r2.created, false);
  rmSync(dir, { recursive: true, force: true });
});

test("materialize does not clobber an in-flight epic (status past refined)", async () => {
  const stub = createFetchStub();
  stub.on("GET", /^\/rest\/api\/3\/issue\/SHOP-1/, {
    body: fx("issue-full.json"),
    persist: true,
  });
  const source = makeSource(stub);
  const dir = makeTmp();

  // First call writes status: refined
  const r1 = await source.materialize({ id: "SHOP-1", title: "Add bulk order endpoint" }, dir);

  // Simulate the orchestrator advancing the epic to built.
  const advanced = readFileSync(r1.epicFilePath, "utf8").replace(
    /^status: refined$/m,
    "status: built",
  );
  const fs = await import("node:fs");
  fs.writeFileSync(r1.epicFilePath, advanced, "utf8");

  // Second materialize call — should NOT overwrite the built file.
  const r2 = await source.materialize({ id: "SHOP-1", title: "Add bulk order endpoint" }, dir);
  const after = readFileSync(r2.epicFilePath, "utf8");

  assert.match(after, /^status: built$/m, "status should remain 'built'");
  assert.equal(r2.created, false);
  rmSync(dir, { recursive: true, force: true });
});

test("materialize rejects without an id", async () => {
  const stub = createFetchStub();
  const source = makeSource(stub);
  await assert.rejects(
    () => source.materialize({ title: "no id" }, "/tmp"),
    /needs a BacklogItem with an id/,
  );
});

test("materialize rejects without targetDir", async () => {
  const stub = createFetchStub();
  const source = makeSource(stub);
  await assert.rejects(
    () => source.materialize({ id: "SHOP-1" }, null),
    /needs a targetDir/,
  );
});

test("materialize handles an issue with no description (empty body but valid file)", async () => {
  const stub = createFetchStub();
  const issue = JSON.parse(JSON.stringify(fx("issue-full.json")));
  issue.fields.description = null;
  stub.on("GET", /^\/rest\/api\/3\/issue\/SHOP-1/, { body: issue });

  const source = makeSource(stub);
  const dir = makeTmp();
  const r = await source.materialize({ id: "SHOP-1", title: "no body" }, dir);
  const c = readFileSync(r.epicFilePath, "utf8");
  assert.match(c, /## Why/);
  assert.match(c, /_\(no description in Jira\)_/);
  rmSync(dir, { recursive: true, force: true });
});

// (markStatus / attachPR moved out of "not yet shipped" guard tests in
// v0.3.0 — dedicated coverage lives in markStatus.test.mjs and
// attachPR.test.mjs.)
