import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeHost } from "../src/cli/hostNormalize.mjs";
import { translateConnectError } from "../src/cli/translateError.mjs";
import { mergeEnv } from "../src/cli/envFile.mjs";
import { mergeGitignore } from "../src/cli/gitignore.mjs";

// ---------- normalizeHost ----------

test("normalizeHost: bare slug → suffixes .atlassian.net", () => {
  assert.equal(normalizeHost("amali-tech"), "amali-tech.atlassian.net");
});

test("normalizeHost: full host stays as-is", () => {
  assert.equal(
    normalizeHost("amali-tech.atlassian.net"),
    "amali-tech.atlassian.net",
  );
});

test("normalizeHost: strips https:// + path + trailing slash", () => {
  assert.equal(
    normalizeHost("https://amali-tech.atlassian.net/jira/projects"),
    "amali-tech.atlassian.net",
  );
});

test("normalizeHost: trims + lowercases", () => {
  assert.equal(normalizeHost("  AMALI-TECH  "), "amali-tech.atlassian.net");
});

test("normalizeHost: strips port", () => {
  assert.equal(
    normalizeHost("amali-tech.atlassian.net:443"),
    "amali-tech.atlassian.net",
  );
});

test("normalizeHost: throws on empty / non-string", () => {
  assert.throws(() => normalizeHost(""), /required/);
  assert.throws(() => normalizeHost("   "), /required/);
  assert.throws(() => normalizeHost(undefined), /required/);
  assert.throws(() => normalizeHost(123), /required/);
});

// ---------- translateConnectError ----------

test("translateConnectError: 404 'Site temporarily unavailable' → tenant-not-found message", () => {
  const err = {
    status: 404,
    body: { errorCode: "OTHER", errorMessage: "Site temporarily unavailable" },
  };
  const msg = translateConnectError(err, { host: "wrong.atlassian.net" });
  assert.match(msg, /tenant "wrong\.atlassian\.net" not found/i);
  assert.match(msg, /URL you use to access Jira/);
});

test("translateConnectError: 401 → guidance about token + email", () => {
  const err = { status: 401 };
  const msg = translateConnectError(err, {
    host: "x.atlassian.net",
    email: "ada@example.com",
  });
  assert.match(msg, /Token rejected/i);
  assert.match(msg, /ada@example\.com/);
  assert.match(msg, /id\.atlassian\.com/);
});

test("translateConnectError: ENOTFOUND → DNS guidance", () => {
  const err = { cause: { code: "ENOTFOUND" } };
  const msg = translateConnectError(err, { host: "bad.atlassian.net" });
  assert.match(msg, /doesn't resolve/);
  assert.match(msg, /bad\.atlassian\.net/);
});

test("translateConnectError: falls back to raw message for unknown error", () => {
  const err = { message: "weird thing happened" };
  const msg = translateConnectError(err, { host: "x" });
  assert.equal(msg, "weird thing happened");
});

// ---------- mergeEnv ----------

test("mergeEnv: appends new keys to empty file", () => {
  const out = mergeEnv("", { FOO: "bar", BAZ: "qux" });
  assert.equal(out, "FOO=bar\nBAZ=qux\n");
});

test("mergeEnv: preserves unrelated keys + comments", () => {
  const existing = "# pre-existing\nA=1\nB=2\n";
  const out = mergeEnv(existing, { B: "two", C: "3" });
  assert.match(out, /^# pre-existing$/m);
  assert.match(out, /^A=1$/m);
  assert.match(out, /^B=two$/m);
  assert.doesNotMatch(out, /^B=2$/m);
  assert.match(out, /^C=3$/m);
});

test("mergeEnv: quotes values with spaces / hash / quotes", () => {
  const out = mergeEnv("", {
    A: "no spaces",
    B: "has a #",
    C: 'has "quotes"',
  });
  assert.match(out, /^A="no spaces"$/m);
  assert.match(out, /^B="has a #"$/m);
  assert.match(out, /^C="has \\"quotes\\""$/m);
});

test("mergeEnv: idempotent on identical updates", () => {
  const first = mergeEnv("", { X: "1" });
  const second = mergeEnv(first, { X: "1" });
  assert.equal(second, first);
});

// ---------- mergeGitignore ----------

test("mergeGitignore: returns null when entries already present", () => {
  const out = mergeGitignore(".env.local\n.shipwrights/\n", [
    ".env.local",
    ".shipwrights/",
  ]);
  assert.equal(out, null);
});

test("mergeGitignore: appends missing entries under Shipwrights header", () => {
  const out = mergeGitignore("node_modules/\n", [".env.local", ".shipwrights/"]);
  assert.match(out, /^node_modules\/$/m);
  assert.match(out, /^# Shipwrights$/m);
  assert.match(out, /^\.env\.local$/m);
  assert.match(out, /^\.shipwrights\/$/m);
});

test("mergeGitignore: only appends entries that are actually missing", () => {
  const out = mergeGitignore("node_modules/\n.env.local\n", [
    ".env.local",
    ".shipwrights/",
  ]);
  assert.match(out, /^\.shipwrights\/$/m);
  // .env.local should appear only once
  const count = out.match(/^\.env\.local$/gm)?.length ?? 0;
  assert.equal(count, 1);
});

test("mergeGitignore: handles empty input", () => {
  const out = mergeGitignore("", [".env.local"]);
  assert.match(out, /^# Shipwrights$/m);
  assert.match(out, /^\.env\.local$/m);
});
