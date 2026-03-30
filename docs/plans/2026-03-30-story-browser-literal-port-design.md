# Story Browser Literal Port Design

**Goal:** Replace the current Story Browser create modal with a near-literal runtime port of the Lovable reference modal while preserving the existing Jira-backed create flow for Epic, Story, and child issues.

## Approved Decisions

- Use a **literal port** approach, not a restyle of the existing `ujg-sb-create-*` layout.
- Match the **live reference modal** from [Lovable App](https://preview--daily2-diligence-board.lovable.app/) rather than the earlier generic form layout.
- Repeat the **runtime DOM order, utility-style class structure, spacing, tiny controls, and interaction model** as closely as practical inside the gadget.
- Move epic selection into the **top epic tree row**:
  - clicking the epic key/title can switch to an existing epic selector
  - when an existing epic is selected, the editable new-epic fields disappear
  - when the existing epic is cleared, the epic row becomes editable again for creating a new epic
- Keep the visible controls from the reference **working**, not decorative, with one approved exception:
  - `+link` and `+ блокер` are **out of scope for this pass**
  - they must not affect Jira payload construction in this pass

## Reference Contract

The port must match these reference traits:

- Overlay shell:
  - `fixed inset-0 z-50 flex items-start justify-center pt-2 bg-black/60 backdrop-blur-sm`
- Dialog shell:
  - `bg-card border border-border rounded-lg shadow-2xl w-[95vw] max-w-[1800px] max-h-[96vh] flex flex-col`
- Header content:
  - compact KPI-style summary row such as `CORE Σ 26ч оценка · 0ч списано · 5 задач`
  - right-aligned `Создать` and close controls
- Tree layout:
  - epic row at top
  - nested story row below epic
  - child rows below story
  - tiny inline action links such as `+компонент`, `+метку`, `+ описание`
  - view toggles `Таблица`, `Аккордеон`, `Строки`
  - add-role chips `+SE`, `+FE`, `+BE`, `+QA`, `+DO`
  - bottom tabs `Активность`, `Комментарии`, `Списания`

## Architecture

Keep the existing data/API/create pipeline as the backend layer:

- `ujg-story-browser-modules/api.js`
- `ujg-story-browser-modules/main.js`
- `ujg-story-browser-modules/rendering.js`
- `ujg-story-browser-modules/create-story.js` submit/search logic

Replace the modal renderer and modal-specific UI state with a literal-port view layer:

- rebuild `renderCreateModal()` around the reference shell and tree structure
- add literal-port row render helpers for epic, story, and child rows
- preserve async selector safety, double-submit protection, and partial-failure handling

## UI State Model

Extend the draft UI state to support the reference interactions:

- `draft.ui.viewMode = "table" | "accordion" | "rows"`
- `draft.ui.activeTab = "activity" | "comments" | "worklogs"`
- `draft.ui.epicSelectionMode = "new" | "existing"`
- stable per-row ids for child rows so the DOM is predictable while adding/removing rows
- per-row local state for:
  - inline summary editing
  - description expansion
  - selector popover state
  - estimate/status/sprint display helpers

## Behavior Contract

### Epic Row

- The epic row is the source of truth for whether the draft creates a new epic or attaches to an existing one.
- Selecting an existing epic hides the createable epic summary/description/components/labels fields.
- Reverting to a new epic restores those editors without losing unrelated story/child state.

### Story And Child Rows

- Story and child summaries are edited inline from the tree row itself.
- `+ описание` expands row-local description editors under the row.
- Assignee, components, and labels use compact inline selectors in the row, but still use the current Jira-backed APIs.
- `Таблица`, `Аккордеон`, and `Строки` switch the child row presentation while keeping the same underlying draft data.
- `+SE`, `+FE`, `+BE`, `+QA`, and `+DO` add real child rows from the template set.

### Out Of Scope For This Pass

- `+link`
- `+ блокер`
- Jira issue link creation after submit

They are explicitly deferred to a later pass.

## Risk Notes

- The current create modal is structurally unlike the reference, so this is primarily a renderer rewrite, not a small patch.
- The literal utility-style DOM must stay **scoped to Story Browser** so it does not bleed into the rest of the gadget.
- The bundle outputs (`ujg-story-browser.js`, `ujg-story-browser.runtime.js`) must remain in sync with source after the rewrite.

## Files Expected To Change

- `jira/ujg-story-browser-modules/create-story.js`
- `jira/ujg-story-browser.css`
- `jira/ujg-story-browser-modules/rendering.js`
- `jira/ujg-story-browser-modules/main.js`
- `jira/tests/story-browser-create-story.test.js`
- `jira/tests/story-browser-css.test.js`
- `jira/tests/story-browser-rendering.test.js`
- `jira/tests/story-browser-main.test.js`
- `jira/ujg-story-browser.js`
- `jira/ujg-story-browser.runtime.js`
