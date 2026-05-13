// Shared config loader for CLI subcommands.
//
// Reads, in increasing precedence:
//   1. .env (loaded into process.env, doesn't override existing values)
//   2. .env.local (same — for token + email + host)
//   3. .shipwrights/jira.json (non-secret config: host, email, jql, field_mapping)
//   4. process.env (already-set values win — including from .env / .env.local)
//
// Returns the assembled config ready to pass to createSource(). Throws with
// a "run `init` first" message if the JSON is missing.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const CONFIG_FILENAME = ".shipwrights/jira.json";

export function loadConfig({ cwd = process.cwd() } = {}) {
  loadDotenv(cwd);

  const configPath = resolve(cwd, CONFIG_FILENAME);
  if (!existsSync(configPath)) {
    throw new Error(
      `No config found at ${CONFIG_FILENAME}.\n` +
        `Run \`npx @shipwrights/source-jira init\` first.`,
    );
  }

  let fileConfig;
  try {
    fileConfig = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    throw new Error(
      `Couldn't parse ${CONFIG_FILENAME}: ${err.message}. ` +
        `Re-run \`init\` to regenerate.`,
    );
  }

  const host = process.env.JIRA_HOST ?? fileConfig.host;
  const email = process.env.JIRA_EMAIL ?? fileConfig.email;
  const token = process.env.JIRA_API_TOKEN;
  const jql = fileConfig.jql;

  const missing = [];
  if (!host) missing.push("host (JIRA_HOST or jira.json:host)");
  if (!email) missing.push("email (JIRA_EMAIL or jira.json:email)");
  if (!token) missing.push("token (JIRA_API_TOKEN env)");
  if (!jql) missing.push("jql (jira.json:jql)");
  if (missing.length > 0) {
    throw new Error(`Config incomplete — missing: ${missing.join(", ")}.`);
  }

  return {
    host,
    email,
    token,
    jql,
    ...(fileConfig.field_mapping
      ? { field_mapping: fileConfig.field_mapping }
      : {}),
    ...(fileConfig.status_mapping
      ? { status_mapping: fileConfig.status_mapping }
      : {}),
  };
}

function loadDotenv(cwd) {
  for (const name of [".env", ".env.local"]) {
    const p = resolve(cwd, name);
    if (!existsSync(p)) continue;
    for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }
}
