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

function createJqueryStub(handler) {
    var calls = [];

    return {
        ajax: function(options) {
            calls.push(normalize(options));
            return handler(options);
        },
        Deferred: createDeferred,
        when: function() {
            var items = Array.prototype.slice.call(arguments);
            var combined = createDeferred();
            var remaining = items.length;
            var results = new Array(items.length);

            if (!remaining) {
                combined.resolve();
                return combined.promise();
            }

            items.forEach(function(item, index) {
                item.done(function() {
                    results[index] = arguments.length > 1 ? Array.prototype.slice.call(arguments) : arguments[0];
                    remaining -= 1;
                    if (remaining === 0) {
                        combined.resolve.apply(combined, results);
                    }
                }).fail(function() {
                    combined.reject.apply(combined, arguments);
                });
            });

            return combined.promise();
        },
        __calls: calls
    };
}

function resolvedAjax(data) {
    var d = createDeferred();
    d.resolve([data, "success", {}]);
    return d.promise();
}

function rejectedAjax(statusText) {
    var d = createDeferred();
    d.reject({ responseJSON: {} }, statusText || "error");
    return d.promise();
}

function loadRepoApi(jquery) {
    return loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "repo-api.js"), {
        jquery: jquery,
        _ujgCommon: { baseUrl: "" },
        _ujgUA_config: { CONFIG: { maxConcurrent: 2 } },
        _ujgUA_utils: {}
    });
}

function loadRepoDataProcessor() {
    return loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "repo-data-processor.js"), {
        _ujgUA_config: {},
        _ujgUA_utils: {
            parseDate: function(value) {
                if (!value) return null;
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
    });
}

function createHtmlJqueryStub() {
    function createCollection(root, selectors, singleNode) {
        return {
            html: function() {
                return root.html;
            },
            find: function(selector) {
                return createCollection(root, parseSelector(selector));
            },
            on: function(eventName, selector, handler) {
                if (!root.handlers[eventName]) root.handlers[eventName] = [];
                root.handlers[eventName].push({
                    selector: selector,
                    handler: handler
                });
                return this;
            },
            removeClass: function(className) {
                selectors.forEach(function(node) {
                    removeClasses(node, className);
                });
                return this;
            },
            addClass: function(className) {
                selectors.forEach(function(node) {
                    addClasses(node, className);
                });
                return this;
            },
            attr: function(name) {
                var node = singleNode || selectors[0];
                return node ? node.attrs[name] : undefined;
            },
            trigger: function(eventName) {
                var node = singleNode || selectors[0];
                (root.handlers[eventName] || []).forEach(function(binding) {
                    if (node && matchesSelector(node, binding.selector)) {
                        binding.handler.call(node);
                    }
                });
                return this;
            }
        };
    }

    function splitClasses(value) {
        return String(value || "").split(/\s+/).filter(Boolean);
    }

    function addClasses(node, className) {
        var current = splitClasses(node.attrs["class"]);
        splitClasses(className).forEach(function(name) {
            if (current.indexOf(name) < 0) current.push(name);
        });
        node.attrs["class"] = current.join(" ");
        syncNode(node);
    }

    function removeClasses(node, className) {
        var removed = splitClasses(className);
        node.attrs["class"] = splitClasses(node.attrs["class"]).filter(function(name) {
            return removed.indexOf(name) < 0;
        }).join(" ");
        syncNode(node);
    }

    function syncNode(node) {
        var attrs = Object.keys(node.attrs).map(function(name) {
            var value = node.attrs[name];
            if (value === undefined || value === null || value === "") return "";
            return name + '="' + value + '"';
        }).filter(Boolean).join(" ");
        root.html = root.html.replace(node.original, "<td " + attrs + ">");
        node.original = "<td " + attrs + ">";
    }

    function parseAttrs(attrText) {
        var attrs = {};
        attrText.replace(/([a-zA-Z0-9:-]+)="([^"]*)"/g, function(_, key, value) {
            attrs[key] = value;
            return "";
        });
        return attrs;
    }

    function parseSelector(selector) {
        var attrMatch = selector.match(/^td\[data-date(?:="([^"]+)")?\]$/);
        if (!attrMatch) return [];
        var wantedDate = attrMatch[1];
        var matches = [];
        root.html.replace(/<td\s+([^>]*data-date="[^"]+"[^>]*)>/g, function(full, attrText) {
            var attrs = parseAttrs(attrText);
            if (!wantedDate || attrs["data-date"] === wantedDate) {
                matches.push({
                    attrs: attrs,
                    original: full
                });
            }
            return full;
        });
        return matches;
    }

    function matchesSelector(node, selector) {
        var attrMatch = selector.match(/^td\[data-date(?:="([^"]+)")?\]$/);
        return !!attrMatch && (!attrMatch[1] || node.attrs["data-date"] === attrMatch[1]);
    }

    var root = {
        html: "",
        handlers: {}
    };

    function $(input) {
        if (typeof input === "string") {
            root.html = input;
            return createCollection(root, parseSelector("td[data-date]"));
        }
        if (input && input.attrs) {
            return createCollection(root, [], input);
        }
        throw new Error("Unsupported jquery stub input");
    }

    return $;
}

