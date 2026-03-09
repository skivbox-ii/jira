# User Activity Repo Activity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend `user-activity` with full repository activity from Jira Dev Status API, rendered as a repo calendar and a repository activity log in the same style as the current dashboard.

**Architecture:** Keep current Jira activity pipeline unchanged, then add a second pipeline for repo activity. Load dev-status for already collected issues, normalize all repo events into `repoActivity`, and render two new UI blocks: `Repo Activity Calendar` and `Repository Activity Log`.

**Tech Stack:** AMD modules, jQuery, Jira REST API, Jira Dev Status API, standalone Node build script

---

### Task 1: Add repo dev-status loading module

**Files:**
- Create: `jira/ujg-user-activity-modules/repo-api.js`
- Reference: `jira/ujg-project-analytics-modules/data-collection.js`

**Step 1: Write the failing test**

Create a narrow test helper target for dev-status response merging:

```javascript
test("mergeDevStatus merges repository and pullrequest payloads by detail and repository identity", () => {
    const repoResp = {
        detail: [{
            applicationLinkId: "a1",
            instanceId: "i1",
            type: "stash",
            name: "Bitbucket",
            repositories: [{ id: "r1", name: "repo-a", commits: [{ id: "c1" }] }]
        }]
    };
    const prResp = {
        detail: [{
            applicationLinkId: "a1",
            instanceId: "i1",
            type: "stash",
            name: "Bitbucket",
            repositories: [{ id: "r1", name: "repo-a", pullRequests: [{ id: "pr1" }] }]
        }]
    };
    const out = mod.mergeDevStatus(repoResp, prResp);
    assert.strictEqual(out.detail.length, 1);
    assert.strictEqual(out.detail[0].repositories.length, 1);
    assert.strictEqual(out.detail[0].repositories[0].commits.length, 1);
    assert.strictEqual(out.detail[0].repositories[0].pullRequests.length, 1);
});
```

**Step 2: Run test to verify it fails**

Run: `cd jira && node --test tests/user-activity-repo.test.js`

Expected: FAIL because `repo-api.js` and exported helper do not exist yet.

**Step 3: Write minimal implementation**

Create `repo-api.js` with:
- `mergeDevStatus(repoResp, prResp)`
- `fetchIssueDevStatus(issue, onProgress)`
- `fetchRepoActivityForIssues(issues, onProgress)`

Implementation rules:
- call `/rest/dev-status/1.0/issue/detail`
- request both `repository` and `pullrequest`
- merge them like in project analytics
- never fail the whole batch on one issue
- return `{ issueDevStatusMap }`

**Step 4: Run test to verify it passes**

Run: `cd jira && node --test tests/user-activity-repo.test.js`

Expected: PASS for merge behavior.

---

### Task 2: Add repo activity normalization

**Files:**
- Create: `jira/ujg-user-activity-modules/repo-data-processor.js`
- Test: `jira/tests/user-activity-repo.test.js`
- Reference: `jira/ujg-project-analytics-modules/developer-analytics.js`
- Reference: `jira/ujg-project-analytics-modules/dev-cycle.js`

**Step 1: Write the failing test**

Add tests for normalization:

```javascript
test("processRepoActivity builds commit and PR events for selected user", () => {
    const issueMap = {
        "CORE-1": { key: "CORE-1", summary: "Test task" }
    };
    const issueDevStatusMap = {
        "CORE-1": {
            detail: [{
                repositories: [{
                    name: "core-api",
                    url: "https://git/repo",
                    commits: [{
                        id: "abc123",
                        message: "Fix auth",
                        authorTimestamp: "2026-03-08T10:00:00.000Z",
                        author: { name: "dtorzok", displayName: "Dima Torzok" }
                    }],
                    pullRequests: [{
                        id: "42",
                        name: "Fix auth",
                        status: "MERGED",
                        createdDate: "2026-03-07T08:00:00.000Z",
                        mergedDate: "2026-03-08T12:00:00.000Z",
                        author: { name: "dtorzok", displayName: "Dima Torzok" },
                        reviewers: []
                    }]
                }]
            }]
        }
    };
    const repoActivity = mod.processRepoActivity(issueMap, issueDevStatusMap, { name: "dtorzok", displayName: "Dima Torzok" }, "2026-03-01", "2026-03-31");
    assert.strictEqual(repoActivity.items.length, 3); // PR opened, PR merged, commit
    assert.strictEqual(repoActivity.stats.totalCommits, 1);
    assert.strictEqual(repoActivity.stats.totalPullRequests, 2);
});
```

