const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const loadAmdModule = require("./helpers/load-amd-module");

function normalize(value) {
    return JSON.parse(JSON.stringify(value));
}

function createDeferred() {
    var state = "pending";
    var settledArgs = [];
    var doneHandlers = [];
    var failHandlers = [];
    var deferred = {
        resolve: function() {
            if (state !== "pending") return deferred;
            state = "resolved";
            settledArgs = Array.prototype.slice.call(arguments);
            doneHandlers.slice().forEach(function(handler) {
                handler.apply(null, settledArgs);
            });
            return deferred;
        },
        reject: function() {
            if (state !== "pending") return deferred;
            state = "rejected";
            settledArgs = Array.prototype.slice.call(arguments);
            failHandlers.slice().forEach(function(handler) {
                handler.apply(null, settledArgs);
            });
            return deferred;
        },
        done: function(handler) {
            if (state === "resolved") {
                handler.apply(null, settledArgs);
            } else if (state === "pending") {
                doneHandlers.push(handler);
            }
            return deferred;
        },
        fail: function(handler) {
            if (state === "rejected") {
                handler.apply(null, settledArgs);
            } else if (state === "pending") {
                failHandlers.push(handler);
            }
            return deferred;
        },
        then: function(onFulfilled, onRejected) {
            return new Promise(function(resolve, reject) {
                deferred.done(function() {
                    try {
                        resolve(onFulfilled ? onFulfilled.apply(null, arguments) : arguments[0]);
                    } catch (err) {
                        reject(err);
                    }
                });
                deferred.fail(function() {
                    if (!onRejected) {
                        reject(arguments[0]);
                        return;
                    }
                    try {
                        resolve(onRejected.apply(null, arguments));
                    } catch (err) {
                        reject(err);
                    }
                });
            });
        },
        promise: function() {
            return deferred;
        }
    };
    return deferred;
}

function resolvedAjax(data) {
    var d = createDeferred();
    d.resolve(data, "success", {});
    return d.promise();
}

function rejectedAjax(xhr, status, errorThrown) {
    var d = createDeferred();
    d.reject(xhr || {}, status || "error", errorThrown || "");
    return d.promise();
}

function hybridWorklogSearchResponse() {
    return {
        total: 1,
        issues: [
            {
                key: "PROJ-1",
                fields: {
                    summary: "Worklog issue",
                    status: { name: "In Progress" },
                    issuetype: { name: "Task" },
                    project: { key: "PROJ" },
                    worklog: {
                        startAt: 0,
                        maxResults: 20,
                        total: 1,
                        worklogs: [
                            {
                                id: "wl-hybrid-1",
                                author: { accountId: "u1" },
                                started: "2026-03-25T09:15:00.000+0000",
                                timeSpentSeconds: 1800
                            }
                        ]
                    }
                },
                changelog: { histories: [] }
            }
        ]
    };
}

var hybridActivityAtomXml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<feed xmlns="http://www.w3.org/2005/Atom">' +
    "<entry>" +
    "<title>User One commented on PROJ-2</title>" +
    "<published>2026-03-25T11:42:00.000Z</published>" +
    "<summary type=\"text\">Profile-only issue</summary>" +
    "</entry>" +
    "</feed>";

function createJqueryStub(handler) {
    var calls = [];
    return {
        ajax: function(options) {
            calls.push(options);
            return handler(options);
        },
        Deferred: createDeferred,
        __calls: calls
    };
}

function loadApi(jquery) {
    return loadAmdModule(path.join(__dirname, "..", "ujg-daily-diligence-modules", "api-jira.js"), {
        jquery: jquery,
        _ujgCommon: {
            utils: {
                parseDate: function(value) {
                    var date = new Date(value);
                    return isNaN(date.getTime()) ? null : date;
                },
                getDayKey: function(date) {
                    var year = date.getFullYear();
                    var month = String(date.getMonth() + 1).padStart(2, "0");
                    var day = String(date.getDate()).padStart(2, "0");
                    return year + "-" + month + "-" + day;
                }
            }
        },
        _ujgDD_config: {
            jiraBaseUrl: "https://jira.example.com"
        }
    });
}

