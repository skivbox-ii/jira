# Day-Sequential Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the parallel-period data loading pipeline with a strict day-by-day sequential pipeline with HTTP request caching and progressive UI rendering.

**Architecture:** Each calendar day loads independently (newest first): for each user sequentially — JQL search + issue details + comments, then repo dev-status for the day's issues. Each completed day renders immediately into a pre-drawn calendar grid. An HTTP-level request cache (keyed by method+url+body) eliminates duplicate API calls across days. Cache resets on each "Load" press.

**Tech Stack:** AMD modules (`define()`), jQuery (`$.ajax`, `$.Deferred`, `$.when`), Node.js test runner

---

### Task 1: HTTP Request Cache Module

**Files:**
- Create: `ujg-user-activity-modules/request-cache.js`
- Test: `tests/user-activity-repo.test.js` (append new tests)

**Step 1: Write the failing test**

In `tests/user-activity-repo.test.js`, append:

```javascript
test("request-cache: cachedAjax returns cached response on second call", function() {
    var callCount = 0;
    var jq = createJqueryStub(function() {
        callCount++;
        return resolvedAjax({ ok: true });
    });
    var cache = loadRequestCache(jq);
    var r1, r2;
    cache.cachedAjax({ url: "/api/test", type: "GET", dataType: "json" }).done(function(d) { r1 = d; });
    cache.cachedAjax({ url: "/api/test", type: "GET", dataType: "json" }).done(function(d) { r2 = d; });
    assert.equal(callCount, 1, "real AJAX called only once");
    assert.deepStrictEqual(r1, [{ ok: true }, "success", {}]);
    assert.deepStrictEqual(r2, [{ ok: true }, "success", {}]);
});

test("request-cache: clearCache causes fresh request", function() {
    var callCount = 0;
    var jq = createJqueryStub(function() {
        callCount++;
        return resolvedAjax({ n: callCount });
    });
    var cache = loadRequestCache(jq);
    cache.cachedAjax({ url: "/api/x", type: "GET" });
    assert.equal(callCount, 1);
    cache.clearCache();
    cache.cachedAjax({ url: "/api/x", type: "GET" });
    assert.equal(callCount, 2);
});

test("request-cache: POST body included in cache key", function() {
    var callCount = 0;
    var jq = createJqueryStub(function() {
        callCount++;
        return resolvedAjax({ n: callCount });
    });
    var cache = loadRequestCache(jq);
    cache.cachedAjax({ url: "/api/search", type: "POST", data: '{"jql":"a"}' });
    cache.cachedAjax({ url: "/api/search", type: "POST", data: '{"jql":"b"}' });
    assert.equal(callCount, 2, "different POST bodies are separate cache entries");
});

test("request-cache: failed request is not cached", function() {
    var callCount = 0;
    var jq = createJqueryStub(function() {
        callCount++;
        if (callCount === 1) return rejectedAjax("error");
        return resolvedAjax({ ok: true });
    });
    var cache = loadRequestCache(jq);
    var failed = false;
    cache.cachedAjax({ url: "/api/fail", type: "GET" }).fail(function() { failed = true; });
    assert.ok(failed);
    var r2;
    cache.cachedAjax({ url: "/api/fail", type: "GET" }).done(function(d) { r2 = d; });
    assert.equal(callCount, 2, "retries after failure");
});
```

Add helper `loadRequestCache` near other load helpers:

```javascript
function loadRequestCache(jquery) {
    return loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "request-cache.js"), {
        jquery: jquery
    });
}
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/user-activity-repo.test.js 2>&1 | tail -20`
Expected: FAIL — module `request-cache.js` does not exist

**Step 3: Write minimal implementation**

Create `ujg-user-activity-modules/request-cache.js`:

