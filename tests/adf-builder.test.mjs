import { test } from "node:test";
import assert from "node:assert/strict";
import { adfParagraph, adfParagraphWithLink } from "../src/adf-builder.mjs";

test("adfParagraph wraps plain text in a doc with one paragraph", () => {
  const doc = adfParagraph("Hello world");
  assert.equal(doc.type, "doc");
  assert.equal(doc.version, 1);
  assert.equal(doc.content.length, 1);
  assert.equal(doc.content[0].type, "paragraph");
  assert.deepEqual(doc.content[0].content, [{ type: "text", text: "Hello world" }]);
});

test("adfParagraph turns newlines into hardBreak nodes", () => {
  const doc = adfParagraph("line one\nline two\nline three");
  const inner = doc.content[0].content;
  // Expect: text, hardBreak, text, hardBreak, text
  assert.equal(inner.length, 5);
  assert.equal(inner[0].type, "text");
  assert.equal(inner[0].text, "line one");
  assert.equal(inner[1].type, "hardBreak");
  assert.equal(inner[2].text, "line two");
  assert.equal(inner[3].type, "hardBreak");
  assert.equal(inner[4].text, "line three");
});

test("adfParagraph handles empty input", () => {
  const doc = adfParagraph("");
  assert.equal(doc.content[0].content.length, 0);
});

test("adfParagraphWithLink emits a link mark on the URL text", () => {
  const doc = adfParagraphWithLink("Shipped via ", "https://github.com/foo/bar/pull/1");
  const inner = doc.content[0].content;
  assert.equal(inner.length, 2);
  assert.equal(inner[0].type, "text");
  assert.equal(inner[0].text, "Shipped via ");
  assert.equal(inner[1].type, "text");
  assert.equal(inner[1].text, "https://github.com/foo/bar/pull/1");
  assert.deepEqual(inner[1].marks, [
    { type: "link", attrs: { href: "https://github.com/foo/bar/pull/1" } },
  ]);
});

test("adfParagraphWithLink allows custom link text", () => {
  const doc = adfParagraphWithLink("See ", "https://example.com", "the PR");
  const inner = doc.content[0].content;
  assert.equal(inner[1].text, "the PR");
  assert.equal(inner[1].marks[0].attrs.href, "https://example.com");
});

test("adfParagraphWithLink works with no prefix", () => {
  const doc = adfParagraphWithLink("", "https://example.com");
  const inner = doc.content[0].content;
  assert.equal(inner.length, 1);
  assert.equal(inner[0].text, "https://example.com");
});
