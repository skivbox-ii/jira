# Ticket Assistant: Prompt Settings And Token Budget

Date: 20 October 2026 (Europe/Moscow).
Original token-budget source/runtime: `21238c243d5babb961440aefe38a856f204c80f0`.
Original bootstrap: `364e118`, pushed to `main`.
Current response-fix source/runtime: `272cff2`; bootstrap release `28c846d`.
Status: implemented, locally verified and published. Initial personal
Citrix preparation failed; after the response fixes, the authorized
synthetic Bug scenario passed through preparation, clarification, checking,
one creation and opening the resulting issue. See the chronological
production follow-ups below. This does not accept every template or
establish the cause of the second historical rejection.

## Scope

The existing prompt/template editor includes a local context budget and
response reserve. Defaults are 32768 and 4096, not discovered model
capacity. Available input is context minus reserve. The reserve is local,
not a provider output parameter. Positive safe integers and reserve less
than context are required. Existing schemaVersion 1 preferences migrate
without losing instructions. Storage remains per user/origin/project;
settings JSON includes budgets, not credentials or draft data.

Preflight shows an explicitly approximate count, with instructions,
source, Jira fields/service data and reserve. Errors link directly to
settings. Exact numeric provider usage is displayed separately when
returned. Changing budgets invalidates checks while retaining draft data
and creation safety guards, including cached project drafts.

For arbitrary configured models no tokenizer is assumed. The heuristic
uses rounded-up ASCII characters / 3 plus other Unicode code points,
with complete JSON escaping/structure and 32 framing tokens. It is not an
exact count or a guaranteed upper bound. No new provider/tokenizer service
was introduced.

Assistant requests explicitly opt into preserved prompt strings. Shared
transport independently validates the budget and does not normalize or
truncate those strings, including legacy requests. Other callers retain
the existing sanitizer defaults and message-role convention. Generated
Importer, Timesheet and User Activity bundles contain only synchronized
shared-client code; their callers do not opt into this behavior.

Separate resource guards remain: 4 MiB UTF-8 for prompt strings together,
2 MiB for extracted assistant response JSON. These are not token limits.
The shared transport still reads the provider response envelope before
the assistant JSON size check.

## Verification

Sol 6.1 Author/Reviewer, medium reasoning; independent review found no
actionable findings and approved both specification compliance and code
quality. Parent verified the final frozen code:

| Check | Result |
| --- | --- |
| Full unit/browser regression | 1936/1936, no failures/skips, exit 0 |
| Separate generated-runtime acceptance | 9/9, no failures/skips, exit 0 |
| Build/bootstrap after final pin | 46/46, exit 0 |
| In-memory source/runtime/bootstrap build | Byte-identical |
| `git diff --check` | Clean |
| Local desktop/mobile browser | 1440/390, offline fixtures only |

Commands used the cached Node executable and dependencies:

```sh
export NODE_PATH=/Users/skivbox/.cache/ujg-ticket-assistant-test/node_modules
NODE=/Users/skivbox/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
$NODE --test --test-concurrency=2 --test-reporter=tap tests/*.test.js tests/browser/*.test.cjs
$NODE tests/browser/ticket-assistant-acceptance.cjs
UJG_RELEASE_REF=21238c243d5babb961440aefe38a856f204c80f0 $NODE --test tests/ticket-assistant-build.test.js tests/widget-bootstrap.test.js
```

Parent personally reproduced the old UI error using 700 repetitions of a
synthetic Russian request: system 4042/6000 bytes, user 88471/42000 bytes.
On the new UI the budget shortcut opened settings; changing context to
65536 retained the source, permitted the stubbed request and survived
reload. Reserve 70000 was rejected; cancelling retained the previous
4096 reserve. Generated desktop/mobile screenshots were inspected.

Tests cover exact transport content beyond both former byte caps,
Unicode/empty estimates, budget boundaries, settings validation,
migration, JSON transfer, reload, cancellation, check invalidation,
provider usage, error shortcuts and no outgoing live calls. Original
failing tests and fixes are recorded in the retained author report.

Artifacts outside git:
`/Users/skivbox/.cache/ujg-ticket-assistant-acceptance/2026-10-20-token-budget/`.
Includes final test logs, author/reviewer reports and desktop/mobile
screenshots. No production payload or credentials are stored there.

## Publication

After push, the stable bootstrap was purged from jsDelivr cache. All
three URLs returned HTTP 200 and matched local bytes:

| Asset | Reference | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Bootstrap | `main` | 20046 | `96acb98d53fe9678ce007580b1d368514f52b22a239854397237ba20ef7d75c5` |
| Runtime | `21238c243d5babb961440aefe38a856f204c80f0` | 230450 | `8f7fa86949e4c388fffc2f75f454e30fdb701f3b2f31f90874a4d010f4f95140` |
| CSS | `21238c243d5babb961440aefe38a856f204c80f0` | 9248 | `6d8a15db1d3302f406b0806bb60907613647bd88d1daef9110f5c48b3ef5c8d9` |