```javascript
define("_ujgUA_requestCache", ["jquery"], function($) {
    "use strict";

    var store = {};

    function cacheKey(options) {
        var method = String(options.type || options.method || "GET").toUpperCase();
        var url = String(options.url || "");
        var body = "";
        if (method === "POST" || method === "PUT") {
            body = typeof options.data === "string" ? options.data : JSON.stringify(options.data || "");
        } else if (options.data && typeof options.data === "object") {
            var keys = Object.keys(options.data).sort();
            body = keys.map(function(k) { return k + "=" + options.data[k]; }).join("&");
        }
        return method + ":" + url + ":" + body;
    }

    function cachedAjax(options) {
        var key = cacheKey(options);
        if (store[key]) {
            var d = $.Deferred();
            d.resolve.apply(d, store[key]);
            return d.promise();
        }
        var real = $.ajax(options);
        var d2 = $.Deferred();
        real.done(function() {
            var args = Array.prototype.slice.call(arguments);
            store[key] = args;
            d2.resolve.apply(d2, args);
        });
        real.fail(function() {
            d2.reject.apply(d2, arguments);
        });
        return d2.promise();
    }

    function clearCache() {
        store = {};
    }

    return {
        cachedAjax: cachedAjax,
        clearCache: clearCache,
        cacheKey: cacheKey
    };
});
```

**Step 4: Run test to verify it passes**

Run: `node --test tests/user-activity-repo.test.js 2>&1 | tail -5`
Expected: all request-cache tests PASS

**Step 5: Commit**

```bash
git add ujg-user-activity-modules/request-cache.js tests/user-activity-repo.test.js
git commit -m "feat(request-cache): add HTTP request cache module with tests"
```

---

### Task 2: Integrate cachedAjax into api.js

**Files:**
- Modify: `ujg-user-activity-modules/api.js`
- Test: `tests/user-activity-repo.test.js`

**Step 1: Write the failing test**

