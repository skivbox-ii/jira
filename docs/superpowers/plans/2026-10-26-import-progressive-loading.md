# Import Progressive Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Show the complete lightweight registry before sequential history enrichment without losing data or controls.

**Architecture:** Explicit registry fields/profile in the existing API, small paginated searches and bounded timeout recovery. Main owns the current run and background enrichment, reusing existing history loading boundaries where possible. Registry/rendering distinguish pending, failed and complete history without replacing user interaction state.

**Tech Stack:** AMD JavaScript, jQuery, Node test runner, JSDOM, Playwright mock preview.

**Spec:** `docs/superpowers/specs/2026-10-26-import-progressive-loading-design.md`

## Global Constraints

- Preserve unrelated user files. Work in the existing task branch `codex/import-registry-details` in the requested repository; no competing implementation or new user threads.
- Sol 6.1 medium author and independent reviewer. Main agent owns browser acceptance, documentation and final integration.
- No live Jira/LLM requests, secrets, ticket/status/assignment writes or Citrix control.
- Maintain `docs/import-table-ui-contract.md`, especially draft preservation, coverage and late-read guards.
- Registry search page 50, one timeout retry at 25 per failed page, existing 30-second deadline. Other specialized reads retain their field requirements.
- Base registry is atomic; heavy enrichment is progressive and cannot roll it back or masquerade as complete.

## Review Focus

- Stopped/superseded runs and status readback cannot be overwritten by late history.
- Failure after some history succeeds retains base rows and retries only missing work.
- Excel sync, empty datasets, source changes and missing selected filter values preserve preferences.
- Opening Dynamics during enrichment does not race two queues or lose comments/coverage.
- Timer/enrichment/final renders preserve open filter search, selections, focus and scroll.

### Task 1: API, progressive enrichment and UI state

**Files:** `ujg-excel-story-importer-modules/api.js`, `main.js`, `activity-loader.js` if needed, `registry.js`, `grid.js`, `rendering.js`; focused existing unit/UI tests. Add a small owned queue module only if needed; update build module list in that case. Do not edit unrelated widgets.

**Interfaces:** Keep existing API defaults for specialized callers. Registry opts into explicit lightweight search options. Main records per-issue history readiness and run identity, and passes honest progress/age state to rendering. Sequential enrichment reads only history and fields needed to validate status age; Dynamics retains complete comment pagination and full data capture. Exact names may follow existing conventions.

- [x] Add failing tests proving a lightweight 50-item registry search and timeout retry at 25 at the same offset, preserving successful pages and abort.
- [x] Add failing integration tests proving base rows publish before delayed history, per-key age completion, retained rows on error, retry-only-missing, stop/restart/scope-change guards, Excel path and Dynamics handoff.
- [x] Implement explicit field profiles and safe page recovery without changing specialized defaults.
- [x] Implement sequential history enrichment and honest age/progress states. Preserve current filter draft/focus/scroll using existing grid snapshot mechanisms; avoid full table render on timer ticks.
- [x] Run focused API/main/registry/request-progress/activity tests; fix real failures without weakening coverage.
- [x] Build JS/runtime and run full tests; hand off changed paths and exact evidence to independent reviewer.

### Task 2: Personal acceptance, review and release

**Files:** new `tests/browser/import-progressive-acceptance.cjs`, relevant preview fixture if needed, contract, backlog, acceptance report and generated importer bundles.

- [x] Create a mock browser scenario with delayed heavy requests, multiple light pages, timeout-once, enrichment failure/retry, late responses and 1000-task Dynamics data.
- [x] Personally inspect desktop/mobile before, during and after enrichment; verify filters and last rows with the existing workload fixture.
- [x] Obtain independent spec/quality review of complete diff and resolve material findings.
- [x] Update contract/backlog and acceptance report with verified results and outstanding Citrix acceptance.
- [ ] Build/commit/publish only importer changes through the existing authorized process; verify commit-pinned assets and report exact publication, never infer production acceptance from CDN.
