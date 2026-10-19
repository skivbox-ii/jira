# Ticket Assistant Release Candidate Acceptance

Planned task/report date: 19 October 2026. Final acceptance and full regression executed/completed **20 October 2026, Europe/Moscow**. Initial source/TDD checks began on 19 October. Worktree: `/Users/skivbox/.codex/worktrees/ticket-assistant/jira` only. Base: `95f54f6`.

Local implementation/Task 9 work: **complete with concerns**. Published: **NO**. Citrix accepted: **NO**. Parent whole-branch final review: **pending**. The single full regression run is not reported as green.

## Candidate And Scope

Source/runtime commit: `0cc0795a235de1fe6349cc95f6183361bb133165`, `fix(ticket-assistant): clarify Russian acceptance and recovery labels`. Packaging/acceptance commit is the introducing commit of this report, subject `test(ticket-assistant): verify workflow and document release candidate`; the local SDD report records its resulting SHA.

Only permitted polish was added, with regressions first: new source answer blocks use `Вопрос/Ответ` while exact legacy English blocks still deduplicate; required-field messages are Russian and generated questions use current metadata names; attachment outcomes are Russian; a checked correction identifies rejection as the previous creation attempt. Field IDs, stored status enums and API policies are unchanged. No project/domain policy was hardcoded.

Other Task 9 changes: standalone generated-runtime acceptance runner, this report, README/browser README, and own bootstrap fallback. No preview-server, importer, shared-client, other-widget asset or dashboard-property changes. No installs, agents/reviewers, production calls, publication, push, PR, merge or Citrix actions.

## Actual Verification

Environment: Node **24.19.0**, Playwright **1.62.1**, installed Chrome **155.0.8059.80**, macOS arm64. Existing dependencies: `/tmp/ujg-ticket-assistant-test/node_modules`. Environment evidence: `/tmp/ticket-assistant-20261019/environment.json`.

Commands below use exactly this executable/environment prefix:

```sh
env UJG_RELEASE_REF=0cc0795 NODE_PATH=/tmp/ujg-ticket-assistant-test/node_modules /Users/skivbox/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
```

The prefix was followed by these exact argument lists, from the worktree root:

```sh
build-ticket-assistant.js
--test tests/ticket-assistant-*.test.js tests/browser/ticket-assistant-*.test.cjs tests/shared-llm-client.test.js tests/widget-bootstrap.test.js
tests/browser/ticket-assistant-acceptance.cjs
--test --test-concurrency=2 --test-reporter=tap tests/*.test.js tests/browser/*.test.cjs
```

| Final Check | Actual Result | Log Under `/tmp/ticket-assistant-20261019/` |
| --- | --- | --- |
| Own build, explicit fallback `0cc0795` | exit 0 | `build-final.log` |
| Profile + shared/bootstrap | **204/204**, exit 0, 0 failed/cancelled/skipped/todo | `profile-final.log` |
| Final standalone acceptance | **9/9**, exit 0, 0 failed/cancelled/skipped/todo; 65138.570334 ms | `acceptance-final-2.log` |
| Full offline suite, run exactly once | **1897/1898**, exit 1, 1 failed, 0 cancelled/skipped/todo; 104724.288666 ms | `full-offline-final.tap` |
| Failed importer test alone, parent 4317 | **0/1**, exit 1, same assertion | `importer-startup-isolated.log` |
| Same unchanged test, fresh ephemeral fixture | **1/1**, exit 0; fixture closed in finally | `importer-startup-fresh-fixture.log` |
| `git show` byte parity at fallback commit | source/runtime/CSS identical | `pin-parity.log` |
| In-memory own module/assets rebuild at explicit ref | no source/runtime/bootstrap drift, exit 0 | `generated-final.log` |

`git diff --check` passed; only the assigned files are staged for the packaging commit.

Full-suite failure: `tests/browser/import-preview-startup.test.cjs:63`, test `the shared preview URL opens a populated tree without manual import or synchronization`, assertion `Opening Dynamics loads Jira automatically`. Actual coverage was `Проверена история 0 из 227 задач`. This was not ECONNREFUSED and was reproduced outside full-suite concurrency. Parent 4317 returned `window.fixtureNow="2026-10-19T18:00:00+03:00"` after the wall clock entered 20 October. Its fixture date is computed at server startup; the preview patches capture/summarize time. The unchanged test passed against a fresh ephemeral server returning `2026-10-20T18:00:00+03:00`. Evidence: `importer-clock-evidence.log`. This supports fixture-clock rollover as the cause, not an assistant regression. No importer code was changed, no parent server restarted, and the full run was not repeated or relabeled as passing.

Exact isolated command used the same Node/dependency environment with `--test tests/browser/import-preview-startup.test.cjs`. The fresh-fixture repeat ran that command with `IMPORT_PREVIEW_URL=http://127.0.0.1:62157`, a child fixture server started with `PORT=0`; that temporary port is now closed. No actual write endpoint was called.

