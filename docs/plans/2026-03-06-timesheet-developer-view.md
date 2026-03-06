# Timesheet Developer View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix "per-developer" mode, show date with month, display individual worklogs, replace user-select with searchable dropdown.

**Architecture:** Enrich worklog data model in `_ujgCommon.js`, add projection function in `ujg-timesheet.js`, update render and replace native `<select>` with custom dropdown widget. Pure jQuery/AMD, no new dependencies.

**Tech Stack:** jQuery, AMD (define), Jira REST API v2.

---

### Task 1: Enrich worklog data model in `_ujgCommon.js`

**Files:**
- Modify: `jira/_ujgCommon.js:149-177` (inside `loadWorklogsForDay`)

**Step 1: Add `worklogs` array to each issue record**

In `loadWorklogsForDay`, after grouping by author, build an extra `worklogs` array on the result object. Each entry: `{ authorId, authorName, seconds, comment }`.

```js
// Inside the dayWls.length > 0 block, after byAuthor loop
var worklogs = dayWls.map(function(w) {
    var uid = (w.author && (w.author.accountId || w.author.key || w.author.name)) || "unknown";
    var uname = (w.author && (w.author.displayName || w.author.name)) || uid;
    return {
        authorId: uid,
        authorName: uname,
        seconds: w.timeSpentSeconds || 0,
        comment: w.comment || ""
    };
});

result.push({
    key: key,
    seconds: totalSeconds,
    comments: allComments,
    authors: authors,
    worklogs: worklogs          // <-- NEW
});
```

**Step 2: Verify backwards compatibility**

Existing fields `seconds`, `comments`, `authors` remain unchanged. The only addition is `worklogs`.

**Step 3: Commit**

```bash
git add jira/_ujgCommon.js
git commit -m "feat(timesheet): add worklogs array to day issue data model"
```

---

### Task 2: Add projection function `filterDayDataByUsers`

**Files:**
- Modify: `jira/ujg-timesheet.js:169-176` (replace `filterDayDataByUsers`)

**Step 1: Rewrite `filterDayDataByUsers` to project worklogs**

```js
function filterDayDataByUsers(dayData, userIds) {
    if (!userIds || userIds.length === 0) return dayData;
    return dayData.map(function(item) {
        var wls = (item.worklogs || []).filter(function(w) {
            return userIds.indexOf(w.authorId) >= 0;
        });
        if (wls.length === 0) return null;
        var seconds = 0, comments = [], authors = {};
        wls.forEach(function(w) {
            seconds += w.seconds;
            if (w.comment) comments.push(w.comment);
            authors[w.authorId] = w.authorName;
        });
        return $.extend({}, item, {
            seconds: seconds,
            comments: comments,
            authors: authors,
            worklogs: wls
        });
    }).filter(Boolean);
}
```

**Step 2: Commit**

```bash
git add jira/ujg-timesheet.js
git commit -m "feat(timesheet): project issue data per selected users via worklogs"
```

---

### Task 3: Fix "per-developer" mode

**Files:**
- Modify: `jira/ujg-timesheet.js:348-358` (`renderCalendar`)

**Step 1: When `separateCalendars` is on and no users selected, iterate all known users**

```js
if (state.separateCalendars) {
    var userIds = state.selectedUsers.length > 0
        ? state.selectedUsers
        : Object.keys(state.users).sort(function(a, b) {
            return (state.users[a] || "").localeCompare(state.users[b] || "");
        });
    if (userIds.length > 0) {
        html += '<div class="ujg-calendars-container">';
        userIds.forEach(function(userId, idx) {
            html += renderSingleCalendar(userId, 'cal-' + idx);
        });
        html += '</div>';
    } else {
        html = renderSingleCalendar(null, 'cal-main');
    }
} else {
    html = renderSingleCalendar(null, 'cal-main');
}
```

**Step 2: Rename checkbox label**

In `initPanel` (line 638), change `Отдельные календари` to `По разработчикам`.

**Step 3: Commit**

```bash
git add jira/ujg-timesheet.js
git commit -m "fix(timesheet): per-developer mode works without manual user selection"
```

---

### Task 4: Show date as `dd.mm` in calendar cells

**Files:**
- Modify: `jira/ujg-timesheet.js:291` (cell date render)

