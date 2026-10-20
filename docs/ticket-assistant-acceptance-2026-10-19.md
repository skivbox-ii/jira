# Ticket Assistant Release Candidate Acceptance

Planned task/report date: 19 October 2026. Final acceptance and full regression executed/completed **20 October 2026, Europe/Moscow**. Initial source/TDD checks began on 19 October. Worktree: `/Users/skivbox/.codex/worktrees/ticket-assistant/jira` only. Base: `95f54f6`.

Current source/runtime: **5ee9a0f3d4fc310e0d81d4f23a46ad5225244767**; bootstrap packaging **746e5cf** pins that full SHA. Published: **YES, 20 October 2026, `7d40fd3` pushed to `main`**. Citrix accepted: **NO**. The user initially deferred publication, then explicitly requested commit/push so the CDN URL would work in Citrix. Candidate full regression: **1919/1919**, zero failures or skips; standalone acceptance **9/9**. Historical local acceptance and pre-release review follow the publication record.

## Publication: 20 October

The clean reviewed worktree fast-forwarded `origin/main` from `9ea7554` to
`7d40fd3` with `git push origin HEAD:main`, exit 0, no force push. Only the
Ticket Assistant, its build registration, tests and documentation changed.
Before pushing, parent reran build/bootstrap/connection tests: **57/57**,
exit 0, no failures or skips. In-memory rebuild and pinned asset parity
also passed.

The first CDN request for `@main/ujg-ticket-assistant.bootstrap.js` returned
the previous 404. A targeted jsDelivr purge completed successfully; the
unchanged URL then returned HTTP 200. Downloaded bytes matched local files:

| Asset | Ref | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Bootstrap | `main` | 20046 | `ad254d5e789e3e95d05c3e45e4fe6c1d467bfba2a8a6e65125f26cdc118d36a7` |
| Runtime | `5ee9a0f3d4fc310e0d81d4f23a46ad5225244767` | 219514 | `84adc626cd50b6d8b243629466b7ab5edb836739272f4dcf19e19957dfd4ed97` |
| CSS | `5ee9a0f3d4fc310e0d81d4f23a46ad5225244767` | 8647 | `bba299667470d3edc916db2f58845db4318c1946bcdfaa5134077afe0879e5cb` |

No Citrix interaction, Jira issue writes, dashboard property changes or
live model requests were made in this publication step. CDN delivery does
not establish production UI acceptance. Next: use the existing setup
instructions on the separate dashboard and perform the agreed read-only
Citrix acceptance when the screen is available.

## Pre-release Review: 20 October

Sol 6.1 / medium Reviewer Hilbert inspected the deployment boundary, production
versus fixture dependencies, hardcoded values and existing UI patterns.
Two findings were confirmed and assigned to Sol 6.1 / medium Author McClintock:

- P2: a new browser could not configure the shared LLM connection from this
  standalone gadget. `f634887` adds an explicit connection dialog following
  the existing Timesheet pattern, using the same shared reader/writer and
  `ujg-shared-llm-config` key. It preserves the existing base prompt/protocol,
  masks and clears the credential input on close, requires explicit Save,
  verifies durable read-back, handles storage failure and invalidates the
  current checked draft. Saving never calls the model.
- P3: removing the selected project chip sent `null` to a controller that
  requires a project. Removal is now hidden only for that mandatory picker;
  project switching and removable optional/user selections remain available.

The review found no production fixture transports or hardcoded project/type
IDs. Projects/catalogs use Jira API; DEVOPS is an editable policy preset;
CDN repository and release pin are delivery configuration. No importer,
shared-client source or other-widget assets were changed.

Fresh author regression: RED **0/8**, GREEN **8/8**, profile **222/222**,
build/bootstrap **46/46**. Fresh parent full-suite command uses the executable
and dependency prefix below, arguments `--test --test-concurrency=2
--test-reporter=tap tests/*.test.js tests/browser/*.test.cjs`:
**1916/1916**, exit 0, no failed/cancelled/skipped/todo, 76982.1375 ms.
Fresh standalone `tests/browser/ticket-assistant-acceptance.cjs`: **9/9**,
exit 0, no failures/skips, 61897.321917 ms.