## Acceptance Evidence And Limits

The nine tests exercise the actual generated assistant runtime, AI JSON builder/parser, controller, personal store, creator and UI. Each session owns `startPreview({port:0})`, fresh Chrome context and finally cleanup. Jira reads/writes and shared-client requestText are fixture transports in memory. The test-only transport wrapper never changes production or preview source. Issue counters in Node survive page reload; unknown creation and partial-file recovery retain exactly one issue create. Only an explicit corrected retry after definite rejection reaches a second issue create. HTTP requests must stay on the preview origin and use GET; external requests and page errors fail acceptance. No live Jira/LLM call occurred.

At **1440x900** and **390x844**, with reduced motion: three stock templates plus a fourth, common/template instructions reaching the actual prompt, visible multiline answers reaching Check, answer deduplication, protected manual summary with separate pending replacement, edit invalidation, JSON settings transfer/remapping across DEMO/APP, two identities in the same storage, reload recovery, unsupported required metadata/form fallback, failure/retry/cancel and discarded late response, keyboard activation, timer focus/caret/source-scroll/page-scroll retention, long questions and last-field reachability. Success, definite rejection/correction, unknown result and partial attachments are separately covered, including reload/reselection/retry.

**Coexistence limitation:** both generated bundles register in one duplicate-rejecting AMD registry and both constructors resolve. CSS is probed in both directions using a synthetic `.ujg-excel-story-importer` neighbor and real assistant controls. The importer is **not instantiated** there. Full-page `coexistence-1440.png` was inspected and shows that synthetic neighbor; its viewport companion shows only the assistant. This proves AMD definition compatibility and the measured CSS probe, not two working gadgets together. Simultaneous real-widget lifecycle remains an explicit final-review gap. Separate importer regression results above are independent evidence and do not close it.

## Screenshots And Personal Check

All artifacts are outside git in `/tmp/ticket-assistant-20261019/`. Full-page PNGs and exact-size `-viewport.png` companions:

- `answers-protected-{1440,390}`: visible Russian source answers and protected manual summary.
- `settings-fourth-{1440,390}`: long rules, mapping, JSON transfer, reachable modal footer.
- `progress-{1440,390}`: compact timer, preserved caret/scroll.
- `long-last-field-{1440,390}`: long question/answer and last metadata field.
- `unsupported-{1440,390}`: named required field and ordinary Jira form fallback.
- `creation-{success,rejected,lostresponse,filefail}`, `file-partial`: durable creation/file outcomes.
- `coexistence-1440`: assistant plus synthetic CSS neighbor, with the limitation above.

Author inspected full-page desktop/mobile answers, settings, long-field view, creation success/unknown/partial files, and coexistence including the synthetic neighbor; also inspected exact viewport settings390, progress1440 and long-last-field390. No overlap was seen in the inspected controls. PNG header checks confirm viewport companions are exactly 1440x900 or 390x844 (`screenshot-dimensions.log`). This is author inspection, not a substitute for parent visual acceptance.

Parent separately reported on 20 October: runtime `0cc0795` reloaded; Russian attachment statuses and retained fourth template; Prepare -> visible `Вопрос/Ответ`; manual summary survives another Prepare with a separate pending replacement; progress hidden on finish. Parent inspected `answers-protected-1440-viewport.png` and `progress-390.png`, no overlap. Earlier parent T6/T7/T8 checks, including the native file chooser, are prior evidence, not this author's execution. Whole-branch review remains pending after the Task 9 commit.

## Packaging And Remaining Gates

Fallback `0cc0795` contains byte-identical `ujg-ticket-assistant.js`, `ujg-ticket-assistant.runtime.js`, and `ujg-ticket-assistant.css`, checked using `git show 0cc0795:<asset>` against local bytes. Own bootstrap is deliberately pinned independently from other widgets. Module build/bootstrap comparisons use the explicit ref; rebuilding only this widget causes no false pin drift.

Release file list: `ujg-ticket-assistant.bootstrap.js`, `ujg-ticket-assistant.runtime.js`, `ujg-ticket-assistant.css`, plus `ujg-ticket-assistant.js` for the source/legacy bundle. Existing registration in `build-widget-bootstrap-assets.js` and the own `build-ticket-assistant.js` are already present; no additional shared registration change was needed. Public AMD `_ujgTicketAssistant`, runtime `_ujgTicketAssistantRuntime`, CSS root `.ujg-ticket-assistant`.

The global dashboard `ujg.dashboardReleaseRef` still overrides fallback under the existing process. This candidate does not alter it or other widgets. Publication requires a separate user-approved action, then byte comparison of JS/runtime/CSS with CDN. CDN parity is **not performed** because nothing was published. Citrix requires a separate handoff and fresh screen; it remains **NO**. Cross-tab storage CAS remains optimistic, runtime file bytes require reselect after reload, and unknown writes require human reconciliation as documented in T8.
