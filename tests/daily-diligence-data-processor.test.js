const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const loadAmdModule = require("./helpers/load-amd-module");

function loadUtils() {
    return loadAmdModule(path.join(__dirname, "..", "ujg-daily-diligence-modules", "utils.js"), {
        _ujgDD_config: { ICONS: {} }
    });
}

function loadDataProcessor() {
    return loadAmdModule(path.join(__dirname, "..", "ujg-daily-diligence-modules", "data-processor.js"), {
        _ujgDD_utils: loadUtils()
    });
}

test("processTeamData merges Jira, Bitbucket, Confluence for two users over two days", function() {
    var dp = loadDataProcessor();
    assert.equal(typeof dp.processTeamData, "function");

    var jiraData = {
        issues: [
            {
                key: "SDKU-1",
                fields: {
                    summary: "Fix bug",
                    status: { name: "In Progress" },
                    issuetype: { name: "Bug" },
                    project: { key: "SDKU", name: "SDK" },
                    worklog: {
                        startAt: 0,
                        maxResults: 2,
                        total: 2,
                        worklogs: [
                            {
                                author: { accountId: "u1" },
                                started: "2026-03-01T10:00:00.000+0000",
                                created: "2026-03-01T21:05:00.000+0000",
                                timeSpentSeconds: 3600,
                                comment: "work"
                            },
                            {
                                author: { key: "u2" },
                                started: "2026-03-02T08:00:00.000+0000",
                                created: "2026-03-01T22:00:00.000+0000",
                                timeSpentSeconds: 7200,
                                comment: "late log day"
                            }
                        ]
                    }
                },
                changelog: {
                    histories: [
                        {
                            id: "h1",
                            author: { accountId: "u1" },
                            created: "2026-03-02T14:00:00.000+0000",
                            items: [{ field: "status", fromString: "Open", toString: "In Progress" }]
                        }
                    ]
                }
            }
        ]
    };

    var t1 = Date.parse("2026-03-01T18:30:00.000Z");
    var t2 = Date.parse("2026-03-02T11:00:00.000Z");
    var bitbucketData = {
        commits: [
            {
                author: { user: { name: "u1" } },
                authorTimestamp: t1,
                message: "feat: evening",
                _ujgProjectKey: "SDKU",
                _ujgRepoSlug: "api"
            },
            {
                author: { user: { name: "u2" } },
                authorTimestamp: t2,
                message: "chore: stats",
                linesAdded: 3,
                linesRemoved: 1,
                _ujgProjectKey: "SDKU",
                _ujgRepoSlug: "api"
            }
        ],
        pullRequests: [
            {
                id: 7,
                title: "Feature PR",
                createdDate: Date.parse("2026-03-01T10:00:00.000Z"),
                updatedDate: Date.parse("2026-03-01T16:00:00.000Z"),
                author: { user: { name: "u2" } },
                reviewers: [{ user: { name: "u1" }, approved: true }],
                fromRef: {
                    repository: { slug: "repo", project: { key: "SDKU" } }
                },
                state: "OPEN",
                activities: [
                    {
                        user: { name: "u1" },
                        createdDate: Date.parse("2026-03-01T11:00:00.000Z"),
                        action: "COMMENTED"
                    }
                ]
            }
        ]
    };

    var confluenceData = [
        { date: "2026-03-02", pageTitle: "Runbook", space: "OPS", action: "updated", userKey: "u2" }
    ];

    var out = dp.processTeamData(jiraData, bitbucketData, confluenceData, ["u1", "u2"], "2026-03-01", "2026-03-02");

    assert.ok(out.u1 && out.u2);
    assert.equal(out.u1.userKey, "u1");
    assert.equal(out.u2.userKey, "u2");

    var d1u1 = out.u1.dayMap["2026-03-01"];
    var d2u1 = out.u1.dayMap["2026-03-02"];
    var d1u2 = out.u2.dayMap["2026-03-01"];
    var d2u2 = out.u2.dayMap["2026-03-02"];

    assert.ok(d1u1 && d2u1 && d1u2 && d2u2);
    assert.equal(d1u1.date, "2026-03-01");
    assert.equal(d2u2.date, "2026-03-02");

    assert.equal(d1u1.worklogs.length, 1);
    assert.equal(d1u1.worklogs[0].issueKey, "SDKU-1");
    assert.equal(d1u1.worklogs[0].workedDate, "2026-03-01");
    assert.equal(d1u1.totalHours, 1);
    assert.equal(d1u1.worklogLoggedLate, true);
    assert.equal(d1u1.hasEveningCommit, true);
    assert.equal(d1u1.lastCommitTime, "18:30");
    assert.equal(d1u1.issueKeys.length, 1);
    assert.equal(d1u1.issueKeys[0], "SDKU-1");

    assert.equal(d1u1.commits.length, 1);
    assert.equal(d1u1.commits[0].linesAdded, 0);
    assert.equal(d1u1.commits[0].linesRemoved, 0);
    assert.equal(d1u1.commits[0].repo, "SDKU/api");

    assert.equal(d1u1.pullRequests.length, 1);
    assert.equal(d1u1.pullRequests[0].author, "u2");
    assert.equal(d1u1.pullRequests[0].state, "open");
    assert.ok(d1u1.pullRequests[0].firstReviewAt);
    assert.equal(d1u1.pullRequests[0].reactionMinutes, 60);

    assert.equal(d2u1.changes.length, 1);
    assert.equal(d2u1.changes[0].issueKey, "SDKU-1");
    assert.equal(d2u1.changes[0].toString, "In Progress");
    assert.equal(d2u1.issueKeys.length, 1);
    assert.equal(d2u1.issueKeys[0], "SDKU-1");

    assert.equal(d2u2.worklogs.length, 1);
    assert.equal(d2u2.worklogs[0].workedDate, "2026-03-02");
    assert.equal(d2u2.totalHours, 2);
    assert.equal(d2u2.worklogLoggedLate, true);
    assert.equal(d2u2.confluence.length, 1);
    assert.equal(d2u2.confluence[0].pageTitle, "Runbook");

    assert.equal(d2u2.commits.length, 1);
    assert.equal(d2u2.commits[0].linesAdded, 3);
    assert.equal(d2u2.commits[0].linesRemoved, 1);

    assert.equal(d1u2.pullRequests.length, 1);
    assert.equal(d1u2.pullRequests[0].author, "u2");
    assert.ok(d1u2.pullRequests[0].firstReviewAt);
    assert.equal(d1u2.pullRequests[0].reactionMinutes, 60);

    assert.ok(out.u1.issueMap["SDKU-1"]);
    assert.equal(out.u1.issueMap["SDKU-1"].summary, "Fix bug");
    assert.ok(out.u2.issueMap["SDKU-1"]);
});

