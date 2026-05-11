import { test } from "node:test";
import assert from "node:assert/strict";
import { validateJql, fieldsForSearch } from "../src/jql.mjs";

test("validateJql passes on a real query", () => {
  const ok = validateJql('project = SHOP AND status in ("Ready", "Refined") ORDER BY priority ASC');
  assert.equal(typeof ok, "string");
});

test("validateJql rejects empty string", () => {
  assert.throws(() => validateJql(""));
  assert.throws(() => validateJql("   "));
});

test("validateJql rejects non-string", () => {
  assert.throws(() => validateJql(null));
  assert.throws(() => validateJql(undefined));
  assert.throws(() => validateJql(42));
});

test("validateJql catches unbalanced quotes", () => {
  assert.throws(
    () => validateJql('status = "Ready'),
    /unbalanced double quotes/,
  );
});

test("validateJql catches unbalanced parens", () => {
  assert.throws(
    () => validateJql("(project = SHOP AND (status = Ready"),
    /unbalanced parentheses/,
  );
});

test("validateJql allows escaped quotes inside strings", () => {
  // "Hello \"World\"" — two visible quotes flanking the escaped pair
  const jql = 'summary = "Hello \\"World\\""';
  // Should pass — only the outer quotes are unescaped
  assert.equal(validateJql(jql), jql);
});

test("fieldsForSearch returns the default set + custom fields", () => {
  const fields = fieldsForSearch({
    fieldMapping: { size: "customfield_10016", parents: "customfield_10014" },
  });
  assert.ok(fields.includes("summary"));
  assert.ok(fields.includes("status"));
  assert.ok(fields.includes("priority"));
  assert.ok(fields.includes("customfield_10016"));
  assert.ok(fields.includes("customfield_10014"));
});

test("fieldsForSearch deduplicates", () => {
  const fields = fieldsForSearch({
    fieldMapping: { size: "summary" }, // intentionally collides with standard
  });
  const summaryCount = fields.filter((f) => f === "summary").length;
  assert.equal(summaryCount, 1);
});
