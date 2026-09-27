# Import Audit Fixes Implementation Plan

> **For agentic workers:** Use subagent-driven-development, TDD and independent review. Scope was approved by the 27.09 continuation request and audit findings.

**Goal:** Correct the five reproduced audit defects without weakening history coverage or Jira write safeguards.

**Architecture:** Retain the existing activity UI, loader and creator boundaries. Preserve only same-scope filter drafts, validate requested components at the creation boundary, and keep truthful retained-history metadata after refresh failures. No production writes or live LLM calls.

**Tech Stack:** AMD JavaScript, jQuery, node:test, jsdom, local Playwright preview.

## Tasks

- [x] `activity-ui.js` and activity browser tests: reproduce final-render filter loss, then preserve search, draft selections, focus/selection and scroll for the same project/epic/day/user. Applying, cancelling, Escape, switching date or scope must not resurrect an old draft. New candidates must not silently select themselves. Run the activity UI suite.
- [x] `creator.js`, `main.js` only if needed, and creator/main tests: reproduce an unknown mapped component reaching createIssue. Fetch the project catalogue before creating the parent or any child; resolve requested components to catalogue IDs, fail explicitly on unknown/ambiguous/catalogue errors without dropping fields. Retain valid mappings and existing creation/link/priority behavior. Verify with local API stubs only.
- [x] `activity-ui.js` and browser tests: retain the history error and state clearly that previous data is shown, with known report cutoff and failed issue keys. Distinguish first-read failure from a previously complete snapshot. Retry clears the error only on success. Do not fabricate completeness or freshness.
- [x] importer CSS and activity browser tests: reproduce the close button scrolling away, then keep the existing header sticky while the events scroll underneath; retain viewport containment, keyboard Escape and focus return. Verify the last event on desktop/mobile. The smaller CSS-only implementation was personally tested by hit testing after 54 events on 1440px and 390px and independently reviewed. Keep a newly shown component error above neighboring sticky action cells.
- [x] `component-sync.js` and its tests: distinguish missing, malformed and foreign-project Jira keys before catalogue/read/write calls. No other synchronization semantics change.
- [x] Independent review, targeted and full regression suites, rebuild importer/runtime only. Personally inspect the local 1000-task, 900/1000/1100-event scenario: dates during/after load, final-render draft, failure/retry, last row and long event lists. Review requirements matrix; record limits honestly.
- [x] Publish only verified scoped changes through the existing main/CDN process. Citrix only after connection recovery and only read-only; unchanged external blockers do not justify repeated control attempts. Record code/test/local status separately from production acceptance.

## Following Item

Local work and publication completed in `466a483`: 1444/1444 tests,
independent review without open findings, personal 1000-task UI rerun,
CDN byte comparison. See `docs/import-audit-fixes-acceptance-2026-09-27.md`.

- [ ] Deferred external acceptance: personal read-only Citrix checks after connection recovery. No new attempt or production write was made during this cycle.

DUE-03 is a separate approved next implementation scope in the continuation request: editable Due date of new original Story from Excel, source value and invalid-date warning, strict parsing, manual correction/cancellation, no change to existing stories or child creation. Start after audit fixes are locally verified, record any genuinely unresolved decision, and test writes only on stubs.