test("processTeamData skips changelog rows when history author is not a requested team key", function() {
    var dp = loadDataProcessor();
    var jiraData = {
        issues: [
            {
                key: "X-1",
                fields: {
                    summary: "S",
                    status: { name: "Open" },
                    issuetype: { name: "Task" },
                    project: { key: "X", name: "Xp" },
                    worklog: { startAt: 0, maxResults: 0, total: 0, worklogs: [] }
                },
                changelog: {
                    histories: [
                        {
                            author: { accountId: "stranger" },
                            created: "2026-03-01T12:00:00.000+0000",
                            items: [{ field: "status", fromString: "Open", toString: "Done" }]
                        }
                    ]
                }
            }
        ]
    };
    var out = dp.processTeamData(jiraData, { commits: [], pullRequests: [] }, [], ["u1"], "2026-03-01", "2026-03-01");
    assert.equal(out.u1.dayMap["2026-03-01"].changes.length, 0);
});

test("processTeamData matches Jira authors by broader person fields", function() {
    var dp = loadDataProcessor();
    var jiraData = {
        issues: [
            {
                key: "SDKU-2",
                fields: {
                    summary: "Broader Jira identity",
                    status: { name: "In Progress" },
                    issuetype: { name: "Task" },
                    project: { key: "SDKU", name: "SDK" },
                    worklog: {
                        startAt: 0,
                        maxResults: 1,
                        total: 1,
                        worklogs: [
                            {
                                author: { emailAddress: "user.one@example.com" },
                                started: "2026-03-01T09:00:00.000+0000",
                                created: "2026-03-01T09:30:00.000+0000",
                                timeSpentSeconds: 1800
                            }
                        ]
                    }
                },
                changelog: {
                    histories: [
                        {
                            author: { displayName: "User Two" },
                            created: "2026-03-01T12:00:00.000+0000",
                            items: [{ field: "status", fromString: "Open", toString: "Done" }]
                        }
                    ]
                }
            }
        ]
    };

    var out = dp.processTeamData(
        jiraData,
        { commits: [], pullRequests: [] },
        [],
        ["user.one@example.com", "User Two"],
        "2026-03-01",
        "2026-03-01"
    );

    assert.equal(out["user.one@example.com"].dayMap["2026-03-01"].worklogs.length, 1);
    assert.equal(out["User Two"].dayMap["2026-03-01"].changes.length, 1);
});

test("processTeamData does not infer late worklogs from started when created is missing", function() {
    var dp = loadDataProcessor();
    var jiraData = {
        issues: [
            {
                key: "SDKU-3",
                fields: {
                    summary: "Missing created",
                    status: { name: "In Progress" },
                    issuetype: { name: "Task" },
                    project: { key: "SDKU", name: "SDK" },
                    worklog: {
                        startAt: 0,
                        maxResults: 1,
                        total: 1,
                        worklogs: [
                            {
                                author: { accountId: "u1" },
                                started: "2026-03-01T21:30:00.000+0000",
                                timeSpentSeconds: 1800
                            }
                        ]
                    }
                },
                changelog: { histories: [] }
            }
        ]
    };

    var out = dp.processTeamData(jiraData, { commits: [], pullRequests: [] }, [], ["u1"], "2026-03-01", "2026-03-01");
    assert.equal(out.u1.dayMap["2026-03-01"].worklogLoggedLate, false);
});

test("processTeamData flattens structured worklog comments to plain text", function() {
    var dp = loadDataProcessor();
    var jiraData = {
        issues: [
            {
                key: "SDKU-4",
                fields: {
                    summary: "Structured comment",
                    status: { name: "In Progress" },
                    issuetype: { name: "Task" },
                    project: { key: "SDKU", name: "SDK" },
                    worklog: {
                        startAt: 0,
                        maxResults: 1,
                        total: 1,
                        worklogs: [
                            {
                                author: { accountId: "u1" },
                                started: "2026-03-01T09:00:00.000+0000",
                                created: "2026-03-01T09:15:00.000+0000",
                                timeSpentSeconds: 1800,
                                comment: {
                                    type: "doc",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [
                                                { type: "text", text: "hello" },
                                                { type: "text", text: "world" }
                                            ]
                                        }
                                    ]
                                }
                            }
                        ]
                    }
                },
                changelog: { histories: [] }
            }
        ]
    };

    var out = dp.processTeamData(jiraData, { commits: [], pullRequests: [] }, [], ["u1"], "2026-03-01", "2026-03-01");
    assert.equal(out.u1.dayMap["2026-03-01"].worklogs[0].comment, "hello world");
});
