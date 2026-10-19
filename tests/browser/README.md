# Offline Import Registry Tests

These fixtures use synthetic remarks and an in-memory Jira API substitute. They do not connect to Jira. The browser test blocks all non-local requests and verifies that no creation call is made, including when opening and cancelling the create dialog.

Install test-only dependencies outside the repository:

```sh
npm install --prefix /tmp/ujg-import-registry-test --no-save jquery@3.7.1 jsdom@26.1.0 xlsx@0.18.5 jszip@3.10.1 mermaid@11.15.0 playwright@1.62.1
export NODE_PATH=/tmp/ujg-import-registry-test/node_modules
node --test tests/browser/excel-story-importer-grid.test.cjs
node tests/browser/import-preview-server.cjs
```

With the local server running, use another terminal with the same `NODE_PATH`:

```sh
node tests/browser/verify-import-registry.cjs
node --test tests/browser/import-preview-startup.test.cjs
```

The default preview at `http://127.0.0.1:4317/` automatically imports and synchronizes its synthetic workbook against the in-memory API. It includes new, failed and partially created remarks, a 23-child tree, and compact expandable groups. No production startup behavior is changed. Use `/?empty=1` for the original manual-upload workflow; `/fixture.xlsx` provides the synthetic workbook.

The first parent description contains a Jira wiki table; its first BE child contains a Mermaid flowchart. The preview serves the pinned Mermaid bundle locally so diagram checks remain offline. The workbook uses the multiline `Ответственный от ТНТ` header found in the production source. Project/Epic and column preferences survive reloads; the column menu can reset the layout.

Descriptions, user search and the explicit Jira-only view also use local fixtures. Hovering or focusing a task opens its already-loaded description without another issue request. The page's Content Security Policy blocks external connections; creation APIs still throw instead of sending writes. Owner edits in this preview modify source data only, not Jira assignees.

Column titles toggle sorting; the adjacent Excel-style dropdown filters values. Priority sorting uses severity for standard Russian/English names, with custom names and empty values after known priorities. Sorting and filtering retain parent/child groups. The status filter can exclude completed tasks while keeping a context parent for matching children. The plus action opens new-Story confirmation for uncreated remarks or child-only confirmation for an existing Story; no final creation is allowed by the preview API.

The browser test uses installed Google Chrome, verifies automatic startup, tree expansion, header filters and manual upload, and checks desktop and mobile layouts. Screenshots go to `/tmp/ujg-import-registry-screenshots` (override with `IMPORT_SCREENSHOTS`). Repository tests remain dependency-free: `node --test tests/*.test.js`.

## Ticket Assistant Acceptance

Use the existing external dependencies; no repository install is needed. Verified runtime is `/Users/skivbox/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`, with `NODE_PATH=/Users/skivbox/.cache/ujg-ticket-assistant-test/node_modules` (parent restored the same pinned dependencies offline after restart cleared `/tmp`).

```sh
export PATH=/Users/skivbox/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
export NODE_PATH=/Users/skivbox/.cache/ujg-ticket-assistant-test/node_modules
export UJG_RELEASE_REF=a9c97fb
node build-ticket-assistant.js
node --test tests/ticket-assistant-*.test.js tests/browser/ticket-assistant-*.test.cjs tests/shared-llm-client.test.js tests/widget-bootstrap.test.js
node tests/browser/ticket-assistant-acceptance.cjs
node --test --test-concurrency=2 --test-reporter=tap tests/*.test.js tests/browser/*.test.cjs
```

The standalone acceptance runner is intentionally `.cjs`, outside the `*.test.cjs` glob. Run it explicitly. It loads the generated runtime, starts its own `startPreview({port:0})`, uses fresh Chrome contexts at 1440x900 and 390x844 with reduced motion, and closes its browser/context/server in `finally`. All API writes remain in fixture memory. Issue POST counters live in the Node fixture across page reloads; no actual HTTP POST is required. The fixture transports exercise the real AI JSON builder/parser, controller, personal store, creator and UI. Any external request or browser exception fails acceptance. No Jira or provider connection is used.

