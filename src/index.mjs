// @shipwrights/source-jira — entry point.
//
// Implements the BacklogSource interface from @shipwrights/core:
//
//   { healthcheck, listAvailable, pickNext, materialize, markStatus, attachPR }
//
// Phase history:
//   Phase 1 (v0.1.0): healthcheck + listAvailable + pickNext
//   Phase 2 (v0.2.0): materialize (issue → epic file via ADF→markdown)
//   Phase 3 (v0.3.0): markStatus (transition mapped, comment for middle states)
//   Phase 4 (v0.3.0): attachPR (short ADF comment with link)
//   Phase 5 (v0.3.0): field mapping auto-detection + enhanced healthcheck

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "./client.mjs";
import { validateJql, fieldsForSearch } from "./jql.mjs";
import { adfToMarkdown } from "./adf-to-markdown.mjs";
import { adfParagraph, adfParagraphWithLink } from "./adf-builder.mjs";

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
      assigneeAccountId: fields.assignee?.accountId ?? null,
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

// Shipwright lifecycle states that *transition* the Jira issue.
// Everything else (sliced, built, integrated, tested, reviewed) is
// internal Shipwright bookkeeping and writes a comment only.
//
// Consumers override via .shipwrights.yml backlog.source.config.status_mapping:
//
//   status_mapping:
//     refined: "In Progress"
//     ready-for-human-review: "In Review"
//     shipped: "Done"
const DEFAULT_STATUS_MAPPING = {
  refined: "Ready for Dev",
  "ready-for-human-review": "In Review",
  shipped: "Done",
};

/**
 * Conventional Jira field names for things Shipwright cares about. Phase 5
 * auto-detection looks for these via the /field API when the user hasn't
 * provided explicit field_mapping in config.
 */
