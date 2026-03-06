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