Parent independently verified in-memory rebuild parity and `git show` byte
parity for source/runtime/CSS at the full `f634887` pin. Fresh desktop/mobile
acceptance screenshots were inspected; this is visual inspection of automated
evidence, not a claim of personal interaction with the new connection dialog.
Its new eight regressions run against the actual modules in JSDOM with
synthetic storage and AI transport. No real credentials or live AI calls
were used.

Hilbert's scoped re-review of `5f66187..49bb457` marked both findings
**ADDRESSED**, then identified one further P2: changing the shared connection
left a checked draft in another cached project valid. Author reproduced
the A -> B -> connection change -> A sequence before fixing it in `5ee9a0f`.
All editable cached drafts now lose only their stale check result.
Contents, settings and storage revisions remain intact; `preflight`,
`submitting`, `unknown`, `created` and drafts with an issue key retain their
creation guards. Bootstrap commit `746e5cf` pins this final source commit.

Final author checks: connection **11/11**, profile **225/225**,
build/bootstrap **46/46**. Parent repeated the full suite on the final
candidate: **1919/1919**, no failed/cancelled/skipped/todo, 83214.541583 ms.
Final standalone acceptance: **9/9**, no failures/skips, 62210.26225 ms.
Both runs completed; no test runner remained active. Parent rechecked
in-memory source/runtime/bootstrap rebuild and pinned source/runtime/CSS
byte parity, and inspected the regenerated 1440/390 px screenshots.

Hilbert independently reviewed only `49bb457..746e5cf`, reran the three
new regressions (**3/3**) and checked build/pin parity. Verdict: cached-check
P2 **ADDRESSED**, no new findings in scope. The new connection dialog has
automated module coverage, not personal interactive acceptance or Citrix
acceptance.

Logs: `/tmp/ticket-assistant-review-fixes-profile.tap`,
`/tmp/ticket-assistant-review-fixes-build.tap`,
`/tmp/ticket-assistant-predeploy-full-20261020.tap`,
`/tmp/ticket-assistant-predeploy-final-acceptance-20261020.tap`.
Final logs: `/tmp/ticket-assistant-cached-connection-red.tap`,
`/tmp/ticket-assistant-cached-connection-profile.tap`,
`/tmp/ticket-assistant-cached-connection-build.tap`,
`/tmp/ticket-assistant-final-full-20261020.tap`,
`/tmp/ticket-assistant-final-acceptance-20261020.tap`.
Final logs and the regenerated desktop/mobile screenshots are retained at
`/Users/skivbox/.cache/ujg-ticket-assistant-acceptance/2026-10-20-5ee9a0f/`.
The dependency prefix remains
`NODE_PATH=/Users/skivbox/.cache/ujg-ticket-assistant-test/node_modules`
with `/Users/skivbox/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`.

Only a fresh Citrix screenshot was obtained before the user's deferral:
Outlook was visible instead of Jira; no clicks or typing followed.
No push, CDN publication, dashboard property changes or production issue
writes occurred. Installation fields are in
[dashboard setup](ticket-assistant-dashboard-setup.md).

**Artifact retention:** the app/OS restart cleared `/tmp`, including every log/screenshot referenced in the historical sections before the final-fix appendix. Those counts describe actual earlier runs, but the old files are no longer available. Fresh evidence was recreated on 20 October with the restored dependency path and is listed in the final appendix. Do not treat historical logs as currently readable artifacts.

Fresh artifacts, including the final full-suite log and screenshots, were also copied to `/Users/skivbox/.cache/ujg-ticket-assistant-acceptance/2026-10-20-a9c97fb/` outside the repository so they survive temporary-directory cleanup.

## Final Parent Acceptance

On 20 October, Sol 6.1 / medium reviewer Halley independently inspected `edd6605..6963255`, the named regressions and fresh logs. Verdict: all four findings and actual-widget coexistence **ADDRESSED**, no new Critical/Important breakage, no out-of-scope findings. The reviewer independently checked generated/source/runtime/bootstrap parity in memory and did not repeat suites. This closes Darwin's earlier whole-branch findings; it is not a claim of production acceptance.

