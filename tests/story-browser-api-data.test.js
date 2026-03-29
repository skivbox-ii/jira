const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const loadAmdModule = require("./helpers/load-amd-module");

const MODULE_DIR = path.join(__dirname, "..", "ujg-story-browser-modules");

function mockWindow() {
    return {
        location: { origin: "https://jira.example.com", protocol: "https:" },
        AJS: { params: { baseURL: "" } }
    };
}

function loadConfig(windowImpl) {
    return loadAmdModule(
        path.join(MODULE_DIR, "config.js"),
        {},
        windowImpl ? { window: windowImpl } : {}
    );
}

function loadUtils(windowImpl) {
    const config = loadConfig(windowImpl);
    return loadAmdModule(path.join(MODULE_DIR, "utils.js"), {
        _ujgSB_config: config
    });
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

function rejectedAjax(err) {
    var d = createDeferred();
    d.reject(err || {}, "error", "");
    return d.promise();
}

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

function loadApi(jquery, windowImpl) {
    const config = loadConfig(windowImpl || mockWindow());
    return loadApiWithConfig(jquery, config);
}

function loadApiWithConfig(jquery, config) {
    return loadAmdModule(path.join(MODULE_DIR, "api.js"), {
        jquery: jquery,
        _ujgSB_config: config
    });
}

function loadData(windowImpl) {
    const config = loadConfig(windowImpl || mockWindow());
    const utils = loadAmdModule(path.join(MODULE_DIR, "utils.js"), {
        _ujgSB_config: config
    });
    return loadDataWithDeps(config, utils);
}

function loadDataWithDeps(config, utils) {
    return loadAmdModule(path.join(MODULE_DIR, "data.js"), {
        _ujgSB_config: config,
        _ujgSB_utils: utils
    });
}

function issueFixture(overrides) {
    const base = {
        key: "PROJ-1",
        fields: {
            summary: "One",
            status: { name: "Open", statusCategory: { name: "To Do", key: "new" } },
            issuetype: { name: "Story" },
            priority: { name: "High" },
            assignee: { displayName: "Alice" },
            timeoriginalestimate: 3600,
            timespent: 1800,
            timetracking: {},
            components: [{ name: "API" }],
            labels: ["l1"],
            fixVersions: [{ name: "1.0" }],
            parent: null,
            created: "2026-01-01T10:00:00.000+0000",
            updated: "2026-01-02T10:00:00.000+0000",
            customfield_10014: null,
            customfield_10020: null
        },
        changelog: { histories: [] }
    };
    const merged = JSON.parse(JSON.stringify(base));
    if (overrides) {
        Object.assign(merged, overrides.key != null ? { key: overrides.key } : {});
        if (overrides.fields) {
            Object.assign(merged.fields, overrides.fields);
        }
        if (overrides.changelog) {
            merged.changelog = overrides.changelog;
        }
    }
    return merged;
}

test("getProjects requests Jira project list", async function() {
    const jquery = createJqueryStub(function() {
        return resolvedAjax([{ key: "P", name: "Proj" }]);
    });
    const api = loadApi(jquery);
    const projects = await api.getProjects();
    assert.equal(jquery.__calls.length, 1);
    assert.equal(jquery.__calls[0].url, "https://jira.example.com/rest/api/2/project");
    assert.equal(Array.isArray(projects), true);
    assert.equal(projects[0].key, "P");
});

test("getProjectIssues posts search with expected body and paginates", async function() {
    const config = loadConfig(mockWindow());
    const fieldsList = config.ISSUE_FIELDS.split(",");

    var page = 0;
    const jquery = createJqueryStub(function(options) {
        assert.equal(options.type, "POST");
        assert.equal(options.url, "https://jira.example.com/rest/api/2/search");
        assert.equal(options.contentType, "application/json");
        const body = JSON.parse(options.data);
        assert.equal(body.jql, 'project = DEMO ORDER BY issuetype ASC, key ASC');
        assert.equal(body.fields.length, fieldsList.length);
        for (var fi = 0; fi < fieldsList.length; fi += 1) {
            assert.equal(body.fields[fi], fieldsList[fi]);
        }
        assert.deepEqual(body.expand, ["changelog"]);
        assert.equal(body.maxResults, 100);
        if (page === 0) {
            assert.equal(body.startAt, 0);
            page += 1;
            return resolvedAjax({
                total: 150,
                issues: new Array(100).fill(null).map(function(_, i) {
                    return { key: "DEMO-" + (i + 1), fields: { summary: "x" } };
                })
            });
        }
        assert.equal(body.startAt, 100);
        return resolvedAjax({
            total: 150,
            issues: new Array(50).fill(null).map(function(_, i) {
                return { key: "DEMO-" + (i + 101), fields: { summary: "y" } };
            })
        });
    });
    const api = loadApi(jquery);
    const issues = await api.getProjectIssues("DEMO");
    assert.equal(issues.length, 150);
    assert.equal(jquery.__calls.length, 2);
});

test("getProjectIssues progress callback receives accumulated issues for partial rendering", async function() {
    const progressCalls = [];
    var page = 0;
    const jquery = createJqueryStub(function() {
        if (page === 0) {
            page += 1;
            return resolvedAjax({
                total: 3,
                issues: [
                    { key: "DEMO-1", fields: { summary: "first" } },
                    { key: "DEMO-2", fields: { summary: "second" } }
                ]
            });
        }
        return resolvedAjax({
            total: 3,
            issues: [{ key: "DEMO-3", fields: { summary: "third" } }]
        });
    });
    const api = loadApi(jquery);

    const issues = await api.getProjectIssues("DEMO", function(loaded, total, partialIssues) {
        progressCalls.push({
            loaded: loaded,
            total: total,
            keys: (partialIssues || []).map(function(issue) {
                return issue.key;
            })
        });
    });

    assert.equal(issues.length, 3);
    assert.deepEqual(JSON.parse(JSON.stringify(progressCalls)), [
        { loaded: 2, total: 3, keys: ["DEMO-1", "DEMO-2"] },
        { loaded: 3, total: 3, keys: ["DEMO-1", "DEMO-2", "DEMO-3"] }
    ]);
});

test("getProjectIssues uses direct ISSUE_FIELDS split contract", async function() {
    const jquery = createJqueryStub(function(options) {
        const body = JSON.parse(options.data);
        assert.equal(body.fields.length, 2);
        assert.equal(body.fields[0], "summary");
        assert.equal(body.fields[1], " status");
        return resolvedAjax({ total: 0, issues: [] });
    });
    const api = loadApiWithConfig(jquery, {
        baseUrl: "https://jira.example.com",
        ISSUE_FIELDS: "summary, status"
    });

    const issues = await api.getProjectIssues("DEMO");
    assert.equal(issues.length, 0);
});

test("getProjectIssues safely quotes unusual project identifiers in JQL", async function() {
    const jquery = createJqueryStub(function(options) {
        const body = JSON.parse(options.data);
        assert.equal(
            body.jql,
            'project = "QA \\"Ops\\" / Team" ORDER BY issuetype ASC, key ASC'
        );
        return resolvedAjax({ total: 0, issues: [] });
    });
    const api = loadApiWithConfig(jquery, {
        baseUrl: "https://jira.example.com",
        ISSUE_FIELDS: "summary,status"
    });

    const issues = await api.getProjectIssues('QA "Ops" / Team');
    assert.equal(issues.length, 0);
});

test("getProjectIssues calls onProgress after each page", async function() {
    var progress = [];
    const jquery = createJqueryStub(function(options) {
        const body = JSON.parse(options.data);
        if (body.startAt === 0) {
            return resolvedAjax({
                total: 120,
                issues: new Array(100).fill(null).map(function(_, i) {
                    return { key: "X-" + i, fields: {} };
                })
            });
        }
        return resolvedAjax({
            total: 120,
            issues: new Array(20).fill(null).map(function(_, i) {
                return { key: "X-" + (100 + i), fields: {} };
            })
        });
    });
    const api = loadApi(jquery);
    await api.getProjectIssues("X", function(loaded, total) {
        progress.push({ loaded: loaded, total: total });
    });
    assert.deepEqual(progress, [
        { loaded: 100, total: 120 },
        { loaded: 120, total: 120 }
    ]);
});

test("getProjectIssues rejects when first page fails", async function() {
    const jquery = createJqueryStub(function() {
        return rejectedAjax({ status: 500 });
    });
    const api = loadApi(jquery);
    await assert.rejects(
        async function() {
            await api.getProjectIssues("Z");
        },
        function() {
            return true;
        }
    );
});

test("getProjectIssues resolves partial when a later page fails", async function() {
    var n = 0;
    const jquery = createJqueryStub(function() {
        n += 1;
        if (n === 1) {
            return resolvedAjax({
                total: 200,
                issues: [{ key: "A-1", fields: { summary: "a" } }]
            });
        }
        return rejectedAjax({ status: 500 });
    });
    const api = loadApi(jquery);
    const issues = await api.getProjectIssues("A");
    assert.equal(issues.length, 1);
    assert.equal(issues[0].key, "A-1");
});

test("getProjectIssues stops on empty page", async function() {
    const jquery = createJqueryStub(function() {
        return resolvedAjax({ total: 999, issues: [] });
    });
    const api = loadApi(jquery);
    const issues = await api.getProjectIssues("E");
    assert.ok(Array.isArray(issues));
    assert.equal(issues.length, 0);
});

test("getProjectEpics posts epic-only search", async function() {
    const config = loadConfig(mockWindow());
    const jquery = createJqueryStub(function(options) {
        const body = JSON.parse(options.data);
        assert.equal(body.jql, "project = DEMO AND issuetype = Epic ORDER BY key ASC");
        assert.equal(body.fields.includes("issuelinks"), true);
        assert.equal(body.expand[0], "changelog");
        return resolvedAjax({ total: 0, issues: [] });
    });
    const api = loadApiWithConfig(jquery, config);

    const issues = await api.getProjectEpics("DEMO");
    assert.ok(Array.isArray(issues));
    assert.equal(issues.length, 0);
});

test("getFieldMetadata requests Jira field catalog", async function() {
    const jquery = createJqueryStub(function(options) {
        assert.equal(options.type, "GET");
        assert.equal(options.url, "https://jira.example.com/rest/api/2/field");
        return resolvedAjax([{ id: "customfield_10008", name: "Epic Link" }]);
    });
    const api = loadApi(jquery);
    const fields = await api.getFieldMetadata();
    assert.equal(Array.isArray(fields), true);
    assert.equal(fields[0].id, "customfield_10008");
});

test("detectFieldConfig derives epic and sprint fields from metadata", function() {
    const jquery = createJqueryStub(function() {
        return resolvedAjax([]);
    });
    const api = loadApi(jquery);
    const detected = api.detectFieldConfig([
        {
            id: "customfield_10008",
            name: "Epic Link",
            schema: { custom: "com.pyxis.greenhopper.jira:gh-epic-link" }
        },
        {
            id: "customfield_10007",
            name: "Sprint",
            schema: { custom: "com.pyxis.greenhopper.jira:gh-sprint" }
        }
    ]);
    assert.equal(detected.epicLinkField, "customfield_10008");
    assert.equal(detected.sprintField, "customfield_10007");
});

test("getStoriesForEpicKeys posts story search scoped by epic link field", async function() {
    const config = loadConfig(mockWindow());
    const jquery = createJqueryStub(function(options) {
        const body = JSON.parse(options.data);
        assert.equal(
            body.jql,
            "project = DEMO AND issuetype = Story AND cf[10014] in (DEMO-2, DEMO-10) ORDER BY key ASC"
        );
        return resolvedAjax({ total: 0, issues: [] });
    });
    const api = loadApiWithConfig(jquery, config);

    const issues = await api.getStoriesForEpicKeys("DEMO", ["DEMO-2", "DEMO-10"]);
    assert.ok(Array.isArray(issues));
    assert.equal(issues.length, 0);
});

test("getStoriesForEpicKeys uses detected epic link field override", async function() {
    const config = loadConfig(mockWindow());
    const jquery = createJqueryStub(function(options) {
        const body = JSON.parse(options.data);
        assert.equal(
            body.jql,
            "project = DEMO AND issuetype = Story AND cf[10008] in (DEMO-2) ORDER BY key ASC"
        );
        assert.equal(body.fields.includes("customfield_10008"), true);
        assert.equal(body.fields.includes("customfield_10014"), false);
        return resolvedAjax({ total: 0, issues: [] });
    });
    const api = loadApiWithConfig(jquery, config);

    const issues = await api.getStoriesForEpicKeys(
        "DEMO",
        ["DEMO-2"],
        null,
        { epicLinkField: "customfield_10008", sprintField: "customfield_10020" }
    );
    assert.ok(Array.isArray(issues));
    assert.equal(issues.length, 0);
});

test("getStoriesForEpicKeys splits large epic lists into multiple searches", async function() {
    const config = loadConfig(mockWindow());
    const epicKeys = Array.from({ length: 250 }, function(_, index) {
        return "DEMO-" + String(index + 1);
    });
    const seenJql = [];
    const jquery = createJqueryStub(function(options) {
        const body = JSON.parse(options.data);
        seenJql.push(body.jql);
        return resolvedAjax({
            total: 1,
            issues: [{ key: "S-" + String(seenJql.length), fields: { summary: "Story" } }]
        });
    });
    const api = loadApiWithConfig(jquery, config);

    const issues = await api.getStoriesForEpicKeys("DEMO", epicKeys);
    assert.ok(Array.isArray(issues));
    assert.ok(jquery.__calls.length > 1);
    assert.equal(issues.length, jquery.__calls.length);
    assert.equal(seenJql[0].indexOf("DEMO-1") >= 0, true);
    assert.equal(seenJql[seenJql.length - 1].indexOf("DEMO-250") >= 0, true);
});

test("getIssuesByKeys returns empty array without search call for empty key list", async function() {
    const jquery = createJqueryStub(function() {
        throw new Error("search should not be called");
    });
    const api = loadApi(jquery);

    const issues = await api.getIssuesByKeys([]);
    assert.equal(Array.isArray(issues), true);
    assert.equal(issues.length, 0);
    assert.equal(jquery.__calls.length, 0);
});

test("buildTree payload keeps only open epics, only stories, and linked child issues", function() {
    const data = loadData();
    const tree = data.buildTree({
        epics: [
            issueFixture({
                key: "E-10",
                fields: {
                    summary: "Open epic",
                    issuetype: { name: "Epic" },
                    status: { name: "Open", statusCategory: { name: "To Do", key: "new" } }
                }
            }),
            issueFixture({
                key: "E-20",
                fields: {
                    summary: "Closed epic",
                    issuetype: { name: "Epic" },
                    status: { name: "Done", statusCategory: { name: "Done", key: "done" } }
                }
            })
        ],
        stories: [
            issueFixture({
                key: "S-1",
                fields: {
                    summary: "Story child",
                    issuetype: { name: "Story" },
                    customfield_10014: "E-10",
                    issuelinks: [
                        {
                            type: { outward: "child", inward: "parent" },
                            outwardIssue: { key: "BE-1" }
                        },
                        {
                            type: { outward: "parent", inward: "is_child" },
                            inwardIssue: { key: "NP-1" }
                        },
                        {
                            type: { outward: "blocks", inward: "is blocked by" },
                            outwardIssue: { key: "SKIP-1" }
                        }
                    ]
                }
            }),
            issueFixture({
                key: "T-1",
                fields: {
                    summary: "Task under epic",
                    issuetype: { name: "Task" },
                    customfield_10014: "E-10"
                }
            }),
            issueFixture({
                key: "S-2",
                fields: {
                    summary: "Story under closed epic",
                    issuetype: { name: "Story" },
                    customfield_10014: "E-20"
                }
            })
        ],
        children: [
            issueFixture({
                key: "BE-1",
                fields: {
                    summary: "[BE] Backend API",
                    issuetype: { name: "Task" }
                }
            }),
            issueFixture({
                key: "NP-1",
                fields: {
                    summary: "Missing prefix child",
                    issuetype: { name: "Task" }
                }
            })
        ]
    });

    assert.equal(tree.length, 1);
    assert.equal(tree[0].key, "E-10");
    assert.equal(tree[0].children.length, 1);
    assert.equal(tree[0].children[0].key, "S-1");
    assert.equal(tree[0].children[0].children.length, 2);
    assert.equal(tree[0].children[0].children[0].key, "BE-1");
    assert.equal(tree[0].children[0].children[0].classification, "BE");
    assert.equal(tree[0].children[0].children[0].classificationMissing, false);
    assert.equal(tree[0].children[0].children[1].key, "NP-1");
    assert.equal(tree[0].children[0].children[1].classification, "NO PREFIX");
    assert.equal(tree[0].children[0].children[1].classificationMissing, true);
    assert.equal(tree[0].children[0].children[0].browseUrl, "https://jira.example.com/browse/BE-1");
});

test("buildTree respects provided epic and sprint field overrides", function() {
    const data = loadData();
    const tree = data.buildTree(
        {
            epics: [
                issueFixture({
                    key: "E-1",
                    fields: {
                        summary: "Epic override",
                        issuetype: { name: "Epic" }
                    }
                })
            ],
            stories: [
                issueFixture({
                    key: "S-1",
                    fields: {
                        summary: "Story via override",
                        issuetype: { name: "Story" },
                        customfield_10014: null,
                        customfield_10008: "E-1",
                        customfield_10007: [{ name: "Sprint Override" }]
                    }
                })
            ],
            children: []
        },
        {
            epicLinkField: "customfield_10008",
            sprintField: "customfield_10007"
        }
    );

    assert.equal(tree.length, 1);
    assert.equal(tree[0].key, "E-1");
    assert.equal(tree[0].children.length, 1);
    assert.equal(tree[0].children[0].key, "S-1");
    assert.equal(tree[0].children[0].sprint, "Sprint Override");
});

test("collectFilters keeps full epic catalog sorted by issue number", function() {
    const data = loadData();
    const epicCatalog = [
        issueFixture({
            key: "E-20",
            fields: {
                summary: "Closed epic",
                issuetype: { name: "Epic" },
                status: { name: "Done", statusCategory: { name: "Done", key: "done" } }
            }
        }),
        issueFixture({
            key: "E-2",
            fields: {
                summary: "Early epic",
                issuetype: { name: "Epic" },
                status: { name: "Open", statusCategory: { name: "To Do", key: "new" } }
            }
        }),
        issueFixture({
            key: "E-10",
            fields: {
                summary: "Open epic",
                issuetype: { name: "Epic" },
                status: { name: "Open", statusCategory: { name: "To Do", key: "new" } }
            }
        })
    ];
    const tree = data.buildTree({
        epics: epicCatalog,
        stories: [
            issueFixture({
                key: "S-1",
                fields: {
                    summary: "Story child",
                    issuetype: { name: "Story" },
                    status: { name: "In Progress", statusCategory: { name: "In Progress", key: "indeterminate" } },
                    customfield_10014: "E-10",
                    customfield_10020: { name: "Sprint 42" }
                }
            })
        ],
        children: []
    });

    const filters = data.collectFilters(tree, epicCatalog);
    assert.ok(filters.statuses.includes("Open"));
    assert.ok(filters.statuses.includes("In Progress"));
    assert.equal(
        filters.epics.map(function(epic) {
            return epic.key;
        }).join("|"),
        "E-2|E-10|E-20"
    );
    assert.equal(filters.sprints[0], "Sprint 42");
});

test("filterTree scopes selectedEpicKeys while preserving matching descendants", function() {
    const data = loadData();
    const tree = data.buildTree({
        epics: [
            issueFixture({
                key: "E-2",
                fields: {
                    summary: "First epic",
                    issuetype: { name: "Epic" },
                    status: { name: "Open", statusCategory: { name: "To Do", key: "new" } }
                }
            }),
            issueFixture({
                key: "E-10",
                fields: {
                    summary: "Second epic",
                    issuetype: { name: "Epic" },
                    status: { name: "Open", statusCategory: { name: "To Do", key: "new" } }
                }
            })
        ],
        stories: [
            issueFixture({
                key: "S-2",
                fields: {
                    summary: "Visible needle story",
                    issuetype: { name: "Story" },
                    customfield_10014: "E-10"
                }
            }),
            issueFixture({
                key: "S-1",
                fields: {
                    summary: "Hidden story",
                    issuetype: { name: "Story" },
                    customfield_10014: "E-2"
                }
            })
        ],
        children: []
    });

    const filtered = data.filterTree(tree, {
        selectedEpicKeys: ["  e-10  "],
        search: "needle"
    });

    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].key, "E-10");
    assert.equal(filtered[0].children.length, 1);
    assert.equal(filtered[0].children[0].key, "S-2");
});

