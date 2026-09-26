# Jira Summary ID Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show the journal ID in the registry without Excel when the parent Story summary starts with its number.

**Architecture:** Preserve the existing source-column ID resolution. Only when it returns no ID, read the linked parent Story summary in the shared remark-id module. Children use the parent container, never their own titles. Do not mutate source columns or Jira data. Keep the existing Dynamics fallback for unlinked rows unchanged.

**Tech Stack:** AMD JavaScript, node:test, existing browser fixtures, Citrix read-only UI.

User approved the short design with “продолжай проверяй”.

- [ ] Add registry regressions for `2650. Problem`, `№42. Problem`, `#42 Problem`, preserved `ID`, numeric zero, absent prefix, unrelated numbers and child titles.
- [ ] Run `node --test tests/excel-story-importer-registry.test.js`; confirm new fallback assertions fail.
- [ ] In `remark-id.js`, after existing ID resolution, inspect `row.storyDetails.summary` only for a linked Story. Match an anchored numeric prefix with optional `№`/`#`, followed by a dot not followed by a digit, whitespace, or end. Production also has `2795.Линия` without a space. Do not interpret a date/decimal prefix as the journal ID. In `activity.js`, do not retry the older permissive regex after the shared helper rejects a linked Story title; use its Jira key instead.
- [ ] Run registry, parser, creator and activity tests, then the full existing suite.
- [ ] Personally check Jira mode without Excel on the local preview. Request independent code review, build/publish importer assets, and confirm the same path in Citrix without writing tickets.
- [ ] Record test counts, commit and actual Citrix evidence in the backlog. Do not close acceptance if Citrix is unavailable.
