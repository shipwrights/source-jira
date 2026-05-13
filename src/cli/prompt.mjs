// Minimal prompt helpers built on node:readline. No external deps.
//
// - prompt(question, { default, validate })   -> string
// - promptSecret(question)                    -> string (input hidden)
// - confirm(question, { default })            -> boolean (y/n)
// - choose(question, items, { default })      -> selected item

import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";

const CTRL_C = "";
const BACKSPACE = "";
const DEL = "";

export async function prompt(question, { default: def, validate } = {}) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    while (true) {
      const suffix = def !== undefined ? ` [${def}]` : "";
      const answer = await new Promise((resolve) =>
        rl.question(`${question}${suffix}: `, resolve),
      );
      const value =
        answer.trim() === "" && def !== undefined ? String(def) : answer.trim();
      if (validate) {
        const err = validate(value);
        if (err) {
          stdout.write(`  ${err}\n`);
          continue;
        }
      }
      return value;
    }
  } finally {
    rl.close();
  }
}

export async function promptSecret(question) {
  // Bypass readline so we don't echo characters. Read raw bytes until newline.
  stdout.write(`${question}: `);

  const wasRaw = stdin.isRaw === true;
  if (typeof stdin.setRawMode === "function") stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  let buf = "";
  return new Promise((resolve) => {
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          cleanup();
          stdout.write("\n");
          return resolve(buf);
        }
        if (ch === CTRL_C) {
          cleanup();
          stdout.write("\n");
          process.exit(130);
        }
        if (ch === BACKSPACE || ch === DEL) {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            stdout.write("\b \b");
          }
          continue;
        }
        if (ch < " ") continue; // ignore other control chars
        buf += ch;
        stdout.write("*");
      }
    };
    const cleanup = () => {
      stdin.removeListener("data", onData);
      if (typeof stdin.setRawMode === "function") stdin.setRawMode(wasRaw);
      stdin.pause();
    };
    stdin.on("data", onData);
  });
}

export async function confirm(question, { default: def = true } = {}) {
  const hint = def ? "Y/n" : "y/N";
  const ans = await prompt(`${question} [${hint}]`, {
    validate: (v) => {
      if (v === "") return null;
      if (!/^(y|n|yes|no)$/i.test(v)) return "Please answer y or n.";
      return null;
    },
  });
  if (ans === "") return def;
  return /^y/i.test(ans);
}

export async function choose(
  question,
  items,
  { default: defIndex = 0, format = (x) => x } = {},
) {
  if (items.length === 0) throw new Error("choose: items is empty");
  stdout.write(`${question}\n`);
  for (let i = 0; i < items.length; i++) {
    stdout.write(`  ${String(i + 1).padStart(2, " ")}) ${format(items[i])}\n`);
  }
  const ans = await prompt(`Pick a number`, {
    default: defIndex + 1,
    validate: (v) => {
      const n = Number.parseInt(v, 10);
      if (!Number.isInteger(n) || n < 1 || n > items.length) {
        return `Enter a number between 1 and ${items.length}.`;
      }
      return null;
    },
  });
  const idx = Number.parseInt(ans, 10) - 1;
  return items[idx];
}
