# Ticket Assistant Pico Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Execute with Sol 6.1 Author/Reviewer, preserving the user's chosen workflow.

**Goal:** Replace the primary ticket-assistant form with a conversational Pico workflow and one editable, validated Jira task card.

**Architecture:** Pi manages conversation and bounded tools. Existing Jira controller, field editors, settings storage and creator own application state and writes. A chat shell presents that state and opens the existing editor on demand.

**Tech Stack:** Existing AMD/jQuery widget; pinned Pi Core/Pi AI 1.4.0 browser bundle, existing shared LLM connection; Node tests and Playwright with mocked transports.

**Spec:** `docs/superpowers/specs/2026-11-03-ticket-assistant-pico-chat.md`

## Global Constraints

- Existing LLM connection and deployment mechanism; no new provider or mandatory server.
- No model tool creates Jira issues or commits template edits.
- One canonical draft for chat, task card and manual editor.
- Preserve required metadata checks, explicit manual fields, stale-result guards and duplicate-create protection.
- Keep user/project/origin storage isolation and existing settings import/export.
- Preserve draft text and report errors/incomplete context without silent truncation.
- Product code implementation follows review of this plan; this document is not evidence of completed implementation.

## Review Focus

- A response arriving after manual editing or project/template switching must not overwrite the new state (Task 2).
- A request to edit a template must not silently alter the active task or save a template (Task 2).
- A restored chat containing prior tool calls must not replay operations (Tasks 1 and 2).
- Concurrent tabs or an unknown creation result must not allow duplicate Jira issues (Tasks 2 and 3).
- A text-only/legacy LLM endpoint must not fail behind an apparently working chat (Task 1).

### Task 1: Pico Runtime and Existing LLM Transport

**Files:** create `ujg-ticket-assistant-chat/runtime.mjs`, `ujg-ticket-assistant-chat/transport.mjs`, its package/lock and build script, bundled AMD asset under `vendor/`; modify `build-ticket-assistant.js`; test `tests/ticket-assistant-chat-runtime.test.cjs`.

**Interfaces:** expose `_ujgTA_picoRuntime.createSession({system, messages, tools, requestText, tokenBudget, onEvent})` returning `{prompt(text), abort(), getMessages(), dispose()}`. `requestText` delegates to the configured shared client and carries AbortSignal. Tool definitions supply names, JSON schemas and validated execute callbacks. Events expose assistant text, tool progress, limits, errors and completion, never hidden reasoning.

- [x] Inspect the referenced Pico runtime, package licences and existing shared-client protocol; record the adapter choice in the spec.
- [x] Add mocked multi-turn/tool-result tests for chat-completions and the existing legacy completions configuration, cancellation and malformed calls.
- [x] Implement the Pi-backed runtime and adapter. If using a structured text tool envelope for the existing endpoint, validate it before translating to Pi events and return every tool result to the loop.
- [x] Bound each user turn to 8 model calls, 12 tool calls and 180 seconds; also enforce the existing configured context/reserve. Stop with a useful message when any bound is reached.
- [x] Preserve complete tool-call/result pairs in restored history; never execute historical calls. Implement explicit history compaction preserving current authoritative task state.
- [x] Build the dependency into the widget without runtime npm/CDN dependencies. Verify licence notices and AMD module registration.
- [x] Run runtime tests and build tests; obtain a Sol 6.1 review before integration.

### Task 2: Task and Template Chat Operations

**Files:** create `ujg-ticket-assistant-modules/chat.js`, `chat-tools.js`; modify `controller.js`, `draft.js`, `storage.js`, `main.js`; tests `tests/ticket-assistant-chat.test.js`, `tests/ticket-assistant-chat-tools.test.js` and relevant existing tests.

**Interfaces:** `_ujgTA_chat.create({controller, runtime, store, onChange})` returns `{send(text), stop(), getState(), undo(), applyTemplateProposal(), rejectTemplateProposal(), destroy()}`. Chat state contains transcript, operation status, error, pending template diff and undo availability; task values remain in `controller.getState().draft`.

- [x] Test the tools listed in the spec, required-field reporting, foreign IDs, unsupported fields and manual-value protection.
- [x] Add controller operations for validated automatic patches and revision-checked undo; reuse draft and validation logic instead of calling updateField as though the model were a human.
- [x] Implement exact template reading and explicit proposal/application with settings revision checks and current-task exception scope.
- [x] Store conversation state scoped by user, project and draft ID. Restore old drafts, handle quota failures and preserve cross-tab conflicts.
- [x] Cancel or invalidate active requests after selection changes, new/discarded drafts and manual edits. Test late responses and pending template conflicts.
- [x] Test that neither malicious source text nor tool arguments can invoke creator or change protected settings.
- [x] Run relevant controller/storage/creator regressions and obtain independent review.

### Task 3: Chat, Task Card and Manual Editor

**Files:** create `ujg-ticket-assistant-modules/chat-ui.js`; modify `ui.js`, `main.js`, `ujg-ticket-assistant.css`, `icons.js` only as needed; update offline preview and add `tests/browser/ticket-assistant-chat.test.cjs`.

**Interfaces:** chat UI renders chat state and canonical controller state; existing UI exposes open/close manual-editor methods while retaining settings, field edits, attachment handling and creation actions. Runtime/controller updates refresh both views without losing keyboard focus or unsent composer text.

- [x] Build the compact project/template header, message log and composer. Type selection remains available when unmapped and inside the manual editor.
- [x] Render one current task card with pending questions, changed values, undo, edit and create; creation calls the existing controller.
- [x] Move the existing manual form into an accessible panel with focus restoration and responsive full-screen behavior.
- [x] Render template display/diff cards with explicit apply/reject. Safely render message Markdown without executing HTML or changing Jira description semantics.
- [x] Test conversational bug preparation, clarifications, manual editing, template changes, reload and one mocked creation end to end.
- [x] Test 1440/390 px, keyboard/focus, cancellation/retry, host resizing, long messages and existing-draft migration. Inspect screenshots personally.
- [x] Run affected tests plus the full required repository gate; complete whole-change Sol 6.1 review and resolve findings.

### Task 4: Publication and Acceptance

**Files:** generated source/runtime/bootstrap, `docs/ticket-assistant-dashboard-setup.md`, a dated chat acceptance report.

- [x] Record checks, known limits, migration behavior and production acceptance still pending.
- [x] Commit verified source/runtime, pin bootstrap to that source commit and push using the established main publication process.
- [x] Verify commit-pinned runtime/CSS/bootstrap on CDN against local files.
- [x] Leave a working local mock preview and provide its URL (`http://127.0.0.1:4321/`).
- [ ] Citrix acceptance remains separate: perform read-only acceptance when the screen is available; any live creation needs its own explicit user authorization.
