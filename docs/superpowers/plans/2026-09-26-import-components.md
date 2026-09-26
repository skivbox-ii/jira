# Import Components Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with independent review checkpoints.

**Goal:** Safely sync Story components and provide a coherent component-scoped daily report with readable, responsive groups.

**Architecture:** A bounded component sync controller follows the existing due-date preflight/confirmation workflow and reuses its table UI. Activity selects parent rows before summarization, with parent component facets calculated on the unfiltered report. Group display preserves raw events and uses local DOM toggles.

**Tech Stack:** AMD JavaScript, jQuery, node:test, existing browser fixtures, read-only Citrix.

**Acceptance:** Completed 2026-09-26 18:43 MSK, commits `7f9b602` and
`6bea0c2`. Evidence and explicit data limitations:
`docs/import-components-acceptance-2026-09-26.md`. Production writes were not
confirmed; unresolved source-module mappings remain tracked under REG-03.

## Task 1: Component sync (worker ownership)

Files: new `component-sync.js`, `api.js`, `main.js`, `rendering.js`, configurable
`due-date-sync-ui.js` or small component UI wrapper, build module list and focused
tests. Do not edit activity modules or generated assets.

- [x] Write failing API/controller tests. Assert preview has no PUT, strict project/key/component IDs, empty/unmapped/duplicate conflicts skipped, all eligible selected, deselection, stale preflight, idempotence, unknown response, restricted payload `{fields:{components:[{id:"100"}]}}`.
- [x] Run `node --test tests/excel-story-importer-component*.test.js`, confirm missing-feature failures.
- [x] Implement `create({api,onChange})` with `open(rows,{projectKey,moduleComponentMap})`, `close`, `select`, `selectAll`, `confirm`, `getState`. Freeze mapping, refresh project catalog, read current full set, replace only after explicit confirmation and unchanged preflight. Use bounded queues and generation guards.
- [x] Wire Excel-only icon, context guards, targeted modal rendering and reuse the existing table preference/filter/resize UI under an independent storage key.
- [x] Run focused unit/browser tests with mocked requests. Report edited paths and remaining risks for integration review.

## Task 2: Activity scope and presentation (orchestrator ownership)

Files: `activity.js`, `activity-ui.js`, focused activity tests and scoped CSS.

- [x] Add failing tests for parent component OR selection, deduplication, missing versus unknown components, unknown completion, empty scope and consistent report/export/LLM context.
- [x] Add helper output containing component facets and source-row selection. Apply selection before `summarize`, preserving Excel join rows for deadlines/form metadata.
- [x] Add global searchable filter using registry interaction pattern, per-user/project persistence, selected values retained even when missing. Pass the scoped report to all existing consumers.
- [x] Read explicit screen-form metadata only from source columns or existing imported description table; add to group header when available.
- [x] Add failing browser tests for immediate event action descriptions, author/time details, scope reset/cancel/search and group toggles preserving sibling nodes/scroll without another summarize call.
- [x] Implement event summaries and local disclosure, measure large synthetic fixture before/after. Keep chronological detail order and raw events unchanged.

## Task 3: Review, integration, acceptance

- [x] Inspect worker diff for spec compliance; run independent code-quality review, fix findings with regressions.
- [x] Build `node build-excel-story-importer.js` and runtime via existing bootstrap builder; run full unit/browser suite with `NODE_PATH=/tmp/ujg-import-registry-test/node_modules` and concurrency 1.
- [x] Personally inspect local desktop/narrow layouts and control behavior; preserve the dev server on 4317.
- [x] Publish only changed importer assets and task docs through existing main/CDN flow. Verify runtime/CSS byte equality.
- [x] Use `testing-citrix-prod` to inspect confirmation preview, component filter scope, counts and journal; scroll whole visible report to bottom. Never confirm production writes.
- [x] Perform a second review/test cycle for discovered defects. Save acceptance/review report and update backlog with concrete evidence. Mark goal complete only after agreed acceptance; report any real limitation explicitly.
