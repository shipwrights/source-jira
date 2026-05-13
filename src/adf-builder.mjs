// Minimal ADF (Atlassian Document Format) builders.
//
// Used by markStatus's middle-state comments and attachPR's PR-link comment.
// We're only writing short, paragraph-level content here — anything more
// complex (lists, code blocks, etc.) would warrant a fuller builder.
//
// ADF reference: https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/

/**
 * Build a minimal ADF doc with a single paragraph of plain text. The text
 * is split on \n so newlines render as hard-break nodes within one paragraph
 * (Jira renders this as visual newlines).
 *
 * @param {string} text
 * @returns {{ type: "doc", version: 1, content: any[] }}
 */
export function adfParagraph(text) {
  const segments = String(text ?? "").split(/\r?\n/);
  const content = [];
  segments.forEach((seg, idx) => {
    if (seg.length > 0) {
      content.push({ type: "text", text: seg });
    }
    if (idx < segments.length - 1) {
      content.push({ type: "hardBreak" });
    }
  });
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content,
      },
    ],
  };
}

/**
 * Build an ADF paragraph containing a link. Useful for attachPR — the PR
 * URL renders as a clickable link in Jira.
 *
 * @param {string} prefix - text before the link (e.g. "Shipped via ")
 * @param {string} url
 * @param {string} [linkText] - what the link says; defaults to the URL itself
 */
export function adfParagraphWithLink(prefix, url, linkText) {
  const content = [];
  if (prefix) content.push({ type: "text", text: prefix });
  content.push({
    type: "text",
    text: linkText ?? url,
    marks: [{ type: "link", attrs: { href: url } }],
  });
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content,
      },
    ],
  };
}