function loadRepoCalendar(jquery, utilsOverrides) {
    utilsOverrides = utilsOverrides || {};
    return loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "repo-calendar.js"), {
        jquery: jquery,
        _ujgUA_config: {},
        _ujgUA_utils: Object.assign({
            WEEKDAYS_RU: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
            MONTHS_RU: ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"],
            getDayKey: function(date) {
                var year = date.getFullYear();
                var month = String(date.getMonth() + 1).padStart(2, "0");
                var day = String(date.getDate()).padStart(2, "0");
                return year + "-" + month + "-" + day;
            },
            getHeatBg: function(value) {
                return value > 0 ? "bg-heat-1" : "bg-heat-0";
            },
            escapeHtml: function(value) {
                return String(value || "")
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#39;");
            }
        }, utilsOverrides)
    });
}

function countMatches(value, pattern) {
    var matches = String(value).match(pattern);
    return matches ? matches.length : 0;
}

test("mergeDevStatus merges repository and pullrequest payloads by detail and repository identity", function() {
    var mod = loadRepoApi(createJqueryStub(function() {
        return resolvedAjax({});
    }));
    var repoResp = {
        detail: [{
            applicationLinkId: "a1",
            instanceId: "i1",
            type: "stash",
            name: "Bitbucket",
            repositories: [{
                id: "r1",
                name: "repo-a",
                url: "https://bitbucket/repo-a",
                commits: [{ id: "c1" }],
                branches: [{ id: "b1" }]
            }]
        }]
    };
    var prResp = {
        detail: [{
            applicationLinkId: "a1",
            instanceId: "i1",
            type: "stash",
            name: "Bitbucket",
            repositories: [{
                id: "r1",
                name: "repo-a",
                url: "https://bitbucket/repo-a",
                pullRequests: [{ id: "pr1" }]
            }]
        }]
    };

    var out = mod.mergeDevStatus(repoResp, prResp);

    assert.equal(out.detail.length, 1);
    assert.equal(out.detail[0].repositories.length, 1);
    assert.deepEqual(normalize(out.detail[0].repositories[0].commits), [{ id: "c1" }]);
    assert.deepEqual(normalize(out.detail[0].repositories[0].branches), [{ id: "b1" }]);
    assert.deepEqual(normalize(out.detail[0].repositories[0].pullRequests), [{ id: "pr1" }]);
});

