# Widget Bootstrap URLs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add stable `*.bootstrap.js` entrypoints for all UJG widgets so Jira gadget configs stop depending on manual commit SHA updates while each widget load still uses one internally consistent release version.

**Architecture:** Keep all current public widget bundles untouched for backward compatibility. Add a new generator that derives `*.runtime.js` files from already-built widget bundles and emits `*.bootstrap.js` files that expose the existing public AMD names, load `_ujgCommon.js` + CSS + runtime JS pinned to one embedded release ref, and then instantiate the runtime module.

**Tech Stack:** Node.js build scripts, AMD/RequireJS, plain JavaScript, jsDelivr GitHub CDN, Node test runner

---

### Task 1: Add a focused bootstrap asset test suite

**Files:**
- Create: `tests/widget-bootstrap.test.js`
- Reference: `tests/standalone-daily-diligence.test.js`
- Reference: `tests/user-activity-repo.test.js`

**Step 1: Write the failing test**

Create tests that describe the expected generator output:

```javascript
test("bootstrap generator emits daily diligence runtime and bootstrap outputs", function() {
    var mod = require(path.join(__dirname, "..", "build-widget-bootstrap-assets.js"));
    var out = mod.buildAssets({
        releaseRef: "abc1234",
        widgets: [mod.WIDGETS.dailyDiligence]
    });

    assert.match(out["ujg-daily-diligence.runtime.js"], /define\("_ujgDailyDiligenceRuntime"/);
    assert.match(out["ujg-daily-diligence.bootstrap.js"], /define\("_ujgDailyDiligence"/);
    assert.match(out["ujg-daily-diligence.bootstrap.js"], /abc1234/);
    assert.match(out["ujg-daily-diligence.bootstrap.js"], /ujg-daily-diligence\.css/);
});
```

Add a second test for the `Timesheet` rename path:

```javascript
test("timesheet runtime rewrites the public AMD name to a dedicated runtime name", function() {
    // build from current ujg-timesheet.js and assert _ujgTimesheetRuntime exists
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/widget-bootstrap.test.js`

Expected: FAIL because `build-widget-bootstrap-assets.js` and generated outputs do not exist yet.

**Step 3: Write minimal implementation**

Create only the exported surface required by the tests:

- `WIDGETS`
- `buildAssets(options)`
- placeholder transformation logic

Do not generate real files yet; return in-memory strings first.

**Step 4: Run test to verify it passes**

Run: `node --test tests/widget-bootstrap.test.js`

Expected: PASS for the initial output shape.

---

### Task 2: Implement the shared bootstrap asset generator

**Files:**
- Create: `build-widget-bootstrap-assets.js`

**Step 1: Extend the failing tests**

Add coverage for:

- `releaseRef` from explicit option
- `releaseRef` fallback from `process.env.UJG_RELEASE_REF`
- `releaseRef` fallback from `git rev-parse --short HEAD`
- unsupported widget source throws a descriptive error

**Step 2: Run test to verify it fails**

Run: `node --test tests/widget-bootstrap.test.js`

Expected: FAIL because the generator does not yet resolve release refs or validate inputs correctly.

**Step 3: Write minimal implementation**

Implement:

- `resolveReleaseRef()`
- widget config table for all six widgets
- transform helper for runtime AMD rename
- bootstrap template generator with:
  - public AMD name
  - immutable `releaseRef`
  - `_ujgCommon.js` URL
  - widget CSS URL
  - widget runtime JS URL

Generator API should be pure enough to test in-memory and also support writing files later.

**Step 4: Run test to verify it passes**

Run: `node --test tests/widget-bootstrap.test.js`

Expected: PASS for release ref resolution and runtime/ bootstrap text generation.

---

### Task 3: Add browser-like runtime loading tests

**Files:**
- Modify: `tests/widget-bootstrap.test.js`

**Step 1: Write the failing test**

Add a fake DOM + fake AMD harness test:

```javascript
test("bootstrap dedupes CSS and JS loads and instantiates the runtime gadget", function(done) {
    // create fake document/head/script/link nodes
    // create fake window.__UJG_BOOTSTRAP__
    // simulate script load completion
    // assert only one _ujgCommon and one runtime script are appended
    // assert runtime gadget constructor receives API
});
```

Cover two constructions of the same gadget on one page:

- first call should append assets
- second call should reuse in-flight or cached promises

**Step 2: Run test to verify it fails**

Run: `node --test tests/widget-bootstrap.test.js`

Expected: FAIL because the bootstrap template does not yet contain dedupe/cache logic.

**Step 3: Write minimal implementation**

Update bootstrap template to include:

- global cache object on `window`
- `loadScriptOnce(url)`
- `loadStyleOnce(url)`
- `instantiateWhenReady(API)`
- console error on failed asset load

Keep implementation tiny; avoid introducing any dependency.

**Step 4: Run test to verify it passes**

Run: `node --test tests/widget-bootstrap.test.js`

Expected: PASS for dedupe and delayed runtime instantiation.

---

### Task 4: Write the generated runtime and bootstrap files into the repo

