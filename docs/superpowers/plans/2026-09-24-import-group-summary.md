# Import Activity Group Summary Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Do not mutate production Jira issues.

**Goal:** Remove the duplicate remark column from the default daily journal, show concise trustworthy group summaries, and audit creation-link direction.

**Architecture:** Keep report facts in `activity.js`, presentation and layout migration in `activity-ui.js`. Preserve existing registry behavior and explicit user preferences. The management/AI epic is recorded separately and is not implemented in this change.

**Tech Stack:** AMD JavaScript, jQuery, CSS, Node test runner, local browser preview.

## Task 1: Group Presentation

**Files:** `ujg-excel-story-importer-modules/activity.js`, `activity-ui.js`, `ujg-excel-story-importer.css`, corresponding activity unit/browser tests.

- [x] Add failing tests for hidden default remark column and one-time migration of saved layouts without losing widths, order, filters or sorting; explicitly enabling the column must survive reload.
- [x] Add failing tests for group current parent status, distinct linked child count, concise daily outcomes (created, completed, reopened, other real changes). No-op statuses and cancelled tasks must not be labelled completed. Missing data must not imply readiness.
- [x] Implement group metadata independent of journal filters. Preserve issue links, ID, wrapping, keyboard collapse and role/team colors. Label current status separately from selected-day outcomes.
- [x] Run activity unit and browser tests, including past-day and incomplete-history scenarios.

## Task 2: Creation Audit

**Files:** `ujg-excel-story-importer-modules/creator.js`, `main.js` (read only unless a confirmed defect requires a change), creator/enrichment tests.

- [x] Compare `createRow` and `createAdditionalTasks` through link-type selection and request payload. Verify Jira request semantics from official references; do not infer direction from property names.
- [x] If a defect is confirmed, reproduce with a failing test for both initial creation and additional tasks before applying a narrow fix. Test configured type names and both outward/inward description orientations.
- [x] Do not repair historical production links or create test issues in Jira.

## Task 3: Verify and Deliver

- [x] Review patches against scope and regression risks; run full unit and importer browser suite.
- [x] Build importer bundle/runtime. Inspect the actual local preview on desktop and narrow viewport.
- [ ] Record the creation audit conclusion and any production verification limitation. Publish only scoped changes under the already-authorized widget update workflow.

## Verification

- Full Node unit and five importer browser suites: 956 passed, 0 failed, 0 skipped.
- Focused activity unit/browser suites: 99 passed. Review regressions cover unknown prior status and unchanged fields; identity changes and standalone worklog events remain observable.
- Local browser: hidden ID after migration; explicit re-enable survives reload; restored compact layout; group collapse preserves short context; desktop and 390px viewport inspected; no console errors.
- Creation audit and retained metadata-unavailable fallback limitation: `docs/import-creation-link-audit.md`.