test("buildTree links parent and epic, places orphans and aggregates", function() {
    const data = loadData();
    const raw = [
        issueFixture({
            key: "P-10",
            fields: {
                summary: "Epic root",
                issuetype: { name: "Epic" },
                parent: null,
                customfield_10014: null
            }
        }),
        issueFixture({
            key: "P-20",
            fields: {
                summary: "Story child",
                issuetype: { name: "Story" },
                parent: { key: "P-10" },
                customfield_10014: null,
                timeoriginalestimate: 7200,
                timespent: 3600,
                status: { name: "Done", statusCategory: { name: "Done", key: "done" } }
            }
        }),
        issueFixture({
            key: "P-99",
            fields: {
                summary: "Loose task",
                issuetype: { name: "Task" },
                parent: null,
                customfield_10014: null
            }
        }),
        issueFixture({
            key: "P-30",
            fields: {
                summary: "Via epic link",
                issuetype: { name: "Story" },
                parent: null,
                customfield_10014: "P-10"
            }
        })
    ];
    const tree = data.buildTree(raw);
    const epic = tree.find(function(n) {
        return n.key === "P-10";
    });
    assert.ok(epic);
    assert.equal(epic.type, "Epic");
    assert.equal(epic.badge, "E");
    const byKey = function(nodes, k) {
        var found = null;
        function walk(arr) {
            (arr || []).forEach(function(n) {
                if (n.key === k) found = n;
                walk(n.children);
            });
        }
        walk(nodes);
        return found;
    };
    const s20 = byKey(epic.children, "P-20");
    assert.ok(s20);
    assert.equal(s20.parentKey, "P-10");
    const s30 = byKey(epic.children, "P-30");
    assert.ok(s30);
    assert.equal(s30.epicLink, "P-10");

    const orphans = tree.find(function(n) {
        return n.key === "__orphans__";
    });
    assert.ok(orphans);
    assert.equal(orphans.summary, "Без эпика");
    assert.equal(byKey(orphans.children, "P-99").key, "P-99");

    assert.equal(typeof epic.totalCount, "number");
    assert.ok(epic.totalCount >= 3);
    assert.equal(typeof epic.totalEstimate, "number");
    assert.equal(typeof epic.totalSpent, "number");
    assert.equal(typeof epic.totalDone, "number");
    assert.ok(epic.progress >= 0 && epic.progress <= 1);
});

