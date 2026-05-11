// @shipwrights/source-jira — entry point.
//
// Implements the BacklogSource interface from @shipwrights/core:
//
//   { healthcheck, listAvailable, pickNext, materialize, markStatus, attachPR }
//
// Phase 1 shipped healthcheck + listAvailable + pickNext.
// Phase 2 (this file) adds materialize: fetch the full issue, render its ADF
// description to markdown, write an epic file with frontmatter.
//
// markStatus and attachPR still throw "Phase N" errors — they land in 3 and 4.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "./client.mjs";
import { validateJql, fieldsForSearch } from "./jql.mjs";
import { adfToMarkdown } from "./adf-to-markdown.mjs";

const PRIORITY_ORDER = { Highest: 0, High: 1, Medium: 2, Low: 3, Lowest: 4 };

/**
 * Resolve a config-declared env var to its value. Throws if missing.
 */
function readEnv(varName, role) {
  const value = process.env[varName];
  if (!value) {
    throw new Error(
      `@shipwrights/source-jira: env var ${varName} is required for ${role} but is not set`,
    );
  }
  return value;
}

/**
 * Map a Jira issue to a Shipwright BacklogItem. Phase 1 uses standard
 * fields only — field_mapping for size / parents arrives in Phase 5.
 */
function toBacklogItem(issue, { idPrefix, fieldMapping }) {
  const fields = issue.fields ?? {};
  const id = issue.key; // SHOP-123
  const sizeFieldKey = fieldMapping?.size;
  const parentsFieldKey = fieldMapping?.parents;

  const size = sizeFieldKey && fields[sizeFieldKey]
    ? bucketSize(Number(fields[sizeFieldKey]))
    : undefined;

  const parents = parentsFieldKey && fields[parentsFieldKey]
    ? [fields[parentsFieldKey]].flat().filter(Boolean)
    : [];

  return {
    id,
    title: fields.summary ?? `(no summary) ${id}`,
    description: undefined, // ADF rendering lands in Phase 2 (materialize)
    status: fields.status?.name ?? "unknown",
    priority: fields.priority?.name,
    size,
    domain: undefined,
    parents,
    metadata: {
      issueKey: issue.key,
      issueId: issue.id,
      jiraUrl: issue.self,
      assignee: fields.assignee?.displayName,
      reporter: fields.reporter?.displayName,
      created: fields.created,
      updated: fields.updated,
      labels: fields.labels ?? [],
      components: (fields.components ?? []).map((c) => c.name),
    },
  };
}

/**
 * Map a numeric story-points value to Shipwright's coarse size bucket.
 * Defaults follow common Fibonacci-style estimation.
 */
function bucketSize(points) {
  if (!Number.isFinite(points)) return undefined;
  if (points <= 2) return "small";
  if (points <= 8) return "medium";
  return "large";
}

function comparePriority(a, b) {
  const ap = PRIORITY_ORDER[a.priority] ?? 99;
  const bp = PRIORITY_ORDER[b.priority] ?? 99;
  if (ap !== bp) return ap - bp;
  return (a.id ?? "").localeCompare(b.id ?? "");
}

/**
 * Lowercase-hyphen-only slug, truncated to a sensible length.
 */
function slugify(title) {
  return String(title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "untitled";
}

/**
 * Map a Jira priority name to Shipwright's P0..P3 if it matches a known label;
 * otherwise pass through. Jira's default priorities are Highest, High, Medium,
 * Low, Lowest — we collapse to the closest P.
 */
function priorityCodeFromName(name) {
  switch (name) {
    case "Highest":
      return "P0";
    case "High":
      return "P1";
    case "Medium":
      return "P2";
    case "Low":
    case "Lowest":
      return "P3";
    default:
      return name ?? "P2";
  }
}

/**
 * Pull a list of acceptance criteria from a description's markdown body.
 * Recognises two common patterns:
 *   - "## Acceptance" or "## Acceptance Criteria" heading followed by a list
 *   - a top-level checkbox list (`- [ ] criterion`)
 * Returns [] when no recognizable section is found.
 */
function extractAcceptance(markdown) {
  if (!markdown) return [];
  const headingRe = /^##\s+Acceptance(?:\s+Criteria)?\s*$([\s\S]*?)(?=^##\s|\Z)/im;
  const match = markdown.match(headingRe);
  const block = match ? match[1] : markdown;
  const bullets = [];
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s+(?:\[[\sxX]\]\s+)?(.+?)\s*$/);
    if (m) bullets.push(m[1]);
  }
  return bullets;
}

/**
 * Build the epic markdown document from an enriched BacklogItem + rendered
 * description. Output structure mirrors @shipwrights/core's epic schema.
 */
function buildEpicMarkdown(item, descriptionMd) {
  const acceptance = extractAcceptance(descriptionMd);
  const priorityCode = priorityCodeFromName(item.priority);
  const sourceBlock = item.metadata
    ? `source:\n  kind: jira\n  issue_key: ${item.metadata.issueKey}\n  jira_url: ${item.metadata.jiraUrl ?? ""}`
    : "";
  const acceptanceBlock = acceptance.length > 0
    ? `acceptance:\n${acceptance.map((a) => `  - ${escapeYamlInline(a)}`).join("\n")}`
    : "acceptance: []";

  return `---
id: ${item.id}
title: ${escapeYamlInline(item.title)}
status: refined
priority: ${priorityCode}
domain: ${item.domain ?? "full-stack"}
owner: claude
parents: ${formatParents(item.parents)}
${acceptanceBlock}
size: ${item.size ?? "medium"}
${sourceBlock}
---

## Why

${descriptionMd || "_(no description in Jira)_"}
`;
}

