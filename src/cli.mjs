#!/usr/bin/env node
// @shipwrights/source-jira CLI entrypoint.
//
// Subcommands:
//   init          interactive setup wizard
//   healthcheck   verify config + connection
//   ls            list backlog items matching the JQL
//   pick          show the single highest-priority item

import { runInit } from "./cli/init.mjs";
import { runHealthcheck } from "./cli/healthcheck.mjs";
import { runLs } from "./cli/ls.mjs";
import { runPick } from "./cli/pick.mjs";

const [, , subcommand, ...rest] = process.argv;

async function main() {
  switch (subcommand) {
    case "init":
      await runInit();
      return;
    case "healthcheck":
    case "doctor":
      await runHealthcheck();
      return;
    case "ls":
    case "list":
      await runLs(parseLsArgs(rest));
      return;
    case "pick":
    case "next":
      await runPick();
      return;
    case "--version":
    case "-v":
      await printVersion();
      return;
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      return;
    default:
      process.stderr.write(`Unknown subcommand: ${subcommand}\n\n`);
      printHelp();
      process.exit(2);
  }
}

function parseLsArgs(args) {
  const out = { limit: 20 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") {
      const n = Number.parseInt(args[i + 1], 10);
      if (Number.isInteger(n) && n >= 0) {
        out.limit = n === 0 ? undefined : n;
      }
      i++;
    } else if (args[i] === "--all") {
      out.limit = undefined;
    }
  }
  return out;
}

function printHelp() {
  process.stdout.write(`@shipwrights/source-jira

Usage:
  npx @shipwrights/source-jira <command>

Commands:
  init              Interactive setup wizard. Writes .env.local + .shipwrights/jira.json.
  healthcheck       Verify config + connection. Aliases: doctor.
  ls                List backlog items matching the JQL. Aliases: list. Flags: --limit N, --all.
  pick              Show the single highest-priority item the orchestrator would pick.
                    Aliases: next.
  --version         Print the installed version.
  --help            Show this help.
`);
}

async function printVersion() {
  // Read our package.json so we don't hardcode the version.
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, resolve } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(await readFile(resolve(here, "../package.json"), "utf8"));
  process.stdout.write(`${pkg.version}\n`);
}

main().catch((err) => {
  if (err && err.message && err.message !== "connection failed") {
    process.stderr.write(`\nError: ${err.message}\n`);
  }
  process.exit(1);
});
