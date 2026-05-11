// @shipwrights/source-jira — entry point.
//
// Implements the BacklogSource interface from @shipwrights/core:
//
//   { healthcheck, listAvailable, pickNext, materialize, markStatus, attachPR }
//
// Phase 1 ships healthcheck + listAvailable + pickNext. The remaining three
// land in Phases 2–4.

import { createClient } from "./client.mjs";
import { validateJql, fieldsForSearch } from "./jql.mjs";

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
     * Phases 2–4: not yet implemented. Each throws a clear error rather than
     * silently no-oping, so consumers know they're on a Phase 1 release.
     */
    async materialize(_item, _targetDir) {
      throw new Error(
        "@shipwrights/source-jira: materialize() lands in Phase 2 (next release). Use listAvailable() / pickNext() for now and materialise epic files by hand.",
      );
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