The parent ran the following exact command from the worktree on frozen `a9c97fb` source with final `a9c97fb` bootstrap pin:

```sh
env NODE_PATH=/Users/skivbox/.cache/ujg-ticket-assistant-test/node_modules /Users/skivbox/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --test-concurrency=2 --test-reporter=tap tests/*.test.js tests/browser/*.test.cjs
```

Result: **1908/1908**, exit 0, 0 failed/cancelled/skipped/todo, 71087.883792 ms. Log: `full-offline-post-review.tap` in both artifact locations above. This run used the freshly restarted importer fixture on 4317, without changing importer code. The final nine-scenario standalone acceptance remains separate from this glob. `git diff --check` passed and the implementation worktree was clean; the original checkout's pre-existing user files were unchanged.

Personal IAB checks covered all four fixes after restart. The parent also inspected fresh desktop storage-warning and mobile 390px screenshots, then exercised the normal source -> Prepare -> visible answer -> Check flow on the offline preview. No production Jira writes, live LLM requests, CDN publication, dashboard changes or Citrix takeover occurred. The preview is left available at `http://127.0.0.1:4320/`.

## Final Review Fixes: 20 October

Source commit `a9c97fb` contains only six own modules, two own generated bundles, three affected regression files, the offline preview fixture and its new browser test. Coexistence was already completed in `6886e09`; the final nine-test acceptance reruns that real-importer scenario. No importer source, preview-server code, CSS, shared client, other-widget assets or dashboard properties changed. Source/tests are frozen for parent verification.

| Finding | Implemented Behavior | Covering Regressions |
| --- | --- | --- |
| Obsolete field after changing issue type | Explicit `discardField` action first preserves original field name and value in visible source, then removes only that field/protection/pending value. Check and reload retain recovery text. Optional unavailable catalogs have the same explicit exclusion. | `tests/ticket-assistant-controller.test.js`: `obsolete field exclusion...`, `optional unavailable catalog...`; `tests/browser/ticket-assistant-editor.test.cjs`: `obsolete metadata values...`; real generated-runtime review fixture |
| Persistence failure after init hidden | Main updates one dedicated warning node when the actual store falls back to memory, without replacing the editor. | editor test `main shows quota fallback after init without replacing editor or caret` exercises project selection and text edits; generated-runtime `review=storage` covers a post-init failure, text, node identity, focus and caret |
| Required incomplete empty catalog | Named unavailable-catalog validation makes the ordinary Jira form fallback available. Missing/unconfirmed values stay blocked; known values from a nonempty partial catalog remain valid. Metadata autocomplete URLs are never followed. | `tests/ticket-assistant-validation.test.js`: `required unavailable catalogs...`; editor test `required unavailable catalog is named...`; generated-runtime `review=catalog` asserts exact form URL and zero external requests |
| No confirmed editable-draft deletion | Idle/rejected drafts have a cancel/confirm action. Confirm clears durable draft content/descriptors and runtime files, retains personal settings, and opens a blank draft. Preflight/submitting/unknown and other-tab durable guards prevent deletion. | controller tests `confirmed draft discard...`, `draft discard refuses...`; editor test `editable draft discard requires confirmation...`; generated-runtime test verifies cancel, confirm, file removal, persisted `draft:null`, reload and retained settings |

Nine focused regressions were written and run RED before production edits: **0/9**, exit 1; then GREEN **9/9**, exit 0. Their original `review-fixes-red.log` and `review-fixes-green-1.log` were lost during restart, not recreated or presented as current files. Exact historical argument list was `--test --test-name-pattern='obsolete field exclusion|optional unavailable|confirmed draft discard|draft discard refuses|required unavailable|obsolete metadata|editable draft discard|main shows quota' tests/ticket-assistant-controller.test.js tests/ticket-assistant-validation.test.js tests/browser/ticket-assistant-editor.test.cjs` with the original `/tmp` dependency path.

Fresh verification after restart uses Node24.19.0, Playwright1.62.1, Chrome155.0.8059.80, macOS arm64. Parent restored pinned dependencies offline outside the repository. Exact executable/environment prefix:

```sh
env UJG_RELEASE_REF=a9c97fb NODE_PATH=/Users/skivbox/.cache/ujg-ticket-assistant-test/node_modules /Users/skivbox/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
```