function formatParents(parents) {
  if (!Array.isArray(parents) || parents.length === 0) return "[]";
  return `[${parents.join(", ")}]`;
}

function escapeYamlInline(value) {
  const s = String(value ?? "");
  if (/^[A-Za-z0-9 _\-.,!?()]+$/.test(s)) return s;
  return JSON.stringify(s);
}

/**
 * Factory called by @shipwrights/core's source-loader.
 */
export function createSource(rawConfig = {}) {
  const {
    host,
    email_env = "JIRA_EMAIL",
    token_env = "JIRA_API_TOKEN",
    jql,
    field_mapping = {},
    id_prefix,
    _client, // injected in tests
  } = rawConfig;

  if (!host) {
    throw new Error("@shipwrights/source-jira: `host` is required (e.g. 'myorg.atlassian.net')");
  }
  if (!jql) {
    throw new Error("@shipwrights/source-jira: `jql` is required");
  }

  // Validate early — surface bad JQL before any API call.
  validateJql(jql);

  const client = _client ?? createClient({
    host,
    email: readEnv(email_env, "Jira email"),
    token: readEnv(token_env, "Jira API token"),
  });

  const fields = fieldsForSearch({ fieldMapping: field_mapping });

  return {
    /**
     * Phase 1: confirm credentials by hitting /myself. Throws on failure.
     */
    async healthcheck() {
      await client.myself();
    },

    /**
     * Phase 1: paginate the configured JQL, map each issue to a BacklogItem.
     * Optional filter narrows by status (Jira status name, not Shipwright
     * status) — pass `statuses` to override the JQL's own status clause.
     */
    async listAvailable(filter = {}) {
      let effectiveJql = jql;
      if (Array.isArray(filter.statuses) && filter.statuses.length > 0) {
        const escaped = filter.statuses.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(", ");
        effectiveJql = `(${jql}) AND status in (${escaped})`;
      }
      const issues = await client.searchJqlAll({
        jql: effectiveJql,
        fields,
        maxResults: 50,
      });
      return issues.map((issue) =>
        toBacklogItem(issue, { idPrefix: id_prefix, fieldMapping: field_mapping }),
      );
    },

    /**
     * Phase 1: pick the highest-priority item, then lowest key alphabetically
     * for stable ordering. Doesn't yet honour `parents-shipped` blocking —
     * that arrives once `materialize` can resolve Epic Link parents (Phase 2/5).
     */
    async pickNext(criteria = {}) {
      const items = await this.listAvailable(criteria);
      if (items.length === 0) return null;
      items.sort(comparePriority);
      return items[0];
    },

    /**
     * Phase 2: fetch the Jira issue (full description), render ADF →
     * markdown, write a refined epic file with frontmatter. Returns
     * { epicFilePath, created } per the BacklogSource contract.
     *
     * The epic file is written with `status: refined` so the orchestrator
     * skips re-running the PO refinement step. Acceptance criteria are
     * parsed from the description if a recognizable `## Acceptance` or
     * checkbox section is found; otherwise left empty for the user/PO to
     * fill in.
     */
    async materialize(item, targetDir) {
      if (!item?.id) {
        throw new Error("@shipwrights/source-jira: materialize() needs a BacklogItem with an id");
      }
      if (!targetDir || typeof targetDir !== "string") {
        throw new Error("@shipwrights/source-jira: materialize() needs a targetDir path");
      }

      const fullFields = fieldsForSearch({ fieldMapping: field_mapping }).concat(["description"]);
      const issue = await client.getIssue(item.id, { fields: fullFields });
      const enriched = toBacklogItem(issue, { idPrefix: id_prefix, fieldMapping: field_mapping });

      const description = adfToMarkdown(issue.fields?.description);
      const slug = slugify(enriched.title);
      const filename = `${enriched.id}-${slug}.md`;
      const path = join(targetDir, filename);
      const created = !existsSync(path);

      mkdirSync(targetDir, { recursive: true });
      const body = buildEpicMarkdown(enriched, description);
      // Be polite: if the file already exists with status > refined, don't
      // overwrite its body — only refresh the frontmatter title in case it
      // changed in Jira.
      if (!created) {
        const existing = readFileSync(path, "utf8");
        const status = (existing.match(/^status:\s*(\S+)/m) ?? [])[1];
        if (status && status !== "idea" && status !== "refined") {
          // Don't clobber in-flight epics; leave them alone.
          return { epicFilePath: path, created: false };
        }
      }
      writeFileSync(path, body, "utf8");
      return { epicFilePath: path, created };
    },

    async markStatus(_itemId, _status) {
      throw new Error(
        "@shipwrights/source-jira: markStatus() lands in Phase 3 (next release).",
      );
    },
    async attachPR(_itemId, _prUrl) {
      throw new Error(
        "@shipwrights/source-jira: attachPR() lands in Phase 4 (next release).",
      );
    },
  };
}

// @shipwrights/core's source-loader accepts default export as the factory too.
export default createSource;
