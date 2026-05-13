// `npx @shipwrights/source-jira init` — interactive wizard that walks a
// fresh user from "I want to use this" to "configured, authenticated,
// and ready to run `materialize`" in ~6 prompts.
//
// Writes:
//   .env.local                  — JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN
//   .shipwrights/jira.json      — non-secret config (host, email, jql,
//                                 field_mapping)
//   .gitignore                  — adds .env.local + .shipwrights/ if absent

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { execSync } from "node:child_process";
import { stdout } from "node:process";
import { createClient } from "../client.mjs";
import { normalizeHost } from "./hostNormalize.mjs";
import {
  translateConnectError,
  TOKEN_GENERATION_URL,
} from "./translateError.mjs";
import { mergeEnv } from "./envFile.mjs";
import { mergeGitignore } from "./gitignore.mjs";
import {
  prompt,
  promptSecret,
  confirm,
  choose,
} from "./prompt.mjs";
import { composeJql } from "./composeJql.mjs";

const FIELD_CONVENTIONS = {
  size: ["Story Points", "Story point estimate"],
  parents: ["Epic Link", "Parent Link", "Parent"],
};

export async function runInit({ cwd = process.cwd() } = {}) {
  stdout.write("\nShipwrights · Jira source — interactive setup\n");
  stdout.write("─────────────────────────────────────────────\n\n");

  // ----- 1. host -----
  const hostRaw = await prompt("Jira host (e.g. yourorg.atlassian.net)", {
    validate: (v) => (v.length === 0 ? "Required." : null),
  });
  const host = normalizeHost(hostRaw);
  if (host !== hostRaw.trim()) {
    stdout.write(`  → using ${host}\n`);
  }

  // ----- 2. email -----
  const gitEmail = tryGetGitEmail();
  const email = await prompt("Your Atlassian email", {
    default: gitEmail,
    validate: (v) => (/.+@.+\..+/.test(v) ? null : "Looks malformed."),
  });

  // ----- 3. token -----
  stdout.write(
    `\nGenerate an API token at:\n  ${TOKEN_GENERATION_URL}\n` +
      `(pick "Create API token" — not the scoped variant).\n\n`,
  );
  const token = await promptSecret("Paste token");
  if (!token) {
    throw new Error("Token is required");
  }

  // ----- 4. verify -----
  stdout.write("\nVerifying connection ... ");
  const client = createClient({ host, email, token });
  let me;
  try {
    me = await client.myself();
  } catch (err) {
    stdout.write("FAIL\n");
    const translated = translateConnectError(err, { host, email });
    stdout.write(`  ${translated}\n\n`);
    throw new Error("connection failed");
  }
  stdout.write(`✓ Authenticated as ${me.displayName ?? me.emailAddress}\n`);

  // ----- 5. project picker -----
  stdout.write("\nFetching your projects ... ");
  let projects;
  try {
    const list = await client.projects();
    projects = Array.isArray(list) ? list : (list?.values ?? []);
    stdout.write(`${projects.length} found\n`);
  } catch (err) {
    stdout.write("FAIL\n");
    stdout.write(`  ${translateConnectError(err, { host, email })}\n`);
    projects = [];
  }

  let projectKey;
  if (projects.length > 0) {
    const picked = await choose("\nWhich project should we track?", projects, {
      format: (p) => `${p.key.padEnd(8)}  ${p.name}`,
    });
    projectKey = picked.key;
  } else {
    projectKey = await prompt("Project key", {
      validate: (v) => (v.length === 0 ? "Required." : null),
    });
  }

  // ----- 6a. sprint scope -----
  const sprintChoice = await pickSprintScope(client, projectKey);

  // ----- 6b. assignment scope -----
  const assigneeChoice = await pickAssigneeScope();

  // ----- 6c. compose + confirm JQL -----
  const proposedJql = composeJql({
    projectKey,
    sprint: sprintChoice,
    assignee: assigneeChoice,
  });
  const useDefault = await confirm(
    `\nProposed JQL:\n  ${proposedJql}\nOK?`,
    { default: true },
  );
  const jql = useDefault
    ? proposedJql
    : await prompt("Custom JQL", {
        validate: (v) => (v.length === 0 ? "Required." : null),
      });

  // ----- 7. field detection -----
  stdout.write("\nDetecting custom fields ... ");
  let fieldMapping = {};
  try {
    const allFields = await client.fields();
    fieldMapping = detectFields(allFields ?? []);
    stdout.write("ok\n");
    for (const [k, v] of Object.entries(fieldMapping)) {
      stdout.write(`  ${k.padEnd(8)}  ${v}\n`);
    }
  } catch (err) {
    stdout.write("skipped (couldn't read /field)\n");
  }

  // ----- 8. write files -----
  stdout.write("\nWriting config:\n");

  const envPath = resolve(cwd, ".env.local");
  const envExisting = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const envNext = mergeEnv(envExisting, {
    JIRA_HOST: host,
    JIRA_EMAIL: email,
    JIRA_API_TOKEN: token,
  });
  writeFileSync(envPath, envNext, "utf8");
  stdout.write(`  .env.local              (token saved here — gitignored)\n`);

  const configPath = resolve(cwd, ".shipwrights/jira.json");
  mkdirSync(dirname(configPath), { recursive: true });
  const config = {
    host,
    email,
    jql,
    ...(Object.keys(fieldMapping).length > 0 ? { field_mapping: fieldMapping } : {}),
    _generated_by: "npx @shipwrights/source-jira init",
    _generated_at: new Date().toISOString(),
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  stdout.write(`  .shipwrights/jira.json  (re-run init to refresh)\n`);

  const giPath = resolve(cwd, ".gitignore");
  const giExisting = existsSync(giPath) ? readFileSync(giPath, "utf8") : "";
  const giNext = mergeGitignore(giExisting, [".env.local", ".shipwrights/"]);
  if (giNext !== null) {
    writeFileSync(giPath, giNext, "utf8");
    stdout.write(`  .gitignore              (added .env.local + .shipwrights/)\n`);
  }

  stdout.write(`\n✓ Done. Next:\n`);
  stdout.write(`  npx @shipwrights/source-jira healthcheck   — verify the connection\n`);
  stdout.write(`  npx @shipwrights/source-jira ls            — list backlog items\n`);
  stdout.write(`  npx @shipwrights/source-jira pick          — show the highest-priority item\n\n`);
}

async function pickSprintScope(client, projectKey) {
  stdout.write("\nChecking for active sprints ... ");
  let activeSprints = [];
  try {
    const boards = (await client.boards({ projectKeyOrId: projectKey, type: "scrum" }))?.values ?? [];
    for (const board of boards) {
      try {
        const page = await client.sprintsForBoard(board.id, { state: "active" });
        for (const s of page?.values ?? []) {
          activeSprints.push({ id: s.id, name: s.name, boardName: board.name });
        }
      } catch {
        // a board may forbid sprint access; skip silently
      }
    }
    stdout.write(`${activeSprints.length} found\n`);
  } catch (err) {
    stdout.write("none (no boards or no agile access)\n");
    return { kind: "none" };
  }

  if (activeSprints.length === 0) {
    return { kind: "none" };
  }

  const options = [
    {
      label: "Active sprint(s) (recommended)",
      jqlPreview: "sprint in openSprints()",
      value: { kind: "active" },
    },
    {
      label: "A specific named sprint",
      jqlPreview: 'sprint = "<name>"',
      value: { kind: "pick-specific" },
    },
    {
      label: "All not-Done tickets (ignore sprint)",
      jqlPreview: "(no sprint filter)",
      value: { kind: "none" },
    },
  ];
  const picked = await choose(
    `\nFound ${activeSprints.length} active sprint(s). How should we scope by sprint?`,
    options,
    { format: (o) => `${o.label.padEnd(40)} ${o.jqlPreview}` },
  );

  if (picked.value.kind === "pick-specific") {
    const sprint = await choose(
      "\nWhich sprint?",
      activeSprints,
      { format: (s) => `${s.name}  (board: ${s.boardName})` },
    );
    return { kind: "specific", name: sprint.name };
  }
  return picked.value;
}

async function pickAssigneeScope() {
  const options = [
    {
      label: "Mine + unassigned (recommended)",
      jqlPreview: "assignee = me OR is EMPTY",
      value: { kind: "mine-or-unassigned" },
    },
    {
      label: "Only assigned to me",
      jqlPreview: "assignee = currentUser()",
      value: { kind: "mine" },
    },
    {
      label: "Only unassigned",
      jqlPreview: "assignee is EMPTY",
      value: { kind: "unassigned" },
    },
    {
      label: "Anyone (no assignee filter)",
      jqlPreview: "(no assignee filter)",
      value: { kind: "any" },
    },
  ];
  const picked = await choose(
    "\nWhich tickets should the orchestrator pick up?",
    options,
    { format: (o) => `${o.label.padEnd(40)} ${o.jqlPreview}` },
  );
  return picked.value;
}

function detectFields(allFields) {
  const out = {};
  for (const [key, candidateNames] of Object.entries(FIELD_CONVENTIONS)) {
    for (const wantedName of candidateNames) {
      const match = allFields.find(
        (f) => f.name === wantedName && typeof f.id === "string",
      );
      if (match) {
        out[key] = match.id;
        break;
      }
    }
  }
  return out;
}

function tryGetGitEmail() {
  try {
    const v = execSync("git config user.email", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return v || undefined;
  } catch {
    return undefined;
  }
}
