const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const loadAmdModule = require("./helpers/load-amd-module");

function normalize(value) {
    return JSON.parse(JSON.stringify(value));
}

function loadCommon() {
    return loadAmdModule(path.join(__dirname, "..", "_ujgCommon.js"), {
        jquery: {}
    });
}

function loadTimesheet(Common) {
    return loadAmdModule(path.join(__dirname, "..", "ujg-timesheet.js"), {
        jquery: {},
        _ujgCommon: Common
    });
}

test("collectIssueWorklogs keeps aggregates and individual worklogs", function() {
    var Common = loadCommon();
    assert.equal(typeof Common.collectIssueWorklogs, "function");

    var result = Common.collectIssueWorklogs([
        {
            author: { accountId: "u2", displayName: "Bob" },
            timeSpentSeconds: 1800,
            comment: ""
        },
        {
            author: { accountId: "u1", displayName: "Alice" },
            timeSpentSeconds: 1200,
            comment: "Sync"
        },
        {
            author: { accountId: "u1", displayName: "Alice" },
            timeSpentSeconds: 2400,
            comment: "Review"
        }
    ]);

    assert.deepEqual(normalize(result.authors), { u1: "Alice", u2: "Bob" });
    assert.equal(result.seconds, 5400);
    assert.deepEqual(normalize(result.comments), ["Sync", "Review"]);
    assert.deepEqual(normalize(result.worklogs), [
        { authorId: "u2", authorName: "Bob", seconds: 1800, comment: "" },
        { authorId: "u1", authorName: "Alice", seconds: 1200, comment: "Sync" },
        { authorId: "u1", authorName: "Alice", seconds: 2400, comment: "Review" }
    ]);
});

test("filterDayDataByUsers recalculates issue data from matching worklogs only", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    assert.equal(typeof Timesheet.__test.filterDayDataByUsers, "function");

    var original = {
        key: "SDKU-1",
        seconds: 5400,
        comments: ["Sync", "Review"],
        authors: { u1: "Alice", u2: "Bob" },
        worklogs: [
            { authorId: "u2", authorName: "Bob", seconds: 1800, comment: "" },
            { authorId: "u1", authorName: "Alice", seconds: 1200, comment: "Sync" },
            { authorId: "u1", authorName: "Alice", seconds: 2400, comment: "Review" }
        ]
    };

    var filtered = Timesheet.__test.filterDayDataByUsers([original], ["u1"]);

    assert.equal(filtered.length, 1);
    assert.notEqual(filtered[0], original);
    assert.equal(filtered[0].seconds, 3600);
    assert.deepEqual(normalize(filtered[0].comments), ["Sync", "Review"]);
    assert.deepEqual(normalize(filtered[0].authors), { u1: "Alice" });
    assert.deepEqual(normalize(filtered[0].worklogs), [
        { authorId: "u1", authorName: "Alice", seconds: 1200, comment: "Sync" },
        { authorId: "u1", authorName: "Alice", seconds: 2400, comment: "Review" }
    ]);
    assert.equal(original.seconds, 5400);
    assert.equal(original.worklogs.length, 3);
});

test("filterDayDataByUsers drops issues without matching authors", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);

    var filtered = Timesheet.__test.filterDayDataByUsers([
        {
            key: "SDKU-1",
            seconds: 1800,
            comments: [],
            authors: { u2: "Bob" },
            worklogs: [{ authorId: "u2", authorName: "Bob", seconds: 1800, comment: "" }]
        }
    ], ["u1"]);

    assert.deepEqual(normalize(filtered), []);
});

test("getCalendarUserIds prefers selected users and otherwise returns all users sorted by name", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    assert.equal(typeof Timesheet.__test.getCalendarUserIds, "function");

    assert.deepEqual(normalize(Timesheet.__test.getCalendarUserIds({
        u2: "Bob",
        u1: "Alice",
        u3: "Charlie"
    }, [])), ["u1", "u2", "u3"]);

    assert.deepEqual(normalize(Timesheet.__test.getCalendarUserIds({
        u2: "Bob",
        u1: "Alice"
    }, ["u2", "u9"])), ["u2"]);
});

