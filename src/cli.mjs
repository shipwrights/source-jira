#!/usr/bin/env node
// @shipwrights/source-jira CLI entrypoint.
//
// Subcommands:
//   init   — interactive setup wizard

import { runInit } from "./cli/init.mjs";

const [, , subcommand, ...rest] = process.argv;

async function main() {
  switch (subcommand) {
    case "init":
      await runInit();
      return;
    case "--version":
    case "-v":
      printVersion();
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

function printHelp() {
  process.stdout.write(`@shipwrights/source-jira

Usage:
  npx @shipwrights/source-jira <command>

Commands:
  init        Interactive setup wizard. Connects to Jira, picks a project,
              writes .env.local + .shipwrights/jira.json + .gitignore.
  --version   Print the installed version.
  --help      Show this help.
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
