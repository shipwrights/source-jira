# @shipwrights/source-jira

Jira backlog source adapter for [`@shipwrights/core`](https://github.com/shipwrights/core). Pulls issues via JQL, materialises them as epic files, writes status transitions and PR links back to Jira.

## Install

```bash
npm install -D @shipwrights/core @shipwrights/source-jira
# or
pnpm add -D @shipwrights/core @shipwrights/source-jira
```

## Configure

Generate a Jira API token at https://id.atlassian.com/manage-profile/security/api-tokens.

Set env vars in your shell or `.env`:

```bash
export JIRA_EMAIL=you@example.com
export JIRA_API_TOKEN=<your-token>
```

Reference them from `.shipwright.yml`:

```yaml
backlog:
  source:
    kind: jira
    config:
      host: myorg.atlassian.net
      email_env: JIRA_EMAIL
      token_env: JIRA_API_TOKEN
      jql: 'project = SHOP AND status in ("Ready for Dev", "Refined") ORDER BY priority ASC'
  state_dir: docs/backlog/epics
```

## What this adapter implements

The `BacklogSource` contract from `@shipwrights/core`:

| Method | Behaviour |
|---|---|
| `healthcheck()` | Calls `GET /myself` to validate auth |
| `listAvailable()` | Runs the configured JQL (`POST /rest/api/3/search/jql`) with cursor pagination |
| `pickNext()` | `listAvailable()` sorted by priority + key |
| `materialize(item, dir)` | Renders the Jira issue's description (ADF) to markdown + writes an epic file with frontmatter |
| `markStatus(id, status)` | Transitions the Jira issue (3 statuses) or posts a comment (middle states) |
| `attachPR(id, prUrl)` | Posts a comment with the PR url |

## Status mapping

Most Shipwright lifecycle states are internal artefacts that don't have a useful Jira counterpart. The adapter only transitions the Jira issue for three states:

| Shipwright status | Jira action (default) |
|---|---|
| `refined` | Transition to **Ready for Dev** |
| `ready-for-human-review` | Transition to **In Review** |
| `shipped` | Transition to **Done** |
| anything else (`sliced`, `built`, `integrated`, `tested`, `reviewed`) | Post a comment, no transition |

Override the mapping in `.shipwright.yml`:

```yaml
config:
  status_mapping:
    refined: "In Progress"
    shipped: "Closed"
```

## Field mapping

Standard fields (`summary`, `priority`, `status`, `labels`) are mapped by name. Story points and parent epic are custom fields — convention-detected by default, overridable:

```yaml
config:
  field_mapping:
    size: customfield_10016     # Story Points
    parents: customfield_10014  # Epic Link
```

## Status

v0.2.0 — Phase 2. Implements `healthcheck`, `listAvailable`, `pickNext`, and `materialize` (full ADF→markdown rendering of Jira issue descriptions). Status transitions (`markStatus`) and PR-link writes (`attachPR`) still throw `"lands in Phase N"` errors and arrive in v0.3 / v0.4.

## License

MIT