test("buildTree derives badge from issuetype object via utils.getTypeBadge", function() {
    const config = loadConfig(mockWindow());
    const seen = [];
    const utils = {
        getStatusName: function(status) {
            return status && status.name ? status.name : "";
        },
        getTypeBadge: function(issuetype) {
            seen.push(issuetype);
            return "OBJ";
        },
        getPriorityName: function(priority) {
            return priority && priority.name ? priority.name : "";
        },
        getSprintName: function() {
            return "";
        },
        isDone: function() {
            return false;
        }
    };
    const data = loadDataWithDeps(config, utils);
    const issuetype = { name: "Epic", iconUrl: "epic.svg" };
    const tree = data.buildTree([
        issueFixture({
            key: "E-1",
            fields: {
                summary: "Epic one",
                issuetype: issuetype
            }
        })
    ]);

    assert.equal(seen.length, 1);
    assert.equal(seen[0], issuetype);
    assert.equal(tree[0].badge, "OBJ");
});

test("buildTree extracts status transitions from changelog", function() {
    const data = loadData();
    const raw = [
        issueFixture({
            key: "P-1",
            fields: { issuetype: { name: "Epic" }, summary: "E" },
            changelog: {
                histories: [
                    {
                        created: "2026-01-10T12:00:00.000+0000",
                        items: [{ field: "status", fromString: "Open", toString: "In Progress" }]
                    },
                    {
                        created: "2026-01-11T12:00:00.000+0000",
                        items: [{ field: "assignee", fromString: "a", toString: "b" }]
                    }
                ]
            }
        })
    ];
    const tree = data.buildTree(raw);
    const epic = tree[0];
    assert.equal(epic.transitions.length, 1);
    assert.equal(epic.transitions[0].from, "Open");
    assert.equal(epic.transitions[0].to, "In Progress");
    assert.equal(epic.transitions[0].at, "2026-01-10T12:00:00.000+0000");
});

