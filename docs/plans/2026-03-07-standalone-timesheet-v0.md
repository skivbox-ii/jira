# Standalone Timesheet v0 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a standalone `/timesheet-v0` page that serves the clean v0 TimeSheet while keeping `/timesheet` on the current implementation.

**Architecture:** Extend the existing standalone Express server with one extra whitelisted JS/CSS pair and one extra HTML route. Reuse the current `timesheet.html` structure by cloning it into a `timesheet-v0.html` page that points to the `v0` widget assets. Update standalone navbars so both TimeSheet pages are reachable.

**Tech Stack:** Node.js, Express, static HTML, RequireJS, jQuery

---

### Task 1: Add server support for v0 assets and route

**Files:**
- Modify: `jira/standalone/server.js`

**Step 1: Add the missing whitelist entries**

Add:

```js
"ujg-timesheet.v0.js", "ujg-timesheet.v0.css",
```

to `WIDGET_FILES`.

**Step 2: Add the new route**

Add:

```js
app.get("/timesheet-v0", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "timesheet-v0.html"));
});
```

near the existing `/timesheet` route.

**Step 3: Syntax check**

Run: `node -c jira/standalone/server.js`

Expected: no output, exit code `0`

### Task 2: Create the standalone v0 page

**Files:**
- Create: `jira/standalone/public/timesheet-v0.html`

**Step 1: Copy the current page structure**

Reuse the existing layout, session fetch, and gadget bootstrap from `timesheet.html`.

**Step 2: Point the page to v0 assets**

Load:

```html
<link rel="stylesheet" href="/widgets/ujg-timesheet.v0.css">
<script src="/widgets/ujg-timesheet.v0.js"></script>
```

**Step 3: Mark the new nav item active**

The new page should show `Timesheet v0` as active in the navbar.

### Task 3: Update standalone navbars

**Files:**
- Modify: `jira/standalone/public/timesheet.html`
- Modify: `jira/standalone/public/sprint.html`
- Modify: `jira/standalone/public/analytics.html`
- Modify: `jira/standalone/public/timesheet-v0.html`

**Step 1: Add the new link**

Add a navbar item linking to:

```html
<a href="/timesheet-v0">Timesheet v0</a>
```

**Step 2: Preserve current active states**

- `/timesheet` stays active only on `timesheet.html`
- `/timesheet-v0` is active only on `timesheet-v0.html`

### Task 4: Verify

**Files:**
- Verify: `jira/standalone/server.js`
- Verify: `jira/standalone/public/timesheet.html`
- Verify: `jira/standalone/public/timesheet-v0.html`

**Step 1: Run syntax check**

Run: `node -c jira/standalone/server.js`

Expected: exit code `0`

**Step 2: Check lint diagnostics**

Expected: no new lint errors

**Step 3: Confirm asset references**

Verify:
- `/timesheet` loads current files
- `/timesheet-v0` loads `v0` files