**Step 2: Run test to verify it fails**

Run: `cd jira && node --test tests/user-activity-repo.test.js`

Expected: FAIL because processor does not exist yet.

**Step 3: Write minimal implementation**

Create processor helpers:
- `matchesSelectedUser(userLike, selectedUser)`
- `normalizeTimestamp(v)`
- `pushEvent(...)`
- `extractCommitEvents(...)`
- `extractPullRequestEvents(...)`
- `extractBranchEvents(...)`
- `processRepoActivity(...)`

Output:
- `items`
- `dayMap`
- `repoMap`
- `stats`

Must support:
- `commit`
- `pull_request_opened`
- `pull_request_merged`
- `pull_request_declined`
- `pull_request_reviewed`
- `pull_request_needs_work`
- `branch_update`
- `branch_commit`
- `repository_update`
- `unknown_dev_event`

**Step 4: Run test to verify it passes**

Run: `cd jira && node --test tests/user-activity-repo.test.js`

Expected: PASS for normalization and stats.

---

### Task 3: Add repo calendar rendering

**Files:**
- Create: `jira/ujg-user-activity-modules/repo-calendar.js`
- Reference: `jira/ujg-user-activity-modules/calendar-heatmap.js`

**Step 1: Write the failing test**

Add a rendering smoke test:

```javascript
test("repo calendar renders event count badges and selection callback", () => {
    const repoDayMap = {
        "2026-03-08": {
            date: "2026-03-08",
            totalEvents: 3,
            items: [
                { type: "commit", repoName: "core-api", hash: "abc123", message: "Fix auth" },
                { type: "pull_request_merged", repoName: "core-api", title: "Fix auth" }
            ],
            countsByType: { commit: 1, pull_request_merged: 1 },
            countsByRepo: { "core-api": 2 }
        }
    };
    const widget = mod.render(repoDayMap, new Date("2026-03-01"), new Date("2026-03-31"));
    assert.ok(widget.$el.html().includes("core-api"));
    assert.ok(widget.$el.html().includes("3"));
});
```

**Step 2: Run test to verify it fails**

Run: `cd jira && node --test tests/user-activity-repo.test.js`

Expected: FAIL because renderer does not exist yet.

**Step 3: Write minimal implementation**

Build `repo-calendar.js` as a sibling of `calendar-heatmap.js`:
- same table shell and classes
- intensity from event count
- day cell content from top repo events
- `+N еще` if day is crowded
- right summary column shows total events and top repos
- `onSelectDate(callback)` support

**Step 4: Run test to verify it passes**

Run: `cd jira && node --test tests/user-activity-repo.test.js`

Expected: PASS.

---

### Task 4: Add repository activity log table

**Files:**
- Create: `jira/ujg-user-activity-modules/repo-log.js`
- Reference: `jira/ujg-user-activity-modules/activity-log.js`

**Step 1: Write the failing test**

Add a rendering/filter smoke test:

```javascript
test("repo log renders rows for repository events", () => {
    const repoActivity = {
        items: [{
            type: "commit",
            date: "2026-03-08",
            timestamp: "2026-03-08T10:00:00.000Z",
            repoName: "core-api",
            branchName: "main",
            issueKey: "CORE-1",
            message: "Fix auth",
            hash: "abc123"
        }]
    };
    const log = mod.create();
    log.render(repoActivity, null);
    assert.ok(log.$el.html().includes("core-api"));
    assert.ok(log.$el.html().includes("abc123"));
});
```

**Step 2: Run test to verify it fails**

Run: `cd jira && node --test tests/user-activity-repo.test.js`

Expected: FAIL because repo log does not exist yet.

**Step 3: Write minimal implementation**

Create `repo-log.js`:
- same visual shell as `activity-log.js`
- filters:
  - repo
  - branch
  - issue
  - type
  - text
- columns:
  - date
  - time
  - repository
  - branch
  - issue
  - type
  - description
  - status/hash
  - expand
- `render(repoActivity, selectedDate)`

**Step 4: Run test to verify it passes**

Run: `cd jira && node --test tests/user-activity-repo.test.js`

Expected: PASS.

---

### Task 5: Extend config and module wiring

**Files:**
- Modify: `jira/ujg-user-activity-modules/config.js`
- Modify: `jira/ujg-user-activity-modules/main.js`
- Modify: `jira/build-user-activity.js`

**Step 1: Write the failing test**

Add a build-order / export smoke test:

