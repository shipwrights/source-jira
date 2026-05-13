// Thin Jira Cloud REST API v3 client.
//
// Uses native fetch + Basic auth (email + API token). No external HTTP dep.
// Exposes the few endpoints Phase 1 needs:
//
//   client.myself()                    -> GET /rest/api/3/myself
//   client.searchJql({ jql, fields })  -> POST /rest/api/3/search/jql (paginates)
//
// Later phases extend this with:
//   client.transitions(issueKey), client.transition(issueKey, transitionId)
//   client.comment(issueKey, adf)
//   client.issue(issueKey)

const API_BASE = "/rest/api/3";

class JiraClientError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "JiraClientError";
    this.status = status;
    this.body = body;
  }
}

export function createClient({ host, email, token, fetch: fetchImpl = fetch } = {}) {
  if (!host) throw new Error("Jira client: host is required (e.g. 'myorg.atlassian.net')");
  if (!email) throw new Error("Jira client: email is required");
  if (!token) throw new Error("Jira client: token is required (API token from id.atlassian.com)");

  const baseUrl = `https://${host}${API_BASE}`;
  const authHeader = `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;

  async function request(method, path, { body, query } = {}) {
    const url = new URL(`${baseUrl}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    const response = await fetchImpl(url.toString(), {
      method,
      headers: {
        Accept: "application/json",
        Authorization: authHeader,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      let errorBody = null;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text().catch(() => null);
      }
      const message = errorBodySummary(errorBody) ?? response.statusText;
      throw new JiraClientError(
        `Jira ${method} ${path} failed: ${response.status} ${message}`,
        response.status,
        errorBody,
      );
    }

    if (response.status === 204) return null;
    return response.json();
  }

  return {
    /** Confirm credentials are valid. Returns the authenticated user. */
    myself() {
      return request("GET", "/myself");
    },

    /**
     * Paginate through JQL search results. Returns an async iterator yielding
     * issues. Uses POST /search/jql with nextPageToken cursor pagination.
     *
     * @param {{ jql: string, fields?: string[], maxResults?: number, fieldsByKeys?: boolean }} opts
     */
    async *searchJql({ jql, fields, maxResults = 50, fieldsByKeys = false }) {
      if (!jql) throw new Error("searchJql requires a `jql` string");
      let nextPageToken;
      while (true) {
        const payload = {
          jql,
          maxResults,
          fieldsByKeys,
          ...(fields ? { fields } : {}),
          ...(nextPageToken ? { nextPageToken } : {}),
        };
        const page = await request("POST", "/search/jql", { body: payload });
        for (const issue of page.issues ?? []) {
          yield issue;
        }
        if (page.isLast || !page.nextPageToken) break;
        nextPageToken = page.nextPageToken;
      }
    },

    /**
     * Convenience wrapper: collect all paginated results into an array.
     */
    async searchJqlAll(opts) {
      const out = [];
      for await (const issue of this.searchJql(opts)) out.push(issue);
      return out;
    },

    /**
     * Get a single issue by key or id, including its full description (which
     * search responses don't return). Used by materialize().
     *
     * @param {string} issueKeyOrId
     * @param {{ fields?: string[], expand?: string }} opts
     */
    getIssue(issueKeyOrId, { fields, expand } = {}) {
      const query = {};
      if (Array.isArray(fields) && fields.length > 0) query.fields = fields.join(",");
      if (expand) query.expand = expand;
      return request("GET", `/issue/${encodeURIComponent(issueKeyOrId)}`, { query });
    },

    /**
     * List available transitions for an issue at its current status. Used by
     * markStatus() to resolve a destination status name to a transition id.
     */
    async getTransitions(issueKeyOrId) {
      const body = await request(
        "GET",
        `/issue/${encodeURIComponent(issueKeyOrId)}/transitions`,
      );
      return body?.transitions ?? [];
    },

    /**
     * Perform a transition by id. Returns null on 204 success.
     */
    transition(issueKeyOrId, transitionId, { fields, update } = {}) {
      return request(
        "POST",
        `/issue/${encodeURIComponent(issueKeyOrId)}/transitions`,
        {
          body: {
            transition: { id: String(transitionId) },
            ...(fields ? { fields } : {}),
            ...(update ? { update } : {}),
          },
        },
      );
    },

    /**
     * Post a comment on an issue. Body must be ADF (Atlassian Document
     * Format); use adfParagraph() from src/index.mjs for short messages.
     */
    comment(issueKeyOrId, adfBody) {
      return request(
        "POST",
        `/issue/${encodeURIComponent(issueKeyOrId)}/comment`,
        { body: { body: adfBody } },
      );
    },

    /**
     * List all custom + standard fields. Used by field mapping
     * auto-detection (Phase 5) to find "Story Points" / "Epic Link".
     */
    fields() {
      return request("GET", "/field");
    },

    /**
     * List all statuses defined in the Jira instance. Used by
     * healthcheck() (Phase 5) to validate the configured status_mapping
     * resolves to real Jira statuses.
     */
    statuses() {
      return request("GET", "/status");
    },

    /**
     * Low-level escape hatch. Useful for tests and for endpoints not yet
     * added to this client.
     */
    request,
  };
}

function errorBodySummary(body) {
  if (!body) return null;
  if (typeof body === "string") return body.slice(0, 200);
  // Jira error shapes:
  //   { errorMessages: ["..."], errors: { field: "..." } }
  //   { message: "...", warningMessages: [...] }
  if (Array.isArray(body.errorMessages) && body.errorMessages.length > 0) {
    return body.errorMessages.join("; ");
  }
  if (body.errors && typeof body.errors === "object") {
    return Object.entries(body.errors)
      .map(([field, msg]) => `${field}: ${msg}`)
      .join("; ");
  }
  if (body.message) return body.message;
  return JSON.stringify(body).slice(0, 200);
}

export { JiraClientError };
