// Translate the noisy error shapes Jira / fetch surface into actionable
// one-liners for humans. Used by the init wizard so a 401 doesn't just
// say "401 Unauthorized" — it says what to do next.

const TOKEN_URL = "https://id.atlassian.com/manage-profile/security/api-tokens";

export function translateConnectError(err, { host, email } = {}) {
  const cause = err?.cause;
  const code = cause?.code ?? err?.code;

  // ----- network-level failures -----
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return [
      `Hostname "${host}" doesn't resolve.`,
      `Check the subdomain — it's whatever comes before .atlassian.net in the URL you use to access Jira in the browser.`,
    ].join("\n  ");
  }
  if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ECONNRESET") {
    return `Couldn't reach ${host} (${code}). Check your network / proxy.`;
  }
  if (code === "CERT_HAS_EXPIRED" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
    return `TLS error connecting to ${host} (${code}). Likely a corporate proxy intercepting HTTPS.`;
  }

  // ----- HTTP-level failures -----
  const status = err?.status;
  const body = err?.body;

  if (status === 404) {
    // Atlassian's "tenant doesn't exist" response.
    if (body?.errorCode === "OTHER" || /site temporarily unavailable/i.test(body?.errorMessage ?? "")) {
      return [
        `Jira tenant "${host}" not found.`,
        `Atlassian returned a generic 404 — this usually means the subdomain is wrong.`,
        `Check the URL you use to access Jira in the browser; use whatever comes before .atlassian.net.`,
      ].join("\n  ");
    }
    return `Jira endpoint not found at ${host} (404).`;
  }

  if (status === 401) {
    return [
      `Token rejected by Jira.`,
      `Most likely causes:`,
      `  • The email "${email ?? "(none)"}" doesn't match your Atlassian account email.`,
      `  • The token is wrong, revoked, or has expired.`,
      `  • You created a "scoped" token — those don't work with Basic auth. Use a classic API token from ${TOKEN_URL}.`,
    ].join("\n  ");
  }

  if (status === 403) {
    return `Token authenticated but the account isn't allowed to access this resource (403). Ask a Jira admin to grant the needed permission, or use a different account.`;
  }

  if (status === 429) {
    return `Jira rate-limited the request (429). Wait a minute and try again.`;
  }

  // Fallback: surface what the client already gave us.
  return err?.message ?? String(err);
}

export const TOKEN_GENERATION_URL = TOKEN_URL;
