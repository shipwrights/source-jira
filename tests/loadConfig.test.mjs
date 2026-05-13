import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/cli/loadConfig.mjs";

function makeTmp() {
  return mkdtempSync(join(tmpdir(), "shipwrights-jira-cfg-"));
}

function writeConfig(cwd, contents) {
  mkdirSync(join(cwd, ".shipwrights"), { recursive: true });
  writeFileSync(
    join(cwd, ".shipwrights/jira.json"),
    JSON.stringify(contents),
    "utf8",
  );
}

function clearJiraEnv() {
  delete process.env.JIRA_HOST;
  delete process.env.JIRA_EMAIL;
  delete process.env.JIRA_API_TOKEN;
}

test("loadConfig throws a helpful message when .shipwrights/jira.json is missing", () => {
  const cwd = makeTmp();
  try {
    assert.throws(() => loadConfig({ cwd }), /Run `npx @shipwrights\/source-jira init`/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("loadConfig reads JSON + token from env, returns full config", () => {
  const cwd = makeTmp();
  const saved = { ...process.env };
  try {
    writeConfig(cwd, {
      host: "x.atlassian.net",
      email: "ada@example.com",
      jql: "project = X",
      field_mapping: { size: "customfield_1" },
    });
    clearJiraEnv();
    process.env.JIRA_API_TOKEN = "tok-from-env";

    const cfg = loadConfig({ cwd });
    assert.equal(cfg.host, "x.atlassian.net");
    assert.equal(cfg.email, "ada@example.com");
    assert.equal(cfg.token, "tok-from-env");
    assert.equal(cfg.jql, "project = X");
    assert.deepEqual(cfg.field_mapping, { size: "customfield_1" });
  } finally {
    process.env = saved;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("loadConfig reads token from .env.local when not set in process.env", () => {
  const cwd = makeTmp();
  const saved = { ...process.env };
  try {
    writeConfig(cwd, { host: "x.atlassian.net", email: "a@b.c", jql: "x" });
    writeFileSync(join(cwd, ".env.local"), "JIRA_API_TOKEN=secret-from-file\n");
    clearJiraEnv();

    const cfg = loadConfig({ cwd });
    assert.equal(cfg.token, "secret-from-file");
  } finally {
    process.env = saved;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("loadConfig: process.env overrides .env.local", () => {
  const cwd = makeTmp();
  const saved = { ...process.env };
  try {
    writeConfig(cwd, { host: "x.atlassian.net", email: "a@b.c", jql: "x" });
    writeFileSync(join(cwd, ".env.local"), "JIRA_API_TOKEN=should-be-overridden\n");
    clearJiraEnv();
    process.env.JIRA_API_TOKEN = "wins";

    const cfg = loadConfig({ cwd });
    assert.equal(cfg.token, "wins");
  } finally {
    process.env = saved;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("loadConfig: env JIRA_HOST overrides jira.json host", () => {
  const cwd = makeTmp();
  const saved = { ...process.env };
  try {
    writeConfig(cwd, {
      host: "stale.atlassian.net",
      email: "a@b.c",
      jql: "x",
    });
    clearJiraEnv();
    process.env.JIRA_HOST = "fresh.atlassian.net";
    process.env.JIRA_API_TOKEN = "tok";

    const cfg = loadConfig({ cwd });
    assert.equal(cfg.host, "fresh.atlassian.net");
  } finally {
    process.env = saved;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("loadConfig: throws on missing token", () => {
  const cwd = makeTmp();
  const saved = { ...process.env };
  try {
    writeConfig(cwd, { host: "x.atlassian.net", email: "a@b.c", jql: "x" });
    clearJiraEnv();
    assert.throws(() => loadConfig({ cwd }), /missing.*token/);
  } finally {
    process.env = saved;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("loadConfig: throws on malformed JSON", () => {
  const cwd = makeTmp();
  const saved = { ...process.env };
  try {
    mkdirSync(join(cwd, ".shipwrights"), { recursive: true });
    writeFileSync(join(cwd, ".shipwrights/jira.json"), "{not json", "utf8");
    clearJiraEnv();
    process.env.JIRA_API_TOKEN = "tok";

    assert.throws(() => loadConfig({ cwd }), /Couldn't parse/);
  } finally {
    process.env = saved;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("loadConfig: passes status_mapping through when present", () => {
  const cwd = makeTmp();
  const saved = { ...process.env };
  try {
    writeConfig(cwd, {
      host: "x.atlassian.net",
      email: "a@b.c",
      jql: "x",
      status_mapping: { shipped: "Closed" },
    });
    clearJiraEnv();
    process.env.JIRA_API_TOKEN = "tok";

    const cfg = loadConfig({ cwd });
    assert.deepEqual(cfg.status_mapping, { shipped: "Closed" });
  } finally {
    process.env = saved;
    rmSync(cwd, { recursive: true, force: true });
  }
});
