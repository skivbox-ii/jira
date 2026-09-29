# Registry Deadlines And Layouts Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development and TDD. Stay in the current checkout; do not create separate user tasks.

**Goal:** Show explicit Excel and Jira due dates and independently remember each registry mode's columns.

**Architecture:** Keep registry/grid APIs and shared filter state. Add the actual Jira date to the existing issue-details flow; never substitute the workbook deadline for it. Store mode-specific layout profiles inside the same user-scoped preferences record and preserve unrelated fields.

**Tech Stack:** AMD JavaScript, jQuery, Node tests, stubbed Playwright preview, Citrix read-only.

## Approved Design

User chose "Две колонки (Recommended)" on 29.09 after the short design:

- `deadline` labelled "Срок Excel" comes only from workbook source columns and the existing column mapping. It remains group-level.
- New `jiraDueDate` labelled "Срок Jira" comes only from `fields.duedate` of the respective original Story or child; never inherit the parent's Jira date into children.
- Excel defaults to the Excel date column, Jira to the Jira date column; both are available in each column menu. The requested default date is visible when profiles are first introduced; preserve all other old widths/order/visibility preferences.
- Each user's Excel and Jira independently remember visibility, order and widths, including empty/loading sources and reload. Reset columns only resets the active mode. Keep at least one column visible, bounded widths and unknown-column sanitization.
- Existing shared filters, completion filters, team selection and sorting survive switches/reset/layout migration. Do not split filter state or affect Dynamics preferences.
- Valid calendar dates before the current Moscow day use red and bold date text. Today's date is not late until the next Moscow day. This is date highlighting regardless of ticket completion, not a new readiness calculation. Invalid/missing dates are not guessed or coloured late.
- No automatic writes, sync, real Jira changes or live LLM calls. Read the added Jira field in existing loads without one extra request per row.

## Steps

- [x] Add failing api/main/registry tests: actual Jira due date propagation, distinct Excel/Jira values, child-specific/null/invalid dates, workbook mapping, Moscow midnight boundary and date-only highlighting independent of selected report day.
- [x] Add failing grid tests for both labelled columns, red/bold date class, separate visibility/width/order, old profile migration in both first-visit orders, empty-mode transitions, shared filters/sort/reset, reload/user isolation/storage failure.
- [x] In `api.js`, include `duedate` in normal issue fields. In `main.js`, keep raw actual `duedate` in issueDetails. In `registry.js`, strictly parse and pass `jiraDueDate` independently; calculate overdue from current date using existing Moscow-day convention.
- [x] In `grid.js`, retain `deadline`, add `jiraDueDate`, preserve source/task row scopes, existing filter/sort/resize/reorder contracts. Separate layout profiles without moving shared filters. In CSS add scoped date-cell overdue colour and font weight.
- [x] Run focused tests with `NODE_PATH=/tmp/ujg-import-registry-test/node_modules node --test tests/excel-story-importer-enrichment.test.js tests/excel-story-importer-main.test.js tests/excel-story-importer-registry.test.js tests/browser/excel-story-importer-grid.test.cjs` and resolve regression failures without dropping old requirements.
- [x] Independent spec and code review. Controller rebuilds only importer JS/runtime; run `node --test --test-concurrency=4 tests/*.test.js tests/browser/*.test.cjs` with the same NODE_PATH. Final: 1635/1635. Review's midnight in-place styling and timer cleanup findings fixed and personally retested.
- [x] Personal stubbed Chrome on desktop/mobile: distinct dates, today's/past/future/missing, two different layouts, switches/reload/reset/shared QA filter, horizontal overflow confined to grid, 0 mutations/LLM/errors. Preserve previous summary behavior.
- [x] Publish explicit verified importer files only, compare JS/runtime/CSS to commit-pinned CDN. Code `fe0845b`, all three assets match byte-for-byte; see acceptance report.
- [ ] Citrix after user signal only: visible dates and two profiles, never confirm writes. Leave acceptance open if unavailable; record evidence/backlog.

## Ownership And Safeguards

Implementation worker owns importer api/main/registry/grid/CSS and matching unit/browser tests. Controller owns docs and a new personal browser acceptance script, build outputs, review, publication and Citrix. No edits to unrelated user docs or .DS_Store. Existing local preview: http://127.0.0.1:4317/.