test("buildTree derives epic problemItems from blocker-like descendant tasks", function() {
    const data = loadData();
    const tree = data.buildTree([
        issueFixture({
            key: "E-1",
            fields: {
                summary: "Epic one",
                issuetype: { name: "Epic" }
            }
        }),
        issueFixture({
            key: "S-1",
            fields: {
                summary: "Story child",
                issuetype: { name: "Story" },
                parent: { key: "E-1" }
            }
        }),
        issueFixture({
            key: "SE-1",
            fields: {
                summary: "Ожидание API контракта",
                issuetype: { name: "System Engineer" },
                parent: { key: "S-1" },
                status: { name: "Open", statusCategory: { name: "To Do", key: "new" } }
            }
        }),
        issueFixture({
            key: "FE-1",
            fields: {
                summary: "Реализация интерфейса",
                issuetype: { name: "Frontend Task" },
                parent: { key: "S-1" },
                status: { name: "Open", statusCategory: { name: "To Do", key: "new" } }
            }
        })
    ]);
    const epic = tree[0];
    assert.ok(Array.isArray(epic.problemItems));
    assert.equal(epic.problemItems.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(epic.problemItems[0])), {
        badge: "SE",
        key: "SE-1",
        text: "Ожидание API контракта"
    });
});

test("collectFilters gathers statuses sprints and epics", function() {
    const data = loadData();
    const sprintStrA =
        "com.atlassian.greenhopper.service.sprint.Sprint@x[id=1,name=Sprint 42,state=ACTIVE]";
    const sprintStrB =
        "com.atlassian.greenhopper.service.sprint.Sprint@y[id=2,name=Sprint 07,state=CLOSED]";
    const raw = [
        issueFixture({
            key: "E-1",
            fields: {
                summary: "Epic one",
                issuetype: { name: "Epic" },
                status: { name: "In Progress" },
                customfield_10020: sprintStrA
            }
        }),
        issueFixture({
            key: "S-1",
            fields: {
                summary: "Story",
                issuetype: { name: "Story" },
                parent: { key: "E-1" },
                status: { name: "Done" },
                customfield_10020: sprintStrA
            }
        }),
        issueFixture({
            key: "T-1",
            fields: {
                summary: "Loose task",
                issuetype: { name: "Task" },
                status: { name: "Open" },
                customfield_10020: sprintStrB
            }
        })
    ];
    const tree = data.buildTree(raw);
    const f = data.collectFilters(tree);
    assert.equal(f.statuses.join("|"), "In Progress|Done|Open");
    assert.equal(f.sprints.join("|"), "Sprint 42|Sprint 07");
    assert.ok(f.epics.some(function(e) {
        return e.key === "E-1" && e.summary === "Epic one";
    }));
});