test("mergeDevStatus avoids duplicate commits branches and pull requests on overlap", function() {
    var mod = loadRepoApi(createJqueryStub(function() {
        return resolvedAjax({});
    }));
    var out = mod.mergeDevStatus({
        detail: [{
            applicationLinkId: "a1",
            instanceId: "i1",
            type: "stash",
            name: "Bitbucket",
            repositories: [{
                id: "r1",
                name: "repo-a",
                url: "https://bitbucket/repo-a",
                commits: [{ id: "c1" }],
                branches: [{ id: "b1", name: "main" }],
                pullRequests: [{ id: "pr1", url: "https://bitbucket/pr/1" }]
            }]
        }]
    }, {
        detail: [{
            applicationLinkId: "a1",
            instanceId: "i1",
            type: "stash",
            name: "Bitbucket",
            repositories: [{
                id: "r1",
                name: "repo-a",
                url: "https://bitbucket/repo-a",
                commits: [{ id: "c1" }, { id: "c2" }],
                branches: [{ id: "b1", name: "main" }, { id: "b2", name: "feature/x" }],
                pullRequests: [
                    { id: "pr1", url: "https://bitbucket/pr/1" },
                    { id: "pr2", url: "https://bitbucket/pr/2" }
                ]
            }]
        }]
    });

    assert.deepEqual(normalize(out.detail[0].repositories[0].commits), [
        { id: "c1" },
        { id: "c2" }
    ]);
    assert.deepEqual(normalize(out.detail[0].repositories[0].branches), [
        { id: "b1", name: "main" },
        { id: "b2", name: "feature/x" }
    ]);
    assert.deepEqual(normalize(out.detail[0].repositories[0].pullRequests), [
        { id: "pr1", url: "https://bitbucket/pr/1" },
        { id: "pr2", url: "https://bitbucket/pr/2" }
    ]);
});

test("mergeDevStatus does not merge unrelated details or repositories with empty identity keys", function() {
    var mod = loadRepoApi(createJqueryStub(function() {
        return resolvedAjax({});
    }));
    var out = mod.mergeDevStatus({
        detail: [{
            repositories: [{
                commits: [{ id: "c1" }]
            }]
        }]
    }, {
        detail: [{
            repositories: [{
                pullRequests: [{ id: "pr1" }]
            }]
        }]
    });

    assert.equal(out.detail.length, 2);
    assert.deepEqual(normalize(out.detail[0].repositories), [{ commits: [{ id: "c1" }] }]);
    assert.deepEqual(normalize(out.detail[1].repositories), [{ pullRequests: [{ id: "pr1" }] }]);
});

test("mergeDevStatus preserves detail-level pull requests without repositories", function() {
    var mod = loadRepoApi(createJqueryStub(function() {
        return resolvedAjax({});
    }));
    var out = mod.mergeDevStatus({
        detail: [{
            applicationLinkId: "a1",
            instanceId: "i1",
            type: "stash",
            name: "Bitbucket",
            pullRequests: [{ id: "pr1" }]
        }]
    }, {
        detail: [{
            applicationLinkId: "a1",
            instanceId: "i1",
            type: "stash",
            name: "Bitbucket",
            pullRequests: [{ id: "pr2" }]
        }]
    });

    assert.deepEqual(normalize(out.detail[0].pullRequests), [
        { id: "pr1" },
        { id: "pr2" }
    ]);
    assert.equal(out.detail[0].repositories, undefined);
});

test("fetchIssueDevStatus keeps repository data when pullrequest request fails", async function() {
    var mod = loadRepoApi(createJqueryStub(function(options) {
        if (options.data.dataType === "repository") {
            return resolvedAjax({
                detail: [{
                    applicationLinkId: "a1",
                    instanceId: "i1",
                    type: "stash",
                    name: "Bitbucket",
                    repositories: [{
                        id: "r1",
                        name: "repo-a",
                        url: "https://bitbucket/repo-a",
                        commits: [{ id: "c1" }]
                    }]
                }]
            });
        }
        if (options.data.dataType === "pullrequest") {
            return rejectedAjax("error");
        }
        throw new Error("Unexpected ajax call");
    }));
    var issue = { id: "1001", key: "SDKU-1" };

    var devStatus = await mod.fetchIssueDevStatus(issue);

    assert.deepEqual(normalize(devStatus.detail[0].repositories[0].commits), [{ id: "c1" }]);
    assert.equal(devStatus.detail[0].repositories[0].pullRequests, undefined);
    assert.deepEqual(normalize(issue.devStatus), normalize(devStatus));
});

