# Day-Sequential Pipeline — Design

**Date:** 2026-03-31
**Module:** `ujg-user-activity-modules`

## Problem

Current data loading fetches everything for the entire period in parallel:
N users × concurrent JQL searches + bulk repo dev-status.
On page reload, AJAX responses arrive in unpredictable order causing commits
to appear randomly from different people. Timestamp/timezone mismatches
compound the issue when repo events straddle day boundaries.

## Solution

Replace the parallel-period pipeline with a strict **day-by-day sequential**
pipeline. Process one calendar day completely before moving to the next.
Add an HTTP-level request cache so duplicate requests across days are served
from memory.

## Architecture

### 1. HTTP Request Cache (`request-cache.js`)

New AMD module. Wraps `$.ajax` with an in-memory hash map.

```
Key   = METHOD + ":" + URL + ":" + sortedBodyOrParams
Value = { data, textStatus, jqXHR-like }
```

Public API:

| Method | Description |
|--------|-------------|
| `cachedAjax(opts)` | Drop-in `$.ajax` replacement. Cache hit → resolved Deferred. Miss → real AJAX + store. |
| `clearCache()` | Wipe all entries. Called on each "Load" press. |

Integration: `api.js` and `repo-api.js` replace `$.ajax`/`$.get`/`$.post`
with `cachedAjax`.

### 2. Day-Sequential Pipeline (`rendering.js` → `loadData`)

```
loadData(users, period):
  clearCache()
  renderEmptyCalendarGrid(period)
  days = generateDayList(period.start, period.end)   // newest → oldest

  for day in days:
    if requestId changed → break

    dayData = { users: {}, allIssues: [] }

    for user in users:                                // sequential
      raw   = await api.fetchAllData(user, day, day)  // JQL 1-day range
      comms = await loadComments(raw.issues)
      dayData.users[user.key] = { rawData: raw, comments: comms }
      dayData.allIssues.push(...raw.issues)
      updateProgress(day, user)

    uniqueIssues = dedup(dayData.allIssues)
    repoStatus   = await repoApi.fetchRepoForIssues(uniqueIssues)
    repoDay      = processRepoForDay(repoStatus, day)

    processed = processOneDayData(dayData, day)
    renderDayCell(day, processed, repoDay)            // progressive

  finalizeRender()
```

Key properties:
- `api.fetchAllData(user, day, day)` — single-day JQL range
- Users processed one after another within a day
- Repo fetched once per day after all users
- HTTP cache eliminates duplicate detail/dev-status requests across days
- `requestId` check at loop top enables cancellation

### 3. API Changes (`api.js`)

`fetchAllData(username, startDate, endDate, onProgress)` unchanged in
signature but now called with `startDate === endDate` (one day).

JQL queries naturally scope to one day:
```
worklogDate >= "2026-03-30" AND worklogDate < "2026-03-31"
```

Internal detail queue (`fetchIssueDetails`) uses `cachedAjax` — if
issue KEY-123 was already detailed on a previous day, cache hit.

### 4. Repo Changes (`repo-api.js`)

`fetchRepoActivityForIssues(issues, onProgress)` uses `cachedAjax`.
Dev-status endpoint does not accept dates, so the same issue returns the
same response — perfect cache candidate.

`processRepoActivity` called with `startDate = endDate = day` filters
events to the single target day.

### 5. Data Processing

`processMultiUserData` receives `startDate = endDate = day`.
Alternatively, a thin `processDaySlice` wrapper can delegate to the
existing function. Output is a single-day `dayMap` entry.

Incremental aggregation: `finalizeRender()` computes totals/stats from
accumulated day results after the loop completes.

### 6. Progressive UI Render

**Calendar grid:**
- Empty grid rendered upfront (all cells grey/placeholder)
- Each completed day fills its cell: worklog hours, issue count, repo badge
- CSS fade-in animation on cell content

**Progress indicator:**
- Text: "День 5 / 30 — загрузка user2..."
- Progress bar: N / totalDays

**Day Detail:**
- Clickable immediately once the day is loaded

### 7. Error Handling

| Scope | Behavior |
|-------|----------|
| Single day fails | Cell renders with error indicator (red border, tooltip). Pipeline continues to next day. |
| Repo fails for day | Jira data renders without repo section. Tooltip shows repo error. |
| New "Load" press | `requestId++`, loop breaks on next iteration. Cache cleared. |

## Files Changed

| File | Change |
|------|--------|
| `request-cache.js` | **New.** HTTP cache module. |
| `api.js` | Replace `$.ajax` → `cachedAjax`. |
| `repo-api.js` | Replace `$.ajax`/`$.get` → `cachedAjax`. |
| `rendering.js` | Rewrite `loadData` to day-sequential loop. Add `renderEmptyCalendarGrid`, `renderDayCell`, `finalizeRender`. |
| `data-processor.js` | Add `processDaySlice` or adapt `processMultiUserData` for single-day input. |
| `repo-data-processor.js` | No structural changes; called per-day with narrower date range. |
| `calendar.js` | Support incremental cell updates (`updateCell(dateKey, data)`). |
| `daily-detail.js` | No changes needed (data model stays the same per day). |
| `tests/user-activity-repo.test.js` | New tests for cache, day-sequential flow, progressive render. |
