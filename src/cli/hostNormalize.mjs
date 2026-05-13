// Normalise whatever a user pastes into a clean atlassian.net host.
//
// Inputs we accept and what we produce:
//   "amali-tech"                            -> "amali-tech.atlassian.net"
//   "amali-tech.atlassian.net"              -> "amali-tech.atlassian.net"
//   "https://amali-tech.atlassian.net"      -> "amali-tech.atlassian.net"
//   "https://amali-tech.atlassian.net/jira" -> "amali-tech.atlassian.net"
//   "   foo  "                              -> "foo.atlassian.net"
//
// Throws on empty input or obviously broken values.

export function normalizeHost(raw) {
  if (typeof raw !== "string") throw new Error("Jira host is required");
  let s = raw.trim().toLowerCase();
  if (!s) throw new Error("Jira host is required");

  // Strip protocol.
  s = s.replace(/^https?:\/\//, "");
  // Strip trailing slash + any path.
  s = s.split("/")[0];
  // Strip ports — atlassian.net is always 443.
  s = s.split(":")[0];

  if (!s) throw new Error("Jira host is required");

  // If they gave a single word, assume it's the tenant slug.
  if (!s.includes(".")) {
    return `${s}.atlassian.net`;
  }
  return s;
}
