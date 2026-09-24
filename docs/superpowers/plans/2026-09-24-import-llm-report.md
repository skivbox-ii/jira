# LLM Report and Questions

## Contract

Execute AI-01 then AI-02 from `docs/import-management-backlog.md` continuously,
as requested by the user. Work in the existing `codex/import-registry-details`
checkout. No production Jira writes, direct production API calls, or live LLM
test requests. Preserve user-owned untracked documents. Existing LLM settings
are reused only after an explicit user action.

- Visible `LLM-отчёт` command in the compact Dynamics toolbar; accessible modal
  with Russian Markdown, issue links, role colors, exact cutoff and coverage.
- Code computes facts. Jira text is untrusted evidence, not instructions.
- Each request fits the existing shared client's 42000 UTF-8 byte user limit
  and 6000 byte base limit. Partition complete source records, never silently
  trim. Oversized indivisible records fail explicitly before requesting.
- Parts retain source keys and event coverage. Show progress and partial
  failures; do not present an incomplete generation as a complete report.
- Questions use the same immutable snapshot and conversation. Scope changes
  isolate the session; data refresh marks existing output stale. Late requests
  cannot replace a newer session. Missing settings, cancellation and failures
  retain the question and keep the rest of the widget usable.
- Output renders inert HTML and images; only safe links, headings, lists,
  tables, emphasis and code. Local preview uses an explicit mock response.

## Tasks

- [x] Context and request engine: `activity-ai.js`, pure regression tests.
- [x] Dialog and entry point: `activity-ai-ui.js`, `activity-ui.js`, CSS,
  browser regressions. Implement report first, then same-snapshot questions.
- [x] Safe Markdown renderer based on an isolated, vendored Marked instance:
  `activity-markdown.js`, focused browser tests.
- [x] Shared-client transport in `main.js`, importer build order, preview
  integration. Unit tests before implementation.
- [ ] Independent review, full suite, build, desktop/mobile UI verification,
  scoped publication and read-only Citrix acceptance. Update backlog states.

## Module Interfaces

`_ujgESI_activityAi.prepare(report, scope)` returns an immutable serializable
plan with `scopeKey`, `fingerprint`, `date`, `asOf`, `metrics`, `coverage`,
`eventCount` and `parts` (requests). Scope contains projectKey, epicKey, baseUrl,
preferencesStorageKey. Fingerprint excludes volatile generatedAt, but includes
the actual cutoff, evidence and teams. Changes in journal filters do not alter
the report context.

`activityAi.run(plan, requestText, options)` returns a promise of
`{markdown, completedParts, totalParts, eventCount}`. `requestText(request)`
returns `{text}` through the existing shared client. Options: `question`,
`history` (array of `{question,answer}`), `onProgress({completed,total})`,
`isCancelled()`. Throws on incomplete failure with readable message and
partial Markdown if available. Batches provide all source data for both report
and questions, with exact code totals not summed by the model.

`_ujgESI_activityMarkdown.render(text, {baseUrl,teams})` returns a jQuery node.

`_ujgESI_activityAiUi.create()` returns `update(report,state,services)`,
`open(anchor)`, `dismiss()` (boolean), `destroy()`. Services include
`onActivityLlmRequest(request)`. The main transport resolves existing config
and calls llmClient; AI-specific busy state belongs to this UI controller.

## Review and Evidence

### Grounded Question Contract

For questions, try repeating the complete conversation in each Jira evidence
request, checking actual serialized sizes first. If it does not fit, send all
raw history in bounded fragments to an internal context-extraction stage.
Carry every extracted note into the final Jira request batches, explicitly
marking the notes as untrusted model summaries. Preflight the entire final
pass; fail clearly when notes leave insufficient room for a source record.
Do not silently trim, recursively compact, or display extraction responses as
answers. Each published answer part must have Jira evidence (or exact global
code facts for an empty source). Cancellation or extraction failures must not
leak internal notes as a partial answer. Progress has separate `context` and
`answer` phases; result counts describe the final answer only.

Base: `0a1cc02`. Separate write ownership for engine, UI and Markdown; main
agent owns transport/build/preview and integration tests. Interfaces above are
shared contracts, so integration tests must exercise real modules together.
Implementation is present. Final review found and fixed stale scope drafts,
regeneration history leakage, detached focus anchors, cached role colors and
orphaned body-mounted dialogs during reinitialization. Provider requests no
longer contain the full team roster or local session identifiers. Source
provenance follows each part; effort is labeled as a current snapshot.

1088 tests passed on the final integrated implementation. Desktop (1440x1000)
and mobile (390x844) mock checks confirmed generation, linked keys and roles,
question submission and scrollable tables without document overflow. Long
conversation fields now travel as Unicode-safe fragments with turn, origin,
field and part provenance; coverage metadata accompanies every request. Tests
reconstruct the original text exactly and retain every Jira event. Oversized
current questions and indivisible source records fail before transport.

Source text is escaped during Marked token walking, before internally generated
list HTML. The security rereview passed 417 adversarial DOM probes, including
raw blocks inside nested loose task lists, without unsafe elements, attributes,
links or resource requests. Full suite: `/tmp/ujg-llm-final.tap`, 1088 passed,
0 failed; `git diff --check` passed. Production acceptance remains pending.
