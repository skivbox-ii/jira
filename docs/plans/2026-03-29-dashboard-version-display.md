# Dashboard Version Display Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show `Dashboard v<hash> • <commit date time>` for the active dashboard `releaseRef` in both the shared bootstrap toolbar and a compact version strip inside the gadget body.

**Architecture:** Keep the source of truth in the existing dashboard-wide `releaseRef` flow, then extend shared bootstrap logic to fetch commit metadata from GitHub for that exact ref, cache it in `window.__UJG_BOOTSTRAP__`, and render both UI locations from the same cached payload. Do not modify individual widget runtimes unless the shared bootstrap approach proves impossible.

**Tech Stack:** Generated bootstrap assets, plain browser DOM APIs, GitHub REST API, Node `--test`, shared bootstrap generator in `build-widget-bootstrap-assets.js`.

---

### Task 1: Commit metadata contract in shared bootstrap generator

**Files:**
- Modify: `build-widget-bootstrap-assets.js`
- Test: `tests/widget-bootstrap.test.js`

**Step 1: Write the failing test**

Add a focused bootstrap test that instantiates a generated gadget, mocks `fetch` for `https://api.github.com/repos/skivbox-ii/jira/commits/<ref>`, and expects the resolved UI text to contain both a short hash and formatted commit time.

**Step 2: Run test to verify it fails**

Run: `node --test tests/widget-bootstrap.test.js`

Expected: FAIL because bootstrap currently knows only `releaseRef` and has no commit metadata flow.

**Step 3: Write minimal implementation**

In `build-widget-bootstrap-assets.js`:

- add shared helpers for:
  - `fetchGithubCommitMetadata(ref)`
  - `loadCommitMetadataForRef(ref)`
  - formatting commit date to `YYYY-MM-DD HH:mm`
- cache commit metadata and in-flight promises under `window.__UJG_BOOTSTRAP__`
- keep bootstrap resilient: return hash-only display if metadata fetch fails

**Step 4: Run test to verify it passes**

Run: `node --test tests/widget-bootstrap.test.js`

Expected: PASS for the new metadata contract test.

**Step 5: Commit**

```bash
git add tests/widget-bootstrap.test.js build-widget-bootstrap-assets.js
git commit -m "test: cover dashboard commit metadata bootstrap flow"
```

### Task 2: Render both toolbar and body version strip

**Files:**
- Modify: `build-widget-bootstrap-assets.js`
- Test: `tests/widget-bootstrap.test.js`

**Step 1: Write the failing test**

Add tests that verify:

- `.ujg-bootstrap-toolbar .ujg-bootstrap-version` renders `Dashboard v<hash> • <date time>`
- a second stable element like `.ujg-bootstrap-version-strip` is mounted in gadget body below the toolbar
- both survive bootstrap remount after runtime clears shared content

**Step 2: Run test to verify it fails**

Run: `node --test tests/widget-bootstrap.test.js`

Expected: FAIL because only the toolbar version span exists today.

**Step 3: Write minimal implementation**

In generated bootstrap template:

- replace the old short ref formatter with a shared display formatter
- add a helper that mounts or reuses `.ujg-bootstrap-version-strip`
- update both toolbar and strip from the same resolved metadata payload
- keep DOM ownership inside bootstrap so runtime files remain untouched

**Step 4: Run test to verify it passes**

Run: `node --test tests/widget-bootstrap.test.js`

Expected: PASS for both render locations and remount behavior.

**Step 5: Commit**

```bash
git add tests/widget-bootstrap.test.js build-widget-bootstrap-assets.js
git commit -m "feat: render dashboard version in bootstrap UI"
```

### Task 3: Refresh flow and fallback behavior

**Files:**
- Modify: `build-widget-bootstrap-assets.js`
- Test: `tests/widget-bootstrap.test.js`

**Step 1: Write the failing test**

Add tests for:

- refresh updates displayed hash/date before reload when GitHub returns a new SHA
- metadata failure keeps `Dashboard v<hash>` without date
- existing `releaseRef` fallback behavior still works if commit metadata fetch fails

**Step 2: Run test to verify it fails**

Run: `node --test tests/widget-bootstrap.test.js`

Expected: FAIL because refresh logic only updates the short hash and has no metadata fallback contract.

**Step 3: Write minimal implementation**

Update refresh handling to:

- fetch metadata for the active or next `releaseRef`
- refresh both UI locations with the best available display string
- keep reload semantics unchanged
- avoid duplicate GitHub metadata requests with single-flight caching

**Step 4: Run test to verify it passes**

Run: `node --test tests/widget-bootstrap.test.js`

Expected: PASS for refresh and fallback coverage.

**Step 5: Commit**

```bash
git add tests/widget-bootstrap.test.js build-widget-bootstrap-assets.js
git commit -m "fix: keep dashboard version display resilient on refresh"
```

### Task 4: Regenerate bootstrap assets and update docs

**Files:**
- Modify: `jira/README.md`
- Create: `docs/plans/2026-03-29-dashboard-version-display-design.md`
- Create: `docs/plans/2026-03-29-dashboard-version-display.md`
- Regenerate: `ujg-daily-diligence.bootstrap.js`
- Regenerate: `ujg-project-analytics.bootstrap.js`
- Regenerate: `ujg-sprint-health.bootstrap.js`
- Regenerate: `ujg-story-browser.bootstrap.js`
- Regenerate: `ujg-timesheet.bootstrap.js`
- Regenerate: `ujg-timesheet.v0.bootstrap.js`
- Regenerate: `ujg-user-activity.bootstrap.js`

**Step 1: Write/update the failing sync expectation**

If generator output or README structure contracts change, extend the relevant expectations in `tests/widget-bootstrap.test.js` and README references first.

**Step 2: Run test to verify it fails**

Run: `node --test tests/widget-bootstrap.test.js`

Expected: FAIL until regenerated bootstrap files and docs are aligned.

**Step 3: Write minimal implementation**

- run `node build-widget-bootstrap-assets.js`
- update `jira/README.md` structure and documentation section to list the new design/plan docs

**Step 4: Run test to verify it passes**

Run:

- `node --test tests/widget-bootstrap.test.js`
- `node --test tests/*.test.js`

Expected: PASS with regenerated bootstrap outputs and synced docs.

**Step 5: Commit**

```bash
git add jira/README.md docs/plans/2026-03-29-dashboard-version-display-design.md docs/plans/2026-03-29-dashboard-version-display.md ujg-*.bootstrap.js tests/widget-bootstrap.test.js
git commit -m "docs: document dashboard version display rollout"
```

### Task 5: Final verification and publish

**Files:**
- Verify only touched files

**Step 1: Run full verification**

Run:

- `node --test tests/widget-bootstrap.test.js`
- `node --test tests/*.test.js`

Expected: all green.

**Step 2: Inspect generated diff**

Run:

- `git status --short`
- `git diff --stat HEAD`

Expected: only planned bootstrap/docs/test changes.

**Step 3: Publish**

Run:

- `git push origin main`

Expected: remote `main` updated with the new dashboard version display behavior.

**Step 4: Smoke-check in Jira**

Manually verify one gadget on dashboard:

- toolbar shows `Dashboard v<hash> • <date time>`
- version strip below toolbar shows the same value
- clicking `Обновить версию` still updates the dashboard version flow
- if GitHub commit metadata is unavailable, UI falls back to `Dashboard v<hash>`

**Step 5: Commit**

No extra commit here if previous tasks already produced the final publishable history.