```javascript
test("api.fetchAllData uses cachedAjax for search requests", function(t, done) {
    var realAjaxCalls = 0;
    var jq = createJqueryStub(function(opts) {
        realAjaxCalls++;
        if (opts.url.indexOf("/rest/api/2/search") >= 0) {
            return resolvedAjax({ issues: [], total: 0 });
        }
        return resolvedAjax({});
    });
    var api = loadUserActivityApi(jq);
    // First call
    api.fetchAllData("user1", "2026-03-30", "2026-03-30").done(function() {
        var firstCount = realAjaxCalls;
        // Second identical call should hit cache
        api.fetchAllData("user1", "2026-03-30", "2026-03-30").done(function() {
            assert.equal(realAjaxCalls, firstCount, "second identical call uses cache");
            done();
        });
    });
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — api.js does not use cache, makes fresh AJAX calls

**Step 3: Modify api.js**

Add `_ujgUA_requestCache` to dependencies:

```javascript
define("_ujgUA_api", ["jquery", "_ujgCommon", "_ujgUA_config", "_ujgUA_utils", "_ujgUA_requestCache"],
function($, Common, config, utils, requestCache) {
```

Replace all `$.ajax(...)` calls with `requestCache.cachedAjax(...)`:

- `searchIssues` → line 31: `requestCache.cachedAjax({...})`
- `fetchIssueChangelog` → line 68: `requestCache.cachedAjax({...})`
- `fetchIssueWorklogs` → line 91: `requestCache.cachedAjax({...})` (note: this currently uses `$.ajax(...).then(...)`, keep the `.then` chain but replace `$.ajax`)
- `fetchIssueComments` → line 197: `requestCache.cachedAjax({...})`

Do NOT replace `searchUsers` (`$.ajax`) — user search should not be cached.

Export `clearCache`:
```javascript
return {
    fetchAllData: fetchAllData,
    fetchIssueComments: fetchIssueComments,
    searchUsers: searchUsers,
    clearCache: function() { requestCache.clearCache(); }
};
```

Update `loadUserActivityApi` helper in test to pass `_ujgUA_requestCache`:

```javascript
function loadUserActivityApi(jquery) {
    var cache = loadRequestCache(jquery);
    return loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "api.js"), {
        jquery: jquery,
        _ujgCommon: { baseUrl: "" },
        _ujgUA_config: { CONFIG: { maxResults: 50, maxConcurrent: 2 } },
        _ujgUA_utils: {},
        _ujgUA_requestCache: cache
    });
}
```

**Step 4: Run test to verify it passes**

Run: `node --test tests/user-activity-repo.test.js 2>&1 | tail -5`
Expected: PASS, and all existing tests still pass

**Step 5: Commit**

```bash
git add ujg-user-activity-modules/api.js tests/user-activity-repo.test.js
git commit -m "feat(api): integrate HTTP request cache into Jira API calls"
```

---

### Task 3: Integrate cachedAjax into repo-api.js

**Files:**
- Modify: `ujg-user-activity-modules/repo-api.js`
- Test: `tests/user-activity-repo.test.js`

**Step 1: Write the failing test**

```javascript
test("repo-api uses cachedAjax for dev-status requests", function() {
    var realCalls = 0;
    var jq = createJqueryStub(function(opts) {
        realCalls++;
        return resolvedAjax({ detail: [] });
    });
    var repoApi = loadRepoApi(jq);

    var issue = { id: "10001", key: "TEST-1" };
    repoApi.fetchIssueDevStatus(issue);
    var firstCount = realCalls;

    // Same issue again — should use cache
    var issue2 = { id: "10001", key: "TEST-1" };
    repoApi.fetchIssueDevStatus(issue2);
    assert.equal(realCalls, firstCount, "dev-status for same issue uses cache");
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — repo-api uses raw `$.ajax`

**Step 3: Modify repo-api.js**

Add `_ujgUA_requestCache` dependency:

```javascript
define("_ujgUA_repoApi", ["jquery", "_ujgCommon", "_ujgUA_config", "_ujgUA_utils", "_ujgUA_requestCache"],
function($, Common, config, utils, requestCache) {
```

Replace both `$.ajax(...)` calls in `fetchIssueDevStatus` (lines 195-214) with `requestCache.cachedAjax(...)`.

Update `loadRepoApi` helper in tests:

```javascript
function loadRepoApi(jquery) {
    var cache = loadRequestCache(jquery);
    return loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "repo-api.js"), {
        jquery: jquery,
        _ujgCommon: { baseUrl: "" },
        _ujgUA_config: { CONFIG: { maxConcurrent: 2 } },
        _ujgUA_utils: {},
        _ujgUA_requestCache: cache
    });
}
```

**Step 4: Run test to verify it passes**

Run: `node --test tests/user-activity-repo.test.js 2>&1 | tail -5`
Expected: PASS

**Step 5: Commit**

```bash
git add ujg-user-activity-modules/repo-api.js tests/user-activity-repo.test.js
git commit -m "feat(repo-api): integrate HTTP request cache into dev-status calls"
```

---

### Task 4: Progress Loader Enhancement

**Files:**
- Modify: `ujg-user-activity-modules/progress-loader.js`
- Test: `tests/user-activity-repo.test.js`

**Step 1: Write the failing test**

```javascript
test("progress-loader update renders day and user info", function() {
    var loader = loadProgressLoader();
    var inst = loader.create();
    inst.show();
    inst.update({
        phase: "day",
        currentDay: "2026-03-30",
        totalDays: 31,
        completedDays: 5,
        currentUser: "Иванов"
    });
    var text = inst.$el.find(".ujg-ua-progress-text").text();
    assert.ok(text.indexOf("6 / 31") >= 0 || text.indexOf("5") >= 0, "shows day progress");
});
```

Add helper:

```javascript
function loadProgressLoader() {
    var utils = loadUserActivityUtils({ location: { origin: "" }, AJS: { params: { baseURL: "" } } });
    return loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "progress-loader.js"), {
        jquery: createJqueryStub(function() { return resolvedAjax({}); }),
        _ujgUA_utils: utils
    });
}
```

**Step 2: Run test to verify it fails**

Expected: FAIL — current `update()` does not handle `phase: "day"`

**Step 3: Modify progress-loader.js**

Extend the `update` function to handle the new `phase: "day"` progress format:

```javascript
function update(progress) {
    if (!progress) return;
    var pct = 0;
    var label = "";
    if (progress.phase === "day") {
        var done = progress.completedDays || 0;
        var total = progress.totalDays || 1;
        pct = Math.round((done / total) * 100);
        label = "День " + (done + 1) + " / " + total;
        if (progress.currentDay) label += " (" + progress.currentDay + ")";
        if (progress.currentUser) label += " — " + progress.currentUser;
    } else if (progress.total > 0) {
        pct = Math.round((progress.loaded / progress.total) * 100);
        label = "Загружено " + progress.loaded + "/" + progress.total + " задач...";
    } else {
        label = "Загрузка...";
    }
    $bar.css("width", pct + "%");
    $text.text(label);
}
```

**Step 4: Run test to verify it passes**

Expected: PASS

**Step 5: Commit**

```bash
git add ujg-user-activity-modules/progress-loader.js tests/user-activity-repo.test.js
git commit -m "feat(progress-loader): support day-sequential progress display"
```

---

### Task 5: Unified Calendar Incremental Update Support

**Files:**
- Modify: `ujg-user-activity-modules/unified-calendar.js`
- Test: `tests/user-activity-repo.test.js`

**Step 1: Write the failing test**

```javascript
test("unified calendar updateDayCell fills a specific cell", function() {
    var utils = loadUserActivityUtils({ location: { origin: "" }, AJS: { params: { baseURL: "" } } });
    var calMod = loadUnifiedCalendar(utils);

    var startDate = new Date("2026-03-02T00:00:00");
    var endDate = new Date("2026-03-06T23:59:59");
    var users = [{ name: "u1", displayName: "User One" }];
    var cal = calMod.render({}, {}, users, startDate, endDate);

    var $cell = cal.$el.find('td[data-date="2026-03-04"]');
    assert.ok($cell.length > 0, "cell exists before update");

    var dayData = {
        users: { u1: { worklogs: [], changes: [], comments: [], totalHours: 3 } },
        allWorklogs: [], allChanges: [], allComments: [],
        totalHours: 3, repoItems: []
    };
    cal.updateDayCell("2026-03-04", dayData, {});

    var updated = cal.$el.find('td[data-date="2026-03-04"]').html();
    assert.ok(updated.indexOf("3") >= 0, "cell shows updated hours");
});
```

Add helper:

```javascript
function loadUnifiedCalendar(utils) {
    var config = loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "config.js"), {});
    return loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "unified-calendar.js"), {
        jquery: createJqueryStub(function() { return resolvedAjax({}); }),
        _ujgUA_config: config,
        _ujgUA_utils: utils
    });
}
```

**Step 2: Run test to verify it fails**

Expected: FAIL — `cal.updateDayCell` is not a function

**Step 3: Modify unified-calendar.js**

Add `updateDayCell(dateStr, dayData, issueMap)` to the returned object from `render()`:

```javascript
function updateDayCell(dateStr, dayData, issueMap) {
    var $cell = $el.find('td[data-date="' + dateStr + '"]');
    if ($cell.length === 0) return;

    var hours = (dayData && dayData.totalHours) || 0;
    var chipsResult = renderUserChips(dayData, selectedUsersRef, dateStr);
    var redBorderCls = chipsResult.allZero && selectedUsersRef && selectedUsersRef.length > 0;

    $cell.toggleClass("ujg-ua-day-cell-red-border", redBorderCls);

    var innerHtml = '<div class="flex items-center justify-between mb-0.5">';
    innerHtml += '<span class="text-[9px] font-semibold text-muted-foreground">' + utils.escapeHtml(getDayTitle(dateStr)) + '</span>';
    if (hours > 0) {
        var heatCls = utils.getHeatBg(hours);
        var textCls = hours >= 5 ? "text-primary-foreground" : "text-foreground";
        innerHtml += '<span class="text-[9px] font-bold px-1 py-0 rounded ' + heatCls + ' ' + textCls + '">' + (Math.round(hours * 10) / 10) + 'ч</span>';
    }
    innerHtml += '</div>';
    innerHtml += chipsResult.html;
    innerHtml += renderJiraBlock(dayData || {}, issueMap || {});
    innerHtml += renderRepoBlock(dayData || {}, issueMap || {});

    $cell.html(innerHtml);
}
```

Store `selectedUsers` as a closure variable `selectedUsersRef` in the `render` function.

Return `updateDayCell` from `render()`:

```javascript
return {
    $el: $el,
    onSelectDate: function(callback) { selectCallback = callback; },
    updateDayCell: updateDayCell
};
```

**Step 4: Run test to verify it passes**

Expected: PASS

**Step 5: Commit**

```bash
git add ujg-user-activity-modules/unified-calendar.js tests/user-activity-repo.test.js
git commit -m "feat(unified-calendar): add updateDayCell for progressive rendering"
```

---

### Task 6: Day-Sequential Pipeline in rendering.js

**Files:**
- Modify: `ujg-user-activity-modules/rendering.js`
- Test: `tests/user-activity-repo.test.js`

This is the core change — rewriting `loadData()`.

**Step 1: Write the failing test**

```javascript
test("rendering loadData processes days newest-first sequentially", function() {
    // This test verifies the order of API calls follows:
    // day 2026-03-03 (newest) → day 2026-03-02 → day 2026-03-01 (oldest)
    // Within each day: user1 then user2 sequentially
    var callLog = [];
    var jq = createJqueryStub(function(opts) {
        if (opts.url && opts.url.indexOf("/rest/api/2/search") >= 0) {
            var body = typeof opts.data === "string" ? JSON.parse(opts.data) : opts.data;
            callLog.push({ phase: "search", jql: body.jql });
            return resolvedAjax({ issues: [], total: 0 });
        }
        return resolvedAjax({});
    });
    var rendering = loadRendering(jq, {
        users: [
            { name: "u1", displayName: "User1" },
            { name: "u2", displayName: "User2" }
        ],
        period: { start: "2026-03-01", end: "2026-03-03" }
    });

    // Verify day order: 03, 02, 01
    var dayOrder = [];
    callLog.forEach(function(c) {
        var m = c.jql && c.jql.match(/>= "(\d{4}-\d{2}-\d{2})"/);
        if (m && dayOrder.indexOf(m[1]) === -1) dayOrder.push(m[1]);
    });
    assert.deepStrictEqual(dayOrder, ["2026-03-03", "2026-03-02", "2026-03-01"]);
});
```

(The `loadRendering` helper will need to be created/adapted — it should wire up the rendering module with mock API, data processor, calendar, etc.)

**Step 2: Run test to verify it fails**

Expected: FAIL — current loadData does parallel requests for entire period

**Step 3: Rewrite loadData in rendering.js**

Add `_ujgUA_requestCache` dependency to rendering module.

Replace `loadData(selectedUsers, period)` (lines 506-652) with:

```javascript
function generateDayList(startDate, endDate) {
    var days = [];
    var d = new Date(endDate + "T00:00:00");
    var start = new Date(startDate + "T00:00:00");
    while (d >= start) {
        days.push(utils.getDayKey(d));
        d.setDate(d.getDate() - 1);
    }
    return days;
}

function loadData(selectedUsers, period) {
    var requestId = ++activeRequestId;
    var requestUsers = cloneUsers(selectedUsers);
    $contentArea.empty();

    if (mods.api.clearCache) mods.api.clearCache();

    var loader = mods.progressLoader.create();
    loader.show();
    $contentArea.append(loader.$el);

    if (requestUsers.length === 0) {
        renderEmptyState();
        return;
    }

    var days = generateDayList(period.start, period.end);
    var totalDays = days.length;

    // Accumulated data across all days
    var fullDayMap = {};
    var fullIssueMap = {};
    var fullProjectMap = {};
    var totalHoursAll = 0;
    var userStatsAccum = {};

    // Render empty calendar grid
    var startDate = new Date(period.start + "T00:00:00");
    var endDate = new Date(period.end + "T23:59:59");
    var calendarMod = mods.unifiedCalendar || mods.calendarHeatmap;
    var calendar;
    if (mods.unifiedCalendar) {
        calendar = calendarMod.render({}, {}, requestUsers, startDate, endDate);
    } else {
        calendar = calendarMod.render({}, {}, startDate, endDate);
    }
    $contentArea.append(calendar.$el);

    var detailInstLocal = mods.dailyDetail.create();
    $contentArea.append(detailInstLocal.$el);
    detailInst = detailInstLocal;

    calendar.onSelectDate(function(dateStr) {
        if (!dateStr) {
            detailInstLocal.hide();
            return;
        }
        var dayData = fullDayMap[dateStr] || {
            worklogs: [], changes: [], issues: [],
            totalHours: 0, allWorklogs: [], allChanges: [],
            allComments: [], repoItems: [], users: {}
        };
        detailInstLocal.show(dateStr, dayData, fullIssueMap, getDetailSelectedUsers(requestUsers));
    });

    var completedDays = 0;
    var allRepoActivity = { dayMap: {}, repoMap: {}, totalCommits: 0, totalPRs: 0 };

    function processDaySequentially(dayIndex) {
        if (dayIndex >= days.length || requestId !== activeRequestId) {
            // All days done — render final aggregates
            finalizeRender(requestUsers, startDate, endDate, calendar, allRepoActivity);
            return;
        }

        var day = days[dayIndex];
        var dayUsersData = [];
        var dayAllIssueKeys = [];
        var seenKeys = {};

        loader.update({
            phase: "day",
            currentDay: day,
            totalDays: totalDays,
            completedDays: completedDays
        });

        processUserSequentially(0);

        function processUserSequentially(userIndex) {
            if (requestId !== activeRequestId) return;
            if (userIndex >= requestUsers.length) {
                afterAllUsersForDay();
                return;
            }

            var user = requestUsers[userIndex];
            loader.update({
                phase: "day",
                currentDay: day,
                totalDays: totalDays,
                completedDays: completedDays,
                currentUser: user.displayName || user.name
            });

            attachAsync(
                mods.api.fetchAllData(user.name, day, day, function() {}),
                function(rawData) {
                    if (requestId !== activeRequestId) return;

                    // Load comments for this user's issues on this day
                    var userIssueKeys = (rawData.issues || []).map(function(i) { return i.key; });
                    loadComments(userIssueKeys, loader, function(commentsMap) {
                        if (requestId !== activeRequestId) return;

                        var ud = {
                            username: user.name,
                            displayName: user.displayName || user.name,
                            rawData: rawData,
                            comments: commentsMap || {}
                        };
                        dayUsersData.push(ud);

                        (rawData.issues || []).forEach(function(issue) {
                            if (!seenKeys[issue.key]) {
                                seenKeys[issue.key] = true;
                                dayAllIssueKeys.push(issue);
                            }
                        });

                        processUserSequentially(userIndex + 1);
                    }, function(err) {
                        // Comment load failed — continue without comments
                        var ud = {
                            username: user.name,
                            displayName: user.displayName || user.name,
                            rawData: rawData,
                            comments: {}
                        };
                        dayUsersData.push(ud);
                        processUserSequentially(userIndex + 1);
                    });
                },
                function(err) {
                    // User fetch failed for this day — skip user, continue
                    processUserSequentially(userIndex + 1);
                }
            );
        }

        function afterAllUsersForDay() {
            if (requestId !== activeRequestId) return;

            // Process Jira data for this day
            var processed;
            if (mods.dataProcessor.processMultiUserData) {
                processed = mods.dataProcessor.processMultiUserData(dayUsersData, day, day);
            } else if (dayUsersData.length > 0) {
                processed = mods.dataProcessor.processData(
                    dayUsersData[0].rawData, dayUsersData[0].username, day, day
                );
            } else {
                processed = { dayMap: {}, issueMap: {}, projectMap: {}, stats: {} };
            }

            // Merge into full maps
            Object.keys(processed.issueMap || {}).forEach(function(k) {
                if (!fullIssueMap[k]) {
                    fullIssueMap[k] = processed.issueMap[k];
                } else {
                    var tgt = fullIssueMap[k];
                    var src = processed.issueMap[k];
                    tgt.worklogs = (tgt.worklogs || []).concat(src.worklogs || []);
                    tgt.changelogs = (tgt.changelogs || []).concat(src.changelogs || []);
                    tgt.totalTimeHours = (tgt.totalTimeHours || 0) + (src.totalTimeHours || 0);
                }
            });
            Object.keys(processed.projectMap || {}).forEach(function(pk) {
                if (!fullProjectMap[pk]) {
                    fullProjectMap[pk] = processed.projectMap[pk];
                } else {
                    var tgt = fullProjectMap[pk];
                    var src = processed.projectMap[pk];
                    tgt.totalHours = (tgt.totalHours || 0) + (src.totalHours || 0);
                    (src.issues || []).forEach(function(ik) {
                        if ((tgt.issues || []).indexOf(ik) === -1) {
                            tgt.issues.push(ik);
                            tgt.issueCount = (tgt.issueCount || 0) + 1;
                        }
                    });
                }
            });

            // Load repo for this day's issues
            var requestUserFilter = requestUsers.length === 1
                ? Object.assign({}, requestUsers[0])
                : requestUsers.map(function(u) { return Object.assign({}, u); });

            attachAsync(
                mods.repoApi.fetchRepoActivityForIssues(dayAllIssueKeys, function() {}),
                function(repoData) {
                    if (requestId !== activeRequestId) return;
                    var repoDay = mods.repoDataProcessor.processRepoActivity(
                        processed.issueMap,
                        repoData && repoData.issueDevStatusMap,
                        requestUserFilter,
                        day, day
                    );

                    // Merge repo into processed day
                    if (repoDay && repoDay.dayMap && repoDay.dayMap[day]) {
                        if (!processed.dayMap[day]) {
                            processed.dayMap[day] = {
                                users: {}, allWorklogs: [], allChanges: [],
                                allComments: [], totalHours: 0, repoItems: []
                            };
                        }
                        processed.dayMap[day].repoItems = (repoDay.dayMap[day].items || []).slice();
                    }

                    // Merge repo aggregate stats
                    if (repoDay && repoDay.dayMap) {
                        Object.keys(repoDay.dayMap).forEach(function(dk) {
                            allRepoActivity.dayMap[dk] = repoDay.dayMap[dk];
                        });
                    }
                    if (repoDay && repoDay.repoMap) {
                        Object.keys(repoDay.repoMap).forEach(function(rk) {
                            allRepoActivity.repoMap[rk] = repoDay.repoMap[rk];
                        });
                    }
                    allRepoActivity.totalCommits += (repoDay && repoDay.totalCommits) || 0;
                    allRepoActivity.totalPRs += (repoDay && repoDay.totalPRs) || 0;

                    finishDay(processed);
                },
                function() {
                    // Repo failed — render day without repo
                    finishDay(processed);
                }
            );
        }

        function finishDay(processed) {
            // Store day data in fullDayMap
            Object.keys(processed.dayMap || {}).forEach(function(dk) {
                fullDayMap[dk] = processed.dayMap[dk];
            });

            // Update calendar cell
            if (calendar && calendar.updateDayCell && processed.dayMap[day]) {
                calendar.updateDayCell(day, processed.dayMap[day], fullIssueMap);
            }

            completedDays++;
            // Move to next day
            processDaySequentially(dayIndex + 1);
        }
    }

    processDaySequentially(0);
}

function finalizeRender(requestUsers, startDate, endDate, calendar, repoActivity) {
    // Compute final stats
    var totalHours = 0;
    var activeDaysSet = {};
    Object.keys(fullDayMap).forEach(function(dk) {
        totalHours += fullDayMap[dk].totalHours || 0;
        if ((fullDayMap[dk].totalHours || 0) > 0) activeDaysSet[dk] = true;
    });

    var stats = {
        totalHours: Math.round(totalHours * 100) / 100,
        totalIssues: Object.keys(fullIssueMap).length
    };

    // Summary cards
    summaryInst = mods.summaryCards.create();
    summaryInst.render(stats);
    // Insert before calendar
    $contentArea.find(".dashboard-card").first().before(summaryInst.$el);

    // Project breakdown
    projBreakInst = mods.projectBreakdown.create();
    var projects = Object.values(fullProjectMap).sort(function(a, b) { return b.totalHours - a.totalHours; });
    var projList = projects.map(function(p) { return { key: p.key, hours: p.totalHours, count: p.issueCount }; });
    projBreakInst.render({ projects: projList, transitions: [] });
    $contentArea.append(projBreakInst.$el);

    // Issue list
    issueListInst = mods.issueList.create();
    var issueProjects = projects.map(function(p) {
        var issues = (p.issues || [])
            .map(function(k) {
                var iss = fullIssueMap[k];
                if (!iss) return null;
                return { key: iss.key, summary: iss.summary, type: iss.type, status: iss.status, hours: iss.totalTimeHours };
            })
            .filter(Boolean)
            .sort(function(a, b) { return b.hours - a.hours; });
        return { key: p.key, count: p.issueCount, hours: p.totalHours, issues: issues };
    });
    issueListInst.render(issueProjects);
    $contentArea.append(issueListInst.$el);

    // Activity log
    activityLogInst = mods.activityLog.create();
    var usernameStr = requestUsers.map(function(u) { return u.name; }).join(",");
    activityLogInst.render({ dayMap: fullDayMap, issueMap: fullIssueMap }, usernameStr,
        utils.getDayKey(startDate), utils.getDayKey(endDate));
    $contentArea.append(activityLogInst.$el);

    // Repo log
    if (repoActivity && Object.keys(repoActivity.dayMap).length > 0) {
        var repoLogInst = mods.repoLog.create();
        repoLogInst.render(repoActivity, null);
        $contentArea.append(repoLogInst.$el);

        if (mods.unifiedCalendar && calendar) {
            // Re-wire date selection to filter repo log
            // (calendar.onSelectDate was already set, add repo sync)
        }
    }
}
```

Note: The `fullDayMap`, `fullIssueMap`, `fullProjectMap` variables need to be scoped within `loadData` but accessible to `finalizeRender`. The simplest approach is to keep them as local variables in `loadData` and pass them to `finalizeRender`, or make `finalizeRender` a nested function inside `loadData`.

**Step 4: Run test to verify it passes**

Run: `node --test tests/user-activity-repo.test.js 2>&1 | tail -5`
Expected: PASS, all tests green

**Step 5: Commit**

```bash
git add ujg-user-activity-modules/rendering.js tests/user-activity-repo.test.js
git commit -m "feat(rendering): rewrite loadData to day-sequential pipeline"
```

---

### Task 7: Rebuild Bundle and Integration Test

**Files:**
- Run: `build-user-activity.js`
- Modify: `ujg-user-activity.js` (generated)
- Modify: `ujg-user-activity.runtime.js` (generated)
- Modify: `*.bootstrap.js` (update releaseRef)

**Step 1: Add request-cache to build script**

Check `build-user-activity.js` for the module list and add `request-cache.js` **before** `api.js` and `repo-api.js` (since they depend on it).

**Step 2: Build**

```bash
cd jira && node build-user-activity.js
```

**Step 3: Verify output**

Check that `ujg-user-activity.js` contains the `_ujgUA_requestCache` define block.

**Step 4: Run all tests**

```bash
node --test tests/user-activity-repo.test.js 2>&1 | tail -5
```

Expected: all tests PASS

**Step 5: Update bootstrap releaseRef**

```bash
node build-widget-bootstrap-assets.js
```

**Step 6: Commit**

```bash
git add ujg-user-activity-modules/request-cache.js ujg-user-activity.js ujg-user-activity.runtime.js *.bootstrap.js build-user-activity.js
git commit -m "build: add request-cache to bundle, rebuild assets"
```

---

### Task 8: Manual Verification Checklist

After all code changes:

1. Open the dashboard in a browser
2. Select 2+ users and a month-long period
3. Click "Загрузить"
4. Verify:
   - [ ] Empty calendar grid appears immediately
   - [ ] Days fill in from newest to oldest
   - [ ] Progress bar shows "День N / M — username..."
   - [ ] Clicking a filled day shows correct detail
   - [ ] Commits and PRs appear consistently for each day (no randomness)
   - [ ] Reloading the page and re-loading produces identical results
   - [ ] Clicking "Загрузить" again resets and starts fresh
