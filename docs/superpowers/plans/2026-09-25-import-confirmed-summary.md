# Confirmed Activity Summary Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans, with TDD and independent review.

**Goal:** Show plain counts for verified remarks despite unrelated incomplete history, without presenting incomplete coverage as complete.

**Architecture:** Keep the existing strict `metrics`, `observed`, and `balance` contract. Add `confirmed` with separately certified group counts and exclusions, consumed consistently by the dashboard, its metric popups, HTML export, and LLM context. No Jira writes or live LLM calls.

**Tech Stack:** Existing AMD JavaScript, jQuery, node:test, jsdom and local browser preview.

## Contract

`report.confirmed` contains `metrics` (changed, newRemarks, completed, reopened, taskReturns, events, overdue), `balance` (startOpen, endOpen), `remarks` (certified count), `totalRemarks`, and `excluded` (id, key, summary, reasons array). Each group gets `confirmed: boolean`. Only groups with complete, usable snapshots, known statuses, and complete membership qualify. Missing, conflicting, stale, unknown-status or future data never manufacture readiness. With zero certified groups, history-based counters/balance are null, not a false zero. Events retain the explicitly observed event count; overdue retains independently confirmed current-state evidence. Exact global metrics retain their current null-on-incomplete semantics.

## Tasks

- [x] Core, `activity.js` and `tests/excel-story-importer-activity.test.js`: add failing mixed good/bad-group tests; confirm failure; calculate `confirmed`, deduplicate shared returned tasks, retain excluded keys/reasons; test future/stale/conflicting snapshots, missing links, unknown intermediate statuses, and full coverage. Run `node --test tests/excel-story-importer-activity.test.js`.
- [x] UI, `activity-ui.js`, `activity-management-ui.js`, importer CSS and browser tests: plain numbers, no comparison signs; matching popup membership; concise coverage/exclusion details with safe Jira links; nest benign timing diagnostics in technical details; current slice says `на момент загрузки`, historical whole-day slice says `на конец дня`. Deadline parsing failures described as unrecognized dates, not erroneous source data. Preserve header filters and other workflows. Run focused browser tests using `NODE_PATH=/tmp/ujg-import-registry-test/node_modules`.
- [x] Export/LLM, `activity.js`, `activity-ai.js` and their tests: carry both confirmed subset and strict completeness; HTML has identical counts/coverage and no comparison signs. No live LLM invocation.
- [x] Rebuild only importer/runtime assets, run regression suite, independent spec and code review, personally inspect local desktop/mobile and screenshots.
- [ ] Publish targeted verified files by the existing approved process, compare CDN bytes. Read-only Citrix acceptance only on a confirmed Jira screen; never mutate Jira or claim production acceptance without evidence. Update backlog and acceptance record. Recurring automation stays paused.

## Scope

The user approved this summary correction on 25.09 with “продолжай и убери ... больше меньше”. Deadline registry column and DUE-03 approval are separate; DUE-04 acceptance is not silently completed by this task.