**Step 1: Replace `day.getDate()` with formatted `dd.mm`**

```js
html += '<span class="ujg-cell-date">' + utils.formatDateShort(day) + '</span>';
```

`utils.formatDateShort` already exists in `_ujgCommon.js` and returns `dd.mm`.

**Step 2: Add `title` with full date to cell div**

```js
html += '<div class="' + cellClass + '" data-day="' + dayKey + '" title="' + utils.formatDate(day) + '">';
```

**Step 3: Commit**

```bash
git add jira/ujg-timesheet.js
git commit -m "fix(timesheet): show dd.mm date in calendar cells"
```

---

### Task 5: Display individual worklogs inside issue card

**Files:**
- Modify: `jira/ujg-timesheet.js:297-323` (issue card render)
- Modify: `jira/ujg-timesheet.css` (new class `.ujg-worklog-entry`)

**Step 1: After issue header and summary, render worklogs list**

Replace the current `showAuthors` block and `showComments` block with a unified worklogs section:

```js
// After summary line
if (item.worklogs && item.worklogs.length > 1) {
    html += '<div class="ujg-worklogs">';
    item.worklogs.forEach(function(wl) {
        html += '<div class="ujg-worklog-entry">';
        html += '<span class="ujg-wl-author">' + utils.escapeHtml(wl.authorName) + '</span>';
        html += '<span class="ujg-wl-time">' + utils.formatTime(wl.seconds) + '</span>';
        if (state.showComments && wl.comment) {
            html += '<span class="ujg-wl-comment">' + utils.escapeHtml(wl.comment.substring(0, 60)) + '</span>';
        }
        html += '</div>';
    });
    html += '</div>';
} else {
    // Single worklog: keep compact, show author only if needed
    if (showAuthors && item.authors) {
        var names = Object.keys(item.authors).map(function(k) { return item.authors[k]; });
        if (names.length > 0) html += '<div class="ujg-issue-author">' + utils.escapeHtml(names.join(", ")) + '</div>';
    }
    if (state.showComments && item.comments && item.comments.length > 0) {
        html += '<div class="ujg-issue-comment">' + utils.escapeHtml(item.comments[0].substring(0, 80)) + '</div>';
    }
}
```

**Step 2: Add CSS for worklog entries**

```css
.ujg-worklogs{margin-top:3px;display:flex;flex-direction:column;gap:1px}
.ujg-worklog-entry{display:flex;align-items:center;gap:4px;font-size:10px;color:#42526e;padding:1px 0;border-top:1px dotted #eee}
.ujg-wl-author{font-weight:500;color:#0052cc;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ujg-wl-time{font-weight:700;color:#172b4d}
.ujg-wl-comment{color:#6b778c;font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px}
```

**Step 3: Commit**

```bash
git add jira/ujg-timesheet.js jira/ujg-timesheet.css
git commit -m "feat(timesheet): show individual worklogs inside issue cards"
```

---

### Task 6: Searchable dropdown for user filter

**Files:**
- Modify: `jira/ujg-timesheet.js:544-573` (user filter init in `initPanel`)
- Modify: `jira/ujg-timesheet.css` (new dropdown styles)

**Step 1: Replace native `<select multiple>` with custom dropdown widget**

In `initPanel`, instead of creating `$userSelect` as a native select, build:

```js
// Dropdown button
var $ddBtn = $('<button class="aui-button ujg-user-dd-btn">Кто: Все</button>');
var $ddPanel = $('<div class="ujg-user-dd-panel" style="display:none"></div>');
var $ddSearch = $('<input type="text" class="ujg-user-dd-search" placeholder="Поиск...">');
var $ddActions = $('<div class="ujg-user-dd-actions"></div>');
var $ddAll = $('<button class="aui-button ujg-btn-small">Все</button>');
var $ddNone = $('<button class="aui-button ujg-btn-small">Сбросить</button>');
$ddActions.append($ddAll, $ddNone);
var $ddList = $('<div class="ujg-user-dd-list"></div>');
$ddPanel.append($ddSearch, $ddActions, $ddList);

// Toggle
$ddBtn.on("click", function(e) { e.stopPropagation(); $ddPanel.toggle(); });
$(document).on("click.ujgDd", function() { $ddPanel.hide(); });
$ddPanel.on("click", function(e) { e.stopPropagation(); });

// Search filter
$ddSearch.on("input", function() {
    var q = $(this).val().toLowerCase();
    $ddList.find(".ujg-user-dd-item").each(function() {
        $(this).toggle($(this).text().toLowerCase().indexOf(q) >= 0);
    });
});

// Select all / none
$ddAll.on("click", function() {
    state.selectedUsers = Object.keys(state.users);
    refreshDdList(); applyUserChange();
});
$ddNone.on("click", function() {
    state.selectedUsers = [];
    refreshDdList(); applyUserChange();
});
```