test("fetchTeamData backfills paginated full worklogs only for truncated issues", async function() {
    var searchResponse = {
        total: 2,
        issues: [
            {
                key: "PROJ-1",
                fields: {
                    summary: "Truncated",
                    status: { name: "In Progress" },
                    issuetype: { name: "Task" },
                    project: { key: "PROJ" },
                    worklog: {
                        startAt: 0,
                        maxResults: 1,
                        total: 3,
                        worklogs: [
                            {
                                id: "wl-1",
                                author: { accountId: "u2" },
                                started: "2026-03-02T10:00:00.000+0000",
                                timeSpentSeconds: 600
                            }
                        ]
                    }
                },
                changelog: { histories: [] }
            },
            {
                key: "PROJ-2",
                fields: {
                    summary: "Complete",
                    status: { name: "Done" },
                    issuetype: { name: "Bug" },
                    project: { key: "PROJ" },
                    worklog: {
                        startAt: 0,
                        maxResults: 1,
                        total: 1,
                        worklogs: [
                            {
                                id: "wl-4",
                                author: { accountId: "u1" },
                                started: "2026-03-04T09:00:00.000+0000",
                                timeSpentSeconds: 900
                            }
                        ]
                    }
                },
                changelog: { histories: [] }
            }
        ]
    };

    var jquery = createJqueryStub(function(options) {
        if (options.url === "https://jira.example.com/rest/api/2/search") {
            return resolvedAjax(searchResponse);
        }
        if (options.url === "https://jira.example.com/rest/api/2/user") {
            return rejectedAjax({ status: 404 }, "error", "not found");
        }
        if (options.url === "https://jira.example.com/rest/api/2/issue/PROJ-1/worklog") {
            if (options.data.startAt === 0) {
                return resolvedAjax({
                    startAt: 0,
                    maxResults: 2,
                    total: 3,
                    worklogs: [
                        {
                            id: "wl-1",
                            author: { accountId: "u2" },
                            started: "2026-03-02T10:00:00.000+0000",
                            timeSpentSeconds: 600
                        },
                        {
                            id: "wl-2",
                            author: { accountId: "u1" },
                            started: "2026-03-03T11:00:00.000+0000",
                            timeSpentSeconds: 1200
                        }
                    ]
                });
            }
            if (options.data.startAt === 2) {
                return resolvedAjax({
                    startAt: 2,
                    maxResults: 2,
                    total: 3,
                    worklogs: [
                        {
                            id: "wl-3",
                            author: { accountId: "u1" },
                            started: "2026-03-10T11:00:00.000+0000",
                            timeSpentSeconds: 1800
                        }
                    ]
                });
            }
        }
        throw new Error("Unexpected AJAX call: " + JSON.stringify(normalize(options)));
    });

    var api = loadApi(jquery);
    var result = await api.fetchTeamData(["u1"], "2026-03-01", "2026-03-05");

    assert.equal(result.issues.length, 2);
    assert.deepEqual(normalize(result.issues[0].fields.worklog.worklogs), [
        {
            id: "wl-2",
            author: { accountId: "u1" },
            started: "2026-03-03T11:00:00.000+0000",
            timeSpentSeconds: 1200
        }
    ]);
    assert.equal(result.issues[0].fields.worklog.total, 1);
    assert.deepEqual(normalize(result.issues[1].fields.worklog.worklogs), [
        {
            id: "wl-4",
            author: { accountId: "u1" },
            started: "2026-03-04T09:00:00.000+0000",
            timeSpentSeconds: 900
        }
    ]);

    var worklogCalls = jquery.__calls.filter(function(call) {
        return /\/rest\/api\/2\/issue\/.+\/worklog$/.test(call.url);
    });
    assert.deepEqual(normalize(worklogCalls.map(function(call) {
        return {
            url: call.url,
            startAt: call.data.startAt
        };
    })), [
        { url: "https://jira.example.com/rest/api/2/issue/PROJ-1/worklog", startAt: 0 },
        { url: "https://jira.example.com/rest/api/2/issue/PROJ-1/worklog", startAt: 2 }
    ]);
});

test("fetchTeamData merges activity stream events with worklog issues", async function() {
    var jquery = createJqueryStub(function(options) {
        if (options.url === "https://jira.example.com/rest/api/2/search") {
            return resolvedAjax(hybridWorklogSearchResponse());
        }
        if (options.url === "https://jira.example.com/rest/api/2/user" && options.data && options.data.key === "u1") {
            return resolvedAjax({
                key: "u1",
                name: "user.one",
                displayName: "User One"
            });
        }
        if (String(options.url).indexOf("https://jira.example.com/activity") === 0) {
            return resolvedAjax(hybridActivityAtomXml);
        }
        throw new Error("Unexpected AJAX call: " + JSON.stringify(normalize(options)));
    });

    var api = loadApi(jquery);
    var result = await api.fetchTeamData(["u1"], "2026-03-24", "2026-03-25");

    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].key, "PROJ-1");
    assert.equal(result.issues[0].fields.summary, "Worklog issue");
    assert.equal(result.issues[0].fields.worklog.worklogs.length, 1);
    assert.equal(result.profileEvents && result.profileEvents.length, 1);
    assert.deepEqual(normalize(result.profileEvents[0]), {
        userKey: "u1",
        date: "2026-03-25",
        time: "11:42",
        issueKey: "PROJ-2",
        issueSummary: "Profile-only issue",
        eventType: "commented",
        text: "commented",
        rawTitle: "User One commented on PROJ-2"
    });
});

test("fetchTeamData keeps worklog results when activity stream fails", async function() {
    var jquery = createJqueryStub(function(options) {
        if (options.url === "https://jira.example.com/rest/api/2/search") {
            return resolvedAjax(hybridWorklogSearchResponse());
        }
        if (options.url === "https://jira.example.com/rest/api/2/user" && options.data && options.data.key === "u1") {
            return resolvedAjax({
                key: "u1",
                name: "user.one",
                displayName: "User One"
            });
        }
        if (String(options.url).indexOf("https://jira.example.com/activity") === 0) {
            return rejectedAjax({ status: 503 }, "error", "activity unavailable");
        }
        throw new Error("Unexpected AJAX call: " + JSON.stringify(normalize(options)));
    });

    var api = loadApi(jquery);
    var result = await api.fetchTeamData(["u1"], "2026-03-24", "2026-03-25");

    assert.equal(result.issues.length, 1);
    assert.deepEqual(normalize(result.profileEvents), []);
});