The existing bootstrap URL stays unchanged. A saved dashboard release
reference has priority over the fallback; the user can use
"Обновить версию" on the separate assistant dashboard. Publication itself
did not change dashboard properties or involve Citrix control.

## Production Follow-Up, 20 October

The user explicitly requested a personal test with real Jira and live AI.
Testing used only the approved Citrix UI stack. No direct Jira requests,
credential reads, HAR export or model/provider changes were made.

The settings dialog showed the editable profile/template and the
32768/4096 context/reserve values after reloading the dashboard. Earlier
preparation and checking of the user's exploratory draft returned
clarifying questions and provider usage (7299 and 7387 total tokens).
This did not establish a successful creation scenario.

A clean, explicitly fictional bug draft was then entered in the selected
project with the Bug template and issue type. It described a disabled
login button after an incorrect password, reproduction steps, expected
behavior and an acceptance criterion. The text explicitly said this was
a test, not an incident or work request. No attachments or real incident
data were invented.

Observed results:

- Before selecting an issue type, the empty draft's estimated context
  exceeded its available budget (30743 versus 28672). Selecting Bug
  reduced it to 7517, and the complete test text produced an estimate of
  7894. Metadata/catalog scope, not just source text, drives the estimate.
- Preparation failed with "AI вернул ответ вне контракта. Проверьте
  данные вручную." A controlled retry with DevTools recording failed
  again. Jira metadata/catalog requests and the AI request returned HTTP
  200; the AI request took approximately 3.04 seconds.
- The observed model response contained a prepared summary and
  description, but represented `components` as an array of string IDs
  instead of the required array of `{id}` objects. This is one confirmed
  contract violation; it is not evidence that the model chose a
  semantically appropriate component.
- An offline isolation check using an existing synthetic metadata fixture
  confirmed that string component IDs reject the entire draft, while the
  same allowed ID wrapped as `{id}` is accepted. No production catalog
  was copied into a test fixture.
- The failed response reported 6510 input and 369 output tokens, 6879
  total. This was not a local token-budget rejection. The UI did not
  explain the offending field or show the usable proposed text.
- Excluding component and fix-version catalogs explicitly reduced the
  estimate to 5194, but another preparation still returned the same
  generic error. That response was not inspected; its exact violation
  remains undiagnosed. The workaround is therefore NOT verified.
- Repeated warnings were visible in the earlier successful check.
  Source inspection also shows the UI concatenating draft warnings with
  validation warnings after `markChecked` copies those warnings into the
  draft. No fix was made during this test.

The test stopped at preparation, without bypassing validation or pressing
Create. The local test draft remains in the widget, with components and
fix versions excluded from generation. No issue creation, attachment
upload, transition or assignment was performed. Production end-to-end
acceptance remains failed/incomplete.

Evidence is retained outside git in
`/Users/skivbox/.codex/citrix-prod-runs/ticket-assistant-create-20261020/`.
Relevant screenshots:

- `inspect-20261020-211658-23862.png`: verified complete test source.
- `inspect-20261020-211714-02501.png`: first preparation failure.
- `inspect-20261020-212118-16907.png`: successful network statuses.
- `inspect-20261020-212327-24257.png`: observed response contract violation.
- `inspect-20261020-212548-21128.png`: failure after explicit catalog exclusion.

Next: diagnose the remaining response violation, improve field-specific
safe diagnostics and the model/response contract, and regression-test the
warning duplication. Then repeat preparation, clarification, checking and
creation through Citrix. Do not describe the current workflow as ready
based only on successful HTTP responses or local tests.

## Response Fixes And Retest, 20 October

The user authorized fixes, Sol 6.1 Author/Reviewer, publication and one
explicitly synthetic production issue. Source/runtime `272cff2` and
bootstrap `28c846d` were pushed to `main`.

The confirmed string-ID shape failure is fixed by lossless normalization
of literal string IDs in multi-option arrays to `{id}` objects. Existing
generated-field scope, shape and catalog checks still apply. Unknown IDs,
labels instead of IDs, unsupported shapes and incomplete catalog
validation are not bypassed; the whole invalid response is still rejected.
Safe diagnostics now identify a fixed reason and, when known, a safe field
label. Raw model responses and arbitrary exception messages are not shown.
Identical draft/check warnings are displayed once.

The second historical rejection remains undiagnosed: its response was
not retained. Two later preparations with excluded component/version
catalogs succeeded even on the old code. This is not proof of a second
root-cause fix.

Sol 6.1 Author and independent Reviewer completed the changes and review;
the Reviewer found no actionable findings through `272cff2`. Parent
verification of the final code:

