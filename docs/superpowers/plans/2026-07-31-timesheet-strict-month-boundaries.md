# Timesheet Strict Month Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split calendar weeks at month boundaries so dates and summaries always belong to the visible month block.

**Architecture:** Keep the existing Monday-to-Sunday `groupWeeks` helper and add a pure `groupWeeksByMonth` transformation that replaces dates from the other month with `null` in separate partial rows. The renderer consumes these rows without changing cell, summary, transition, or worklog rendering code.

**Tech Stack:** AMD JavaScript, jQuery, Node.js test runner, generated widget runtime/bootstrap assets.

---

### Task 1: Split Cross-Month Weeks

**Files:**
- Modify: `tests/timesheet-logic.test.js`
- Modify: `ujg-timesheet.js`
- Generated: `ujg-timesheet.runtime.js`

- [x] **Step 1: Write failing tests for strict month rows**

Add tests that call `Timesheet.__test.groupWeeksByMonth` with June 29 through July 3, 2026 and expect these rows:

```js
[
    ["2026-06-29", "2026-06-30", null, null, null, null, null],
    [null, null, "2026-07-01", "2026-07-02", "2026-07-03", null, null]
]
```

Use the returned rows with `computeWeekSummary` and `getWeekTransitions` to verify that the June row excludes July data and the July row excludes June data.

- [x] **Step 2: Run tests and confirm the missing helper fails**

Run:

```bash
node --test --test-name-pattern='month boundary|partial month rows' tests/timesheet-logic.test.js
```

Expected: FAIL because `groupWeeksByMonth` is not exported.

- [x] **Step 3: Implement the pure month splitter**

Add after `groupWeeks`:

```js
function groupWeeksByMonth(days) {
    var rows = [];
    groupWeeks(days).forEach(function(week) {
        var monthKeys = [];
        week.forEach(function(day) {
            if (!day) return;
            var monthKey = day.getFullYear() + "-" + day.getMonth();
            if (monthKeys.indexOf(monthKey) < 0) monthKeys.push(monthKey);
        });
        monthKeys.forEach(function(monthKey) {
            rows.push(week.map(function(day) {
                if (!day) return null;
                return day.getFullYear() + "-" + day.getMonth() === monthKey ? day : null;
            }));
        });
    });
    return rows;
}
```

Export it through `MyGadget.__test` and change `renderSingleCalendar` to use `groupWeeksByMonth(days)`.

- [x] **Step 4: Run focused tests**

Run:

```bash
node --test tests/timesheet-logic.test.js tests/timesheet-layout.test.js
```

Expected: all tests pass.

### Task 2: Build, Verify, and Release

**Files:**
- Generated: `ujg-timesheet.runtime.js`
- Generated: `ujg-*.bootstrap.js`

- [x] **Step 1: Rebuild generated assets**

Run:

```bash
node build-widget-bootstrap-assets.js
```

Expected: `ujg-timesheet.runtime.js` matches `ujg-timesheet.js` and generated bootstrap tests pass.

- [x] **Step 2: Run the complete suite**

Run:

```bash
node --test tests/*.test.js
```

Expected: all tests pass with no failures.

- [ ] **Step 3: Commit functional files**

```bash
git add docs/superpowers/plans/2026-07-31-timesheet-strict-month-boundaries.md tests/timesheet-logic.test.js ujg-timesheet.js ujg-timesheet.runtime.js
git commit -m "fix(timesheet): split calendar rows by month"
```

- [ ] **Step 4: Pin bootstrap assets to the functional commit**

Run `node build-widget-bootstrap-assets.js`, stage only the changed bootstrap files, and commit:

```bash
functional_ref=$(git rev-parse --short HEAD)
git commit -m "chore(release): pin widget assets to ${functional_ref}"
```

- [ ] **Step 5: Push `main`**

```bash
git push origin main
```

Expected: both implementation and release commits are available on `origin/main`.