```javascript
test("repo modules are included in public bundle order", () => {
    const fs = require("fs");
    const src = fs.readFileSync("ujg-user-activity.js", "utf8");
    assert.ok(src.includes('_ujgUA_repoApi'));
    assert.ok(src.includes('_ujgUA_repoDataProcessor'));
    assert.ok(src.includes('_ujgUA_repoCalendar'));
    assert.ok(src.includes('_ujgUA_repoLog'));
});
```

**Step 2: Run test to verify it fails**

Run: `cd jira && node --test tests/user-activity-repo.test.js`

Expected: FAIL because modules are not yet wired into bundle.

**Step 3: Write minimal implementation**

In `config.js` add:
- repo event labels
- event badge classes
- optional lightweight icons / aliases

In `main.js` add dependencies:
- `_ujgUA_repoApi`
- `_ujgUA_repoDataProcessor`
- `_ujgUA_repoCalendar`
- `_ujgUA_repoLog`

Pass them into `rendering.init(...)`.

In `build-user-activity.js` add module order entries.

**Step 4: Rebuild bundle and re-run test**

Run:
- `cd jira && node build-user-activity.js`
- `cd jira && node --test tests/user-activity-repo.test.js`

Expected: PASS.

---

### Task 6: Integrate repo pipeline into rendering

**Files:**
- Modify: `jira/ujg-user-activity-modules/rendering.js`

**Step 1: Write the failing test**

Add integration smoke test for repo block placement:

```javascript
test("renderDashboard appends repo calendar and repo log after jira blocks", () => {
    // Render with stubbed modules and assert insertion points by heading text.
});
```

**Step 2: Run test to verify it fails**

Run: `cd jira && node --test tests/user-activity-repo.test.js`

Expected: FAIL before integration.

**Step 3: Write minimal implementation**

Update `rendering.js`:
- after Jira `fetchAllData`, call `repoApi.fetchRepoActivityForIssues(rawData.issues, onProgress)`
- build `repoActivity` via `repoDataProcessor.processRepoActivity(...)`
- append:
  - `repoCalendar`
  - `repoLog`
- wire `repoCalendar.onSelectDate(...)` to filter `repoLog`
- keep current Jira calendar -> `DailyDetail` behavior untouched
- if repo load fails, render local error state for repo blocks only

**Step 4: Run test to verify it passes**

Run: `cd jira && node --test tests/user-activity-repo.test.js`

Expected: PASS.

---

### Task 7: Add regression coverage for user matching and noisy data

**Files:**
- Modify: `jira/tests/user-activity-repo.test.js`

**Step 1: Write the failing tests**

Add tests for:
- displayName vs name matching
- PR directly on `detail.pullRequests`
- repo with branch commits
- unknown/fallback event creation
- selectedDate filtering in repo log

**Step 2: Run test to verify they fail**

Run: `cd jira && node --test tests/user-activity-repo.test.js`

Expected: FAIL for uncovered cases.

**Step 3: Write minimal implementation**

Patch processor/log/calendar only where needed to satisfy the failing cases.

**Step 4: Run test to verify they pass**

Run: `cd jira && node --test tests/user-activity-repo.test.js`

Expected: PASS.

---

### Task 8: End-to-end verification in standalone

**Files:**
- Verify only

**Step 1: Build fresh bundle**

Run: `cd jira && node build-user-activity.js`

Expected: bundle builds without errors.

**Step 2: Start standalone server**

Run: `./start.sh`

Expected: server starts on `http://localhost:3000`

**Step 3: Manual verification**

Check:
- `User Activity` opens
- existing Jira blocks still render
- repo calendar appears below Jira calendar
- repo log appears below Jira log
- repo date click filters repo table
- layout and typography match existing dashboard style

**Step 4: Regression verification**

Run: `cd jira && node --test tests/user-activity-repo.test.js`

Expected: PASS

---

### Task 9: Cleanup and documentation polish

**Files:**
- Modify: `jira/docs/plans/2026-03-09-user-activity-repo-activity-design.md`
- Modify: `jira/docs/plans/2026-03-09-user-activity-repo-activity.md`

**Step 1: Re-read actual implementation against design**

Verify:
- separate repo calendar
- separate repo log
- max repo activity retained
- no Jira dashboard regressions

**Step 2: Update plan notes if implementation differs**

Record any justified deviations.

**Step 3: Final verification**

Run:
- `cd jira && node --test tests/user-activity-repo.test.js`
- `cd jira && node build-user-activity.js`

Expected: all pass.

---

Plan complete and saved to `jira/docs/plans/2026-03-09-user-activity-repo-activity.md`.

Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?

