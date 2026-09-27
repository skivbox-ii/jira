# LLM Diagnostics Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Parent owns transport; UI worker owns display and its tests. Do not change unrelated files.

**Goal:** Give every importer LLM report a safe, useful request trace instead of an undifferentiated error.

**Architecture:** Optional fourth argument `{onTrace}` on the existing shared client's `requestText` captures actual requests without changing the wire contract. Importer transport forwards sanitized snapshots to report UIs through a second argument `{onTrace}`. One reusable diagnostic panel renders and exports those snapshots; engines keep their one-request policy.

**Tech Stack:** Existing AMD modules, jQuery, node:test, JSDOM and Chrome local acceptance; Citrix read-only.

## Contract

`requestText(config, request, fetchImpl, {onTrace})` emits immutable JSON-safe
snapshots, no raw error/cause. A trace contains `id`, `startedAt`, `endedAt`,
`durationMs`, `outcome` (running/success/error), `phase`, `summary`,
`request` (`url`, `method`, `model`, `headers`, `credentials`, `body`,
`bodyBytes`, `systemBytes`, `userBytes`, `bodyTruncated`), `response`
(`status`, `statusText`, `url`, `type`, `redirected`, `headers`, `body`,
`bodyBytes`, `bodyTruncated`, `format`, `jsonShape`, `finishReason`, `usage`),
`stages` (`name`, `startedMs`, `durationMs`, `status`), `network`, `limitations`.
Usage has `inputTokens`, `outputTokens`, `totalTokens`, `source`; unavailable
numbers are null, never zero. All strings reaching the callback are sanitized.

## 1. Transport (Parent)

- [ ] Add tests in `tests/shared-llm-client.test.js`: callback stage snapshots,
  success usage, each failure stage, HTTP status, actual normalized JSON,
  known/reflected secrets, no-callback compatibility and no extra requests.
- [ ] Observe RED with `node --test tests/shared-llm-client.test.js`.
- [ ] Implement opt-in trace inside `ujg-shared-modules/llm-client.js`.
  Preserve current behavior for callers without diagnostics; never swallow
  transport outcomes because a diagnostic callback failed.
- [ ] Add RED transport integration test in
  `tests/excel-story-importer-activity-llm-transport.test.js`; in
  `main.js:onActivityLlmRequest` forward the callback, preserve `{text}` return
  and show only the sanitized stage summary in errors.
- [ ] Run focused client + integration tests GREEN.

## 2. UI (Sol6 / Medium Worker)

- [ ] Own `llm-diagnostics-ui.js`, `remark-report-ui.js`, `activity-ai-ui.js`,
  scoped CSS, browser UI tests and importer build module order only.
- [ ] Tests RED for failed trace access, full text, stages, export,
  keyboard close, request/scope isolation and zero requests on inspection.
- [ ] Create shared diagnostic view with a request link, full-size dialog,
  Russian labels, readable request/response text, explicit missing data,
  export and bounded in-memory attempt list. Warn about source data in export.
- [ ] Wrap each engine request with `services.onActivityLlmRequest(part,
  {onTrace:function(trace){...}})` without altering part or engine behavior.
  Ignore stale callbacks; clear prior-run state only on explicit new run.
- [ ] Run worker tests GREEN, report changed paths and any limitations.

## 3. Acceptance (Parent + Independent Reviewer)

- [ ] Review spec compliance, then code quality/security; repair findings.
- [ ] Build importer only, full existing regression suite and diff check.
- [ ] Local isolated Chrome desktop/mobile: stub HTTP error, read-body
  failure, invalid JSON and successful usage, export, scroll to end,
  close/retry. Block external requests and Jira writes.
- [ ] Publish by existing authorized main push; compare pinned CDN assets.
- [ ] Citrix read-only UI check. No live LLM call by agent. Record any
  untested production error capture explicitly and leave it pending if
  user has not produced a trace on the new version.
- [ ] Update backlog and evidence; never mark provider outage resolved
  based on diagnostics alone.
