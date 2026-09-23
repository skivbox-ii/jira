# Import Teams and Current Work Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Continue the existing importer branch; do not modify Jira issues or call production APIs.

**Goal:** Configure local teams, show current work under the remark coordinator, and reset saved LLM connection settings without losing other preferences.

**Architecture:** Isolated AMD teams module owns local team data and pure current-work inference. A separate teams editor uses existing user rows and callbacks. Main integrates these modules; grid shows evidence for all open tasks independently of visible filters. The existing shared LLM key is removed only after explicit confirmation.

**Tech Stack:** Existing AMD JavaScript, jQuery, Node tests, JSDOM, bundled importer.

## Accepted Behavior

- Team settings are scoped to current user and project in localStorage, never the remote mapping store. Teams have id, name, direction, task-role aliases, members with stable Jira identifiers, and a bounded color palette.
- Default role teams: BE, FE, DE, QA, SE, DevOps, implementation; all editable. Directions: development, testing, implementation, analysis, other.
- Owner cell preserves coordinator and adds current directions and task counts. A detail view lists issue key, status, assignee, and inference basis. Multiple directions are simultaneous, not a forced single phase.
- Explicit status phase takes precedence over role, then stable-id team membership. A generic parent assigned to a coordinator does not imply more development when child tasks already establish current work. Explicit parent testing/implementation status remains evidence.
- Missing/unknown status is not treated as active work; completed/cancelled tasks are excluded. All finished tasks do not prove handoff or acceptance. Unknown/unsynchronized/no-ticket states are explicit. Team ambiguity remains visible.
- LLM reset removes only `config.LLM_CONFIG_STORAGE_KEY` after confirmation, including malformed contents. Prompts, mappings, team settings, project/Epic, and column layout stay intact. Shared-key scope is disclosed. Disable reset while an LLM request is in flight; no LLM request is sent by reset.

## Tasks

- [ ] Add tests for team normalization, per-user/project storage, multi-direction inference, closed/unknown statuses, parent ownership distinction, conflicting membership, and partial data. Implement `teams.js` exporting `defaults`, `normalize`, `storageKey`, `load`, `save`, `currentWork`, `directions`, `colors`.
- [ ] Add isolated `teams-ui.js` and DOM tests for add/edit/remove teams, role aliases, color swatches, direction select, member multiselect. Selected members remain pinned and removable while searching, matching AGENTS.md.
- [ ] Integrate settings into main/rendering/build and preview. Preserve assignee stable identifiers during synchronization. Persist local teams only and guard late user-search results across project changes.
- [ ] Add owner-cell current-work details to grid with DOM tests. Preserve existing owner edits, rowspans, sorting/filtering, and fullscreen behavior. Detail view remains read-only.
- [ ] Add failing LLM reset integration and button tests, implement targeted removal/confirmation/error handling, verify next AI use requests new config without calling live LLM.
- [ ] Rebuild importer public/runtime only. Run `env NODE_PATH=/tmp/ujg-import-registry-test/node_modules node --test tests/*.test.js tests/browser/excel-story-importer-grid.test.cjs tests/browser/import-preview-startup.test.cjs` plus new teams DOM tests. Review scoped diff and verify desktop/mobile preview.
- [ ] Publish with existing non-force release flow after tests pass; Citrix UI verification only, do not click live LLM reset or issue-write commands.

## Verification

Implementation and integration completed. The full test command including the new teams UI tests passes: 776 tests, zero failures. Importer public and runtime bundles rebuilt; shared bootstrap references unchanged.

Read-only code review caught draft/focus loss on async member search; fixed with regression tests covering draft/caret preservation, member selection and chip removal during a nonmatching search. Ready-for-testing fallback status is no longer mistaken for completion.

Local browser checks passed: simultaneous development/testing details, team membership persistence across reload, selected members retained during search, desktop/390px layout, LLM confirmation/cancel. No live LLM reset or Jira issue write was performed. Citrix skill inspection could not find a visible Citrix/XView window, so production UI verification remains pending.
