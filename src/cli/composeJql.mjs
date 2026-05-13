// Compose a final JQL string from the scope choices the init wizard collects.
// Pure function — easy to test in isolation.
//
// Inputs:
//   projectKey: "NVC"
//   sprint:     { kind: "active" | "specific" | "none", name?: string }
//   assignee:   { kind: "mine" | "mine-or-unassigned" | "unassigned" | "any" }
//   label:      string | null   (when set, takes precedence and skips sprint/assignee)
//
// Output: a JQL string.
//
// Examples:
//   compose({ projectKey: "NVC", sprint: { kind: "active" }, assignee: { kind: "mine" } })
//     → 'project = NVC AND sprint in openSprints() AND assignee = currentUser() AND statusCategory != Done'
//
//   compose({ projectKey: "NVC", label: "shipwrights-ready" })
//     → 'project = NVC AND labels = shipwrights-ready'

export function composeJql({ projectKey, sprint, assignee, label } = {}) {
  if (!projectKey) throw new Error("composeJql: projectKey is required");

  // Label mode bypasses scope filters by design — the label IS the scope.
  if (label) {
    return `project = ${projectKey} AND labels = ${label}`;
  }

  const parts = [`project = ${projectKey}`];

  switch (sprint?.kind) {
    case "active":
      parts.push("sprint in openSprints()");
      break;
    case "specific":
      if (!sprint.name) throw new Error("composeJql: sprint.name required when kind=specific");
      parts.push(`sprint = "${escapeJqlString(sprint.name)}"`);
      break;
    case "none":
    case undefined:
      break;
    default:
      throw new Error(`composeJql: unknown sprint.kind=${sprint.kind}`);
  }

  switch (assignee?.kind) {
    case "mine":
      parts.push("assignee = currentUser()");
      break;
    case "mine-or-unassigned":
      parts.push("(assignee = currentUser() OR assignee is EMPTY)");
      break;
    case "unassigned":
      parts.push("assignee is EMPTY");
      break;
    case "any":
    case undefined:
      break;
    default:
      throw new Error(`composeJql: unknown assignee.kind=${assignee.kind}`);
  }

  parts.push("statusCategory != Done");
  return parts.join(" AND ");
}

function escapeJqlString(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
