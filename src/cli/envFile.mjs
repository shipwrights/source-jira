// Merge a set of KEY=VALUE pairs into a .env-style file. Preserves existing
// keys we don't touch, updates ones we do, appends ones that are new.
//
// Format rules:
//   - One KEY=VALUE per line.
//   - Lines starting with # or blank lines are preserved verbatim.
//   - Values containing whitespace, #, or quotes are emitted wrapped in
//     double quotes; embedded " are backslash-escaped.

export function mergeEnv(existingContent, updates) {
  const out = [];
  const handled = new Set();
  const lines = (existingContent ?? "").split(/\r?\n/);

  for (const line of lines) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && Object.prototype.hasOwnProperty.call(updates, m[1])) {
      out.push(formatLine(m[1], updates[m[1]]));
      handled.add(m[1]);
    } else {
      out.push(line);
    }
  }

  // Strip a single trailing blank line (it'll be re-added when we join).
  while (out.length > 0 && out[out.length - 1] === "") out.pop();

  const additions = Object.entries(updates).filter(([k]) => !handled.has(k));
  if (additions.length > 0) {
    if (out.length > 0) out.push("");
    for (const [k, v] of additions) out.push(formatLine(k, v));
  }

  return out.join("\n") + "\n";
}

function formatLine(key, value) {
  const v = String(value ?? "");
  if (/[\s#"'`$\\]/.test(v) || v === "") {
    return `${key}="${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return `${key}=${v}`;
}
