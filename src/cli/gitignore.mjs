// Add entries to a .gitignore file, idempotently.
// - Preserves the existing file verbatim.
// - Skips entries that already match (literal or trimmed).
// - Appends new entries under a "# Shipwrights" comment block.

export function mergeGitignore(existingContent, entries) {
  const existing = (existingContent ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  const missing = entries.filter((e) => !existing.includes(e));
  if (missing.length === 0) return null; // nothing to write

  let head = (existingContent ?? "").replace(/\s+$/, "");
  if (head.length > 0) head += "\n\n";

  const block = ["# Shipwrights", ...missing].join("\n");
  return head + block + "\n";
}
