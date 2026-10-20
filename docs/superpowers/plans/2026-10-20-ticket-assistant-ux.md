# Ticket Assistant Guided Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking.

**Goal:** Turn the generic ticket validator into a compact assistant-guided editor.
**Architecture:** Extend the existing AI/controller/draft contracts for scoped proposals, add metadata-driven relation adapters, then integrate a compact UI. Keep all create safeguards and the existing release bootstrap.
**Tech Stack:** AMD JavaScript, jQuery, existing lucide icons, node:test, jsdom and offline browser fixture.
**Spec:** docs/superpowers/specs/2026-10-20-ticket-assistant-ux.md

## Global Constraints

- Work only in /Users/skivbox/.codex/worktrees/ticket-assistant/jira; preserve unrelated work.
- Authors and reviewers use gpt-6.1-sol, medium reasoning. No child agents from authors/reviewers.
- Existing shared LLM only, synthetic tests, no live Jira or LLM calls, no production writes.
- Preserve validation, storage/creation guards, explicit generation scope and all manual edits.
- No arbitrary autocomplete URL fetching, hardcoded project/custom field IDs, fabricated estimates or silent truncation.
- Manual edits use apply_patch. Generated bundles are rebuilt by the parent after integration.
- Node: /Users/skivbox/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
- NODE_PATH=/Users/skivbox/.cache/ujg-ticket-assistant-test/node_modules

## Review Focus

- Editing during a request or before Apply must invalidate the stale proposal.
- Multiple boards, incomplete relation catalogs and changed metadata must not authorize unknown values.
- Optional fields becoming filled/invalid/pending must surface without losing focus or selection.
- Unknown creation outcomes and multi-tab conflicts must still prevent duplicate submission.
- Popovers/fullscreen/mobile, keyboard navigation and long Russian labels must not obscure actions.

### Task 1: Field Assistance Contract

**Files:** ujg-ticket-assistant-modules/ai.js, controller.js, draft.js; corresponding tests/ticket-assistant-*.test.js.

**Interfaces:** Produce controller.assistField(id, action), rejectField(id), existing acceptField(id), and state.assistance for UI feedback. Actions: generate, improve, shorten. Return only one target proposal in draft.pendingFields; no direct field mutation. Keep existing prepare/check APIs compatible. Document final state shape in the author report.

- [x] Add failing tests: target-only context/proposal, empty target still pending, invalid target/foreign catalog ID rejected, protected other fields intact, reject, stale/stop/error/settings change, storage round-trip and creation locks.
- [x] Implement scoped prompts using the existing provider and safety/parser checks. Include source/template/current values; do not send user fields. Respect explicit generation exclusions. Do not invent numeric effort or dates unsupported by source.
- [x] Implement explicit Apply/Reject and invalidation. Existing Prepare behavior remains compatible. Local validation must not turn field assistance into unrelated whole-form questions.
- [x] Run focused unit tests; record red/green evidence and final interface in a report. Do not commit or rebuild bundles; parent integrates and commits after review.

### Task 2: Jira Relation And Numeric Fields

**Files:** ujg-ticket-assistant-modules/fields.js, api.js, validation.js, creator.js, controller.js, main.js, field-ui.js; corresponding unit/browser tests.

**Interfaces:** Metadata identifies Epic Link and Sprint via schema.custom; dynamic choices use the existing field-ui search callback and trusted API helpers. Extend controller with a bounded lookup/selection contract as needed; document it for Task 3. Keep canonical payload values appropriate to Jira's actual field schema.

- [x] Add failing tests for dynamic custom IDs, Epic key payloads, Sprint numeric payloads, real numeric Story Points, unknown schemas, forbidden/nonwritable fields and incomplete catalogs.
- [x] Implement trusted same-origin read adapters using existing repo Jira patterns; verify new API contracts against official Atlassian documentation. Never query production directly. Scope sprint discovery to a chosen board; active/future choices only, with permission/error states and cancellation.
- [x] Confirm selected relation values against current project/type metadata, preserve create-screen restrictions and refresh validation at creation. Handle multiple boards, stale searches, project switches and missing permissions explicitly.
- [x] Run focused tests and document endpoints/remaining production-only limitations. Do not commit or rebuild bundles.

### Task 3: Compact Guided Editor

**Files:** ujg-ticket-assistant-modules/ui.js, field-ui.js, icons.js, main.js if necessary, ujg-ticket-assistant.css; tests/browser/ticket-assistant-*.test.cjs; tests/browser/ticket-assistant-preview.cjs and acceptance fixture.

**Interfaces:** Consume Task 1 assistance methods and Task 2 relation selectors. Preserve existing controller creation/check/settings APIs and test hooks where possible.

- [x] Add failing UI tests for stable Summary-first ordering, compact header, token popover, fullscreen/Escape, optional field disclosure and pending/invalid field visibility.
- [x] Implement compact header, source/assistant column and wider editor. Put primary actions in an accessible persistent action area. No hero or decorative cards.
- [x] Add per-field AI icon/menu with named actions; proposal current/new comparison, Apply/Reject and target questions. Single assistant feedback area with field navigation; display catalog labels/reasons and disabled-control explanations.
- [x] Hide token detail until requested, retain visible limit errors. Preserve focus/drafts across renders, dialogs, fullscreen and responsive layout. No live calls from preview.
- [x] Extend synthetic preview for field assistance, Epic/Sprint/Story Points and large catalogs; test 1440px and 390px, long text, errors and cancellation. Run covering tests, report results; do not commit or rebuild bundles.

### Task 4: Review, Verify And Publish

**Files:** generated ujg-ticket-assistant assets; docs/ticket-assistant-dashboard-setup.md and new acceptance report.

- [x] Independent Sol 6.1 spec/quality review per task, then whole-change review. Resolve findings before publication.
- [x] Parent rebuilds only Ticket Assistant assets and runs full suite: node --test --test-concurrency=2 --test-reporter=tap tests/*.test.js tests/browser/*.test.cjs, plus dedicated browser acceptance.
- [x] Parent personally exercises the offline UI, including Apply/Reject, edit-in-flight, catalog selection, fullscreen, tokens, required/optional fields, desktop/mobile and synthetic create. Capture screenshots; do not call a live model or create another real issue.
- [ ] Commit only scoped files; fetch/check remote, push through existing main release flow, then pin bootstrap to verified code commit and check build tests/CDN byte equality. No force push.
- [ ] Update acceptance/setup docs with actual commits, tests, limitations and Citrix pending status. Return concise result and unchanged dashboard URL.
