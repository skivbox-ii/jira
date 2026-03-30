# Story Browser Literal Port Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the Story Browser create modal so it matches the Lovable reference shell, DOM shape, and interactions while keeping the current Jira-backed create flow for Epic, Story, and child issues.

**Architecture:** Keep the current API/search/create chain as the backend layer, but replace the modal-specific renderer and UI state with a literal-port view model in `create-story.js`. Use scoped CSS utilities to mirror the reference runtime classes and keep `+link` / `+ блокер` out of scope for this pass.

**Tech Stack:** AMD modules, jQuery DOM rendering, scoped CSS, Node `--test`, Jira REST API, generated Story Browser bundle/runtime assets.

---

### Task 1: Lock The Reference Contract In Tests

**Files:**
- Modify: `jira/tests/story-browser-create-story.test.js`
- Modify: `jira/tests/story-browser-css.test.js`
- Modify: `jira/tests/story-browser-rendering.test.js`

**Step 1: Write the failing tests**

Add focused tests that assert:

- the modal shell uses the literal dialog structure from the reference
- the top summary row exists instead of the old `Создание истории` title shell
- the epic row exposes inline epic selection instead of the old radio-toolbar
- the child-area view toggles render as `Таблица`, `Аккордеон`, `Строки`
- the add-role chips `+SE`, `+FE`, `+BE`, `+QA`, `+DO` are present
- `+link` and `+ блокер` are **not** wired into Jira payload creation for this pass

Example assertion to add:

```javascript
test("renderCreateModal uses literal-port dialog shell", function() {
    var rendered = renderCreateModalToHtml(makeDefaultDraft("CORE"));
    assert.match(rendered, /fixed inset-0 z-50/);
    assert.match(rendered, /bg-card border border-border rounded-lg shadow-2xl/);
    assert.match(rendered, /Σ .* задач/);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/story-browser-create-story.test.js tests/story-browser-css.test.js tests/story-browser-rendering.test.js`

Expected: FAIL because the current modal still renders the old `ujg-sb-create-*` shell and radio-toolbar epic mode picker.

**Step 3: Record the exact missing contract**

Before changing production code, note which assertions failed:

- old shell title still present
- literal utility classes missing
- inline epic selector missing
- reference child action chips missing

**Step 4: Commit the red test state**

```bash
git add tests/story-browser-create-story.test.js tests/story-browser-css.test.js tests/story-browser-rendering.test.js
git commit -m "test: lock story browser literal port contract"
```

### Task 2: Reshape Create Draft UI State

**Files:**
- Modify: `jira/ujg-story-browser-modules/create-story.js`
- Test: `jira/tests/story-browser-create-story.test.js`

**Step 1: Write the failing test**

Add tests for the new UI state contract:

- `draft.ui.viewMode`
- `draft.ui.activeTab`
- inline epic selection mode in the epic row
- stable child row ids
- hiding new-epic fields when an existing epic is chosen

Example test:

```javascript
test("makeDefaultDraft initializes literal-port ui state", function() {
    var draft = createStory.makeDefaultDraft("CORE");
    assert.equal(draft.ui.viewMode, "rows");
    assert.equal(draft.ui.activeTab, "activity");
    assert.equal(draft.ui.epicSelectionMode, "new");
    assert.ok(draft.children[0].ui.rowId);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/story-browser-create-story.test.js`

Expected: FAIL because those state fields do not exist yet.

**Step 3: Write minimal implementation**

In `create-story.js`:

- extend `makeDefaultDraft()` to initialize literal-port UI state
- add helper(s) to switch epic mode from the epic row itself
- add stable row ids for children
- keep existing submit/search state fields intact

**Step 4: Run test to verify it passes**

Run: `node --test tests/story-browser-create-story.test.js`

Expected: PASS for the new draft-shape tests.

**Step 5: Commit**

```bash
git add tests/story-browser-create-story.test.js ujg-story-browser-modules/create-story.js
git commit -m "feat: add literal-port story draft state"
```

### Task 3: Rewrite The Modal Renderer As A Literal Port

**Files:**
- Modify: `jira/ujg-story-browser-modules/create-story.js`
- Modify: `jira/tests/story-browser-create-story.test.js`
- Modify: `jira/tests/story-browser-rendering.test.js`

**Step 1: Write the failing test**

Add tests that expect:

- overlay `fixed inset-0 z-50 ...`
- dialog `bg-card border border-border rounded-lg shadow-2xl w-[95vw] max-w-[1800px] max-h-[96vh] flex flex-col`
- KPI-style summary header
- inline epic row, story row, child rows
- view toggle group and bottom tab group

Example test:

```javascript
test("renderCreateModal moves epic selection into the epic row", function() {
    var draft = createStory.makeDefaultDraft("CORE");
    var html = renderCreateModalToHtml(draft);
    assert.match(html, /CORE-200|—/);
    assert.doesNotMatch(html, /Эпик:\s*Новый/);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/story-browser-create-story.test.js tests/story-browser-rendering.test.js`

Expected: FAIL because the old renderer still outputs the generic modal structure.

**Step 3: Write minimal implementation**

Refactor `renderCreateModal()` into literal-port helpers:

- `renderModalShell()`
- `renderSummaryBar()`
- `renderEpicBranch()`
- `renderStoryBranch()`
- `renderChildRow()`
- `renderViewModeToggles()`
- `renderBottomTabs()`

