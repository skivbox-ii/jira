# Import Activity Performance Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with scoped ownership, TDD and review checkpoints.

**Goal:** Make large daily reports responsive with explicit loading stages, reusable verified histories and safe date switching.

**Architecture:** Keep existing AMD/jQuery application and domain calculations. Separate load coordination, bounded memory cache and progress rendering; prepare LLM context only when used. No server, persistent history database, new provider or unrelated refactor.

**Tech Stack:** Existing AMD modules, jQuery, Node test runner/jsdom, local preview and CUA browser verification.

Design approved by user 27.09.2026. Base: `0fb73a2`; preserve unrelated untracked documentation. Existing branch is reused. Publish only explicit scoped paths after review/tests and mainline comparison.

Execution 27.09: implementation, local acceptance and independent review complete.
1408 tests passed. Measurements and remaining production blocker:
`docs/import-performance-acceptance-2026-09-27.md`.
Cache refinement: main render is the conservative dataset publication boundary;
clear there instead of computing a large data/settings signature. Keep existing
task snapshots, not a second source of truth. No domain indexing was warranted
by the measured 23–32 ms calculation. Citrix remains unavailable.

## 1. Stress Fixture And Baseline

Ownership: tests/browser/import-preview-{server.cjs,html,bootstrap.js}, new import-performance fixture/telemetry and tests.

- [x] Add deterministic Jira-like fixture for 250 remarks / 1000 issues and three days with at least 900 events/day; expected event IDs and counts come from generator, not summarize.
- [x] Test real capture/summarize completeness, event identities per date, coherent status chains and no mutations.
- [x] Expose isolated local performance mode with API stubs, counters, timings and explicit fixture date selection. Keep ordinary/preflight fixtures unchanged.
- [x] Measure existing compiled bundle before rebuilding: loading, date changes, filter, sorting, collapse and CPU substeps. Instrument test code only; no live LLM.

Run: `env NODE_PATH=/tmp/ujg-import-registry-test/node_modules node --test tests/browser/import-performance*.test.cjs tests/browser/import-preview-*.test.cjs`.

## 2. Lazy AI Preparation

Ownership: activity-ai-ui.js and tests/browser/excel-story-importer-activity-ai-ui.test.cjs.

- [x] Add failing tests: update while unopened calls prepare zero times; opening uses latest report; visible/busy sessions retain scope isolation and stale-answer detection.
- [x] Store pending report/scope on update and prepare only when opening; active session updates still preserve existing fingerprint rules. Do not change prompts, coverage, client or providers.
- [x] Run focused tests, inspect diff for semantics, keep built bundle unchanged until baseline taken.

## 3. Loading Coordinator

Ownership: new activity-loader.js, main.js, build module list, loader tests and enrichment integration tests.

- [x] Regression cases: at most three reads, duplicate keys share request, date change adopts relevant active reads and reprioritizes queued work immediately, leave/scope change cancels queue, late response never updates new scope, failure retried only explicitly.
- [x] Implement small create/read-selection/cancel coordinator; API promises may have abort. Each selection has generation and progress, each active key is unique. Preserve accepted snapshot proof and existing cutoff checks.
- [x] Integrate existing enrichment through coordinator with target lookup and activity.capture. Keep registry loading and current project cap unchanged. Expose loaded/active/failed items independently of verified coverage.

Contract: `create({read, accept, onProgress, onComplete})` then `select(keys)`; keys are prioritized for current selection, not parallel competing queues. `cancel()` stops queued starts and suppresses late accepts. Each run reports its own completion state; no auto retry loop.

## 4. Report Cache And Progress Isolation

Ownership: new activity-store.js, activity-ui.js, rendering.js, main.js, CSS, focused unit/browser tests.

- [x] Failing regression: changing only activity progress preserves table DOM, focus and popup draft; report calculation/AI preparation counters unchanged.
- [x] Separate progress patch from full rendering. Publish refreshed report at completed data boundary, clearly mark displayed older/preliminary snapshot while reading.
- [x] Bounded cache keyed by date/components within one published dataset. Clear at every main render and Moscow midnight. Retain six cached reports and existing task snapshots; no duplicate raw-history store.
- [x] Tests: warm A/B/A calculates A once, new publication recalculates, old data never shown under new date, different user/scope clears cache, expiry does not claim freshness.
- [x] Preserve deadline-as-today logic, current links caveat, export and AI frozen slice; update progress text and details with no table contract changes.

## 5. Verification And Release

- [x] Build only importer JS/runtime; CSS unchanged. Re-run exact stress cases and compare events/metrics and median/p95/max with baseline.
- [x] Full regression suite, independent spec/code review, resolve findings with regression tests.
- [x] Personal local desktop/narrow verification, date-switch races, error/retry, scroll to last group, filters, sorting, details. No live LLM or Jira writes.
- [ ] Read-only Citrix acceptance through testing-citrix-prod; unavailable Citrix leaves prod acceptance open.
- [x] Fetch/check origin/main, inspect scoped diff and generated outputs, stage only named files, commit/push without force (`bfdd85a`). Unrelated docs excluded; runtime/CSS match commit-pinned CDN. Before/after measurements and production blocker recorded.

Full suite: `env NODE_PATH=/tmp/ujg-import-registry-test/node_modules node --test --test-concurrency=1 --test-reporter=tap tests/*.test.js tests/browser/excel-story-importer-*.test.cjs tests/browser/import-preview-*.test.cjs tests/browser/import-performance*.test.cjs`.