test("countWorkDays counts only Mon-Fri", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    var days = [
        new Date(2026, 2, 2), // Mon
        new Date(2026, 2, 3), // Tue
        new Date(2026, 2, 4), // Wed
        new Date(2026, 2, 5), // Thu
        new Date(2026, 2, 6), // Fri
        new Date(2026, 2, 7), // Sat
        new Date(2026, 2, 8), // Sun
    ];
    assert.equal(Timesheet.__test.countWorkDays(days), 5);
    assert.equal(Timesheet.__test.countWorkDays([]), 0);
});

test("computeUserReport computes metrics correctly", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    var days = [
        new Date(2026, 2, 2), // Mon
        new Date(2026, 2, 3), // Tue
        new Date(2026, 2, 4), // Wed
        new Date(2026, 2, 5), // Thu
        new Date(2026, 2, 6), // Fri
    ];
    var calendarData = {
        "2026-03-02": [{
            key: "T-1", seconds: 28800,
            worklogs: [{ authorId: "u1", seconds: 28800, authorName: "User1" }],
            authors: { "u1": "User1" }
        }],
        "2026-03-03": [{
            key: "T-2", seconds: 14400,
            worklogs: [{ authorId: "u1", seconds: 14400, authorName: "User1" }],
            authors: { "u1": "User1" }
        }],
    };
    var result = Timesheet.__test.computeUserReport("u1", days, calendarData);
    assert.equal(result.workDays, 5);
    assert.equal(result.expectedSeconds, 5 * 8 * 3600);
    assert.equal(result.totalSeconds, 28800 + 14400);
    assert.equal(result.daysWorked, 2);
    assert.equal(result.taskCount, 2);
    assert.equal(result.deficit, (5 * 8 * 3600) - (28800 + 14400));
});

test("computeUserReport returns zero deficit when fully logged", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    var days = [new Date(2026, 2, 2)]; // Mon
    var calendarData = {
        "2026-03-02": [{
            key: "T-1", seconds: 28800,
            worklogs: [{ authorId: "u1", seconds: 28800, authorName: "User1" }],
            authors: { "u1": "User1" }
        }],
    };
    var result = Timesheet.__test.computeUserReport("u1", days, calendarData);
    assert.equal(result.deficit, 0);
    assert.equal(result.totalSeconds, 28800);
});

test("computeWeekSummary aggregates hours, projects, and issue types", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    var weekDays = [
        new Date(2026, 2, 2), // Mon
        new Date(2026, 2, 3), // Tue
        new Date(2026, 2, 4), // Wed
        new Date(2026, 2, 5), // Thu
        new Date(2026, 2, 6), // Fri
        null, // Sat placeholder
        null, // Sun placeholder
    ];
    var calendarData = {
        "2026-03-02": [
            { key: "PROJ-1", seconds: 14400, issueType: "Story", worklogs: [], authors: {} },
            { key: "PROJ-2", seconds: 7200, issueType: "Task", worklogs: [], authors: {} },
        ],
        "2026-03-03": [
            { key: "PROJ-1", seconds: 10800, issueType: "Story", worklogs: [], authors: {} },
            { key: "OTHER-5", seconds: 3600, issueType: "Bug", worklogs: [], authors: {} },
        ],
    };
    var result = Timesheet.__test.computeWeekSummary(weekDays, [], calendarData);
    assert.equal(result.totalSeconds, 14400 + 7200 + 10800 + 3600);
    assert.equal(result.expectedSeconds, 5 * 8 * 3600);
    assert.equal(result.workDays, 5);
    assert.equal(result.daysWorked, 2);
    assert.equal(result.taskCount, 3);
    assert.equal(result.projects["PROJ"], 14400 + 7200 + 10800);
    assert.equal(result.projects["OTHER"], 3600);
    assert.equal(result.issueTypes["Story"], 1); // PROJ-1 counted once
    assert.equal(result.issueTypes["Task"], 1);
    assert.equal(result.issueTypes["Bug"], 1);
});

