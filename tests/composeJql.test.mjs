import { test } from "node:test";
import assert from "node:assert/strict";
import { composeJql } from "../src/cli/composeJql.mjs";

test("composeJql: default scope (no sprint, no assignee)", () => {
  const jql = composeJql({ projectKey: "NVC" });
  assert.equal(jql, "project = NVC AND statusCategory != Done");
});

test("composeJql: active-sprint + mine-or-unassigned (recommended)", () => {
  const jql = composeJql({
    projectKey: "NVC",
    sprint: { kind: "active" },
    assignee: { kind: "mine-or-unassigned" },
  });
  assert.equal(
    jql,
    "project = NVC AND sprint in openSprints() AND (assignee = currentUser() OR assignee is EMPTY) AND statusCategory != Done",
  );
});

test("composeJql: specific sprint with quoting", () => {
  const jql = composeJql({
    projectKey: "NVC",
    sprint: { kind: "specific", name: "NVC Sprint 12" },
    assignee: { kind: "mine" },
  });
  assert.match(jql, /sprint = "NVC Sprint 12"/);
  assert.match(jql, /assignee = currentUser\(\)/);
});

test("composeJql: escapes embedded double quotes in sprint names", () => {
  const jql = composeJql({
    projectKey: "NVC",
    sprint: { kind: "specific", name: 'Q3 "stretch"' },
  });
  assert.match(jql, /sprint = "Q3 \\"stretch\\""/);
});

test("composeJql: label mode bypasses sprint + assignee filters", () => {
  const jql = composeJql({
    projectKey: "NVC",
    label: "shipwrights-ready",
    sprint: { kind: "active" }, // should be ignored
    assignee: { kind: "mine" }, // should be ignored
  });
  assert.equal(jql, "project = NVC AND labels = shipwrights-ready");
});

test("composeJql: unassigned-only assignee scope", () => {
  const jql = composeJql({
    projectKey: "NVC",
    assignee: { kind: "unassigned" },
  });
  assert.match(jql, /assignee is EMPTY/);
});

test("composeJql: any assignee = no filter", () => {
  const jql = composeJql({
    projectKey: "NVC",
    assignee: { kind: "any" },
  });
  assert.doesNotMatch(jql, /assignee/);
});

test("composeJql: throws on missing projectKey", () => {
  assert.throws(() => composeJql({}), /projectKey is required/);
});

test("composeJql: throws on unknown sprint.kind", () => {
  assert.throws(
    () => composeJql({ projectKey: "X", sprint: { kind: "bogus" } }),
    /unknown sprint\.kind/,
  );
});

test("composeJql: throws on specific sprint without name", () => {
  assert.throws(
    () => composeJql({ projectKey: "X", sprint: { kind: "specific" } }),
    /sprint\.name required/,
  );
});
