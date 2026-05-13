import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHealthcheck } from "../src/cli/healthcheck.mjs";

test("healthcheck reports actionable guidance for Jira 401 auth failures", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "shipwright-jira-healthcheck-"));
  const previousCwd = process.cwd();
  const previousEnv = {
    JIRA_HOST: process.env.JIRA_HOST,
    JIRA_EMAIL: process.env.JIRA_EMAIL,
    JIRA_API_TOKEN: process.env.JIRA_API_TOKEN,
  };
  const previousFetch = globalThis.fetch;
  const writes = captureProcessWrites();

  try {
    mkdirSync(join(cwd, ".shipwrights"), { recursive: true });
    writeFileSync(
      join(cwd, ".shipwrights", "jira.json"),
      JSON.stringify({
        host: "amali-tech.atlassian.net",
        email: "dev@example.com",
        jql: 'project = NVC AND sprint = "Sprint 2"',
      }),
    );
    writeFileSync(join(cwd, ".env.local"), "JIRA_API_TOKEN=bad-token\n");
    delete process.env.JIRA_HOST;
    delete process.env.JIRA_EMAIL;
    delete process.env.JIRA_API_TOKEN;
    process.chdir(cwd);
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ errorMessages: ["Unauthorized"] }), {
        status: 401,
        statusText: "Unauthorized",
        headers: { "Content-Type": "application/json" },
      });

    await assert.rejects(() => runHealthcheck(), /healthcheck failed/);

    assert.match(writes.stderr, /Token rejected by Jira/);
    assert.match(writes.stderr, /dev@example\.com/);
    assert.doesNotMatch(writes.stderr, /Jira GET \/myself failed/);
    assert.match(writes.stdout, /Checking \.\.\. FAIL/);
  } finally {
    restoreProcessWrites(writes);
    globalThis.fetch = previousFetch;
    restoreEnv(previousEnv);
    process.chdir(previousCwd);
    rmSync(cwd, { recursive: true, force: true });
  }
});

function captureProcessWrites() {
  const writes = {
    stdout: "",
    stderr: "",
    stdoutWrite: process.stdout.write,
    stderrWrite: process.stderr.write,
  };
  process.stdout.write = function write(chunk, ...args) {
    writes.stdout += String(chunk);
    return writes.stdoutWrite.call(this, chunk, ...args);
  };
  process.stderr.write = function write(chunk, ...args) {
    writes.stderr += String(chunk);
    return writes.stderrWrite.call(this, chunk, ...args);
  };
  return writes;
}

function restoreProcessWrites(writes) {
  process.stdout.write = writes.stdoutWrite;
  process.stderr.write = writes.stderrWrite;
}

function restoreEnv(previousEnv) {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
