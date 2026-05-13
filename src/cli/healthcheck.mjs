import { stderr, stdout } from "node:process";
import { createSource } from "../index.mjs";
import { loadConfig } from "./loadConfig.mjs";
import { translateConnectError } from "./translateError.mjs";

export async function runHealthcheck() {
  const config = loadConfig();
  stdout.write(`config: ${config.host}  -  ${truncate(config.jql, 60)}\n\n`);
  const source = createSource(config);
  stdout.write("Checking ... ");
  try {
    await source.healthcheck();
    stdout.write("ok\n");
  } catch (err) {
    stdout.write("FAIL\n");
    stderr.write(`\n${formatHealthcheckError(err, config)}\n`);
    throw new Error("healthcheck failed");
  }
}

function truncate(s, n) {
  return s.length <= n ? s : `${s.slice(0, n - 1)}...`;
}

function formatHealthcheckError(err, config) {
  const clientError = findJiraClientError(err);
  if (clientError) {
    return translateConnectError(clientError, {
      host: config.host,
      email: config.email,
    });
  }
  return err.message;
}

function findJiraClientError(err) {
  let cursor = err;
  while (cursor) {
    if (typeof cursor.status === "number") return cursor;
    cursor = cursor.cause;
  }
  const match = err?.message?.match(/Jira .* failed: (\d{3})\b/);
  if (!match) return null;
  return {
    status: Number.parseInt(match[1], 10),
    message: err.message,
  };
}