| Check | Result |
| --- | --- |
| Full unit/browser regression | 1944/1944, no failures/skips |
| Separate generated-runtime acceptance | 9/9, no failures/skips |
| Build/bootstrap after final pin | 46/46 |
| Personal local UI | Normalization, specific safe error, retained draft, single warning |
| Desktop/mobile screenshots | 1440/390 inspected |
| `git diff --check` | Clean |

The first full run failed three browser checks because the importer
fixture on port 4317 was not running. After starting that fixture, the
complete suite passed; the temporary fixture was stopped afterwards.
Local LLM requests used only stubs.

Published assets returned HTTP 200 and matched the tested local bytes:

| Asset | Reference | SHA-256 |
| --- | --- | --- |
| Bootstrap | `28c846d` | `fdb08b9ba92f81b3d5608eaa6da16fef9df43b07e68856c503ceebea745c05c1` |
| Runtime | `272cff2` | `aca2d247d6c4e18841659981cfe947c921acde34704fc2981ac0be32ba609caf` |
| CSS | `272cff2` | `6d8a15db1d3302f406b0806bb60907613647bd88d1daef9110f5c48b3ef5c8d9` |

Personal Citrix retest confirmed the newly loaded `28c846d` assets in the
browser's Network panel. Preparation succeeded with all catalogs enabled
(6746 input + 282 output = 7028 provider tokens), and with components and
fix versions explicitly excluded (4103 + 282 = 4385). The draft retained
the synthetic bug description and requested missing required Jira fields.
No issue has been created at this checkpoint; final checking and creation
remain pending. During manual selection of a required fix version, an
unexpected search character appeared without a corresponding typing
action in the agent log. UI control stopped and the user was asked
whether the screen was free. This does not establish a product defect
or prove user interference. Do not continue production writes until
control ownership is clear. Next: select the required real catalog value,
review the explicitly synthetic draft, check it, create exactly once and
verify the returned issue.

Local logs, reviewer reports and inspected screenshots are retained in
`/Users/skivbox/.cache/ujg-ticket-assistant-acceptance/2026-10-20-response-fixes/`.
Production evidence remains in the Citrix session directory above:
`inspect-20261020-215302-31363.png` (new assets),
`inspect-20261020-215336-08088.png` (all catalogs),
`inspect-20261020-215449-20424.png` (excluded catalogs).
These successful preparations alone do not establish end-to-end creation
acceptance or general quality across all three templates.

## Authorized Creation Completed, 20 October, 22:10 MSK

The user confirmed that the Citrix screen was free. The parent continued
the existing draft, without recreating it or changing the connection,
templates or provider. All production interaction used the Citrix UI.

- Selected one allowed required fix version; the required component had
  already been selected manually. An extra transient version selection
  was removed before validation, leaving exactly one selected version.
- Added an explicit opening paragraph to the description: a fictional
  assistant test, not work to perform; component/version selected only
  for this test. The summary and label also identify the test.
- Check returned a required clarification confirming that real logs were
  not applicable to the fictional case. Provider usage: 4191 input + 195
  output = 4386 tokens.
- Entered and submitted that clarification through the normal UI. The
  answer was appended to the source, without replacing the prepared draft.
- A second explicit Check returned no open questions and enabled Create.
  Provider usage: 4263 input + 40 output = 4303 tokens.
- Clicked Create once. The widget reported success, displayed the issue
  link and disabled further creation for that draft.
- Opened the returned issue. Its summary, complete description,
  reproduction steps, expected/actual behavior, acceptance criterion,
  test disclaimer, environment, label, component and one fix version
  matched the reviewed draft. No attachment was added or claimed.

The new issue had a server-selected assignee despite the assistant's
assignee field being empty. Jira also supplied its default priority and
initial status. No assignment or transition was performed after creation.
An empty assignee field must therefore not be described as a guarantee of
an unassigned Jira issue. The created issue was left open for the user;
no second issue, comment, cleanup or deletion was performed.

Evidence in the same private Citrix session:

- `inspect-20261020-220822-21890.png`: test disclaimer in the draft.
- `inspect-20261020-220839-06831.png`: required clarification.
- `inspect-20261020-220954-32488.png`: submitted answer in source.
- `inspect-20261020-221010-31116.png`: no open questions after Check.
- `inspect-20261020-221020-22706.png`: Create enabled.
- `inspect-20261020-221038-15825.png`: successful creation and locked draft.
- `inspect-20261020-221053-12693.png`: resulting Jira issue with saved fields.

The issue key/link is retained in private evidence and reported directly
to the user, not published in this repository.
The tested Bug flow is accepted end to end. Real incident quality, other
templates, attachment upload and handling every future model response
remain outside this single production test. The second historical
rejection's exact cause is still unknown.