test("filterTree preserves ancestors when search matches descendant", function() {
    const data = loadData();
    const raw = [
        issueFixture({
            key: "E-1",
            fields: { summary: "Big epic", issuetype: { name: "Epic" } }
        }),
        issueFixture({
            key: "S-1",
            fields: {
                summary: "Find me unique",
                issuetype: { name: "Story" },
                parent: { key: "E-1" }
            }
        })
    ];
    const tree = data.buildTree(raw);
    const filtered = data.filterTree(tree, { search: "unique" });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].key, "E-1");
    assert.equal(filtered[0].children.length, 1);
    assert.equal(filtered[0].children[0].key, "S-1");
});

test("filterTree search is case-insensitive for mixed-case input", function() {
    const data = loadData();
    const raw = [
        issueFixture({
            key: "E-1",
            fields: { summary: "Big epic", issuetype: { name: "Epic" } }
        }),
        issueFixture({
            key: "S-1",
            fields: {
                summary: "Find me unique",
                issuetype: { name: "Story" },
                parent: { key: "E-1" }
            }
        })
    ];
    const tree = data.buildTree(raw);
    const filtered = data.filterTree(tree, { search: "  UnIqUe  " });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].key, "E-1");
    assert.equal(filtered[0].children.length, 1);
    assert.equal(filtered[0].children[0].key, "S-1");
});