From the worktree root, final argument lists:

```sh
build-ticket-assistant.js
--test --test-reporter=tap tests/ticket-assistant-*.test.js tests/browser/ticket-assistant-*.test.cjs tests/shared-llm-client.test.js tests/widget-bootstrap.test.js
tests/browser/ticket-assistant-acceptance.cjs
--test --test-reporter=tap tests/ticket-assistant-build.test.js tests/widget-bootstrap.test.js
```

The profile run used `UJG_RELEASE_REF=6886e09` before the source commit existed; acceptance omitted that variable because it consumes runtime, not bootstrap. After source commit `a9c97fb`, own build and the 46 build/bootstrap checks used the final explicit `a9c97fb` pin. Production source/runtime/CSS were byte-identical across those checks; only bootstrap fallback changed.

All fresh logs below are currently in `/tmp/ticket-assistant-20261019/`:

| Fresh Check | Actual Result | Log |
| --- | --- | --- |
| First resumed affected check | 109/110, exit 1; new draft-confirm selector collided with existing settings-confirm selector after opening settings | `review-fixes-affected-resumed.log` |
| Profile + shared/bootstrap after uniquely naming the new selector | **214/214**, exit 0, 0 fail/skip/cancel/todo; 13867.66175 ms | `review-profile-resumed.tap` |
| Actual generated acceptance, including real importer coexistence | **9/9**, exit 0, 0 fail/skip/cancel/todo; 61128.219917 ms | `review-acceptance-final.tap` |
| Own build, final pin | exit 0, fallback `a9c97fb` | `review-build-pinned.log` |
| Build/bootstrap after pin | **46/46**, exit 0, 0 fail/skip/cancel/todo; 100.588542 ms | `review-pin-tests.tap` |
| `git show a9c97fb:<asset>` and in-memory own build | source/runtime/CSS byte-identical; generated source/runtime/bootstrap match local files, exit 0 | `review-pin-parity.log` |
| Environment and exact viewport dimensions | Node/browser versions recorded; every viewport PNG is 1440x900 or 390x844, exit 0 | `environment-final.json`, `review-screenshot-dimensions.log` |

The first affected command was `--test tests/ticket-assistant-controller.test.js tests/ticket-assistant-validation.test.js tests/ticket-assistant-storage.test.js tests/ticket-assistant-creator.test.js tests/browser/ticket-assistant-editor.test.cjs tests/browser/ticket-assistant-settings.test.cjs tests/browser/ticket-assistant-review.test.cjs` with the new Node/dependency prefix and no release variable. The selector collision was resolved within the new draft UI/test; settings source was unchanged. All affected tests were included in the later 214/214 run. No author full-suite rerun occurred. The parent subsequently completed the final full suite and scoped review as recorded above.

The new `tests/browser/ticket-assistant-review.test.cjs` uses fresh contexts, an ephemeral server and finally cleanup, only GET on its exact origin, zero issue-create calls, and fails on external requests or page errors. The normal preview default is unchanged. Exact personal CUA hooks (existing server reads fixture/runtime files dynamically; no code-related restart needed):

1. `http://127.0.0.1:4320/?review=obsolete`: type source, summary and "Заметки только для задачи"; choose Jira type "Ошибка"; click "Сохранить в исходнике и исключить поле"; Check. The original named text is recovered and creation becomes available. For deletion, add a file and optionally change a personal setting; "Удалить черновик" -> cancel retains data, confirm -> reload leaves source/fields/files blank and settings retained.
2. `http://127.0.0.1:4320/?review=catalog`: type source/summary, Check, open "Контур приёмки". Named missing catalog is explicit, Create is disabled, form href is `/secure/CreateIssue!default.jspa?pid=101&issuetype=10`. No metadata URL request occurs.
3. `http://127.0.0.1:4320/?review=storage`: type source; click "Имитировать отказ хранилища"; continue typing within source. The real main/store warning appears immediately, with full text, focus and caret retained. Reload resets the synthetic failure switch.

