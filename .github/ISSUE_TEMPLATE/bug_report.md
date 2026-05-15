---
name: Bug report
about: Something doesn't work as documented
title: 'bug: '
labels: ['bug']
assignees: []
---

## What happened

<!-- One short paragraph. -->

## Expected

<!-- What you thought would happen. -->

## Actual

<!-- What actually happened. Include the exact command output if relevant.
     If it's a Jira API error, include the status code and message. -->

## Steps to reproduce

1.
2.
3.

## Config (scrub secrets)

<!--
If the bug depends on .shipwrights/jira.json content, paste it with the
real values replaced — keep the SHAPE so we can reproduce.
-->

```json
{
  "host": "<your-tenant>.atlassian.net",
  "jql": "...",
  "field_mapping": { "...": "..." }
}
```

## Environment

- `@shipwrights/source-jira` version: <!-- run: npx @shipwrights/source-jira --version -->
- Node version: <!-- run: node --version -->
- OS: <!-- macOS 14.5 / Ubuntu 22.04 / Windows 11 / etc -->
- Jira: <!-- Cloud / Data Center / Server, and version if known -->

## Additional context

<!-- Logs, screenshots, related issues. Mask any tokens, emails, or tenant URLs. -->