test("filterTree applies status and epic scope", function() {
    const data = loadData();
    const raw = [
        issueFixture({
            key: "E-1",
            fields: { summary: "E", issuetype: { name: "Epic" }, status: { name: "Open" } }
        }),
        issueFixture({
            key: "S-1",
            fields: {
                summary: "S",
                issuetype: { name: "Story" },
                parent: { key: "E-1" },
                status: { name: "Done" }
            }
        }),
        issueFixture({
            key: "S-2",
            fields: {
                summary: "Other",
                issuetype: { name: "Story" },
                parent: { key: "E-1" },
                status: { name: "Open" }
            }
        })
    ];
    const tree = data.buildTree(raw);
    const byStatus = data.filterTree(tree, { status: "Done" });
    assert.equal(byStatus.length, 1);
    assert.equal(byStatus[0].key, "E-1");
    assert.equal(byStatus[0].children.length, 1);
    assert.equal(byStatus[0].children[0].key, "S-1");

    const full = data.filterTree(tree, { epic: "E-1" });
    assert.equal(full.length, 1);
    assert.equal(full[0].key, "E-1");
});

test("filterTree normalizes status filter values", function() {
    const data = loadData();
    const raw = [
        issueFixture({
            key: "E-1",
            fields: { summary: "Epic", issuetype: { name: "Epic" }, status: { name: "Open" } }
        }),
        issueFixture({
            key: "S-1",
            fields: {
                summary: "Done child",
                issuetype: { name: "Story" },
                parent: { key: "E-1" },
                status: { name: "Done" }
            }
        })
    ];
    const tree = data.buildTree(raw);
    const filtered = data.filterTree(tree, { status: "  done  " });

    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].key, "E-1");
    assert.equal(filtered[0].children.length, 1);
    assert.equal(filtered[0].children[0].key, "S-1");
});