Parent personally confirmed all four cases in IAB on 20 October after restart, using only synthetic UI: obsolete recovery and Check, cancel/confirm/reload deletion, named catalog fallback/form link, immediate memory warning with retained text/focus. This is parent-provided evidence, distinct from the author's automation. Parent owns full-suite and final scoped review.

Fresh screenshots: `review-{obsolete,catalog,storage,discard}.png` and their exact 1440x900 `-viewport.png` companions, `review-obsolete-before.png`, and all standalone acceptance images listed below recreated by the final run. `coexistence-1440.png` shows both actual widgets; `coexistence-destroy-1440.png` shows the importer after assistant destruction. Author inspected fresh catalog full/viewport and storage viewport. Earlier visual-inspection statements remain historical; no new broad visual audit is claimed.

Final fallback `a9c97fb` contains the matching source/runtime/CSS, rather than pre-fix HEAD. Global dashboard override still takes precedence. Local candidate and parent gates complete; published **NO**, Citrix **NO**.

## Historical Candidate And Scope

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

**Initial coexistence limitation at edd6605, superseded by the follow-up below:** both generated bundles registered in one duplicate-rejecting AMD registry and both constructors resolved, but the importer was not instantiated. That original CSS probe/synthetic-neighbor screenshot did not prove two working gadgets together. Parent permitted honest reporting of the gap, not a waiver. The follow-up now replaces that probe with actual importer instantiation and updates the screenshots.

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

## 20 October Follow-up: Actual Coexistence

The test-only follow-up after `edd6605` replaces the synthetic neighbor with `new _ujgExcelStoryImporterRuntime(...)` alongside the actual assistant. Real importer main/rendering/grid load two in-memory Story records via the existing offline API-boundary pattern. UI actions select Jira mode, load the registry, sort ascending, and open the loaded description. The assistant performs Prepare without replacing the importer table. CSS comparisons use actual controls; both runtime constructors and separate shared-client identities resolve in the duplicate-rejecting registry. During a second delayed Prepare the assistant is destroyed twice; its late completion does not restore UI, while the importer still sorts descending. The importer exposes no public destroy method; the owned context closes it in finally. No importer source, architecture, generated assets or preview-server code changed.

Same executable/env prefix as above. Focused command: `node --test --test-name-pattern='actual importer registry' tests/browser/ticket-assistant-acceptance.cjs`, **1/1**, exit 0, 7110.5465 ms; log `/tmp/ticket-assistant-20261019/coexistence-followup-focused-3.log`. Then `node tests/browser/ticket-assistant-acceptance.cjs`, **9/9**, exit 0, 0 failed/skipped/cancelled/todo, 66088.140333 ms; log `/tmp/ticket-assistant-20261019/acceptance-coexistence-followup-final.log`. Two initial harness assertions were corrected: the real load-button label includes `замечания`; plain fixture description text avoids Jira wiki hyphen formatting. No product fix was inferred from them.

Screenshots updated: `/tmp/ticket-assistant-20261019/coexistence-1440.png` now shows both real gadgets in the full-page image; its exact 1440x900 viewport shows the importer. `coexistence-destroy-1440.png` and `coexistence-destroy-1440-viewport.png` show the still-working importer after assistant destruction. Author inspected full-page coexistence and both viewport images. This closes the original simultaneous real-widget coverage gap for these bounded interactions; it does not claim an importer destroy API or exhaustive multi-gadget lifecycle coverage.

Separately, **parent-executed** later full suite on source `0cc0795` / packaging `edd6605`: **1898/1898**, 0 failed/skipped/cancelled/todo, exit 0, 116261.175209 ms. Exact executable/env prefix unchanged, arguments `--test --test-concurrency=2 --test-reporter=tap tests/*.test.js tests/browser/*.test.cjs`. Parent spawned unchanged importer fixture with `PORT=0`, passed `IMPORT_PREVIEW_URL=http://127.0.0.1:63827` only to the suite, and closed that child in finally. Two hardcoded-4317 tests used the untouched parent server. Log `/tmp/ticket-assistant-20261019/full-offline-fresh-fixture.tap`, summary inspected by author. This later result does not erase the first 1897/1898 run or its clock investigation. The coexistence `.cjs` test is outside that suite glob and is verified separately above. This author did not repeat the full suite.
