// ADF (Atlassian Document Format) → markdown converter.
//
// Handles the 80% of ADF nodes that show up in a normal Jira issue
// description: paragraphs, headings, bullet / ordered lists, code blocks,
// blockquotes, horizontal rules, links, inline cards, mentions, emoji.
//
// Unsupported nodes (tables, panels, status pills, expand/collapse, dates,
// embeds) emit an HTML comment so the consumer sees what was dropped without
// the document falling apart silently. Tables are common enough to flag, but
// implementing them well needs row/header logic that doesn't earn its keep
// for a v1.
//
// Marks (inline text formatting) handled: strong, em, code, strike, link.
// Underline and subsup render as plain text (no clean markdown equivalent).

const UNSUPPORTED_NODES = new Set([
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "panel",
  "expand",
  "nestedExpand",
  "status",
  "date",
  "mediaGroup",
  "mediaSingle",
  "media",
  "embedCard",
  "decisionList",
  "decisionItem",
  "taskList",
  "taskItem",
]);

/**
 * Convert an ADF root document to markdown.
 *
 * @param {object | null | undefined} adf - the document; usually fields.description from a Jira issue
 * @returns {string} markdown (empty string for null/undefined)
 */
export function adfToMarkdown(adf) {
  if (!adf) return "";
  if (typeof adf === "string") return adf; // already plain text
  if (adf.type !== "doc") {
    // Some endpoints return a single node — handle gracefully.
    return renderNode(adf, { listDepth: 0 }).trim();
  }
  const out = renderChildren(adf.content ?? [], { listDepth: 0 }, "\n\n").trim();
  return out;
}

function renderChildren(nodes, ctx, separator = "") {
  if (!Array.isArray(nodes)) return "";
  return nodes
    .map((n) => renderNode(n, ctx))
    .filter((s) => s !== "")
    .join(separator);
}

function renderNode(node, ctx) {
  if (!node || typeof node !== "object") return "";
  const type = node.type;
  switch (type) {
    case "text":
      return renderTextWithMarks(node);
    case "paragraph":
      return renderChildren(node.content ?? [], ctx);
    case "hardBreak":
      return "  \n"; // markdown line break: two spaces + newline
    case "heading":
      return renderHeading(node, ctx);
    case "bulletList":
      return renderList(node, ctx, "-");
    case "orderedList":
      return renderList(node, ctx, "1.");
    case "listItem":
      return renderChildren(node.content ?? [], ctx, "\n");
    case "codeBlock":
      return renderCodeBlock(node);
    case "blockquote":
      return renderBlockquote(node, ctx);
    case "rule":
      return "---";
    case "inlineCard":
      return renderInlineCard(node);
    case "mention":
      return renderMention(node);
    case "emoji":
      return renderEmoji(node);
    default:
      if (UNSUPPORTED_NODES.has(type)) {
        return `<!-- unsupported ADF node: ${type} -->`;
      }
      // Unknown node — try to render children, fall back to a comment
      if (Array.isArray(node.content) && node.content.length > 0) {
        return renderChildren(node.content, ctx);
      }
      return `<!-- unknown ADF node: ${type} -->`;
  }
}

function renderTextWithMarks(node) {
  let text = node.text ?? "";
  if (!text) return "";
  const marks = node.marks ?? [];
  for (const mark of marks) {
    text = applyMark(text, mark);
  }
  return text;
}

function applyMark(text, mark) {
  switch (mark.type) {
    case "strong":
      return `**${text}**`;
    case "em":
      return `*${text}*`;
    case "code":
      return `\`${text}\``;
    case "strike":
      return `~~${text}~~`;
    case "link": {
      const href = mark.attrs?.href ?? "";
      return `[${text}](${href})`;
    }
    case "underline":
      // No native markdown for underline. Render as text + comment so consumers
      // can spot if they want to add it back via HTML.
      return text;
    case "subsup":
      return text;
    default:
      return text;
  }
}

function renderHeading(node, ctx) {
  const level = Math.min(Math.max(node.attrs?.level ?? 1, 1), 6);
  const inner = renderChildren(node.content ?? [], ctx);
  return `${"#".repeat(level)} ${inner}`;
}

function renderList(node, ctx, marker) {
  const childCtx = { ...ctx, listDepth: ctx.listDepth + 1 };
  const indent = "  ".repeat(ctx.listDepth);
  return (node.content ?? [])
    .map((item) => {
      const inner = renderChildren(item.content ?? [], childCtx, "\n");
      const lines = inner.split("\n");
      const first = lines.shift() ?? "";
      // Continuation lines: only add the +2 indent for plain text. Lines
      // that already start with whitespace are nested-list output that
      // self-indents at the correct depth.
      const rest = lines.map((l) => {
        if (l === "" || /^\s/.test(l)) return l;
        return `${indent}  ${l}`;
      });
      return `${indent}${marker} ${first}${rest.length > 0 ? `\n${rest.join("\n")}` : ""}`;
    })
    .join("\n");
}

function renderCodeBlock(node) {
  const lang = node.attrs?.language ?? "";
  const content = (node.content ?? [])
    .map((c) => c.text ?? "")
    .join("");
  return `\`\`\`${lang}\n${content}\n\`\`\``;
}

function renderBlockquote(node, ctx) {
  const inner = renderChildren(node.content ?? [], ctx, "\n\n");
  return inner
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function renderInlineCard(node) {
  const url = node.attrs?.url ?? "";
  return url ? `[${url}](${url})` : "";
}

function renderMention(node) {
  const text = node.attrs?.text ?? node.attrs?.id ?? "user";
  return text.startsWith("@") ? text : `@${text}`;
}

function renderEmoji(node) {
  return node.attrs?.text ?? node.attrs?.shortName ?? "";
}