const FIELD_CONVENTIONS = {
  size: ["Story Points", "Story point estimate", "Story Point Estimate"],
  parents: ["Epic Link", "Parent Link", "Parent"],
};

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
    status_mapping,
    id_prefix,
    _client, // injected in tests
  } = rawConfig;

  // Effective status mapping: user override merged on top of defaults.
  const effectiveStatusMapping = { ...DEFAULT_STATUS_MAPPING, ...(status_mapping ?? {}) };

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

  // Field mapping resolution. If the consumer's config provided explicit
  // entries, use those. Otherwise, lazy-detect via the /field API the first
  // time we need them. Cache the result.
  let resolvedFieldMapping = null;
  let currentUserCache = null;
  async function getFieldMapping() {
    if (resolvedFieldMapping) return resolvedFieldMapping;
    const explicit = { ...field_mapping };
    if (explicit.size && explicit.parents) {
      resolvedFieldMapping = explicit;
      return resolvedFieldMapping;
    }
    // Detect missing pieces via /field.
    let allFields;
    try {
      allFields = await client.fields();
    } catch {
      // /field may not be accessible; fall back to whatever was explicit.
      resolvedFieldMapping = explicit;
      return resolvedFieldMapping;
    }
    const byName = Object.fromEntries((allFields ?? []).map((f) => [f.name, f.id]));
    for (const [role, candidates] of Object.entries(FIELD_CONVENTIONS)) {
      if (explicit[role]) continue;
      const hit = candidates.find((name) => byName[name]);
      if (hit) explicit[role] = byName[hit];
    }
    resolvedFieldMapping = explicit;
    return resolvedFieldMapping;
  }

  return {
    /**
     * Phase 1 + Phase 5: confirm credentials, validate JQL, and (if a
     * status_mapping is configured) confirm every mapped destination is a
     * real Jira status. Throws an aggregate error listing all failures.
     */
    async healthcheck() {
      const failures = [];

      // Auth check (always).
      try {
        await client.myself();
      } catch (err) {
        failures.push(`auth: ${err.message}`);
        // If auth fails, the rest of the checks will also fail — bail early.
        throw new Error(`Jira healthcheck failed: ${failures.join("; ")}`);
      }

      // JQL syntax check via a minimal dry-run. Some Jira tenants reject
      // maxResults: 0 ("max results parameter has to be between 1 and 5,000")
      // even though it's documented as legal — so we ask for 1 and ignore
      // any issue that comes back.
      try {
        await client.request("POST", "/search/jql", {
          body: { jql, maxResults: 1 },
        });
      } catch (err) {
        failures.push(`jql: ${err.message}`);
      }

      // Status mapping check.
      const customMappings = Object.entries(status_mapping ?? {});
      if (customMappings.length > 0) {
        try {
          const statuses = await client.statuses();
          const known = new Set((statuses ?? []).map((s) => s.name));
          for (const [shipwrightStatus, jiraStatusName] of customMappings) {
            if (!known.has(jiraStatusName)) {
              failures.push(
                `status_mapping.${shipwrightStatus}: "${jiraStatusName}" is not a known Jira status in this instance`,
              );
            }
          }
        } catch (err) {
          // /status may not be accessible — surface as a soft warning, not a hard fail.
          // (Don't push to failures; let the call proceed.)
        }
      }

      if (failures.length > 0) {
        throw new Error(`Jira healthcheck failed: ${failures.join("; ")}`);
      }
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

    /**
     * Phase 3: propagate a Shipwright status change back to Jira.
     *
     * - If the status is in effectiveStatusMapping → fetch available
     *   transitions for the issue, find the one whose destination matches
     *   the mapped Jira status name, POST the transition.
     * - Otherwise → post a comment recording the status change. Middle
     *   states (sliced, built, integrated, tested, reviewed) take this
     *   path by default since they're Shipwright bookkeeping that doesn't
     *   have a meaningful Jira workflow analog.
     *
     * The comment fallback is also taken if a mapped transition is
     * configured but isn't reachable from the issue's current state
     * (Jira workflows are state-dependent). In that case we surface a
     * warning comment + throw, because silently swallowing a failed
     * transition would be confusing.
     */
    async markStatus(itemId, status) {
      if (!itemId) throw new Error("@shipwrights/source-jira: markStatus needs an itemId");
      if (!status) throw new Error("@shipwrights/source-jira: markStatus needs a status");

      const targetJiraStatus = effectiveStatusMapping[status];
      if (!targetJiraStatus) {
        // Middle state — post a comment, no transition.
        await client.comment(
          itemId,
          adfParagraph(`Shipwrights moved this issue to status: ${status}`),
        );
        return { transitioned: false, commented: true };
      }

      const transitions = await client.getTransitions(itemId);
      const match = transitions.find(
        (t) => t.to?.name === targetJiraStatus || t.name === targetJiraStatus,
      );
      if (!match) {
        const available = transitions.map((t) => t.to?.name ?? t.name).filter(Boolean);
        throw new Error(
          `@shipwrights/source-jira: cannot transition ${itemId} to "${targetJiraStatus}" — not reachable from current state. ` +
            `Available transitions: [${available.join(", ")}]. ` +
            `Either change status_mapping.${status} or move the issue manually first.`,
        );
      }
      await client.transition(itemId, match.id);
      return { transitioned: true, transitionId: match.id, targetStatus: targetJiraStatus };
    },

    /**
     * Phase 4: append a "Shipped via <prUrl>" comment with a clickable
     * link to the issue. Uses adfParagraphWithLink so Jira renders the
     * URL as a real link, not plain text.
     */
    async attachPR(itemId, prUrl) {
      if (!itemId) throw new Error("@shipwrights/source-jira: attachPR needs an itemId");
      if (!prUrl) throw new Error("@shipwrights/source-jira: attachPR needs a prUrl");
      const adf = adfParagraphWithLink("Shipped via ", prUrl);
      await client.comment(itemId, adf);
      return { commented: true, prUrl };
    },

    /**
     * Phase 5: expose the resolved field mapping for diagnostics and tests.
     * Calls /field on first use to auto-detect Story Points / Epic Link
     * if the consumer didn't provide them in config. Cached after first
     * resolution.
     */
    async getFieldMapping() {
      return getFieldMapping();
    },

    /**
     * v0.5: return the authenticated user's accountId + displayName.
     * Cached after first call. Used by the loop to detect when a ticket
     * is assigned to someone *other* than the authenticated user.
     */
    async currentUser() {
      if (!currentUserCache) {
        const me = await client.myself();
        currentUserCache = {
          accountId: me.accountId,
          displayName: me.displayName,
          email: me.emailAddress,
        };
      }
      return currentUserCache;
    },

    /**
     * v0.5: self-assign a ticket. Used by the loop's "0 candidates"
     * fallback when the user picks one of the unassigned tickets to
     * claim before driving it through the pipeline.
     */
    async assignToCurrentUser(itemId) {
      if (!itemId) throw new Error("@shipwrights/source-jira: assignToCurrentUser needs an itemId");
      const me = await this.currentUser();
      await client.assignIssue(itemId, me.accountId);
      return { assigned: true, accountId: me.accountId, displayName: me.displayName };
    },
  };
}

// @shipwrights/core's source-loader accepts default export as the factory too.
export default createSource;