test("filterTree normalizes sprint and epic filters", function() {
    const data = loadData();
    const raw = [
        issueFixture({
            key: "E-1",
            fields: { summary: "Epic", issuetype: { name: "Epic" } }
        }),
        issueFixture({
            key: "S-42",
            fields: {
                summary: "Sprint child",
                issuetype: { name: "Story" },
                parent: { key: "E-1" },
                customfield_10020: { name: "Sprint 42" }
            }
        })
    ];
    const tree = data.buildTree(raw);
    const filtered = data.filterTree(tree, { epic: "  e-1  ", sprint: "  sprint 42  " });

    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].key, "E-1");
    assert.equal(filtered[0].children.length, 1);
    assert.equal(filtered[0].children[0].key, "S-42");
});

test("filterTree recomputes aggregate fields for visible subtree", function() {
    const data = loadData();
    const raw = [
        issueFixture({
            key: "E-1",
            fields: {
                summary: "Epic",
                issuetype: { name: "Epic" },
                status: { name: "Open" },
                timeoriginalestimate: 0,
                timespent: 0
            }
        }),
        issueFixture({
            key: "S-1",
            fields: {
                summary: "Done child",
                issuetype: { name: "Story" },
                parent: { key: "E-1" },
                status: { name: "Done" },
                timeoriginalestimate: 100,
                timespent: 40
            }
        }),
        issueFixture({
            key: "S-2",
            fields: {
                summary: "Open child",
                issuetype: { name: "Story" },
                parent: { key: "E-1" },
                status: { name: "Open" },
                timeoriginalestimate: 200,
                timespent: 60
            }
        })
    ];
    const tree = data.buildTree(raw);
    const filtered = data.filterTree(tree, { status: "Done" });

    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].totalEstimate, 100);
    assert.equal(filtered[0].totalSpent, 40);
    assert.equal(filtered[0].totalDone, 1);
    assert.equal(filtered[0].totalCount, 2);
    assert.equal(filtered[0].progress, 0.5);
});

