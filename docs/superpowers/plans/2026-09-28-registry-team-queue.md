# Registry Team Queue Implementation Plan

**Goal:** A shared Excel/Jira team filter with the approved QA work-queue OR rule.
**Architecture:** `teams.queueTeamIds(task, normalizedTeams)` computes memberships once
per grid row. `registry` intersects `filters.teamIds` with row memberships, then
applies ordinary filters to the same row. `grid` owns the toolbar menu and persistence.
**Tech Stack:** Existing AMD modules, jQuery, jsdom/node:test, local Playwright, Citrix.
**Approval:** User confirmed the short design on 28.09.2026; proceed autonomously.

## Approved Behavior
- QA: exact normalized Testing/In Testing/Тестирование/На тестировании status,
  OR an open QA-role task. Completed/cancelled QA tasks are not open. Missing
  status alone is not proof of an open QA task. No broad matching of "review".
- QA team identity comes from configured QA roles, not the display name. Renaming
  a team does not change its rule. Other teams use configured role or member identity.
- OR between selected teams; AND with the existing column/status filters. Parent
  context remains, nonmatching children stay hidden, no duplicate rows from OR.
- Compact toolbar dropdown: stable searchable checkbox options, count, only-this,
  select/clear found, Apply/Cancel/reset; no new filter row or native select.
- Shared user-scoped registry preferences keep selection across source/data/view
  changes and reload. Unknown stored team IDs stay visible/removable. Empty selection
  means no matches; no filter means all records including unassigned/new Excel rows.
- Global reset clears this filter too, preserving sorting/column preferences.
  Existing disclosure behavior stays independent of selection.

## Execution
- [x] Core worker: failing node tests in `tests/excel-story-importer-teams.test.js`
  and `tests/excel-story-importer-registry.test.js`; implement `queueTeamIds` in
  `teams.js`, and the array intersection case for `teamIds` in `registry.matches`.
- [x] Main worker: failing browser tests in `excel-story-importer-grid.test.cjs`;
  persist `teamIds`, compute row memberships, implement a grid-owned team filter
  button/menu, mount in `rendering.js`, constrain it in importer CSS. Update only
  the required grid test stub. No changes to Jira workflow, assignments or tickets.
- [x] Run focused tests with `NODE_PATH=/tmp/ujg-import-registry-test/node_modules`.
  Verify both QA OR branches, terminal/missing status cases, conjunction on the same
  child, context/collapse, draft cancellation/focus, persistence/reset and absent IDs.
- [x] Independent Sol6/medium review, then local Chrome acceptance at 1440/390 px,
  QA selection, search, multi-select, status/assignee interaction, source switch,
  reload, reset and scroll to last row. No live LLM or Jira writes.
- [ ] Build only importer bundles; run full regression tests, record any existing
  timeout without claiming a pass. Publish scoped verified changes through the
  existing main/CDN process, personally check Citrix read-only and record evidence.
  Do not close REG-06 or REG-05 production acceptance without screenshots.
