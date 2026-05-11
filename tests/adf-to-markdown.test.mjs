import { test } from "node:test";
import assert from "node:assert/strict";
import { adfToMarkdown } from "../src/adf-to-markdown.mjs";

const doc = (...content) => ({ type: "doc", version: 1, content });
const p = (...content) => ({ type: "paragraph", content });
const t = (text, marks) => ({ type: "text", text, ...(marks ? { marks } : {}) });

test("empty / null doc returns empty string", () => {
  assert.equal(adfToMarkdown(null), "");
  assert.equal(adfToMarkdown(undefined), "");
  assert.equal(adfToMarkdown(doc()), "");
});

test("single paragraph of text", () => {
  const md = adfToMarkdown(doc(p(t("Hello world"))));
  assert.equal(md, "Hello world");
});

test("two paragraphs separate with a blank line", () => {
  const md = adfToMarkdown(doc(p(t("First.")), p(t("Second."))));
  assert.equal(md, "First.\n\nSecond.");
});

test("text marks: bold, italic, code, strike, link", () => {
  const md = adfToMarkdown(
    doc(
      p(
        t("normal "),
        t("bold", [{ type: "strong" }]),
        t(" "),
        t("italic", [{ type: "em" }]),
        t(" "),
        t("inline-code", [{ type: "code" }]),
        t(" "),
        t("strike", [{ type: "strike" }]),
        t(" "),
        t("a link", [{ type: "link", attrs: { href: "https://example.com" } }]),
      ),
    ),
  );
  assert.equal(
    md,
    "normal **bold** *italic* `inline-code` ~~strike~~ [a link](https://example.com)",
  );
});

test("headings respect level (clamped 1..6)", () => {
  const md = adfToMarkdown(
    doc(
      { type: "heading", attrs: { level: 1 }, content: [t("H1")] },
      { type: "heading", attrs: { level: 3 }, content: [t("H3")] },
      { type: "heading", attrs: { level: 9 }, content: [t("H-too-deep")] },
    ),
  );
  assert.match(md, /^# H1$/m);
  assert.match(md, /^### H3$/m);
  assert.match(md, /^###### H-too-deep$/m);
});

test("bullet list renders with - markers", () => {
  const md = adfToMarkdown(
    doc({
      type: "bulletList",
      content: [
        { type: "listItem", content: [p(t("alpha"))] },
        { type: "listItem", content: [p(t("beta"))] },
        { type: "listItem", content: [p(t("gamma"))] },
      ],
    }),
  );
  assert.equal(md, "- alpha\n- beta\n- gamma");
});

test("ordered list renders with 1. markers", () => {
  const md = adfToMarkdown(
    doc({
      type: "orderedList",
      content: [
        { type: "listItem", content: [p(t("first"))] },
        { type: "listItem", content: [p(t("second"))] },
      ],
    }),
  );
  assert.equal(md, "1. first\n1. second");
});

test("nested bullet list indents", () => {
  const md = adfToMarkdown(
    doc({
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            p(t("outer")),
            {
              type: "bulletList",
              content: [
                { type: "listItem", content: [p(t("inner-a"))] },
                { type: "listItem", content: [p(t("inner-b"))] },
              ],
            },
          ],
        },
      ],
    }),
  );
  assert.match(md, /- outer/);
  assert.match(md, /\n {2}- inner-a/);
  assert.match(md, /\n {2}- inner-b/);
});

test("code block with language fence", () => {
  const md = adfToMarkdown(
    doc({
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [t("const x: number = 1;")],
    }),
  );
  assert.equal(md, "```ts\nconst x: number = 1;\n```");
});

test("code block without language", () => {
  const md = adfToMarkdown(
    doc({
      type: "codeBlock",
      content: [t("plain text")],
    }),
  );
  assert.equal(md, "```\nplain text\n```");
});

test("blockquote prefixes each line with >", () => {
  const md = adfToMarkdown(
    doc({
      type: "blockquote",
      content: [p(t("quoted line one")), p(t("quoted line two"))],
    }),
  );
  assert.match(md, /^> quoted line one$/m);
  assert.match(md, /^> quoted line two$/m);
});

test("rule renders as ---", () => {
  const md = adfToMarkdown(doc({ type: "rule" }));
  assert.equal(md, "---");
});

test("hardBreak renders as markdown line break", () => {
  const md = adfToMarkdown(doc(p(t("line one"), { type: "hardBreak" }, t("line two"))));
  assert.match(md, /line one  \nline two/);
});

test("inlineCard becomes a markdown link", () => {
  const md = adfToMarkdown(
    doc(p(t("see "), { type: "inlineCard", attrs: { url: "https://example.com/x" } })),
  );
  assert.match(md, /\[https:\/\/example\.com\/x\]\(https:\/\/example\.com\/x\)/);
});

test("mention renders as @name", () => {
  const md = adfToMarkdown(
    doc(p(t("ping "), { type: "mention", attrs: { text: "@ada" } })),
  );
  assert.match(md, /ping @ada/);
});

test("emoji renders its text", () => {
  const md = adfToMarkdown(
    doc(p(t("status "), { type: "emoji", attrs: { text: "✅", shortName: ":check:" } })),
  );
  assert.match(md, /status ✅/);
});

test("unsupported nodes emit an HTML comment placeholder", () => {
  const md = adfToMarkdown(
    doc(p(t("see table:")), {
      type: "table",
      content: [],
    }),
  );
  assert.match(md, /<!-- unsupported ADF node: table -->/);
});

test("unknown node tries to render children, else emits a comment", () => {
  const md = adfToMarkdown(
    doc({ type: "futureWidget", content: [p(t("falls back to children"))] }),
  );
  assert.match(md, /falls back to children/);
  const md2 = adfToMarkdown(doc({ type: "futureWidget", content: [] }));
  assert.match(md2, /<!-- unknown ADF node: futureWidget -->/);
});

test("real-world Jira issue description renders coherently", () => {
  const md = adfToMarkdown({
    type: "doc",
    version: 1,
    content: [
      p(t("Customers need bulk submit. Today: one-at-a-time.")),
      { type: "heading", attrs: { level: 2 }, content: [t("Acceptance")] },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              p(
                t("POST "),
                t("/api/orders/bulk", [{ type: "code" }]),
                t(" accepts an array of up to 100 orders."),
              ),
            ],
          },
          {
            type: "listItem",
            content: [p(t("Partial failures return per-row error envelope."))],
          },
        ],
      },
    ],
  });
  assert.match(md, /Customers need bulk submit/);
  assert.match(md, /^## Acceptance$/m);
  assert.match(md, /- POST `\/api\/orders\/bulk` accepts/);
});
