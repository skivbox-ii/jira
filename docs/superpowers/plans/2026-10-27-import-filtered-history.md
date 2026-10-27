# Skip history hidden by completed filters

> Execution: superpowers:subagent-driven-development. Existing authorization covers implementation, Author/Reviewer Sol6.1 and publication. User confirmed: «Да, только при включённом исключении». Honor applied completed-exclusion filters, not unconditional history deletion.

**Goal:** Avoid unnecessary registry status-age history reads for completed issues hidden by the existing exclusion checkboxes.
**Architecture:** Let the grid expose the applied completed-exclusion selection through rendering, and notify the controller when relevant applied visibility changes. Keep all base rows/fields and the independent full Dynamics history path. No new preference or provider.
**Tech:** existing AMD/jQuery, Node/JSDOM26, mocked Chromium.
**Spec:** Latest user: “если стоит исключительно [interpreted: исключить] готовое ... если история готова, то её не грузить”. Existing controls are “Исключить готовые” (children) and “Исключить готовые истории” (whole groups). Clarification explicitly confirmed by the user during implementation.

## Requirements

- Source base a53e1fe; preserve unrelated changes. Do not redo completed REG-10.
- Only applied filters affect requests, not draft checkbox/search edits. Existing saved user preferences apply on first load in Excel and Jira.
- ExcludeDoneStories skips ready Story and all children hidden with it. ExcludeDone skips completed children of included groups. Shared child still needed by any included group is fetched once. Current ready/done predicate must agree with registry, including reopened/stale-resolution semantics.
- Other filters, sorting, pages and normal collapsed trees do not suppress history. Existing temporary manual disclosure can reveal filtered children; those must be loadable. No silent regression of manual disclosure.
- Removing exclusions/reset triggers only missing required histories, keeping completed results and scope guards. Newly excluded queued requests must not start; abort obsolete active reads when supported, ignore late results. Avoid restarting unchanged active useful requests and avoid retry loops on errors/unrelated filter changes. Explicit Stop remains effective; no background restart from incidental render.
- Deferred histories are not complete and not errors; no permanent “Загружается…” on excluded data. No invented status age. Do not clear already complete evidence solely due to filtering.
- Full Dynamics history/comments remain complete for all source issues, including currently completed/hidden ones; report and LLM coverage cannot claim deferred history complete. Base 50/25 reads unchanged.
- No real Jira/LLM/Citrix access. User retains Citrix. Tests local; independent review, personal UI, publish/CDN match, report local vs production.

## Tasks / ownership

1. Author: main.js, grid.js, rendering.js, registry.js only if needed; tests/excel-story-importer-load-controller.test.js and directly relevant grid/registry tests. Controller owns browser fixtures/acceptance, bundles and docs. Author must not build/commit/push.
   - [x] Add RED tests for saved exclusion/all-hidden/shared child, filter-change/drains/resume, children-only/manual disclosure, canceled drafts/explicit stop, Dynamics includes skipped issues.
   - [x] Minimal implementation preserving queue/error guards and incomplete-history meaning; targeted tests GREEN.
2. Controller in parallel:
   - [x] Browser reproduction with applied exclusion; measure requested key sets and saved requests rather than guessed wall-clock speed.
   - [x] Personal local UI1440/390, exclusions toggle/reset during queue and after finish, drafts, errors/retry/stop; Dynamics900–1100events if behavior affected.
   - [x] Independent Sol6.1 medium review, relevant/full tests, generated artifacts, publish and CDN verify.
   - [x] Update backlog/report with exact local counts, limitations and next step.

Published code: `610161b`. Local acceptance is recorded in
`docs/import-filtered-history-acceptance-2026-10-27.md`, including the
JSDOM baseline timing investigation and separate successful rerun.
Citrix acceptance remains pending until the user hands control back.