Coverage includes all three templates plus a fourth, source answers/protected edits, two projects and identities, JSON transfer, unsupported required metadata, retry/cancel/late response, timer focus/caret/scroll, long content, known/unknown creation and partial attachment recovery after reload. Coexistence now instantiates both generated runtimes in the same duplicate-rejecting AMD registry. The real importer main/rendering/grid loads two in-memory Jira fixture rows, sorts them and opens a loaded description; the real assistant performs Prepare while preserving the importer table. Computed styles on real controls are compared in both directions. The assistant is destroyed twice during a delayed Prepare; its late completion cannot restore its UI, and the importer still sorts afterward. Both shared-client AMD identities remain separate. Only API/transport boundaries are stubbed; no importer source or architecture changes were needed. The importer has no public destroy method, so context closure ends its lifecycle without inventing one.

Full-page screenshots and exact viewport companions (`*-viewport.png`) are written outside git to `/tmp/ticket-assistant-20261019/`. This includes `answers-protected-{1440,390}`, `settings-fourth-{1440,390}`, `progress-{1440,390}`, `long-last-field-{1440,390}`, `unsupported-{1440,390}`, `creation-{success,rejected,lostresponse,filefail}`, `file-partial`, `coexistence-1440` (both actual gadgets in the full-page image), and `coexistence-destroy-1440` (importer still working after assistant destruction).

For manual fixture-only use, `node tests/browser/ticket-assistant-preview-server.cjs` prints the local URL. Assistant preview 4320 needs no code-related restart: preview-server code was not changed. Parent restarted both servers after the app/OS restart. The long-running importer 4317 fixture retains its startup date, which can make its existing startup test fail after midnight. Initial execution on 20 October produced 1897/1898 in the author's single full run; an isolated repeat against 4317 failed, and the same unchanged test against a fresh ephemeral importer fixture passed 1/1. Later the parent independently ran the full suite with a fresh ephemeral importer fixture: 1898/1898. These pre-restart log files were lost with `/tmp`; their results remain historical. On final source `a9c97fb`, fresh checks are 214/214 profile/shared/bootstrap, 9/9 standalone acceptance, 46/46 after bootstrap pinning, and parent full suite **1908/1908**, exit 0. The independent scoped review closed all findings. Fresh logs/screenshots are additionally retained at `/Users/skivbox/.cache/ujg-ticket-assistant-acceptance/2026-10-20-a9c97fb/`; see [the acceptance report](../../docs/ticket-assistant-acceptance-2026-10-19.md).

Offline review cases use the same actual generated runtime and keep the normal preview default unchanged. `tests/browser/ticket-assistant-review.test.cjs` automates these in fresh contexts, with no external calls:

- `http://127.0.0.1:4320/?review=obsolete`: enter source, summary and "Заметки только для задачи", switch Jira type to "Ошибка", explicitly save/exclude the obsolete field, then Check. Its original named value appears in source. "Удалить черновик" asks for confirmation; cancel retains data, confirm clears source/fields/files, reload stays blank and personal settings remain.
- `http://127.0.0.1:4320/?review=catalog`: enter source/summary, Check, then open "Контур приёмки". Its unavailable catalog is explicit, Create stays disabled, and the ordinary Jira form link is scoped to project/type. The metadata autocomplete URL is never requested.
- `http://127.0.0.1:4320/?review=storage`: enter source, click "Имитировать отказ хранилища", then type within the source. Main's real memory-only warning appears immediately while text, editor identity, focus and caret remain intact.

Fresh artifacts include `review-{obsolete,catalog,storage,discard}.png` and exact 1440x900 `-viewport.png` companions, plus `review-obsolete-before.png`. The unchanged acceptance runner recreates 1440x900/390x844 evidence and actual importer coexistence screenshots. Publication and Citrix remain NO.
