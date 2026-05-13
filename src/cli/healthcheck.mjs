import { stdout, stderr } from "node:process";
import { createSource } from "../index.mjs";
import { loadConfig } from "./loadConfig.mjs";

export async function runHealthcheck() {
  const config = loadConfig();
  stdout.write(`config: ${config.host}  ·  ${truncate(config.jql, 60)}\n\n`);
  const source = createSource(config);
  stdout.write("Checking ... ");
  try {
    await source.healthcheck();
    stdout.write("✓ ok\n");
  } catch (err) {
    stdout.write("FAIL\n");
    stderr.write(`\n${err.message}\n`);
    throw new Error("healthcheck failed");
  }
}

function truncate(s, n) {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