test("computeMonthSummary adds utilization and project percentages", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    var days = [new Date(2026, 2, 2)]; // Mon
    var calendarData = {
        "2026-03-02": [
            { key: "A-1", seconds: 21600, issueType: "Story", worklogs: [], authors: {} },
            { key: "B-1", seconds: 7200, issueType: "Task", worklogs: [], authors: {} },
        ],
    };
    var result = Timesheet.__test.computeMonthSummary(days, [], calendarData);
    assert.equal(result.totalSeconds, 28800);
    assert.equal(result.expectedSeconds, 28800);
    assert.equal(result.utilization, 100);
    assert.equal(result.projectPcts["A"], 75);
    assert.equal(result.projectPcts["B"], 25);
});

test("computeWeekSummary in group mode scales capacity by active users", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    var weekDays = [
        new Date(2026, 2, 2), // Mon
        new Date(2026, 2, 3), // Tue
        new Date(2026, 2, 4), // Wed
        new Date(2026, 2, 5), // Thu
        new Date(2026, 2, 6), // Fri
    ];
    var calendarData = {
        "2026-03-02": [{
            key: "TEAM-1",
            seconds: 57600,
            issueType: "Story",
            authors: { u1: "Alice", u2: "Bob" },
            worklogs: [
                { authorId: "u1", authorName: "Alice", seconds: 28800, comment: "" },
                { authorId: "u2", authorName: "Bob", seconds: 28800, comment: "" }
            ]
        }]
    };

    var result = Timesheet.__test.computeWeekSummary(weekDays, [], calendarData, { groupSummary: true });

    assert.equal(result.totalSeconds, 57600);
    assert.equal(result.activeUserCount, 2);
    assert.equal(result.expectedSeconds, 2 * 5 * 8 * 3600);
    assert.equal(result.utilization, 20);
});

test("computeMonthSummary in group mode reports active users instead of single-user norm", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    var days = [new Date(2026, 2, 2)]; // Mon
    var calendarData = {
        "2026-03-02": [{
            key: "TEAM-1",
            seconds: 57600,
            issueType: "Task",
            authors: { u1: "Alice", u2: "Bob" },
            worklogs: [
                { authorId: "u1", authorName: "Alice", seconds: 28800, comment: "" },
                { authorId: "u2", authorName: "Bob", seconds: 28800, comment: "" }
            ]
        }]
    };

    var result = Timesheet.__test.computeMonthSummary(days, [], calendarData, { groupSummary: true });

    assert.equal(result.activeUserCount, 2);
    assert.equal(result.expectedSeconds, 2 * 8 * 3600);
    assert.equal(result.utilization, 100);
    assert.match(Timesheet.__test.formatSummaryHeadline(result, true), /2/);
    assert.doesNotMatch(Timesheet.__test.formatSummaryHeadline(result, true), /\/\s*8h|\/\s*40h/i);
});

test("getWeekTransitions filters changelog entries by week date range", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    var weekDays = [
        new Date(2026, 2, 2), // Mon
        new Date(2026, 2, 3), // Tue
        null, null, null, null, null,
    ];
    var taskKeys = { "T-1": true, "T-2": true };
    var changelogData = {
        "T-1": [
            { date: "2026-03-02T10:00:00.000+0000", from: "Open", to: "In Progress" },
            { date: "2026-03-10T10:00:00.000+0000", from: "In Progress", to: "Done" },
        ],
        "T-2": [
            { date: "2026-03-03T14:00:00.000+0000", from: "Open", to: "Review" },
        ],
    };
    var result = normalize(Timesheet.__test.getWeekTransitions(weekDays, taskKeys, changelogData));
    assert.equal(result.length, 2);
    var t1 = result.find(function(r) { return r.key === "T-1"; });
    var t2 = result.find(function(r) { return r.key === "T-2"; });
    assert.ok(t1);
    assert.deepEqual(t1.changes, ["Open \u2192 In Progress"]);
    assert.ok(t2);
    assert.deepEqual(t2.changes, ["Open \u2192 Review"]);
});
