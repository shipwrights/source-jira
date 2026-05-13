import { stdout } from "node:process";
import { createSource } from "../index.mjs";
import { loadConfig } from "./loadConfig.mjs";

export async function runPick() {
  const config = loadConfig();
  stdout.write(`config: ${config.host}  ·  ${config.jql}\n\n`);

  const source = createSource(config);
  const item = await source.pickNext();
  if (!item) {
    stdout.write("(no items match — backlog is empty under current JQL)\n");
    return;
  }

  stdout.write(`${item.id}  ·  ${item.title}\n`);
  stdout.write(`  status:   ${item.status ?? "-"}\n`);
  stdout.write(`  priority: ${item.priority ?? "-"}\n`);
  stdout.write(`  size:     ${item.size ?? "-"}\n`);
  const parents =
    Array.isArray(item.parents) && item.parents.length > 0
      ? item.parents.join(", ")
      : "none";
  stdout.write(`  parents:  ${parents}\n`);
}