Important constraints:

- do not reintroduce the old top radio-toolbar epic mode picker
- keep assignee/component/label selector wiring working inside the new row layout
- keep `+link` and `+ блокер` out of Jira payload logic for this pass

**Step 4: Run test to verify it passes**

Run: `node --test tests/story-browser-create-story.test.js tests/story-browser-rendering.test.js`

Expected: PASS for the shell and interaction contract.

**Step 5: Commit**

```bash
git add tests/story-browser-create-story.test.js tests/story-browser-rendering.test.js ujg-story-browser-modules/create-story.js
git commit -m "feat: port story browser create modal shell"
```

### Task 4: Port The Reference Styling Literally But Safely

**Files:**
- Modify: `jira/ujg-story-browser.css`
- Modify: `jira/tests/story-browser-css.test.js`

**Step 1: Write the failing test**

Add CSS contract assertions for the literal-port shell:

- overlay/dialog/header classes
- compact row spacing and tiny text actions
- selected view toggle styles
- add-role chips
- bottom tabs

Example assertion:

```javascript
assert.match(css, /\.ujg-story-browser .*bg-card/);
assert.match(css, /\.ujg-story-browser .*w-\[95vw\]/);
assert.match(css, /\.ujg-story-browser .*text-\[7px\]/);
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/story-browser-css.test.js`

Expected: FAIL because the current CSS still describes the older custom modal system.

**Step 3: Write minimal implementation**

In `ujg-story-browser.css`:

- add a scoped utility layer that reproduces the reference shell and row styling
- keep selectors scoped to Story Browser / popup host so there is no global bleed
- keep existing picker support styles only where still needed

**Step 4: Run test to verify it passes**

Run: `node --test tests/story-browser-css.test.js`

Expected: PASS with the new literal-port shell selectors present.

**Step 5: Commit**

```bash
git add tests/story-browser-css.test.js ujg-story-browser.css
git commit -m "feat: add literal-port story browser modal styling"
```

### Task 5: Wire Existing Jira Behavior Into The New UI

**Files:**
- Modify: `jira/ujg-story-browser-modules/create-story.js`
- Modify: `jira/ujg-story-browser-modules/main.js`
- Modify: `jira/tests/story-browser-create-story.test.js`
- Modify: `jira/tests/story-browser-main.test.js`

**Step 1: Write the failing tests**

Add tests for:

- selecting an existing epic hides new-epic create fields
- clearing the existing epic restores new-epic editing
- `Таблица` / `Аккордеон` / `Строки` mutate only view state
- `+SE` / `+FE` / `+BE` / `+QA` / `+DO` append real rows
- submit still creates Epic/Story/children correctly
- `+link` and `+ блокер` remain out of submit payloads

Example test:

```javascript
test("selecting an existing epic hides new-epic editors", function() {
    var draft = createStory.makeDefaultDraft("CORE");
    draft.ui.epicSelectionMode = "existing";
    draft.existingEpicKey = "CORE-200";
    var html = renderCreateModalToHtml(draft);
    assert.doesNotMatch(html, /Новый эпик/);
    assert.match(html, /CORE-200/);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/story-browser-create-story.test.js tests/story-browser-main.test.js`

Expected: FAIL because the new UI state is not fully wired to the existing create flow yet.

**Step 3: Write minimal implementation**

- finish the inline epic selection handlers
- wire view-mode toggles to `draft.ui.viewMode`
- wire bottom tabs to `draft.ui.activeTab`
- wire add-role chips to real child row creation helpers
- keep submit/partial failure/stale async behavior intact

**Step 4: Run test to verify it passes**

Run: `node --test tests/story-browser-create-story.test.js tests/story-browser-main.test.js`

Expected: PASS with the literal-port interactions driving the same Jira-backed create flow.

**Step 5: Commit**

```bash
git add tests/story-browser-create-story.test.js tests/story-browser-main.test.js ujg-story-browser-modules/create-story.js ujg-story-browser-modules/main.js
git commit -m "feat: wire literal-port story modal interactions"
```

### Task 6: Rebuild Generated Assets And Verify End To End

**Files:**
- Modify: `jira/ujg-story-browser.js`
- Modify: `jira/ujg-story-browser.runtime.js`
- Modify: generated bootstrap assets only if the generator output changes

**Step 1: Rebuild Story Browser outputs**

Run: `node build-story-browser.js`

Expected: regenerated `ujg-story-browser.js`.

**Step 2: Rebuild runtime/bootstrap assets if required**

Run: `node build-widget-bootstrap-assets.js`

Expected: regenerated `ujg-story-browser.runtime.js` and any required bootstrap fallbacks.

**Step 3: Run targeted verification**

Run:

```bash
node --test tests/story-browser-create-story.test.js tests/story-browser-css.test.js tests/story-browser-rendering.test.js tests/story-browser-main.test.js tests/story-browser-api-data.test.js
```

Expected: PASS.

**Step 4: Run full verification**

Run:

```bash
node --test tests/*.test.js
```

Expected: PASS with zero failures.

**Step 5: Commit**

```bash
git add ujg-story-browser.js ujg-story-browser.runtime.js ujg-story-browser.bootstrap.js ujg-*.bootstrap.js
git commit -m "feat: ship literal-port story browser modal"
```