test("fetchRepoActivityForIssues resolves merged dev-status and keeps failed issues empty", async function() {
    var $ = createJqueryStub(function(options) {
        if (options.data.issueId === "1001" && options.data.dataType === "repository") {
            return resolvedAjax({
                detail: [{
                    applicationLinkId: "a1",
                    instanceId: "i1",
                    type: "stash",
                    name: "Bitbucket",
                    repositories: [{ id: "r1", name: "repo-a", url: "https://bitbucket/repo-a", commits: [{ id: "c1" }] }]
                }]
            });
        }
        if (options.data.issueId === "1001" && options.data.dataType === "pullrequest") {
            return resolvedAjax({
                detail: [{
                    applicationLinkId: "a1",
                    instanceId: "i1",
                    type: "stash",
                    name: "Bitbucket",
                    repositories: [{ id: "r1", name: "repo-a", url: "https://bitbucket/repo-a", pullRequests: [{ id: "pr1" }] }]
                }]
            });
        }
        if (options.data.issueId === "1002" && options.data.dataType === "repository") {
            return rejectedAjax("error");
        }
        if (options.data.issueId === "1002" && options.data.dataType === "pullrequest") {
            return resolvedAjax({ detail: [] });
        }
        throw new Error("Unexpected ajax call: " + JSON.stringify(options.data));
    });
    var mod = loadRepoApi($);
    var progressEvents = [];

    var result = await mod.fetchRepoActivityForIssues([
        { id: "1001", key: "SDKU-1" },
        { id: "1002", key: "SDKU-2" }
    ], function(progress) {
        progressEvents.push(normalize(progress));
    });

    assert.equal($.__calls.length, 4);
    assert.equal($.__calls[0].url, "/rest/dev-status/1.0/issue/detail");
    assert.equal($.__calls[0].data.applicationType, "stash");
    assert.equal($.__calls[0].data.dataType, "repository");
    assert.equal($.__calls[1].data.dataType, "pullrequest");
    assert.deepEqual(
        normalize(result.issueDevStatusMap["SDKU-1"].detail[0].repositories[0].commits),
        [{ id: "c1" }]
    );
    assert.deepEqual(
        normalize(result.issueDevStatusMap["SDKU-1"].detail[0].repositories[0].pullRequests),
        [{ id: "pr1" }]
    );
    assert.deepEqual(normalize(result.issueDevStatusMap["SDKU-2"]), {});
    assert.deepEqual(progressEvents, [
        { phase: "repo-dev-status", loaded: 0, total: 2 },
        { phase: "repo-dev-status", loaded: 1, total: 2 },
        { phase: "repo-dev-status", loaded: 2, total: 2 }
    ]);
});