**Step 2: `refreshDdList()` rebuilds checkboxes from `state.users`**

```js
function refreshDdList() {
    var userList = Object.keys(state.users).map(function(id) {
        return { id: id, name: state.users[id] };
    }).sort(function(a, b) { return a.name.localeCompare(b.name); });
    $ddList.empty();
    userList.forEach(function(u) {
        var checked = state.selectedUsers.indexOf(u.id) >= 0;
        var $item = $('<label class="ujg-user-dd-item"><input type="checkbox"' + (checked ? ' checked' : '') + '><span></span></label>');
        $item.find("span").text(u.name);
        $item.find("input").on("change", function() {
            if ($(this).is(":checked")) {
                if (state.selectedUsers.indexOf(u.id) < 0) state.selectedUsers.push(u.id);
            } else {
                state.selectedUsers = state.selectedUsers.filter(function(id) { return id !== u.id; });
            }
            applyUserChange();
        });
        $ddList.append($item);
    });
    updateDdBtnLabel();
}

function updateDdBtnLabel() {
    var c = state.selectedUsers.length, t = Object.keys(state.users).length;
    $ddBtn.text("Кто: " + (c === 0 ? "Все (" + t + ")" : c + " из " + t));
}

function applyUserChange() {
    updateDdBtnLabel();
    updateUrlState();
    updateDebug();
    renderCalendar();
}
```

**Step 3: Rewire `updateUserList` to call `refreshDdList`**

Replace existing `updateUserList()` body:

```js
function updateUserList() { refreshDdList(); }
function updateUserSelectLabel() { updateDdBtnLabel(); }
```

**Step 4: Add CSS for dropdown**

```css
.ujg-user-dd-btn{position:relative;min-width:140px;text-align:left}
.ujg-user-dd-panel{position:absolute;z-index:100;background:#fff;border:1px solid #dfe1e6;border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,0.15);width:240px;max-height:320px;display:flex;flex-direction:column;padding:6px}
.ujg-user-dd-search{width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid #dfe1e6;border-radius:3px;font-size:12px;margin-bottom:4px}
.ujg-user-dd-actions{display:flex;gap:4px;margin-bottom:4px}
.ujg-user-dd-list{overflow-y:auto;max-height:220px;display:flex;flex-direction:column;gap:1px}
.ujg-user-dd-item{display:flex;align-items:center;gap:5px;padding:4px 6px;border-radius:3px;font-size:12px;cursor:pointer;user-select:none}
.ujg-user-dd-item:hover{background:#f4f5f7}
.ujg-user-dd-item input{margin:0}
```

**Step 5: Remove old `$userSelect`, `$clearUsersBtn`, adjust `$userFilter` container**

Delete creation of `$userSelect` and `$clearUsersBtn`. Replace with `$ddBtn` and `$ddPanel` inside `$userFilter`:

```js
$userFilter.append($ddBtn, $ddPanel);
```

Remove variable declarations of `$userSelect` from the top-level vars (line 114).

**Step 6: Commit**

```bash
git add jira/ujg-timesheet.js jira/ujg-timesheet.css
git commit -m "feat(timesheet): searchable dropdown for user filter"
```

---

### Task 7: Update README and bump version

**Files:**
- Modify: `jira/README.md`
- Modify: `jira/ujg-timesheet.js:10` (CONFIG.version)

**Step 1: Bump version to `1.6.0`**

**Step 2: Update README structure to reflect `docs/plans/`**

**Step 3: Commit**

```bash
git add jira/README.md jira/ujg-timesheet.js
git commit -m "chore: bump timesheet to 1.6.0, update readme"
```
