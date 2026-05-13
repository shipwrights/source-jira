// Minimal stub for Node 20+ `fetch` to drive the Jira client in tests.
//
// Usage:
//   const stub = createFetchStub();
//   stub.on("GET", "/rest/api/3/myself", { body: myselfJson });
//   stub.on("POST", "/rest/api/3/search/jql", (req) => ({ body: pageJson }));
//   const client = createClient({ host, email, token, fetch: stub.fetch });
//
// Handlers fire in registration order. Each handler matches once unless its
// returned value's `persist: true` is set. After running, `stub.assertExhausted()`
// asserts every handler was hit, or `stub.history` exposes recorded requests.

import assert from "node:assert/strict";

export function createFetchStub() {
  const handlers = [];
  const history = [];

  const stub = {
    on(method, pathPattern, response) {
      handlers.push({ method, pathPattern, response, used: false });
    },

    history,

    async fetch(url, init = {}) {
      const parsed = new URL(url);
      const path = parsed.pathname + parsed.search;
      const method = (init.method ?? "GET").toUpperCase();
      const query = Object.fromEntries(parsed.searchParams.entries());
      const requestRecord = {
        method,
        url,
        path,
        pathname: parsed.pathname,
        query,
        headers: init.headers ?? {},
        body: init.body ? JSON.parse(init.body) : undefined,
      };
      history.push(requestRecord);

      for (const handler of handlers) {
        if (handler.used && handler.response?.persist !== true) continue;
        if (handler.method !== method) continue;
        if (!pathMatches(handler.pathPattern, path)) continue;
        handler.used = true;
        const resolved = typeof handler.response === "function"
          ? handler.response(requestRecord)
          : handler.response;
        return buildResponse(resolved ?? {});
      }

      // No handler matched — fail loudly so tests catch unstubbed calls.
      throw new Error(
        `fetch-stub: no handler for ${method} ${path}\n  registered:\n` +
          handlers.map((h) => `    ${h.method} ${h.pathPattern}`).join("\n"),
      );
    },

    assertExhausted() {
      const unused = handlers.filter(
        (h) => !h.used && h.response?.persist !== true,
      );
      assert.equal(
        unused.length,
        0,
        `fetch-stub: ${unused.length} unused handlers: ${unused
          .map((h) => `${h.method} ${h.pathPattern}`)
          .join(", ")}`,
      );
    },
  };

  return stub;
}

function pathMatches(pattern, actual) {
  if (typeof pattern === "string") {
    // Allow "/foo" to match "/foo?query=bar"
    return actual === pattern || actual.startsWith(`${pattern}?`);
  }
  if (pattern instanceof RegExp) return pattern.test(actual);
  return false;
}

function buildResponse({ status = 200, body, headers = {} }) {
  const isJson = body !== undefined && typeof body !== "string";
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: statusText(status),
    headers: new Map(Object.entries(headers)),
    async json() {
      if (typeof body === "string") return JSON.parse(body);
      return body;
    },
    async text() {
      if (body === undefined || body === null) return "";
      return typeof body === "string" ? body : JSON.stringify(body);
    },
  };
}

function statusText(status) {
  const codes = {
    200: "OK", 201: "Created", 204: "No Content",
    400: "Bad Request", 401: "Unauthorized", 403: "Forbidden",
    404: "Not Found", 429: "Too Many Requests", 500: "Internal Server Error",
  };
  return codes[status] ?? "Unknown";
}