test("processRepoActivity builds commit and PR events for selected user", function() {
    var mod = loadRepoDataProcessor();
    var issueMap = {
        "CORE-1": { key: "CORE-1", summary: "Test task" }
    };
    var issueDevStatusMap = {
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

    var repoActivity = mod.processRepoActivity(
        issueMap,
        issueDevStatusMap,
        { name: "dtorzok", displayName: "Dima Torzok" },
        "2026-03-01",
        "2026-03-31"
    );

    assert.equal(repoActivity.items.length, 3);
    assert.deepEqual(normalize(repoActivity.items.map(function(item) {
        return item.type;
    })), ["pull_request_opened", "commit", "pull_request_merged"]);
    assert.equal(repoActivity.stats.totalCommits, 1);
    assert.equal(repoActivity.stats.totalPullRequests, 2);
    assert.equal(repoActivity.stats.totalRepositories, 1);
    assert.equal(repoActivity.dayMap["2026-03-08"].totalEvents, 2);
    assert.equal(repoActivity.repoMap["core-api"].totalEvents, 3);
    assert.equal(repoActivity.items[0].author, "Dima Torzok");
    assert.deepEqual(normalize(repoActivity.items[0].reviewers), []);
    assert.equal(normalize(repoActivity.items[0].raw).id, "42");
    assert.equal(repoActivity.items[1].author, "Dima Torzok");
    assert.equal(normalize(repoActivity.items[1].raw).id, "abc123");
});

test("processRepoActivity extracts branch commits and reviewer decisions for selected user", function() {
    var mod = loadRepoDataProcessor();
    var repoActivity = mod.processRepoActivity(
        {
            "CORE-2": { key: "CORE-2", summary: "Review task" }
        },
        {
            "CORE-2": {
                detail: [{
                    repositories: [{
                        name: "core-web",
                        url: "https://git/core-web",
                        branches: [{
                            id: "b1",
                            name: "feature/review",
                            lastUpdated: "2026-03-09T09:00:00.000Z",
                            author: { accountId: "u-1" },
                            commits: [{
                                id: "def456",
                                message: "Apply review",
                                authorTimestamp: "2026-03-09T10:00:00.000Z",
                                author: { accountId: "u-1" }
                            }]
                        }],
                        pullRequests: [{
                            id: "77",
                            name: "Review me",
                            status: "OPEN",
                            createdDate: "2026-03-09T08:00:00.000Z",
                            author: { name: "someone-else" },
                            reviewers: [{
                                user: { accountId: "u-1", displayName: "Dima Torzok" },
                                status: "NEEDS_WORK",
                                lastReviewedDate: "2026-03-09T11:00:00.000Z"
                            }, {
                                user: { key: "u-1", displayName: "Dima Torzok" },
                                status: "APPROVED",
                                approvedDate: "2026-03-09T12:00:00.000Z"
                            }]
                        }]
                    }]
                }]
            }
        },
        { key: "u-1", displayName: "Dima Torzok" },
        "2026-03-01",
        "2026-03-31"
    );

    assert.deepEqual(normalize(repoActivity.items.map(function(item) {
        return item.type;
    })), ["branch_commit", "pull_request_needs_work", "pull_request_reviewed"]);
    assert.equal(repoActivity.stats.totalCommits, 1);
    assert.equal(repoActivity.stats.totalPullRequests, 2);
    assert.equal(repoActivity.stats.totalBranchesTouched, 1);
    assert.equal(repoActivity.dayMap["2026-03-09"].countsByType.branch_commit, 1);
    assert.equal(repoActivity.repoMap["core-web"].branches.length, 1);
});

test("processRepoActivity supports lowercase matching PR aliases and repository updates", function() {
    var mod = loadRepoDataProcessor();
    var repoActivity = mod.processRepoActivity(
        {
            "CORE-3": { key: "CORE-3", summary: "Alias task" }
        },
        {
            "CORE-3": {
                detail: [{
                    pullrequest: [{
                        id: "90",
                        title: "Late update",
                        status: "OPEN",
                        createdDate: "2026-02-28T10:00:00.000Z",
                        updatedDate: "2026-03-10T11:00:00.000Z",
                        author: { accountId: "user-42" }
                    }],
                    repositories: [{
                        name: "core-alias",
                        url: "https://git/core-alias",
                        pullRequest: [{
                            id: "91",
                            title: "Alias merged",
                            status: "MERGED",
                            createdDate: "2026-03-10T09:00:00.000Z",
                            mergedDate: "2026-03-10T12:00:00.000Z",
                            author: { accountId: "user-42" }
                        }],
                        updatedDate: "2026-03-10T13:00:00.000Z",
                        author: { accountId: "user-42" }
                    }]
                }]
            }
        },
        { accountId: "USER-42" },
        "2026-03-01",
        "2026-03-31"
    );

    assert.deepEqual(normalize(repoActivity.items.map(function(item) {
        return item.type;
    })), [
        "pull_request_opened",
        "repository_update",
        "pull_request_merged"
    ]);
    assert.equal(repoActivity.stats.totalPullRequests, 2);
    assert.equal(repoActivity.dayMap["2026-03-10"].countsByType.repository_update, 1);
    assert.equal(repoActivity.items[1].title, "Late update");
    assert.equal(repoActivity.items[1].message, "");
    assert.equal(repoActivity.items[1].status, "OPEN");
    assert.equal(repoActivity.items[1].hash, "");
});

test("processRepoActivity suppresses repository fallback for repo-level PR updated in range", function() {
    var mod = loadRepoDataProcessor();
    var repoActivity = mod.processRepoActivity(
        {
            "CORE-3A": { key: "CORE-3A", summary: "Repo PR update" }
        },
        {
            "CORE-3A": {
                detail: [{
                    repositories: [{
                        name: "core-pr-update",
                        url: "https://git/core-pr-update",
                        updatedDate: "2026-03-15T13:00:00.000Z",
                        author: { accountId: "repo-user" },
                        pullRequests: [{
                            id: "92",
                            title: "Repo updated PR",
                            status: "OPEN",
                            createdDate: "2026-02-20T09:00:00.000Z",
                            updatedDate: "2026-03-15T12:00:00.000Z",
                            author: { accountId: "repo-user" }
                        }]
                    }]
                }]
            }
        },
        { accountId: "REPO-USER" },
        "2026-03-01",
        "2026-03-31"
    );

    assert.deepEqual(normalize(repoActivity.items.map(function(item) {
        return item.type;
    })), ["repository_update"]);
});

test("processRepoActivity emits unknown_dev_event for repo-ish unknown activity in range", function() {
    var mod = loadRepoDataProcessor();
    var repoActivity = mod.processRepoActivity(
        {
            "CORE-4": { key: "CORE-4", summary: "Unknown activity task" }
        },
        {
            "CORE-4": {
                detail: [{
                    repositories: [{
                        name: "core-unknown",
                        url: "https://git/core-unknown",
                        changesets: [{
                            id: "x1",
                            updatedDate: "2026-03-11T10:00:00.000Z",
                            author: { key: "u-lower" },
                            title: "External sync"
                        }]
                    }]
                }]
            }
        },
        { key: "U-LOWER" },
        "2026-03-01",
        "2026-03-31"
    );

    assert.equal(repoActivity.items.length, 1);
    assert.equal(repoActivity.items[0].type, "unknown_dev_event");
    assert.equal(repoActivity.items[0].repoName, "core-unknown");
    assert.equal(repoActivity.dayMap["2026-03-11"].countsByType.unknown_dev_event, 1);
});

test("processRepoActivity keeps branch_update when there are no branch commits for selected user in range", function() {
    var mod = loadRepoDataProcessor();
    var repoActivity = mod.processRepoActivity(
        {
            "CORE-5": { key: "CORE-5", summary: "Branch update only" }
        },
        {
            "CORE-5": {
                detail: [{
                    repositories: [{
                        name: "core-branch",
                        url: "https://git/core-branch",
                        branches: [{
                            id: "b5",
                            name: "feature/solo",
                            lastUpdated: "2026-03-12T09:00:00.000Z",
                            author: { key: "Branch-User" },
                            commits: [{
                                id: "zzz999",
                                authorTimestamp: "2026-02-12T09:00:00.000Z",
                                author: { key: "Branch-User" }
                            }]
                        }]
                    }]
                }]
            }
        },
        { key: "branch-user" },
        "2026-03-01",
        "2026-03-31"
    );

    assert.deepEqual(normalize(repoActivity.items.map(function(item) {
        return item.type;
    })), ["branch_update"]);
});

test("processRepoActivity emits declined PR event", function() {
    var mod = loadRepoDataProcessor();
    var repoActivity = mod.processRepoActivity(
        {
            "CORE-6": { key: "CORE-6", summary: "Declined task" }
        },
        {
            "CORE-6": {
                detail: [{
                    repositories: [{
                        name: "core-pr",
                        url: "https://git/core-pr",
                        pullRequests: [{
                            id: "decl-1",
                            title: "Rejected change",
                            status: "DECLINED",
                            createdDate: "2026-03-13T09:00:00.000Z",
                            declinedDate: "2026-03-13T12:00:00.000Z",
                            author: { displayName: "Decline User" },
                            reviewers: [{ user: { displayName: "Reviewer A" } }]
                        }]
                    }]
                }]
            }
        },
        { displayName: "Decline User" },
        "2026-03-01",
        "2026-03-31"
    );

    assert.deepEqual(normalize(repoActivity.items.map(function(item) {
        return item.type;
    })), ["pull_request_opened", "pull_request_declined"]);
});

test("processRepoActivity preserves author reviewers and raw across event types", function() {
    var mod = loadRepoDataProcessor();
    var repoActivity = mod.processRepoActivity(
        {
            "CORE-7": { key: "CORE-7", summary: "Rich contract task" }
        },
        {
            "CORE-7": {
                detail: [{
                    repositories: [{
                        name: "core-rich",
                        url: "https://git/core-rich",
                        updatedDate: "2026-03-14T08:00:00.000Z",
                        author: { displayName: "Rich User" },
                        commits: [{
                            id: "c-rich",
                            message: "Rich commit",
                            authorTimestamp: "2026-03-14T09:00:00.000Z",
                            author: { displayName: "Rich User" }
                        }],
                        branches: [{
                            id: "b-rich",
                            name: "feature/rich",
                            lastUpdated: "2026-03-14T10:00:00.000Z",
                            author: { displayName: "Rich User" }
                        }],
                        pullRequests: [{
                            id: "pr-rich",
                            title: "Rich PR",
                            status: "DECLINED",
                            createdDate: "2026-03-14T11:00:00.000Z",
                            declinedDate: "2026-03-14T12:00:00.000Z",
                            author: { displayName: "Rich User" },
                            reviewers: [{ user: { displayName: "Reviewer Rich" } }]
                        }],
                        changesets: [{
                            id: "u-rich",
                            updatedDate: "2026-03-14T13:00:00.000Z",
                            author: { displayName: "Rich User" },
                            title: "Unknown rich"
                        }]
                    }]
                }]
            }
        },
        { displayName: "Rich User" },
        "2026-03-01",
        "2026-03-31"
    );
    var byType = {};

    repoActivity.items.forEach(function(item) {
        byType[item.type] = item;
        assert.equal(typeof item.title, "string");
        assert.equal(typeof item.message, "string");
        assert.equal(typeof item.status, "string");
        assert.equal(typeof item.hash, "string");
    });

    assert.equal(byType.commit.author, "Rich User");
    assert.deepEqual(normalize(byType.commit.reviewers), []);
    assert.equal(normalize(byType.commit.raw).id, "c-rich");
    assert.equal(byType.branch_update.author, "Rich User");
    assert.equal(normalize(byType.branch_update.raw).id, "b-rich");
    assert.equal(byType.pull_request_declined.author, "Rich User");
    assert.deepEqual(normalize(byType.pull_request_declined.reviewers), ["Reviewer Rich"]);
    assert.equal(normalize(byType.pull_request_declined.raw).id, "pr-rich");
    assert.equal(byType.unknown_dev_event.author, "Rich User");
    assert.equal(normalize(byType.unknown_dev_event.raw).id, "u-rich");
});

test("repo calendar renders repo names and event count badge", function() {
    var mod = loadRepoCalendar(createHtmlJqueryStub());
    var widget = mod.render({
        "2026-03-08": {
            date: "2026-03-08",
            totalEvents: 3,
            items: [
                { type: "commit", repoName: "core-api", hash: "abc123", message: "Fix auth" },
                { type: "pull_request_merged", repoName: "core-api", title: "Fix auth" },
                { type: "commit", repoName: "core-ui", hash: "def456", message: "Refine layout" }
            ],
            countsByType: { commit: 2, pull_request_merged: 1 },
            countsByRepo: { "core-api": 2, "core-ui": 1 }
        }
    }, new Date("2026-03-01T00:00:00.000Z"), new Date("2026-03-31T00:00:00.000Z"));

    assert.match(widget.$el.html(), /core-api/);
    assert.match(widget.$el.html(), />3<\/span>/);
});

test("repo calendar shows crowded-day overflow and deterministic top events", function() {
    var mod = loadRepoCalendar(createHtmlJqueryStub());
    var widget = mod.render({
        "2026-03-08": {
            date: "2026-03-08",
            totalEvents: 4,
            items: [
                { type: "commit", repoName: "repo-z", hash: "111aaa", message: "Oldest", timestamp: "2026-03-08T08:00:00.000Z" },
                { type: "commit", repoName: "repo-a", hash: "222bbb", message: "Newest", timestamp: "2026-03-08T12:00:00.000Z" },
                { type: "pull_request_merged", repoName: "repo-b", title: "Middle", timestamp: "2026-03-08T10:00:00.000Z" },
                { type: "commit", repoName: "repo-c", hash: "333ccc", message: "Noon-ish", timestamp: "2026-03-08T11:00:00.000Z" }
            ],
            countsByType: { commit: 3, pull_request_merged: 1 },
            countsByRepo: { "repo-z": 1, "repo-a": 1, "repo-b": 1, "repo-c": 1 }
        }
    }, new Date("2026-03-01T00:00:00.000Z"), new Date("2026-03-31T00:00:00.000Z"));
    var html = widget.$el.html();

    assert.match(html, /\+2 еще/);
    assert.ok(html.indexOf("repo-a") < html.indexOf("repo-c"));
    assert.ok(html.indexOf("repo-c") < html.indexOf("repo-b"));
});

test("repo calendar renders weekly summary and uses heat class from utils", function() {
    var mod = loadRepoCalendar(createHtmlJqueryStub(), {
        getHeatBg: function(value) {
            return "heat-level-" + value;
        }
    });
    var widget = mod.render({
        "2026-03-03": {
            date: "2026-03-03",
            totalEvents: 5,
            items: [
                { type: "commit", repoName: "super-long-repository-name-for-summary-column-with-many-segments", message: "Touch repo" }
            ],
            countsByType: { commit: 5 },
            countsByRepo: { "super-long-repository-name-for-summary-column-with-many-segments": 5 }
        },
        "2026-03-05": {
            date: "2026-03-05",
            totalEvents: 2,
            items: [
                { type: "commit", repoName: "short-repo", message: "Touch repo" }
            ],
            countsByType: { commit: 2 },
            countsByRepo: { "short-repo": 2 }
        }
    }, new Date("2026-03-01T00:00:00.000Z"), new Date("2026-03-31T00:00:00.000Z"));
    var html = widget.$el.html();

    assert.match(html, /heat-level-5/);
    assert.match(html, /super-long-repository-name-for-summary-column-with-many-segments: 5/);
    assert.match(html, /short-repo: 2/);
    assert.match(html, />7<\/span>/);
    assert.doesNotMatch(html, /whitespace-nowrap/);
});

test("repo calendar switches selection between dates and toggles callback", function() {
    var mod = loadRepoCalendar(createHtmlJqueryStub());
    var selected = [];
    var widget = mod.render({
        "2026-03-08": {
            date: "2026-03-08",
            totalEvents: 1,
            items: [
                { type: "commit", repoName: "core-api", hash: "abc123", message: "Fix auth" }
            ],
            countsByType: { commit: 1 },
            countsByRepo: { "core-api": 1 }
        },
        "2026-03-09": {
            date: "2026-03-09",
            totalEvents: 1,
            items: [
                { type: "commit", repoName: "core-ui", hash: "def456", message: "Refine layout" }
            ],
            countsByType: { commit: 1 },
            countsByRepo: { "core-ui": 1 }
        }
    }, new Date("2026-03-01T00:00:00.000Z"), new Date("2026-03-31T00:00:00.000Z"));

    widget.onSelectDate(function(value) {
        selected.push(value);
    });

    var $cell = widget.$el.find('td[data-date="2026-03-08"]');
    var $otherCell = widget.$el.find('td[data-date="2026-03-09"]');
    assert.equal(typeof widget.onSelectDate, "function");
    assert.equal($cell.attr("data-date"), "2026-03-08");

    $cell.trigger("click");
    assert.deepEqual(selected, ["2026-03-08"]);
    assert.equal(countMatches(widget.$el.html(), /ring-2/g), 1);

    $otherCell.trigger("click");
    assert.deepEqual(selected, ["2026-03-08", "2026-03-09"]);
    assert.equal(countMatches(widget.$el.html(), /ring-2/g), 1);

    $otherCell.trigger("click");
    assert.deepEqual(selected, ["2026-03-08", "2026-03-09", null]);
    assert.equal(countMatches(widget.$el.html(), /ring-2/g), 0);
});