**Files:**
- Create: `ujg-sprint-health.runtime.js`
- Create: `ujg-sprint-health.bootstrap.js`
- Create: `ujg-project-analytics.runtime.js`
- Create: `ujg-project-analytics.bootstrap.js`
- Create: `ujg-timesheet.runtime.js`
- Create: `ujg-timesheet.bootstrap.js`
- Create: `ujg-timesheet.v0.runtime.js`
- Create: `ujg-timesheet.v0.bootstrap.js`
- Create: `ujg-user-activity.runtime.js`
- Create: `ujg-user-activity.bootstrap.js`
- Create: `ujg-daily-diligence.runtime.js`
- Create: `ujg-daily-diligence.bootstrap.js`

**Step 1: Extend the failing tests**

Add a file-existence / content test:

```javascript
test("generated bootstrap assets are present in the repository", function() {
    var root = path.join(__dirname, "..");
    assert.match(fs.readFileSync(path.join(root, "ujg-daily-diligence.bootstrap.js"), "utf8"), /_ujgDailyDiligence/);
    assert.match(fs.readFileSync(path.join(root, "ujg-daily-diligence.runtime.js"), "utf8"), /_ujgDailyDiligenceRuntime/);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/widget-bootstrap.test.js`

Expected: FAIL because the generator has not yet written real files.

**Step 3: Write minimal implementation**

Extend `build-widget-bootstrap-assets.js` with a CLI mode:

```bash
node build-widget-bootstrap-assets.js
```

CLI behavior:

- read current widget bundles from repo root
- derive runtime files
- emit all bootstrap files
- print release ref and file list

Run the generator once and add the generated artifacts to the repository.

**Step 4: Run test to verify it passes**

Run:

- `node build-widget-bootstrap-assets.js`
- `node --test tests/widget-bootstrap.test.js`

Expected: PASS and all generated files are present.

---

### Task 5: Document the new stable URLs and update project structure

**Files:**
- Modify: `README.md`
- Modify: `docs/plans/2026-03-29-widget-bootstrap-design.md`
- Modify: `docs/plans/2026-03-29-widget-bootstrap.md`

**Step 1: Update README structure**

Add the new top-level generated files to `README.md`:

- all `*.bootstrap.js`
- all `*.runtime.js`
- `build-widget-bootstrap-assets.js`
- `tests/widget-bootstrap.test.js`

Respect the existing tree style and keep it concise.

**Step 2: Add usage examples**

Document the recommended Jira config format, at minimum for:

- `Daily Diligence`
- `Timesheet`
- `User Activity`

Each example should show:

- stable `JavaScript URLs`
- empty `CSS URLs`
- unchanged `AMD module`

**Step 3: Run a docs sanity check**

Run: `node --test tests/widget-bootstrap.test.js`

Expected: still PASS; docs update should not affect generator behavior.

**Status:** Done in `widget-bootstrap` worktree — `README.md` tree + Jira examples; plan/design docs under `docs/plans/`; sanity check `node --test tests/widget-bootstrap.test.js` passes.

---

### Task 6: Add a regression guard that bootstraps stay in sync with source bundles

**Files:**
- Modify: `tests/widget-bootstrap.test.js`

**Step 1: Write the failing test**

Add a sync test:

```javascript
test("re-running bootstrap generator produces the committed assets byte-for-byte", function() {
    // generate in memory from current source bundles
    // compare to committed *.runtime.js and *.bootstrap.js files
});
```

This prevents stale generated bootstrap files from drifting after a widget rebuild.

**Step 2: Run test to verify it fails**

Run: `node --test tests/widget-bootstrap.test.js`

Expected: FAIL until the compare-against-disk path is implemented.

**Step 3: Write minimal implementation**

Add helper functions in the test and generator to:

- build assets in-memory
- normalize line endings if needed
- compare expected vs committed output exactly

**Step 4: Run test to verify it passes**

Run: `node --test tests/widget-bootstrap.test.js`

Expected: PASS; regenerated outputs match committed files.

---

### Task 7: Final verification on the full repo state

**Files:**
- Verify only

**Step 1: Run targeted tests**

Run: `node --test tests/widget-bootstrap.test.js`

Expected: PASS.

**Step 2: Run broader regression suite**

Run: `node --test tests/*.test.js`

Expected: PASS for the full suite.

**Step 3: Regenerate bootstrap assets and re-check cleanliness**

Run:

- `node build-widget-bootstrap-assets.js`
- `git status --short`

Expected:

- generator succeeds
- working tree remains clean after regeneration

**Step 4: Manual smoke verification in Jira gadget config**

Use one migrated gadget, preferably `Daily Diligence`, with:

```text
JavaScript URLs:
https://cdn.jsdelivr.net/gh/skivbox-ii/jira@main/ujg-daily-diligence.bootstrap.js

CSS URLs:
[empty]

AMD module:
_ujgDailyDiligence
```

Expected:

- gadget initializes
- CSS is applied
- `_ujgCommon.js` behavior remains intact
- no duplicate asset loads in the browser console/network tab

---

Plan complete and saved to `docs/plans/2026-03-29-widget-bootstrap.md`.

Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
