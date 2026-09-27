# Compact Management Report Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. The user approved the general report and explicitly requires strict context compression and very few provider requests.

**Goal:** A useful seven-day management report and same-snapshot questions, each requiring at most one call through the existing LLM connection.

**Architecture:** A pure `activity-brief.js` module computes daily reports from the existing loaded history, aggregates unique issues/events and worklogs, and selects bounded evidence. The existing LLM dialog uses this engine, defaults to seven days, and retains a compact one-day option. No provider calls for compression, retries, background generation, or additional providers.

**Tech Stack:** Existing AMD JavaScript, jQuery, safe Markdown, Node tests and local browser fixtures.

## Contract

- At most one LLM request per explicit report/question. User prompt at most 18000 UTF-8 bytes, system prompt at most 4000 bytes. No hidden map/reduce or retry. Reject oversized fixed context/questions before transport.
- Code computes aggregate facts over all loaded remarks in the selected project/Epic/current component scope, including quiet open remarks. Seven calendar days ending on selected date; current day uses the existing cutoff. Unknown history remains unknown.
- Detail selection is deterministic, prioritizing overdue/returns/quiet-open/ready/new cases. At most ten detailed remarks and bounded text; UI and payload disclose included/omitted remarks, omitted/truncated text and request size. Aggregates must not be recalculated from the selected subset.
- Worklogs are deduplicated per issue/record and restricted by recorded work date; distinguish incomplete worklog coverage and cumulative snapshot effort from period effort. Missing hours are not zero productivity. Current teams and current links are not historical facts.
- Absence of status/creation/assignment events in the period is a named signal, not proof of inactivity. Do not infer causes, deadline changes, readiness for customer acceptance, or staff utilization without evidence.
- Use local factual digest and selected source keys/times. No raw bulk description diffs, full team roster, credentials or irrelevant fields. Jira text is untrusted evidence. Display a concise Russian Markdown report: situation, up to five intervention items, results, resources, unknowns.
- Questions use the immutable prepared snapshot; any reduction of conversation text is disclosed. Do not send a new history summarization call. Data refresh marks answers stale; scope/mode changes isolate sessions and ignore late responses.
- Preserve all existing table preferences and unrelated source behavior. Legacy detailed engine remains available to its tests, but normal UI routes only through compact report/question generation.

## Tasks

- [ ] Add `activity-brief.js` and `tests/excel-story-importer-activity-brief.test.js`; observe failures before implementation. API: `prepare(rows, teams, options)` with date, days (1 or 7), now, cutoff, columnMap, journalRows, scopeWarning, scope. Return immutable plan with date/fromDate/asOf/coverage/eventCount/scopeKey/fingerprint/request/meta. `run(plan, requestText, options)` returns markdown and completedParts=totalParts=1; no retry, cancellation checked before and after transport.
- [ ] Extend existing dialog and activity UI adapter; register module in build and test loaders. Display period mode, data coverage, request budget and expandable context before generation. Preserve cancellation, drafts, safe Markdown, stale state and focus.
- [ ] Test real integrated compact engine: large fixture, component scope, seven-day boundaries, quiet remarks, partial histories, unknown deadlines, duplicate worklogs, Unicode budget, long questions, failure/cancel, one call and no auto-calls on open.
- [ ] Independently review scope/data correctness and UI. Run full suite, build only importer/runtime. Personally inspect desktop/mobile mock generation, errors, period switch, dates and scroll to end.
- [ ] Publish verified importer scope by existing process. Citrix read-only: open compact report and inspect preparation/budget; never press live Generate or mutate Jira. Record actual checks and leave unavailable acceptance open.

## Test Commands

`node --test tests/excel-story-importer-activity-brief.test.js`

`NODE_PATH=/tmp/ujg-import-registry-test/node_modules node --test --test-concurrency=1 tests/*.test.js tests/browser/excel-story-importer-*.test.cjs tests/browser/import-preview-*.test.cjs tests/browser/import-performance*.test.cjs`

Self-review: one call includes questions, compression is local, all aggregate scope is preserved, detail selection is explicit, and production writes/live LLM calls remain forbidden for agent testing.
