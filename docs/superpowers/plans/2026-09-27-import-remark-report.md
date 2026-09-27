# Remark Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Отдельный полный и компактный AI-разбор одного замечания без изменения общего отчёта.

**Architecture:** Чистый сборщик контекста получает одну свежую строку Story с дочерними снимками. Отдельный read-only loader дочитывает комментарии и работу; диалог готовит контекст и вызывает существующий LLM transport только по явной кнопке.

**Tech Stack:** AMD, ES5-style JavaScript, jQuery, существующий Markdown, node:test/jsdom/Playwright.

## 1. Context Engine (Sol6 Medium)

Files: `ujg-excel-story-importer-modules/remark-report.js`, `tests/excel-story-importer-remark-report.test.js`.

- [x] RED: all related tasks, all comments, full lifecycle beyond selected day, exact actors/timestamps, partial blockers, overflow, one transport call, cancellation. Run `node --test tests/excel-story-importer-remark-report.test.js`.
- [x] GREEN: AMD `_ujgESI_remarkReport`, API:

```js
prepare(row, teams, {asOf, scopeKey, sourceWarnings})
// => {key,remarkId,title,asOf,coverage,canGenerate,blockers,warnings,
//     request:{systemPrompt,userPrompt,allowProtocolFallback:false},
//     meta:{userBytes,userLimit,systemBytes,systemLimit,requestCount:1}}
run(plan, requestText, {isCancelled}) // => Promise<{markdown}>
```

- [x] Existing `activity`/`remark-id` semantics, no alternate readiness definition. One row only; complete bodies, no sampling. Dictionary packing; stop on overflow. No changes to activity-brief/legacy AI.
- [x] Spec review then quality review; rerun tests after findings.

## 2. Read-only Sources (Main Agent)

Files: `api.js`, new `remark-report-loader.js`, `main.js`, new loader/controller tests.

- [x] RED: read only chosen Story/current children; initial full comments skip redundant requests; paginate incomplete comments; reject duplicate/empty/nonadvancing/changed-total pages; failures produce blockers; no write/LLM calls. Stale/cancelled results cannot affect dialog.
- [x] GREEN: API methods `getIssueComments(key,startAt)`, `getIssueWorklogs(key,startAt)`. Loader `load(key,{onProgress,isCancelled})` reads original issue and comments, reuses dependency-injected existing child key and issue detail helpers. Rechecks original parent revision/links at end to detect concurrent modification.
- [x] Main service `onLoadRemarkReport(key, options)` looks up original row at call time, checks current scope, returns `{row,asOf,sourceWarnings}` without mutating registry/history. Read details through existing `issueDetails` and `issueChildStatusRows`.
- [x] `node --test tests/excel-story-importer-remark-report-loader.test.js tests/excel-story-importer-remark-report-controller.test.js`.

## 3. Dialog And Integration (Main Agent)

Files: new `remark-report-ui.js`, `activity-ui.js`, `icons.js` if icon absent, CSS, build order; new browser tests.

- [x] RED: group action placement, preview does not call LLM, full scrollable context, explicit generate, double click, error/manual retry, close/scope-change cancels stale result, Markdown safety.
- [x] GREEN: `create().open(group,state,services,anchor)`, `.dismiss()`, `.destroy()`; use existing icon/Markdown/dialog conventions. Window shows original remark identity, current snapshot time, task/comment/event coverage, budget, blockers and context disclosure. Only ready plan enables generate.
- [x] Register module order in `build-excel-story-importer.js`; runtime builder derives existing module list. Integrate button at end of group, close dialog on Dynamics suspend or changed project/epic.
- [x] `NODE_PATH=/tmp/ujg-import-registry-test/node_modules node --test tests/browser/excel-story-importer-remark-report-ui.test.cjs tests/browser/excel-story-importer-activity-ui.test.cjs`.

## 4. Acceptance And Publication

- [x] Full existing node suite and all importer browser tests; rebuild only importer artifacts. Review diff for unrelated modifications.
- [x] Independent Sol6 medium review: first approved criteria, then defects/security/regressions. Fix and rerun findings.
- [x] Local Playwright: synthetic long history/comments, single report call, error/oversize/incomplete/close, 1440/390 widths, scroll response/context to bottom; no external network.
- [ ] Scoped commit/publish through existing `origin/main` process; verify commit-pinned CDN runtime/CSS bytes.
- [ ] Fresh Citrix screenshot, read-only preview of real group, confirm linked tasks/comments/coverage, inspect to bottom. No generation and no Jira mutation.
- [ ] Record evidence and residual limits in backlog/acceptance doc. Completion only with actual checks, no claim of provider answer quality without user-run live answer.
