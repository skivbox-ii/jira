# Timesheet Report Column — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Report" column to the Timesheet widget showing per-user worklog statistics (hours logged, deficit, days with entries, task count).

**Architecture:** New checkbox "Отчёт" toggles a side panel right of the calendar. Data computed from existing `state.calendarData`/`state.users` — no new API calls. Report updates in real-time during progressive loading.

**Tech Stack:** Vanilla JS (AMD module), jQuery, CSS

---

### Task 1: Add computeUserReport logic

**Files:**
- Modify: `jira/ujg-timesheet.js` — add functions after `getCalendarUserIds` (~line 129)
- Test: `jira/tests/timesheet-logic.test.js` — add tests for report computation

**Step 1: Add `countWorkDays` and `computeUserReport` functions**

Insert after `getCalendarUserIds` function (before `function MyGadget(API)`):

```javascript
function countWorkDays(days) {
    var count = 0;
    (days || []).forEach(function(day) {
        if (day && utils.getDayOfWeek(day) < 5) count++;
    });
    return count;
}

function computeUserReport(userId, days, calendarData) {
    var workDays = countWorkDays(days);
    var expectedSeconds = workDays * 8 * 3600;
    var totalSeconds = 0;
    var daysWithEntries = 0;
    var taskKeys = {};

    (days || []).forEach(function(day) {
        var dayKey = utils.getDayKey(day);
        var items = calendarData[dayKey] || [];
        var daySeconds = 0;
        items.forEach(function(item) {
            var wls = item.worklogs || [];
            wls.forEach(function(wl) {
                if (wl.authorId === userId) {
                    daySeconds += wl.seconds || 0;
                    if (item.key) taskKeys[item.key] = true;
                }
            });
            if (!item.worklogs || item.worklogs.length === 0) {
                if (item.authors && item.authors[userId]) {
                    daySeconds += item.seconds || 0;
                    if (item.key) taskKeys[item.key] = true;
                }
            }
        });
        if (daySeconds > 0) daysWithEntries++;
        totalSeconds += daySeconds;
    });

    var deficit = expectedSeconds - totalSeconds;
    return {
        totalSeconds: totalSeconds,
        expectedSeconds: expectedSeconds,
        deficit: deficit > 0 ? deficit : 0,
        daysWorked: daysWithEntries,
        workDays: workDays,
        taskCount: Object.keys(taskKeys).length
    };
}
```

**Step 2: Add test for computeUserReport**

Add to `jira/tests/timesheet-logic.test.js`:

```javascript
test("computeUserReport computes metrics correctly", () => {
    // Mock 5 days: Mon-Fri
    const days = [
        new Date(2026, 2, 2), // Mon
        new Date(2026, 2, 3), // Tue
        new Date(2026, 2, 4), // Wed
        new Date(2026, 2, 5), // Thu
        new Date(2026, 2, 6), // Fri
    ];
    const calendarData = {
        "2026-03-02": [{ key: "T-1", seconds: 28800, worklogs: [{ authorId: "u1", seconds: 28800 }], authors: { "u1": "User1" } }],
        "2026-03-03": [{ key: "T-2", seconds: 14400, worklogs: [{ authorId: "u1", seconds: 14400 }], authors: { "u1": "User1" } }],
    };
    const result = mod.computeUserReport("u1", days, calendarData);
    assert.strictEqual(result.workDays, 5);
    assert.strictEqual(result.expectedSeconds, 5 * 8 * 3600);
    assert.strictEqual(result.totalSeconds, 28800 + 14400);
    assert.strictEqual(result.daysWorked, 2);
    assert.strictEqual(result.taskCount, 2);
    assert.strictEqual(result.deficit, (5 * 8 * 3600) - (28800 + 14400));
});
```

**Step 3: Run test, verify it passes**

Run: `cd jira && node --test tests/timesheet-logic.test.js`

**Step 4: Export test functions**

Add `countWorkDays` and `computeUserReport` to `MyGadget.__test`:

```javascript
MyGadget.__test = {
    filterDayDataByUsers: filterDayDataByUsers,
    getCalendarUserIds: getCalendarUserIds,
    countWorkDays: countWorkDays,
    computeUserReport: computeUserReport
};
```

---

### Task 2: Add report rendering and checkbox

**Files:**
- Modify: `jira/ujg-timesheet.js` — add `state.showReport`, `renderReport()`, checkbox in `initPanel()`

**Step 1: Add `state.showReport`**

In `MyGadget` state object (~line 132), add:

```javascript
showReport: false,
reportSort: "name", // "name", "total", "deficit", "days", "tasks"
reportSortAsc: true,
```

**Step 2: Add `renderReport()` function**

Insert after `renderCalendar()` function. This builds an HTML table of per-user metrics.

**Step 3: Add "Отчёт" checkbox in `initPanel()`**

In `$row3`, after the `$separateCheck` block, add:

```javascript
var $reportCheck = $('<label class="ujg-control-checkbox"><input type="checkbox"><span>Отчёт</span></label>');
$reportCheck.find("input").on("change", function() {
    state.showReport = $(this).is(":checked");
    renderCalendar();
});
$row3.append($reportCheck);
```

**Step 4: Modify `renderCalendar()` to include report wrapper**

Wrap calendar HTML in a flex container and conditionally add report panel.

---

### Task 3: CSS styles for report panel

**Files:**
- Modify: `jira/ujg-timesheet.css` — add report panel styles at end

**Step 1: Add CSS**

```css
/* Report panel */
.ujg-report-wrapper{display:flex;gap:16px;align-items:flex-start}
.ujg-report-wrapper>.ujg-calendar,.ujg-report-wrapper>.ujg-calendars-container{flex:1;min-width:0}
.ujg-report-panel{width:320px;flex-shrink:0;border:1px solid #dfe1e6;border-radius:4px;overflow:hidden;font-size:12px;background:#fff}
.ujg-report-panel table{width:100%;border-collapse:collapse}
.ujg-report-panel th{padding:8px 6px;background:#f4f5f7;text-align:left;font-weight:600;color:#42526e;font-size:11px;cursor:pointer;user-select:none;white-space:nowrap;border-bottom:1px solid #dfe1e6}
.ujg-report-panel th:hover{background:#ebecf0}
.ujg-report-panel th.ujg-sort-active{color:#0052cc}
.ujg-report-panel td{padding:6px;border-bottom:1px solid #f4f5f7;color:#172b4d;white-space:nowrap}
.ujg-report-panel tr:hover td{background:#f8f9fb}
.ujg-report-panel .ujg-rp-name{max-width:120px;overflow:hidden;text-overflow:ellipsis;font-weight:500}
.ujg-report-panel .ujg-rp-ok{color:#27ae60;font-weight:700}
.ujg-report-panel .ujg-rp-deficit{color:#e74c3c;font-weight:700}
.ujg-report-panel .ujg-rp-empty{color:#b3bac5}
.ujg-report-panel .ujg-rp-total-row td{background:#f4f5f7;font-weight:700;border-top:2px solid #dfe1e6}
@media(max-width:768px){.ujg-report-wrapper{flex-direction:column}.ujg-report-panel{width:100%}}
```

---

### Task 4: Integration — wire renderReport into renderCalendar

**Files:**
- Modify: `jira/ujg-timesheet.js` — modify `renderCalendar()` function

**Step 1: Modify `renderCalendar()`**

Change the end of `renderCalendar()` to wrap calendar + report in a flex container when `state.showReport` is true.

**Step 2: Manual test**

Load Timesheet, enable "Отчёт" checkbox, verify report column appears with per-user data. Check colors: green for full, red deficit, dash for empty.
