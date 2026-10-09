# Activity Comments Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development task by task. Keep writes disjoint and preserve unrelated changes.

**Goal:** Show comment additions in Dynamics with a three-line preview and an accessible full-text hover/click popup, without changing grouping.

**Architecture:** Reuse captured Jira comment envelopes and the existing bounded activity loader. Read missing comment pages, validate pagination and preserve partial evidence with explicit diagnostics. Build comment events alongside changelog events. Retain exact text for export and evidence; presentation alone is clamped.

**Tech Stack:** Existing AMD JavaScript, jQuery, node:test, JSDOM, Playwright local preview.

## Approved Contract

- User approved execution on 09.10: up to three lines, ellipsis for overflow, hover popup; click and keyboard must work too.
- An event uses `kind: "comment"`, `field: "comment"`, `commentAction: "created" | "updated"`, `commentId`, exact body in `to`, empty `from`, and optional `commentNote`. Common author/time/issue/assignee fields follow existing events.
- Creation is included in the selected Moscow day, for original stories and linked children. The latest edit may be shown at its actual update time with updateAuthor; no invented intermediate revisions. Current text edited after creation is labelled as such, never called the original version.
- Fetch all accessible pages only when the issue envelope is incomplete. Validate counts, offsets, IDs and stable total. Preserve available text on error, expose incomplete comments separately from status-history completeness. Respect cancellation and concurrency.
- Plain safe text with line breaks, no HTML injection. Short comments need no popup or ellipsis. Long popup is viewport constrained, scrollable and hoverable, closes on Escape/outside click, supports touch and keyboard, and cleans up on rerender/navigation.
- Same grouping, filters, sorting and full-text HTML export. No live LLM call or Jira writes. No claim of Citrix acceptance without personal read-only testing after the user restores Jira.

## Tasks

- [x] 1. Add failing model tests in `tests/excel-story-importer-activity.test.js`: comment-only change, child/shared issue, Moscow boundaries, edited text labels, exact multiline text, incomplete comments and escaped full export. Run `node --test tests/excel-story-importer-activity.test.js`, then implement in `activity.js`.
- [x] 2. Add failing loader tests in `tests/excel-story-importer-activity-loader.test.js`: complete fast path, missing pages, changed total, duplicates, failure, cancellation and retry. Implement hydration in `activity-loader.js`; wire `readComments` and pending comment completeness in `main.js`. Existing status metrics remain based on status history, not guessed comment completeness.
- [x] 3. UI worker owns `activity-ui.js`, importer CSS and focused JSDOM UI tests. Implement comment preview in single and grouped rows without changing `journalRows`; reuse existing popup ownership and positioning. Verify overflow detection after rendering and resizing, hover crossing into popup, click, focus, Escape, long unbroken text and no XSS.
- [x] 4. Personal local Playwright acceptance at 1440 and 390px: short/long/multiline comments, popup full text to last line, no overflow, 900–1100 daily events, date changes during/after loading, filter draft through final render, failure/retry, last row and zero live writes/LLM. Save evidence outside repository.
- [x] 5. Independent gpt-6-sol medium review, repair findings, run full importer suite and rebuild with `node build-excel-story-importer.js`; syntax and diff checks. Publish only owned verified files through existing approved workflow. Update backlog and acceptance report distinguishing local and Citrix checks.
