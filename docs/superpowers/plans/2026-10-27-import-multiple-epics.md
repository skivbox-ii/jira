# Import Multiple Epics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking.

**Goal:** Combine remarks from multiple selected epics in one importer registry and consistent downstream reports.

**Architecture:** Canonical unique epic-key set in selection state; retain scalar epicKey compatibility for single-epic creation. One paginated Epic Link IN search, set-aware scope guards and metadata. Existing picker becomes a draft checkbox popover.

**Tech Stack:** AMD JavaScript, jQuery, Node tests, JSDOM, Playwright local mocks.

**Spec:** `docs/superpowers/specs/2026-10-27-import-multiple-epics-design.md`

## Global Constraints

- Preserve unrelated files and existing functionality. Reuse current `codex/import-registry-details` checkout; base `0f4a345`.
- Sol6.1 medium author and independent reviewer; no new user tasks, no nested agents.
- State exposes `epicKeys` (normalized unique array); `epicKey` remains the single selected key or empty for compatibility and creation. Legacy scope inputs containing only epicKey remain supported.
- Selection is OR across epics, AND project. Empty means all project stories. Preserve pages 50, timeout retry25, cancellation and explicit completeness.
- Persistence remains user/project-scoped. Read old string values; preserve other preferences. Existing single-key storage format may remain for zero/one value; multiple values must round-trip.
- No live Jira/LLM/Citrix actions. Creation still submits only one epic through existing explicit confirmation; multi-selection never silently picks the first epic.
- Follow `docs/import-table-ui-contract.md`: compact header, accessible bounded popover, draft Apply/cancel, search without selection loss, no new native selects.
- Controller owns docs, new browser fixture/acceptance, generated bundles and publication. Author owns production source/CSS/build entry plus existing/new focused tests, excluding controller-owned files below.

## Review Focus

- Changing only the second epic invalidates old rows, history, export and AI cache/confirmations.
- Selection order/duplicates do not cause a distinct scope; no accidental widening to all stories.
- Old user preferences migrate and absent catalog keys stay removable; late catalog responses do not change the draft or another project.
- Popup remains usable during loading, after search and on 390px; Escape/outside click cancel.
- Creating a Story while two epics are selected does not send an array or first key as Epic Link.

### Task 1: Multi-epic selection, transport and all dependent scopes

**Files:** `ujg-excel-story-importer-modules/{main,api,rendering,activity-ui,activity,activity-ai,activity-ai-ui,activity-brief,remark-report-ui,source-export-api,source-export-ui}.js`, CSS, focused tests. Add a small shared epic-scope helper and update `build-excel-story-importer.js` if needed; avoid unrelated refactoring. Controller owns `tests/browser/import-multiple-epics-fixture.js`, `import-multiple-epics-acceptance.cjs`, `import-preview-server.cjs` and generated JS/runtime.

**Interfaces:** Existing `onEpicSelect` accepts string and array, applies normalized state and invalidation; popup may use additional open/draft/apply/cancel services. `api.getProjectIssues(projectKey, epicKeysOrLegacyKey, options)` supports both. Scope inputs gain epicKeys without breaking legacy one-key reports. Main owns migration, cancellation and scalar creation choice; rendering owns visual draft interactions.

- [x] Add failing tests for IN search, duplicate/ordering normalization and legacy single/empty behavior.
- [x] Add failing controller/preferences tests for two keys, reload/project/user isolation, second-key late response guards and single creation target.
- [x] Implement canonical set propagation through registry, Dynamics/report scope labels, export queries and AI cache keys; validate configured Epic Link instead of silently widening a selected scope.
- [x] Implement compact draft multiselect, missing saved choices, accessible search/Apply/cancel, and mobile bounds; cover real bubbling checkbox clicks, search, Escape, outside click and focus.
- [x] Run affected tests, report exact RED/GREEN evidence, files and limitations. Do not build/commit/publish.

### Task 2: Browser acceptance, review and release

**Files:** New browser fixture and acceptance above, preview server, contract/backlog/acceptance report, generated JS/runtime.

- [x] Create a mock with two epics, excluded third epic, shared child and field-aware paginated search; old UI fails multi-select scenario.
- [x] Build final sources; verify 1440/390 px selection union, cancel/search, saved reload, stale responses, clear-to-all and independent creation target. Personally inspect UI.
- [x] Verify existing progressive loading and 1000-task Dynamics/900–1100 events; run full suite and scoped independent Author/Reviewer, resolving material findings.
- [x] Update docs and backlog, commit/publish only verified task files via existing process, compare commit-pinned CDN bytes; leave Citrix acceptance pending.
