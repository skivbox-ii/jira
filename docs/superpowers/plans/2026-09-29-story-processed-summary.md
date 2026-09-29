# Story Processed Summary Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development; keep edits scoped to the importer and tests.

**Goal:** Count nonclosed original Stories assigned to the implementation team as processed, and prevent old Jira resolutions from marking reissued Stories fixed.

**Architecture:** Preserve the existing statistics pipeline and current all-loaded-data scope. Determine implementation membership with stable identifiers in configured teams, never child assignments or display names. Current workflow state takes precedence over an old resolution.

**Tech Stack:** AMD JavaScript, jQuery, Node test runner, stubbed Playwright preview; Citrix read-only acceptance.

## Approved Rules

User confirmed 29.09: processed is determined by the original Story assignee belonging to a configured implementation-direction team, including Stories in Issued or Testing. Closed and cancelled Stories keep their separate buckets.

- Display five mutually exclusive buckets: fixed, processed (implementation), testing, cancelled, open.
- Original Story status and assignee only; child assignments do not reclassify the Story.
- Unknown/conflicting original status remains unknown; uncreated rows remain uncreated.
- Missing Excel ID does not remove a Story with a valid Jira key.
- Do not change QA filter OR semantics or silently inherit registry filters into statistics.
- No changes to production Jira records and no live LLM calls.

## Tasks

- [x] Reproduce stale-resolution failure in `tests/excel-story-importer-main.test.js` and status/statistics tests before fixing. Cover active category + old resolution/date, reopened/issued names, true terminal and cancellation, unknown workflow fallback.
- [x] Correct `main.js` status derivation and narrowly align `teams.js` classification as required. Preserve unknown terminal workflows that only have resolution metadata, unless a known active state contradicts it.
- [x] Add failing tests for `statistics.js`: original assignee in implementation on Issued/Testing; closed/cancelled priority; child-only assignment, role/name-only match, missing ID, duplicate/conflicting parents and count conservation.
- [x] Add `stories.processed` and `Отработано (внедрение)` to `statistics-ui.js` using existing helpers and table structure. Keep old detail tables unchanged.
- [x] Personally verify stubbed desktop/mobile UI for five totals, QA filter invariance, reissued status, hidden detail tables, scrolling and no writes/LLM/errors.
- [x] Independent spec and code review; rebuild only importer JS/runtime; run full tests and `git diff --check`.
- [ ] Publish only verified importer changes with the existing main/CDN process. Verify static asset equality; personally inspect the new summary and reopened Story behavior through Citrix without mutations. Do not declare completed acceptance when blocked.

## Live Diagnostic Evidence

Citrix session `import-summary-counts-20260929`, 14:33-14:38 MSK.
The 11 visible QA groups contain six original Stories in Testing and five in Issued. Seven have an Excel ID, of which four are Testing and three Issued. Of the four without ID, two are Testing and two Issued. This explains 6 versus 7 without changing the counter.

Testing keys: EVOSCADA-21440, EVOSCADA-21631, EVOSCADA-21769, EVOSCADA-21772, EVOSCADA-21840, EVOSCADA-21882.
Issued keys: EVOSCADA-21519, EVOSCADA-21570, EVOSCADA-21895, EVOSCADA-21170, EVOSCADA-21851.

Actual Jira EVOSCADA-21570 shows current status `Выдано` and resolution `Готово` on the same detail screen (`inspect-20260929-143841-12202.png`). Its green importer status is therefore a confirmed stale-resolution defect, not evidence of successful current completion.
