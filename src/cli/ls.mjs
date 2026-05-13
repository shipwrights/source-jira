import { stdout } from "node:process";
import { createSource } from "../index.mjs";
import { loadConfig } from "./loadConfig.mjs";

export async function runLs({ limit } = {}) {
  const config = loadConfig();
  stdout.write(`config: ${config.host}  ·  ${config.jql}\n\n`);

  const source = createSource(config);
  const items = await source.listAvailable();
  stdout.write(`${items.length} item(s):\n`);

  const shown = typeof limit === "number" ? items.slice(0, limit) : items;
  if (shown.length === 0) {
    stdout.write("  (none)\n");
    return;
  }

  // Column widths derived from the data so wide statuses don't overflow.
  const idW = Math.max(...shown.map((i) => i.id?.length ?? 0));
  const statusW = Math.max(
    ...shown.map((i) => (i.status ?? "?").length),
    6,
  );
  const priorityW = Math.max(
    ...shown.map((i) => (i.priority ?? "?").length),
    8,
  );
  const sizeW = Math.max(...shown.map((i) => (i.size ?? "-").length), 6);

  for (const item of shown) {
    stdout.write(
      `  ${(item.id ?? "?").padEnd(idW)}  ` +
        `[${(item.status ?? "?").padEnd(statusW)} | ` +
        `${(item.priority ?? "?").padEnd(priorityW)} | ` +
        `${(item.size ?? "-").padEnd(sizeW)}]  ` +
        `${item.title ?? ""}\n`,
    );
  }
  if (typeof limit === "number" && items.length > limit) {
    stdout.write(`  ... and ${items.length - limit} more (use --limit 0 for all)\n`);
  }
}