test("filterTree recomputes problemItems for the visible subtree only", function() {
    const data = loadData();
    const raw = [
        issueFixture({
            key: "E-1",
            fields: { summary: "Epic", issuetype: { name: "Epic" } }
        }),
        issueFixture({
            key: "SE-1",
            fields: {
                summary: "Waiting backend contract",
                issuetype: { name: "System Engineer" },
                parent: { key: "E-1" },
                status: { name: "Open", statusCategory: { name: "To Do", key: "new" } }
            }
        }),
        issueFixture({
            key: "FE-1",
            fields: {
                summary: "Regular visible task",
                issuetype: { name: "Frontend Task" },
                parent: { key: "E-1" },
                status: { name: "Open", statusCategory: { name: "To Do", key: "new" } }
            }
        })
    ];
    const tree = data.buildTree(raw);
    const filtered = data.filterTree(tree, { search: "Regular visible task" });

    assert.equal(filtered.length, 1);
    assert.ok(Array.isArray(filtered[0].problemItems));
    assert.equal(filtered[0].problemItems.length, 0);
});

test("filterTree applies sprint filter and preserves matching ancestors", function() {
    const data = loadData();
    const raw = [
        issueFixture({
            key: "E-1",
            fields: { summary: "Epic", issuetype: { name: "Epic" }, customfield_10020: null }
        }),
        issueFixture({
            key: "S-42",
            fields: {
                summary: "Sprint 42 child",
                issuetype: { name: "Story" },
                parent: { key: "E-1" },
                customfield_10020: { name: "Sprint 42" }
            }
        }),
        issueFixture({
            key: "S-07",
            fields: {
                summary: "Sprint 07 child",
                issuetype: { name: "Story" },
                parent: { key: "E-1" },
                customfield_10020: { name: "Sprint 07" }
            }
        })
    ];
    const tree = data.buildTree(raw);
    const filtered = data.filterTree(tree, { sprint: "Sprint 42" });

    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].key, "E-1");
    assert.equal(filtered[0].children.length, 1);
    assert.equal(filtered[0].children[0].key, "S-42");
});
