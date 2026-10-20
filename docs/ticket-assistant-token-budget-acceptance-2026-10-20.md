# Ticket Assistant: Prompt Settings And Token Budget

Date: 20 October 2026 (Europe/Moscow).
Source/runtime: `21238c243d5babb961440aefe38a856f204c80f0`.
Bootstrap: `364e118`, pushed to `main`.
Status: implemented, locally verified and published. This version has not
been personally accepted in Citrix; no live LLM or Jira write was performed.

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
"Обновить версию" on the separate assistant dashboard. The agent did not
change dashboard properties or control Citrix in this task.

Next: read-only verification of the new settings in Citrix when the screen
is available. A live LLM run remains the user's explicit action.
