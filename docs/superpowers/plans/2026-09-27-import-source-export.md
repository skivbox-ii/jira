# Source Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Export complete available Jira source records and readable MSK daily text for independent research without LLM or Jira writes.

**Architecture:** Isolated collector/formatter plus modal, integrated with existing read APIs and Dynamics. Keep source records separate from calculated activity summaries; report coverage instead of truncating.

**Tech Stack:** Existing AMD JavaScript, jQuery, node:test, JSDOM and browser fixture.

## Tasks

- [x] Add failing collector/formatter tests in `tests/excel-story-importer-source-export.test.js`: unique issues, all pages, partial reads, long bodies, daily timezone, explicit source IDs, worklog dates, no mutation or silent limit.
- [x] Implement `ujg-excel-story-importer-modules/source-export.js`: read plan, bounded collection with cancellation, coverage, deterministic JSON and plain-text daily sections.
- [x] Wire narrow service in `main.js`, using fresh paginated parent discovery and existing child-direction semantics, source columns and current teams only. Do not pass the whole state/config.
- [x] Add UI tests and `source-export-ui.js`: explicit load, readable request plan/progress, text/JSON download, day navigation and cancellation. Add one Dynamics toolbar action, lifecycle cleanup and builder entries. Reuse existing modal CSS.
- [x] Run focused tests, build, full existing test suite; inspect desktop/mobile fixture and final record with no external network calls.
- [x] Independent Sol6/medium review; fix findings with regressions and rerun checks. Publish only scoped verified files using the established process.
- [x] Read-only Citrix source collection and actual export. Evidence: `docs/import-source-export-acceptance-2026-09-27.md`.
- [ ] Analyze raw data outside the repository; update backlog with evidence and any missing-data blocker, not a false completion. Pending transfer of saved Citrix JSON and original Excel to the local machine.
