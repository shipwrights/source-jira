// JQL helpers. Two responsibilities for now:
//
// 1. Light validation — surface obvious mistakes (empty string, mismatched
//    quotes) before sending to Jira. Jira's 400 messages are useful but a
//    cheap pre-check makes /shipwright:doctor output more actionable.
//
// 2. Field-list resolution — given the consumer's `field_mapping` config,
//    produce the `fields` array we ask Jira to return so we don't pull the
//    full issue payload (each issue is ~10kb of irrelevant data otherwise).

const ALWAYS_REQUESTED_FIELDS = [
  "summary",
  "status",
  "priority",
  "issuetype",
  "labels",
  "components",
  "assignee",
  "reporter",
  "created",
  "updated",
];

/**
 * Cheap structural validation. Throws on obvious errors. Returns the JQL
 * unchanged on success.
 */
export function validateJql(jql) {
  if (typeof jql !== "string") {
    throw new Error("JQL must be a string");
  }
  const trimmed = jql.trim();
  if (trimmed.length === 0) {
    throw new Error("JQL is empty");
  }
  if (countUnescaped(trimmed, '"') % 2 !== 0) {
    throw new Error(`JQL has unbalanced double quotes: ${trimmed}`);
  }
  if (countUnescaped(trimmed, "'") % 2 !== 0) {
    throw new Error(`JQL has unbalanced single quotes: ${trimmed}`);
  }
  const opens = (trimmed.match(/\(/g) ?? []).length;
  const closes = (trimmed.match(/\)/g) ?? []).length;
  if (opens !== closes) {
    throw new Error(`JQL has unbalanced parentheses (${opens} open, ${closes} close): ${trimmed}`);
  }
  return trimmed;
}

function countUnescaped(s, char) {
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === char && s[i - 1] !== "\\") count++;
  }
  return count;
}

/**
 * Compute the field list we request from Jira's search endpoint. Pulls only
 * what the adapter needs, including any custom-field IDs from the consumer's
 * field_mapping config.
 */
export function fieldsForSearch({ fieldMapping = {} } = {}) {
  const fields = new Set(ALWAYS_REQUESTED_FIELDS);
  // The mapping values may be `customfield_NNNNN` IDs or standard field
  // names. Either way we ask for them.
  for (const value of Object.values(fieldMapping)) {
    if (typeof value === "string" && value.length > 0) fields.add(value);
  }
  return [...fields];
}
