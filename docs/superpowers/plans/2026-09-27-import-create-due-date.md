# New Story Due Date Implementation Plan

> **For agentic workers:** Use subagent-driven-development, TDD, independent review and personal local UI verification.

**Goal:** DUE-03: submit the explicitly confirmed Excel deadline as Jira Due date when creating a new original Story.

**Architecture:** Reuse the strict deadline resolver and source column mapping. The creation dialog owns a separate date draft; creator validates again before writes. This does not update existing Stories, children, Excel source cells or the separate deadline synchronization workflow.

**Tech Stack:** Existing AMD modules, jQuery dialog controls, node:test/jsdom and isolated local Playwright stubs.

## Approved Scope

The 27.09 continuation request includes DUE-03 in its agreed scope: editable Due date in the Story confirmation dialog, original source value, unrecognized-date warning, manual correction/cancellation, and no silent omission on Jira error. An explicit "Не указывать срок" checkbox disambiguates intentional omission of a nonempty source from a failed parse; an originally empty source may remain empty without any invented date. No new provider, backend, production write or child inheritance is introduced.

## Tasks

Local work and publication completed in `466a483`: 1444/1444 tests,
independent review without open findings, personal desktop/mobile stub
scenarios and CDN byte comparison. Details:
`docs/import-create-due-date-acceptance-2026-09-27.md`.

- [ ] Deferred external acceptance: personally inspect the published confirmation form through Citrix after connection recovery. Never create a production Story during acceptance.

- [x] Core: expose/reuse the existing strict calendar parser in `deadlines.js`; extend `creator.js` and its tests so valid Excel/explicit dates become ISO `fields.duedate` only for a new original Story. Invalid/conflicting nonempty source or invalid explicit date blocks before any write unless the user explicitly omits the field. Empty source omits the field. Epic retry retains Due date, and rejection of Due date remains a visible failure, never a retry without the field. Existing stories and additional children stay unchanged.
- [x] Dialog: `main.js`, `rendering.js`, corresponding main/browser tests. Initialize source information using actual `columnMap` and `deadlines.resolve`; show original values and diagnostic, editable date and explicit omit choice. Draft changes do not mutate source rows; cancel preserves them. Revalidate before confirmation and retain errors visibly. Dialog project/type changes and child mode must not leak or manufacture dates.
- [x] Reproduce missing `duedate` first, then run focused tests. Inspect valid, empty, invalid, conflict, correction, omission, cancellation and Jira rejection on local stubs; verify desktop/mobile and capture screenshots. No production creation.
- [x] Independent spec and code review, full importer regressions, build importer/runtime, update backlog and acceptance record, publish targeted verified files and verify CDN bytes. Citrix read-only preview remains pending while connection is unavailable; do not label local acceptance as production acceptance.
