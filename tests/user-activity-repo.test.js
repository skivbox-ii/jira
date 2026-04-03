const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");
const loadAmdModule = require("./helpers/load-amd-module");

function normalize(value) {
    return JSON.parse(JSON.stringify(value));
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createDeferred() {
    var state = "pending";
    var settledArgs = [];
    var doneHandlers = [];
    var failHandlers = [];
    var alwaysHandlers = [];
    function runAlways() {
        alwaysHandlers.slice().forEach(function(handler) {
            handler.apply(null, settledArgs);
        });
    }
    var deferred = {
        resolve: function() {
            if (state !== "pending") return deferred;
            state = "resolved";
            settledArgs = Array.prototype.slice.call(arguments);
            doneHandlers.slice().forEach(function(handler) {
                handler.apply(null, settledArgs);
            });
            runAlways();
            return deferred;
        },
        reject: function() {
            if (state !== "pending") return deferred;
            state = "rejected";
            settledArgs = Array.prototype.slice.call(arguments);
            failHandlers.slice().forEach(function(handler) {
                handler.apply(null, settledArgs);
            });
            runAlways();
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
        always: function(handler) {
            if (state === "resolved" || state === "rejected") {
                handler.apply(null, settledArgs);
            } else if (state === "pending") {
                alwaysHandlers.push(handler);
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

function resolvedAlways(value) {
    var d = createDeferred();
    d.always = function(handler) {
        d.done(handler);
        d.fail(handler);
        return d;
    };
    d.resolve(value);
    return d.promise();
}

function createWindowStub(search) {
    return {
        location: {
            search: search || "",
            pathname: "/plugins/servlet/ujg-user-activity",
            hash: ""
        },
        history: {
            replaceState: function() {}
        }
    };
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
        _ujgUA_utils: {},
        _ujgUA_requestCache: loadRequestCache(jquery)
    });
}

function loadRequestCache(jquery) {
    return loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "request-cache.js"), {
        jquery: jquery
    });
}

function loadUserActivityApi(jquery) {
    return loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "api.js"), {
        jquery: jquery,
        _ujgCommon: { baseUrl: "" },
        _ujgUA_config: { CONFIG: { maxResults: 50, maxConcurrent: 2 } },
        _ujgUA_utils: {},
        _ujgUA_requestCache: loadRequestCache(jquery)
    });
}

function loadUserActivityUtils(windowStub) {
    var config = loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "config.js"), {});
    var globals = windowStub ? { window: windowStub } : {};
    return loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "utils.js"), {
        _ujgUA_config: config
    }, globals);
}

function createProgressLoaderJqueryStub() {
    var barWidth = "0%";
    var labelText = "";
    var $bar = {
        css: function(prop, val) {
            if (prop === "width") barWidth = String(val);
            return $bar;
        }
    };
    var $text = {
        text: function(t) {
            if (!arguments.length) return labelText;
            labelText = t;
            return $text;
        }
    };
    var $root = {
        find: function(sel) {
            if (sel.indexOf("ujg-ua-progress-bar") !== -1) return $bar;
            if (sel.indexOf("ujg-ua-progress-text") !== -1) return $text;
            return $text;
        },
        show: function() {
            return $root;
        },
        hide: function() {
            return $root;
        }
    };
    return {
        $: function() {
            return $root;
        },
        barWidth: function() {
            return barWidth;
        },
        labelText: function() {
            return labelText;
        }
    };
}

function loadProgressLoader(jqStub) {
    return loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "progress-loader.js"), {
        jquery: jqStub.$,
        _ujgUA_utils: {}
    });
}

function loadUserActivityUtilsWithDate(isoNow, windowStub) {
    var config = loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "config.js"), {});
    var RealDate = Date;

    function FakeDate() {
        var args = arguments.length ? Array.prototype.slice.call(arguments) : [isoNow];
        return new (Function.prototype.bind.apply(RealDate, [null].concat(args)))();
    }

    FakeDate.now = function() {
        return RealDate.parse(isoNow);
    };
    FakeDate.parse = RealDate.parse;
    FakeDate.UTC = RealDate.UTC;
    FakeDate.prototype = RealDate.prototype;

    return loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "utils.js"), {
        _ujgUA_config: config
    }, Object.assign({
        Date: FakeDate
    }, windowStub ? { window: windowStub } : {}));
}

function loadAiReport(extraGlobals) {
    return loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "ai-report.js"), {
        jquery: function() {
            throw new Error("jquery UI stub not available in this test");
        },
        _ujgUA_utils: {
            escapeHtml: function(value) {
                return String(value == null ? "" : value)
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#39;");
            },
            icon: function(name) {
                return "[" + name + "]";
            }
        }
    }, extraGlobals || {});
}

test("progress-loader: day phase sets bar from completedDays over totalDays", function() {
    var stub = createProgressLoaderJqueryStub();
    var loader = loadProgressLoader(stub).create();
    loader.update({
        phase: "day",
        currentDay: 3,
        totalDays: 10,
        completedDays: 2
    });
    assert.equal(stub.barWidth(), "20%");
    assert.equal(stub.labelText(), "День 3 / 10");
});

test("progress-loader: day phase appends dayKey and userDisplayName", function() {
    var stub = createProgressLoaderJqueryStub();
    var loader = loadProgressLoader(stub).create();
    loader.update({
        phase: "day",
        currentDay: 1,
        totalDays: 5,
        completedDays: 0,
        dayKey: "2026-04-01",
        userDisplayName: "Иван"
    });
    assert.equal(stub.labelText(), "День 1 / 5 (2026-04-01) — Иван");
});

test("progress-loader: legacy loaded total task text unchanged", function() {
    var stub = createProgressLoaderJqueryStub();
    var loader = loadProgressLoader(stub).create();
    loader.update({ loaded: 7, total: 20 });
    assert.equal(stub.barWidth(), "35%");
    assert.equal(stub.labelText(), "Загружено 7/20 задач...");
});

test("user-activity utils: issue URL falls back to location origin", function() {
    var utils = loadUserActivityUtils({
        location: { origin: "https://jira.example.com" },
        AJS: { params: { baseURL: "" } }
    });
    assert.equal(utils.buildIssueUrl("ABC-123"), "https://jira.example.com/browse/ABC-123");
});

test("user-activity utils: issue URL prefers AJS baseURL and encodes issue key", function() {
    var utils = loadUserActivityUtils({
        location: { origin: "https://jira.example.com" },
        AJS: { params: { baseURL: " https://jira.alt.example.com/jira/ " } }
    });
    assert.equal(utils.getJiraBaseUrl(), "https://jira.alt.example.com/jira");
    assert.equal(utils.buildIssueUrl("ABC/123"), "https://jira.alt.example.com/jira/browse/ABC%2F123");
});

test("user-activity utils: issue link normalizes extra attrs", function() {
    var utils = loadUserActivityUtils({
        location: { origin: "https://jira.example.com" },
        AJS: { params: { baseURL: "" } }
    });
    assert.equal(
        utils.renderIssueLink("ABC-123", null, 'class="foo" data-issue="1"'),
        '<a href="https://jira.example.com/browse/ABC-123" target="_blank" rel="noopener noreferrer" class="foo" data-issue="1">ABC-123</a>'
    );
});

test("user-activity utils: issue link escapes object attrs", function() {
    var utils = loadUserActivityUtils({
        location: { origin: "https://jira.example.com" },
        AJS: { params: { baseURL: "" } }
    });
    assert.equal(
        utils.renderIssueLink("ABC-123", null, { class: 'foo" onclick="x' }),
        '<a href="https://jira.example.com/browse/ABC-123" target="_blank" rel="noopener noreferrer" class="foo&quot; onclick=&quot;x">ABC-123</a>'
    );
});

test("user-activity utils: builds bitbucket URLs and short hash", function() {
    var utils = loadUserActivityUtils({
        location: { origin: "https://jira.example.com" },
        AJS: { params: { baseURL: "" } }
    });
    assert.equal(
        utils.buildBitbucketCommitUrl("https://bitbucket/repo-a/", "557bbc52515"),
        "https://bitbucket/repo-a/commits/557bbc52515"
    );
    assert.equal(
        utils.buildBitbucketPullRequestUrl("https://bitbucket/repo-a", "229"),
        "https://bitbucket/repo-a/pull-requests/229"
    );
    assert.equal(utils.shortHash("557bbc52515"), "557bbc5251");
});

test("user-activity utils: done issue ref adds strike class and status tooltip", function() {
    var utils = loadUserActivityUtils({
        location: { origin: "https://jira.example.com" },
        AJS: { params: { baseURL: "" } }
    });
    var html = utils.renderIssueRef("ABC-123", "Closed task", "Done");

    assert.equal(utils.isDoneStatus({ name: "Done" }), true);
    assert.equal(utils.isDoneStatus("Resolved"), true);
    assert.equal(utils.isDoneStatus("Open"), false);
    assert.match(html, /class="[^"]*ujg-ua-issue-key[^"]*ujg-ua-issue-done/);
    assert.doesNotMatch(html, /class="[^"]*ujg-ua-issue-summary[^"]*ujg-ua-issue-done/);
    assert.match(html, /title="Текущий статус: Done"/);
    assert.match(html, /Closed task/);
});

test("user-activity utils: status badge uses grouped colors and title can include status set time", function() {
    var utils = loadUserActivityUtils({
        location: { origin: "https://jira.example.com" },
        AJS: { params: { baseURL: "" } }
    });

    var openBadge = utils.renderIssueStatusBadge ? utils.renderIssueStatusBadge("Backlog") : "";
    var activeBadge = utils.renderIssueStatusBadge ? utils.renderIssueStatusBadge("QA") : "";
    var doneBadge = utils.renderIssueStatusBadge ? utils.renderIssueStatusBadge("Resolved") : "";
    var html = utils.renderIssueRef("ABC-123", "Timed status", "QA", {
        statusChangedAt: "2026-04-02T15:45:00"
    });

    assert.match(openBadge, /ujg-ua-status-open/);
    assert.match(activeBadge, /ujg-ua-status-active/);
    assert.match(doneBadge, /ujg-ua-status-done/);
    assert.match(html, /title="Текущий статус: QA \| Установлен: 02\.04\.2026 15:45"/);
});

test("user-activity utils: default period is current week from monday to today", function() {
    var utils = loadUserActivityUtilsWithDate("2026-04-01T12:00:00", {
        location: { origin: "https://jira.example.com" },
        AJS: { params: { baseURL: "" } }
    });

    assert.deepEqual(normalize(utils.getDefaultPeriod()), {
        start: "2026-03-30",
        end: "2026-04-01"
    });
});

test("user-activity utils: matches author against selected users by identity tokens", function() {
    var utils = loadUserActivityUtils({
        location: { origin: "https://jira.example.com" },
        AJS: { params: { baseURL: "" } }
    });
    var selected = [{ accountId: "acc-other", displayName: "Someone" }, { accountId: "  ACC-42 ", userName: "ivan" }];
    assert.equal(
        utils.matchesSelectedUsers({ accountId: "acc-42", displayName: "Local Label" }, selected),
        true
    );
    assert.equal(
        utils.matchesSelectedUsers({ displayName: "Bob Smith" }, [{ displayName: "Bob Jones" }]),
        false
    );
});

test("user-activity utils: computes worklog lag score from started and created", function() {
    var utils = loadUserActivityUtils({
        location: { origin: "https://jira.example.com" },
        AJS: { params: { baseURL: "" } }
    });

    var meta = utils.getWorklogLagMeta("2026-04-25T09:00:00", "2026-04-26T08:00:00", 4);

    assert.equal(meta.workedDayKey, "2026-04-25");
    assert.equal(meta.isLate, true);
    assert.equal(Math.round(meta.lagDurationHoursRaw * 10) / 10, 8);
    assert.equal(Math.round(meta.lagScoreHours * 100) / 100, 1.33);
});

test("user-activity utils: next-day midnight keeps zero lag score", function() {
    var utils = loadUserActivityUtils({
        location: { origin: "https://jira.example.com" },
        AJS: { params: { baseURL: "" } }
    });

    var meta = utils.getWorklogLagMeta("2026-04-25T09:00:00", "2026-04-26T00:00:00", 4);

    assert.equal(meta.workedDayKey, "2026-04-25");
    assert.equal(meta.isLate, false);
    assert.equal(meta.lagDurationHoursRaw, 0);
    assert.equal(meta.lagScoreHours, 0);
});

test("user-activity utils: formats lag duration without zero days prefix", function() {
    var utils = loadUserActivityUtils({
        location: { origin: "https://jira.example.com" },
        AJS: { params: { baseURL: "" } }
    });

    assert.equal(utils.formatLagDurationHours(0), "0ч");
    assert.equal(utils.formatLagDurationHours(8), "8ч");
    assert.equal(utils.formatLagDurationHours(24), "1д");
    assert.equal(utils.formatLagDurationHours(40.1), "1д 16ч");
});

test("user-activity API: activity JQL exclusive upper bound includes end date", async function() {
    var captured = [];
    var $ = createJqueryStub(function(options) {
        if (options.url && options.url.indexOf("/rest/api/2/search") !== -1) {
            captured.push(JSON.parse(options.data));
        }
        return resolvedAjax({ issues: [], total: 0 });
    });
    var api = loadUserActivityApi($);
    await new Promise(function(resolve, reject) {
        api.fetchAllData("jdoe", "2026-03-30", "2026-03-31").done(function() {
            try {
                var jql = captured.map(function(body) { return body.jql; }).find(function(q) {
                    return q.indexOf("assignee was") !== -1;
                });
                assert.ok(jql, "expected activity search JQL");
                assert.match(jql, /updated >= "2026-03-30"/);
                assert.match(jql, /updated < "2026-04-01"/);
                var wjql = captured.map(function(body) { return body.jql; }).find(function(q) {
                    return q.indexOf("worklogAuthor") !== -1;
                });
                assert.ok(wjql, "expected worklog search JQL");
                assert.match(wjql, /worklogDate >= "2026-03-30"/);
                assert.match(wjql, /worklogDate < "2026-04-01"/);
                resolve();
            } catch (err) {
                reject(err);
            }
        }).fail(reject);
    });
});

test("user-activity API: fetchAllData second call reuses request cache", async function() {
    var ajaxCount = 0;
    var $ = createJqueryStub(function(options) {
        ajaxCount += 1;
        var url = options.url || "";
        if (url.indexOf("/rest/api/2/search") !== -1) {
            return resolvedAjax({
                issues: [{ key: "ABC-1", id: "1" }],
                total: 1
            });
        }
        if (url.indexOf("/rest/api/2/issue/") !== -1 && url.indexOf("expand=changelog") !== -1) {
            return resolvedAjax({
                changelog: { histories: [], total: 0 },
                fields: { summary: "S" }
            });
        }
        if (url.indexOf("/worklog") !== -1 && url.indexOf("/comment") === -1) {
            return resolvedAjax({ worklogs: [] });
        }
        return resolvedAjax({});
    });
    var api = loadUserActivityApi($);
    await new Promise(function(resolve, reject) {
        api.fetchAllData("u", "2026-01-01", "2026-01-01").done(resolve).fail(reject);
    });
    var afterFirst = ajaxCount;
    await new Promise(function(resolve, reject) {
        api.fetchAllData("u", "2026-01-01", "2026-01-01").done(resolve).fail(reject);
    });
    assert.ok(afterFirst > 0, "expected ajax on first load");
    assert.equal(ajaxCount, afterFirst, "second fetchAllData should not duplicate ajax");
});

test("user-activity API: fetchIssueComments second call reuses request cache", async function() {
    var ajaxCount = 0;
    var $ = createJqueryStub(function(options) {
        ajaxCount += 1;
        if ((options.url || "").indexOf("/comment") !== -1) {
            return resolvedAjax({ comments: [] });
        }
        return resolvedAjax({});
    });
    var api = loadUserActivityApi($);
    await new Promise(function(resolve, reject) {
        api.fetchIssueComments(["K-1"]).done(function() { resolve(); }).fail(reject);
    });
    var n1 = ajaxCount;
    await new Promise(function(resolve, reject) {
        api.fetchIssueComments(["K-1"]).done(function() { resolve(); }).fail(reject);
    });
    assert.equal(ajaxCount, n1, "second fetchIssueComments should not add ajax");
});

test("user-activity API: clearCache forces new requests", async function() {
    var ajaxCount = 0;
    var $ = createJqueryStub(function(options) {
        ajaxCount += 1;
        if ((options.url || "").indexOf("/comment") !== -1) {
            return resolvedAjax({ comments: [] });
        }
        return resolvedAjax({});
    });
    var api = loadUserActivityApi($);
    await new Promise(function(resolve, reject) {
        api.fetchIssueComments(["K-2"]).done(function() { resolve(); }).fail(reject);
    });
    api.clearCache();
    await new Promise(function(resolve, reject) {
        api.fetchIssueComments(["K-2"]).done(function() { resolve(); }).fail(reject);
    });
    assert.equal(ajaxCount, 2);
});

test("user-activity API: searchUsers is not cached (repeated calls hit ajax)", async function() {
    var ajaxCount = 0;
    var $ = createJqueryStub(function(options) {
        ajaxCount += 1;
        if ((options.url || "").indexOf("/user/picker") !== -1) {
            return resolvedAjax({ users: [] });
        }
        return resolvedAjax({});
    });
    var api = loadUserActivityApi($);
    await api.searchUsers("a");
    await api.searchUsers("a");
    assert.equal(ajaxCount, 2);
});

function loadRepoDataProcessor() {
    var u = uaUtilsForLinks();
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
            },
            buildBitbucketCommitUrl: u.buildBitbucketCommitUrl,
            buildBitbucketPullRequestUrl: u.buildBitbucketPullRequestUrl
        }
    });
}

function loadUserActivityDataProcessor() {
    var u = uaUtilsForLinks();
    return loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "data-processor.js"), {
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
            },
            getProjectKey: function(issueKey) {
                return String(issueKey || "").split("-")[0] || "";
            },
            getWorklogLagMeta: u.getWorklogLagMeta
        }
    });
}

function createSummaryCardsJqueryStub() {
    function renderNode(node) {
        return "<" + node.tag + node.attrs + ">" + node.inner + "</" + node.tag + ">";
    }

    function removeByClass(node, className) {
        var pattern = new RegExp(
            '<([a-zA-Z0-9]+)([^>]*)class="[^"]*' + escapeRegExp(className) + '[^"]*"[^>]*>[\\s\\S]*?<\\/\\1>',
            "g"
        );
        node.inner = node.inner.replace(pattern, "");
    }

    function wrap(node) {
        return {
            __node: node,
            append: function(child) {
                if (child && child.__node) node.inner += renderNode(child.__node);
                else node.inner += String(child || "");
                return this;
            },
            html: function(value) {
                if (value === undefined) return node.inner;
                node.inner = String(value);
                return this;
            },
            find: function(selector) {
                var classMatch = /^\.([a-zA-Z0-9_-]+)$/.exec(selector);
                return {
                    remove: function() {
                        if (classMatch) removeByClass(node, classMatch[1]);
                        return this;
                    }
                };
            }
        };
    }

    return function(input) {
        var match = /^<([a-zA-Z0-9]+)([^>]*)><\/\1>$/.exec(String(input || "").trim());
        if (!match) throw new Error("summary cards jquery stub: unsupported input");
        return wrap({ tag: match[1], attrs: match[2], inner: "" });
    };
}

function loadSummaryCards(jquery) {
    var configMod = loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "config.js"), {});
    var u = uaUtilsForLinks();
    return loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "summary-cards.js"), {
        jquery: jquery,
        _ujgUA_config: configMod,
        _ujgUA_utils: {
            escapeHtml: u.escapeHtml,
            icon: function() {
                return "";
            }
        }
    });
}

function createMultiPickerJqueryStub(pickerDocument) {
    var docHandlers = [];

    function El(tag, className) {
        return {
            tagName: String(tag).toUpperCase(),
            className: className || "",
            attrs: {},
            style: { display: "" },
            textContent: "",
            childNodes: [],
            parentNode: null,
            contains: function(other) {
                var p = other;
                while (p) {
                    if (p === this) return true;
                    p = p.parentNode;
                }
                return false;
            }
        };
    }

    function appendNode(parent, child) {
        parent.childNodes.push(child);
        child.parentNode = parent;
    }

    function hasClass(n, c) {
        return (" " + (n.className || "") + " ").indexOf(" " + c + " ") >= 0;
    }

    function matchSel(n, selector) {
        if (!n || !n.tagName) return false;
        selector = String(selector || "").trim();
        var compound = selector.match(/^(\.[a-zA-Z0-9_-]+)\s+(\w+)$/);
        if (compound) {
            return hasClass(n, compound[1].slice(1)) && n.tagName === compound[2].toUpperCase();
        }
        var tc = selector.match(/^(\w+)\[type="checkbox"\]$/i);
        if (tc) return n.tagName === tc[1].toUpperCase() && n.attrs.type === "checkbox";
        var onlyClass = selector.match(/^\.([a-zA-Z0-9_-]+)$/);
        if (onlyClass) return hasClass(n, onlyClass[1]);
        var parts = selector.split(".").filter(Boolean);
        if (!parts.length) return false;
        if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(parts[0]) && parts.length > 1) {
            var tag = parts.shift().toUpperCase();
            if (n.tagName !== tag) return false;
            return parts.every(function(c) { return hasClass(n, c); });
        }
        if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(parts[0]) && parts.length === 1) {
            return n.tagName === parts[0].toUpperCase();
        }
        return parts.every(function(c) { return hasClass(n, c); });
    }

    function walkDesc(n, fn) {
        (n.childNodes || []).forEach(function(ch) {
            fn(ch);
            walkDesc(ch, fn);
        });
    }

    function findDesc(start, selector) {
        var out = [];
        var compound = selector.match(/^(\.[a-zA-Z0-9_-]+)\s+(\w+)$/);
        if (compound) {
            walkDesc(start, function(ch) {
                if (hasClass(ch, compound[1].slice(1))) {
                    walkDesc(ch, function(x) {
                        if (x.tagName === compound[2].toUpperCase()) out.push(x);
                    });
                }
            });
            return out;
        }
        walkDesc(start, function(ch) {
            if (matchSel(ch, selector)) out.push(ch);
        });
        return out;
    }

    function parseAttrs(attrStr, node) {
        String(attrStr || "").replace(/([a-zA-Z0-9:-]+)(?:="([^"]*)")?/g, function(_, key, val) {
            if (key === "class") node.className = val || "";
            else node.attrs[key] = val === undefined ? "" : val;
        });
    }

    function parseHtml(html) {
        html = String(html || "").trim();
        var inputRe = /^<input([^>]*)\/?>/i.exec(html);
        if (inputRe) {
            var inp = El("input", "");
            parseAttrs(inputRe[1], inp);
            return inp;
        }
        var selfRe = /^<(\w+)((?:\s[^>]+)?)\s*\/>\s*$/.exec(html);
        if (selfRe) {
            var s = El(selfRe[1], "");
            parseAttrs(selfRe[2], s);
            return s;
        }
        var pair = /^<(\w+)((?:\s[^>]+)?)\s*>([\s\S]*)<\/\1>\s*$/i.exec(html);
        if (!pair) throw new Error("multi-picker stub: bad html " + html.slice(0, 80));
        var el = El(pair[1], "");
        parseAttrs(pair[2], el);
        var inner = pair[3].trim();
        if (inner && inner.indexOf("<") < 0) {
            el.textContent = inner;
        } else if (inner) {
            appendNode(el, parseHtml(inner));
        }
        return el;
    }

    function buildPickerRoot() {
        var root = El("div", "ujg-ua-multi-picker");
        var trigger = El("button", "aui-button ujg-ua-picker-trigger");
        trigger.attrs.type = "button";
        trigger.textContent = "0 пользователей";
        var panel = El("div", "ujg-ua-picker-panel");
        panel.style.display = "none";
        var search = El("input", "ujg-ua-picker-search");
        search.attrs.type = "search";
        search.attrs.placeholder = "Поиск пользователей...";
        var chips = El("div", "ujg-ua-picker-selected");
        var actions = El("div", "ujg-ua-picker-actions");
        var reset = El("button", "aui-button aui-button-link");
        reset.attrs.type = "button";
        reset.textContent = "Сбросить";
        var results = El("div", "ujg-ua-picker-results");
        appendNode(actions, reset);
        appendNode(panel, search);
        appendNode(panel, chips);
        appendNode(panel, actions);
        appendNode(panel, results);
        appendNode(root, trigger);
        appendNode(root, panel);
        return root;
    }

    function jq(nodes) {
        nodes = (nodes || []).filter(Boolean);
        var col = {
            length: nodes.length,
            find: function(sel) {
                var acc = [];
                nodes.forEach(function(start) {
                    findDesc(start, sel).forEach(function(x) {
                        acc.push(x);
                    });
                });
                return jq(acc);
            },
            append: function(other) {
                var raw = other && typeof other.length === "number" && other[0] !== undefined ? other[0] : other;
                nodes.forEach(function(n) {
                    appendNode(n, raw);
                });
                return col;
            },
            empty: function() {
                nodes.forEach(function(n) {
                    n.childNodes.forEach(function(ch) {
                        ch.parentNode = null;
                    });
                    n.childNodes = [];
                });
                return col;
            },
            text: function(val) {
                if (val === undefined) {
                    return nodes[0] ? String(nodes[0].textContent || "") : "";
                }
                nodes.forEach(function(n) {
                    n.textContent = String(val);
                });
                return col;
            },
            attr: function(name, val) {
                if (val === undefined) return nodes[0] ? nodes[0].attrs[name] : undefined;
                nodes.forEach(function(n) {
                    n.attrs[name] = String(val);
                });
                return col;
            },
            prop: function(name, val) {
                if (val === undefined) {
                    if (name === "checked") return !!(nodes[0] && nodes[0]._checked);
                    return nodes[0] && nodes[0].attrs[name];
                }
                if (name === "checked") {
                    nodes.forEach(function(n) {
                        n._checked = !!val;
                    });
                }
                return col;
            },
            show: function() {
                nodes.forEach(function(n) {
                    n.style.display = "";
                });
                return col;
            },
            hide: function() {
                nodes.forEach(function(n) {
                    n.style.display = "none";
                });
                return col;
            },
            focus: function() {
                return col;
            },
            on: function(a, b, c) {
                var delegate;
                var handler;
                if (typeof b === "function") {
                    handler = b;
                    delegate = null;
                } else {
                    delegate = b;
                    handler = c;
                }
                var ev = String(a).split(".")[0];
                nodes.forEach(function(node) {
                    if (!node._handlers) node._handlers = {};
                    if (!node._handlers[ev]) node._handlers[ev] = [];
                    node._handlers[ev].push({ delegate: delegate, handler: handler });
                });
                return col;
            },
            trigger: function(evName) {
                var type = String(evName).split(".")[0];
                var target = nodes[0];
                if (!target) return col;
                var evt = { target: target, stopPropagation: function() {}, type: type };
                var chain = [];
                var p = target;
                while (p) {
                    chain.push(p);
                    p = p.parentNode;
                }
                chain.forEach(function(node) {
                    var bindings = (node._handlers && node._handlers[type]) || [];
                    bindings.forEach(function(b) {
                        if (!b.delegate) {
                            if (node === target) b.handler.call(target, evt);
                        } else if (matchSel(target, b.delegate)) {
                            b.handler.call(target, evt);
                        }
                    });
                });
                return col;
            }
        };
        for (var i = 0; i < nodes.length; i++) col[i] = nodes[i];
        return col;
    }

    function $(arg) {
        if (arg === pickerDocument) {
            return {
                on: function(full, h) {
                    docHandlers.push({ full: full, h: h });
                },
                off: function(full) {
                    docHandlers = docHandlers.filter(function(x) {
                        return x.full !== full;
                    });
                }
            };
        }
        if (typeof arg === "string" && arg.indexOf("ujg-ua-multi-picker") >= 0) {
            return jq([buildPickerRoot()]);
        }
        if (typeof arg === "string" && arg.charAt(0) === "<") {
            return jq([parseHtml(arg)]);
        }
        throw new Error("multi-picker jquery stub: unsupported arg");
    }

    $.when = function() {
        var items = Array.prototype.slice.call(arguments);
        var combined = createDeferred();
        var remaining = items.length;
        var results = new Array(items.length);
        if (!remaining) {
            combined.resolve();
            return combined.promise();
        }
        items.forEach(function(item, index) {
            if (!item || typeof item.done !== "function") {
                if (item && typeof item.then === "function") {
                    var wrapped = createDeferred();
                    item.then(function(value) {
                        wrapped.resolve(value);
                    }, function(err) {
                        wrapped.reject(err);
                    });
                    item = wrapped.promise();
                } else {
                    throw new TypeError("multi-picker stub requires promise-like item");
                }
            }
            item.done(function() {
                results[index] = arguments.length > 1 ? Array.prototype.slice.call(arguments) : arguments[0];
                remaining -= 1;
                if (remaining === 0) combined.resolve.apply(combined, results);
            }).fail(function() {
                combined.reject.apply(combined, arguments);
            });
        });
        return combined.promise();
    };
    $.Deferred = createDeferred;
    return $;
}

function loadMultiUserPicker(pickerDocument, api) {
    var $ = createMultiPickerJqueryStub(pickerDocument);
    return loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "multi-user-picker.js"), {
        jquery: $,
        _ujgUA_config: {},
        _ujgUA_api: api
    }, { document: pickerDocument });
}

test("multi-user-picker setSelectedUsers normalizes users and distinguishes team-sync vs manual", function() {
    var metaCalls = [];
    var pickerDoc = {};
    var api = {
        searchUsers: function() {
            var d = createDeferred();
            d.resolve([]);
            return d.promise();
        }
    };
    var mod = loadMultiUserPicker(pickerDoc, api);
    var picker = mod.create(null, function(users, meta) {
        metaCalls.push({ users: normalize(users), meta: normalize(meta) });
    });
    picker.setSelectedUsers([{ name: "u1", displayName: "User 1" }], { source: "team-sync" });
    assert.deepEqual(normalize(picker.getSelectedUsers()), [{ name: "u1", displayName: "User 1", key: "u1" }]);
    assert.equal(metaCalls.length, 1);
    assert.equal(metaCalls[0].meta.source, "team-sync");
    picker.setSelectedUsers([{ name: "u2", displayName: "U2" }]);
    assert.equal(metaCalls[metaCalls.length - 1].meta.source, "manual");
});

test("multi-user-picker clearSelection passes source; reset button uses manual", function() {
    var metaCalls = [];
    var pickerDoc = {};
    var api = {
        searchUsers: function() {
            var d = createDeferred();
            d.resolve([]);
            return d.promise();
        }
    };
    var mod = loadMultiUserPicker(pickerDoc, api);
    var picker = mod.create(null, function(users, meta) {
        metaCalls.push({ users: normalize(users), meta: normalize(meta) });
    });
    picker.setSelectedUsers([{ name: "u1", displayName: "User 1" }], { source: "team-sync" });
    var nAfterSet = metaCalls.length;
    picker.clearSelection({ source: "team-sync" });
    assert.deepEqual(normalize(picker.getSelectedUsers()), []);
    assert.equal(metaCalls[nAfterSet].meta.source, "team-sync");
    picker.setSelectedUsers([{ name: "x", displayName: "X" }], { source: "team-sync" });
    picker.$el.find(".ujg-ua-picker-actions button").trigger("click");
    assert.deepEqual(normalize(picker.getSelectedUsers()), []);
    assert.equal(metaCalls[metaCalls.length - 1].meta.source, "manual");
});

test("multi-user-picker getSelectedUsers returns a safe copy", function() {
    var pickerDoc = {};
    var api = {
        searchUsers: function() {
            var d = createDeferred();
            d.resolve([]);
            return d.promise();
        }
    };
    var mod = loadMultiUserPicker(pickerDoc, api);
    var picker = mod.create(null, function() {});

    picker.setSelectedUsers([{ name: "u1", displayName: "User 1" }], { source: "team-sync" });
    var selected = picker.getSelectedUsers();
    selected.push({ name: "u2", displayName: "User 2", key: "u2" });
    selected[0].displayName = "Mutated";

    assert.deepEqual(normalize(picker.getSelectedUsers()), [{ name: "u1", displayName: "User 1", key: "u1" }]);
});

test("multi-user-picker suppresses redundant notifications for unchanged programmatic selection", function() {
    var metaCalls = [];
    var pickerDoc = {};
    var api = {
        searchUsers: function() {
            var d = createDeferred();
            d.resolve([]);
            return d.promise();
        }
    };
    var mod = loadMultiUserPicker(pickerDoc, api);
    var picker = mod.create(null, function(users, meta) {
        metaCalls.push({ users: normalize(users), meta: normalize(meta) });
    });

    picker.setSelectedUsers([{ name: "u1", displayName: "User 1" }], { source: "team-sync" });
    picker.setSelectedUsers([{ key: "u1", displayName: "User 1" }], { source: "team-sync" });
    picker.clearSelection({ source: "team-sync" });
    picker.clearSelection({ source: "team-sync" });

    assert.deepEqual(metaCalls, [{
        users: [{ name: "u1", displayName: "User 1", key: "u1" }],
        meta: { source: "team-sync" }
    }, {
        users: [],
        meta: { source: "team-sync" }
    }]);
});

test("multi-user-picker setFromUrl defaults source to url and allows override", async function() {
    var metaCalls = [];
    var pickerDoc = {};
    var api = {
        searchUsers: function(query) {
            var d = createDeferred();
            d.resolve([{
                name: query,
                displayName: "User " + query.toUpperCase()
            }]);
            return d.promise();
        }
    };
    var mod = loadMultiUserPicker(pickerDoc, api);
    var picker = mod.create(null, function(users, meta) {
        metaCalls.push({ users: normalize(users), meta: normalize(meta) });
    });

    picker.setFromUrl({ users: "u1" });
    await new Promise(function(resolve) { setTimeout(resolve, 0); });
    picker.setFromUrl({ users: "u2" }, { source: "team-sync" });
    await new Promise(function(resolve) { setTimeout(resolve, 0); });

    assert.deepEqual(metaCalls, [{
        users: [{ name: "u1", displayName: "User U1", key: "u1" }],
        meta: { source: "url" }
    }, {
        users: [{ name: "u2", displayName: "User U2", key: "u2" }],
        meta: { source: "team-sync" }
    }]);
});

function createHtmlJqueryStub() {
    function createCollection(root, selectors, singleNode) {
        return {
            html: function(value) {
                if (value === undefined) return root.html;
                root.html = String(value);
                return this;
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
            attr: function(name, value) {
                var node = singleNode || selectors[0];
                if (value === undefined) return node ? node.attrs[name] : undefined;
                if (!node) return this;
                node.attrs[name] = String(value);
                syncNode(node);
                return this;
            },
            val: function(value) {
                var node = singleNode || selectors[0];
                if (value === undefined) return node ? (node.attrs.value || "") : "";
                if (!node) return this;
                node.attrs.value = String(value);
                syncNode(node);
                return this;
            },
            trigger: function(eventName) {
                var node = singleNode || selectors[0];
                (root.handlers[eventName] || []).forEach(function(binding) {
                    if (node && matchesSelector(node, binding.selector)) {
                        binding.handler.call(node, { target: node });
                    }
                });
                return this;
            },
            each: function() {
                return this;
            },
            css: function() {
                return this;
            },
            outerHeight: function() {
                return 0;
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
        root.html = root.html.replace(node.original, "<" + node.tag + (attrs ? " " + attrs : "") + ">");
        node.original = "<" + node.tag + (attrs ? " " + attrs : "") + ">";
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
        var matches = [];

        root.html.replace(/<([a-zA-Z0-9]+)\s*([^>]*)>/g, function(full, tag, attrText) {
            if (full.indexOf("</") === 0) return full;
            var node = {
                tag: tag.toLowerCase(),
                attrs: parseAttrs(attrText),
                original: full
            };

            if (matchesSelector(node, selector)) {
                matches.push(node);
            }
            return full;
        });

        return matches;
    }

    function hasClass(node, className) {
        return splitClasses(node.attrs["class"]).indexOf(className) >= 0;
    }

    function matchesSelector(node, selector) {
        var classMatch = selector.match(/^\.([a-zA-Z0-9_-]+)$/);
        var tagMatch = selector.match(/^([a-zA-Z0-9]+)$/);
        var tagClassMatch = selector.match(/^([a-zA-Z0-9]+)\.([a-zA-Z0-9_-]+)$/);
        var attrMatch = selector.match(/^([a-zA-Z0-9]+)?\[([a-zA-Z0-9:-]+)(?:="([^"]+)")?\]$/);

        if (classMatch) return hasClass(node, classMatch[1]);
        if (tagMatch) return node.tag === tagMatch[1].toLowerCase();
        if (tagClassMatch) {
            return node.tag === tagClassMatch[1].toLowerCase() && hasClass(node, tagClassMatch[2]);
        }
        if (!attrMatch) return false;
        var wantedTag = attrMatch && attrMatch[1];
        var attrName = attrMatch && attrMatch[2];
        var attrValue = attrMatch && attrMatch[3];

        if (wantedTag && node.tag !== wantedTag.toLowerCase()) return false;
        if (!Object.prototype.hasOwnProperty.call(node.attrs, attrName)) return false;
        return attrValue === undefined || node.attrs[attrName] === attrValue;
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

function uaUtilsForLinks() {
    return loadUserActivityUtils({
        location: { origin: "https://jira.example.com" },
        AJS: { params: { baseURL: "" } }
    });
}

function loadRepoLog(jquery, utilsOverrides, configOverrides) {
    utilsOverrides = utilsOverrides || {};
    configOverrides = configOverrides || {};
    var u = uaUtilsForLinks();
    return loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "repo-log.js"), {
        jquery: jquery,
        _ujgUA_config: configOverrides,
        _ujgUA_utils: Object.assign({
            escapeHtml: u.escapeHtml,
            renderIssueLink: u.renderIssueLink,
            renderExternalLink: u.renderExternalLink,
            renderIssueRef: u.renderIssueRef,
            renderIssueLinkWithStatus: u.renderIssueLinkWithStatus,
            renderIssueSummaryText: u.renderIssueSummaryText,
            buildIssueUrl: u.buildIssueUrl,
            getJiraBaseUrl: u.getJiraBaseUrl,
            getStatusName: u.getStatusName,
            isDoneStatus: u.isDoneStatus,
            getIssueStatusTitle: u.getIssueStatusTitle,
            shortHash: u.shortHash
        }, utilsOverrides)
    });
}

function loadUnifiedCalendar(jquery, utilsOverrides) {
    utilsOverrides = utilsOverrides || {};
    var configMod = loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "config.js"), {});
    var u = uaUtilsForLinks();
    return loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "unified-calendar.js"), {
        jquery: jquery,
        _ujgUA_config: configMod,
        _ujgUA_utils: Object.assign({
            WEEKDAYS_RU: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
            MONTHS_RU: ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"],
            getDayKey: function(date) {
                var y = date.getFullYear();
                var m = String(date.getMonth() + 1).padStart(2, "0");
                var d = String(date.getDate()).padStart(2, "0");
                return y + "-" + m + "-" + d;
            },
            getHeatBg: function(value) {
                return value > 0 ? "bg-heat-1" : "bg-heat-0";
            },
            formatTime: function(ts) {
                if (!ts) return "";
                var date = new Date(ts);
                if (isNaN(date.getTime())) return "";
                return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
            },
            truncate: function(s, n) {
                s = String(s || "");
                return s.length <= n ? s : s.slice(0, n) + "…";
            },
            formatDayMonth: u.formatDayMonth,
            formatDayMonthTime: u.formatDayMonthTime,
            formatLagDurationHours: u.formatLagDurationHours,
            isWeekendDay: function(dateStr) {
                var dt = new Date(dateStr + "T00:00:00");
                var dow = dt.getDay();
                return dow === 0 || dow === 6;
            },
            escapeHtml: u.escapeHtml,
            renderIssueLink: u.renderIssueLink,
            renderExternalLink: u.renderExternalLink,
            renderIssueRef: u.renderIssueRef,
            renderIssueLinkWithStatus: u.renderIssueLinkWithStatus,
            renderIssueSummaryText: u.renderIssueSummaryText,
            renderIssueStatusBadge: u.renderIssueStatusBadge,
            buildIssueUrl: u.buildIssueUrl,
            getJiraBaseUrl: u.getJiraBaseUrl,
            getStatusName: u.getStatusName,
            isDoneStatus: u.isDoneStatus,
            getIssueStatusChangedAt: u.getIssueStatusChangedAt,
            getIssueStatusTitle: u.getIssueStatusTitle,
            shortHash: u.shortHash,
            matchesSelectedUsers: u.matchesSelectedUsers
        }, utilsOverrides)
    }, { requestAnimationFrame: function(fn) { if (fn) fn(); } });
}

function loadDailyDetail(jqueryFactory) {
    var configMod = loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "config.js"), {});
    var u = uaUtilsForLinks();
    var $fn = jqueryFactory || function() {
        return {
            html: function() {
                return this;
            },
            slideDown: function() {
                return this;
            },
            slideUp: function() {
                return this;
            },
            find: function() {
                return { on: function() {} };
            }
        };
    };
    return loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "daily-detail.js"), {
        jquery: $fn,
        _ujgUA_config: configMod,
        _ujgUA_utils: u
    });
}

function createActivityLogJqueryStub() {
    var doc = {};
    var tbodyInner = "";
    var expandHandler = null;

    var root = {
        find: function(sel) {
            if (sel === ".ujg-ua-log-tbody") {
                return {
                    html: function(v) {
                        if (v === undefined) return tbodyInner;
                        tbodyInner = String(v);
                        return this;
                    },
                    on: function(ev, sub, fn) {
                        if (ev === "click" && sub === ".ujg-ua-row-expand") expandHandler = fn;
                        return this;
                    }
                };
            }
            if (sel === ".ujg-ua-log-count") {
                return { text: function() { return this; } };
            }
            if (/^\.ujg-ua-th-/.test(sel)) {
                return { empty: function() { return this; }, append: function() { return this; } };
            }
            return root;
        }
    };

    function inner() {
        var c = {
            append: function() { return c; },
            empty: function() { return c; },
            on: function() { return c; },
            html: function() { return c; },
            val: function() { return c; },
            show: function() { return c; },
            hide: function() { return c; },
            focus: function() { return c; },
            toggle: function() { return c; },
            addClass: function() { return c; },
            removeClass: function() { return c; },
            closest: function() { return { length: 0 }; },
            stopPropagation: function() {}
        };
        return c;
    }

    function $(input) {
        if (input === doc) {
            return { on: function() { return inner(); } };
        }
        if (typeof input === "string") {
            if (/dashboard-card|ujg-ua-log-tbody/.test(input)) return root;
            return inner();
        }
        if (input && typeof input.getAttribute === "function") {
            return {
                attr: function(n) {
                    return input.getAttribute(n);
                }
            };
        }
        throw new Error("activity log jquery stub: unsupported input");
    }

    return {
        doc: doc,
        $: $,
        getTbodyHtml: function() {
            return tbodyInner;
        },
        clickExpandFirstRow: function() {
            if (!expandHandler) throw new Error("missing expand handler");
            var el = {
                getAttribute: function(n) {
                    return n === "data-idx" ? "0" : null;
                }
            };
            expandHandler.call(el, { target: el });
        }
    };
}

function loadActivityLog(jquery, utilsOverrides, documentRef) {
    utilsOverrides = utilsOverrides || {};
    var u = uaUtilsForLinks();
    return loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "activity-log.js"), {
        jquery: jquery,
        _ujgUA_config: {},
        _ujgUA_utils: Object.assign({
            escapeHtml: u.escapeHtml,
            renderIssueLink: u.renderIssueLink,
            renderIssueRef: u.renderIssueRef,
            renderIssueLinkWithStatus: u.renderIssueLinkWithStatus,
            renderIssueSummaryText: u.renderIssueSummaryText,
            buildIssueUrl: u.buildIssueUrl,
            getJiraBaseUrl: u.getJiraBaseUrl,
            getProjectKey: u.getProjectKey,
            getStatusName: u.getStatusName,
            isDoneStatus: u.isDoneStatus,
            getIssueStatusTitle: u.getIssueStatusTitle,
            formatTime: function(ts) {
                if (!ts) return "";
                var date = new Date(ts);
                if (isNaN(date.getTime())) return "";
                return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
            },
            icon: function() {
                return "";
            }
        }, utilsOverrides)
    }, documentRef ? { document: documentRef } : {});
}

function countMatches(value, pattern) {
    var matches = String(value).match(pattern);
    return matches ? matches.length : 0;
}

function loadRendering(jquery, utilsOverrides, documentStub, windowStub) {
    var filePath = path.join(__dirname, "..", "ujg-user-activity-modules", "rendering.js");
    var code = fs.readFileSync(filePath, "utf8");
    var exported;
    var sandbox = {
        console: console,
        Date: Date,
        Object: Object,
        Array: Array,
        JSON: JSON,
        Math: Math,
        parseInt: parseInt,
        parseFloat: parseFloat,
        isNaN: isNaN,
        isFinite: isFinite,
        URLSearchParams: URLSearchParams,
        encodeURIComponent: encodeURIComponent,
        decodeURIComponent: decodeURIComponent,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        document: documentStub,
        window: windowStub,
        define: function(name, names, factory) {
            if (typeof name !== "string") {
                factory = names;
                names = name;
            }
            exported = factory.apply(null, (names || []).map(function(dep) {
                if (dep === "jquery") return jquery;
                if (dep === "_ujgUA_config") return {};
                if (dep === "_ujgUA_utils") {
                    return Object.assign({
                        icon: function(name) { return "[" + name + "]"; },
                        getDefaultPeriod: function() {
                            return { start: "2026-03-01", end: "2026-03-31" };
                        },
                        getIssueStatusChangedAt: function() {
                            return "";
                        },
                        renderIssueStatusBadge: function(status) {
                            return '<span class="ujg-ua-inline-status">' + String(status || "") + "</span>";
                        },
                        escapeHtml: function(value) { return String(value || ""); },
                        getDayKey: function(date) {
                            var year = date.getFullYear();
                            var month = String(date.getMonth() + 1).padStart(2, "0");
                            var day = String(date.getDate()).padStart(2, "0");
                            return year + "-" + month + "-" + day;
                        }
                    }, utilsOverrides || {});
                }
                throw new Error("Missing dependency: " + dep);
            }));
        }
    };
    sandbox.define.amd = true;
    vm.runInNewContext(code, sandbox, {
        filename: path.resolve(filePath)
    });
    return exported;
}

test("user-activity team sync: one team yields all members", function() {
    var docStub = { __node: { label: "document", children: [], slots: {}, handlers: {} } };
    var jqStub = createRenderingJqueryStub(docStub);
    var mod = loadRendering(jqStub.$, {}, docStub);
    function resolveUser(k) {
        return { name: k, displayName: "D_" + k, key: k };
    }
    var teams = [{ id: "t1", memberKeys: ["u1", "u2"] }];
    assert.deepEqual(
        normalize(mod.getUsersFromTeams(teams, ["t1"], resolveUser)),
        normalize([
            { name: "u1", displayName: "D_u1", key: "u1" },
            { name: "u2", displayName: "D_u2", key: "u2" }
        ])
    );
});

test("user-activity team sync: two teams union without duplicate keys", function() {
    var docStub = { __node: { label: "document", children: [], slots: {}, handlers: {} } };
    var jqStub = createRenderingJqueryStub(docStub);
    var mod = loadRendering(jqStub.$, {}, docStub);
    function resolveUser(k) {
        return { name: k, displayName: k, key: k };
    }
    var teams = [
        { id: "a", memberKeys: ["x", "y"] },
        { id: "b", memberKeys: ["y", "z"] }
    ];
    assert.deepEqual(
        normalize(mod.getUsersFromTeams(teams, ["a", "b"], resolveUser)),
        normalize([
            { name: "x", displayName: "x", key: "x" },
            { name: "y", displayName: "y", key: "y" },
            { name: "z", displayName: "z", key: "z" }
        ])
    );
});

test("user-activity team sync: manual user list mismatch clears team union match", function() {
    var docStub = { __node: { label: "document", children: [], slots: {}, handlers: {} } };
    var jqStub = createRenderingJqueryStub(docStub);
    var mod = loadRendering(jqStub.$, {}, docStub);
    var store = {
        getDisplayNameByKey: function() {
            return { a: "A", b: "B" };
        }
    };
    function resolveUser(k) {
        var m = store.getDisplayNameByKey();
        return { name: k, displayName: m[k] || k, key: k };
    }
    var teams = [{ id: "t1", memberKeys: ["a", "b"] }];
    assert.equal(mod.usersMatchTeamUnion([{ name: "a", displayName: "A", key: "a" }], teams, ["t1"], resolveUser), false);
    assert.equal(
        mod.usersMatchTeamUnion(
            [
                { name: "a", displayName: "A", key: "a" },
                { name: "b", displayName: "B", key: "b" }
            ],
            teams,
            ["t1"],
            resolveUser
        ),
        true
    );
});

test("user-activity team sync: manual picker change clears selected teams in rendering", function() {
    var docStub = { __node: { label: "document", children: [], slots: {}, handlers: {} } };
    var jqStub = createRenderingJqueryStub(docStub);
    var mod = loadRendering(jqStub.$, {}, docStub);
    var selectedUsers = [];
    var teamPickerSelected = [];
    var teamPickerSetCalls = [];
    var teamPickerChange = null;
    var pickerOnChange = null;

    function resolvedAlways(value) {
        var d = createDeferred();
        d.always = function(handler) {
            d.done(handler);
            d.fail(handler);
            return d;
        };
        d.resolve(value);
        return d.promise();
    }

    mod.init(jqStub.createNode("root"), {
        multiUserPicker: {
            create: function(_, onChange) {
                pickerOnChange = onChange;
                return {
                    $el: jqStub.createNode("MultiUserPicker"),
                    setFromUrl: function() {
                        return resolvedAlways();
                    },
                    getSelectedUsers: function() {
                        return normalize(selectedUsers);
                    },
                    setSelectedUsers: function(nextUsers, options) {
                        selectedUsers = normalize(nextUsers || []);
                        onChange(normalize(selectedUsers), normalize(options || {}));
                    }
                };
            }
        },
        dateRangePicker: {
            create: function(onChange) {
                var period = { start: "2026-03-01", end: "2026-03-31" };
                if (onChange) onChange(period);
                return {
                    $el: jqStub.createNode("DateRangePicker"),
                    getPeriod: function() {
                        return period;
                    }
                };
            }
        },
        teamStore: {
            loadTeams: function() {
                return resolvedAlways([{ id: "team-1", memberKeys: ["u1", "u2"] }]);
            },
            getTeams: function() {
                return [{ id: "team-1", memberKeys: ["u1", "u2"] }];
            },
            getDisplayNameByKey: function() {
                return { u1: "User 1", u2: "User 2", u3: "User 3" };
            }
        },
        teamPicker: {
            create: function(options) {
                teamPickerChange = function(nextIds) {
                    teamPickerSelected = normalize(nextIds || []);
                    options.onChange(nextIds);
                };
                teamPickerSelected = normalize(options.selectedTeamIds || []);
                return {
                    $el: jqStub.createNode("TeamPicker"),
                    setSelectedTeamIds: function(nextIds, callOptions) {
                        teamPickerSelected = normalize(nextIds || []);
                        teamPickerSetCalls.push({
                            ids: normalize(nextIds || []),
                            options: normalize(callOptions || {})
                        });
                    },
                    destroy: function() {}
                };
            }
        }
    });

    teamPickerChange(["team-1"]);
    assert.deepEqual(teamPickerSelected, ["team-1"]);
    assert.deepEqual(normalize(selectedUsers), [
        { name: "u1", displayName: "User 1", key: "u1" },
        { name: "u2", displayName: "User 2", key: "u2" }
    ]);

    pickerOnChange([{ name: "u3", displayName: "User 3", key: "u3" }], { source: "manual" });

    assert.deepEqual(teamPickerSelected, []);
    assert.deepEqual(teamPickerSetCalls, [{
        ids: [],
        options: { silent: true }
    }]);
});

test("user-activity team manager button opens popup and refreshes team picker", function() {
    var docStub = { __node: { label: "document", children: [], slots: {}, handlers: {} } };
    var jqStub = createRenderingJqueryStub(docStub);
    var mod = loadRendering(jqStub.$, {}, docStub);
    var teams = [{ id: "team-1", name: "Alpha", memberKeys: ["u1"] }];
    var teamPickerSnapshots = [];
    var teamPickerCreateOptions = [];
    var popupParent = null;
    var popupOnChange = null;
    var root = jqStub.createNode("root");

    function resolvedAlways(value) {
        var d = createDeferred();
        d.always = function(handler) {
            d.done(handler);
            d.fail(handler);
            return d;
        };
        d.resolve(value);
        return d.promise();
    }

    function triggerClick(node) {
        (node.handlers.click || []).forEach(function(binding) {
            binding.handler.call(node, { target: node, type: "click" });
        });
    }

    function findChildByHtml(node, needle) {
        return (node.children || []).filter(function(child) {
            return child && typeof child.html === "string" && child.html.indexOf(needle) >= 0;
        })[0] || null;
    }

    mod.init(root, {
        multiUserPicker: {
            create: function() {
                return {
                    $el: jqStub.createNode("MultiUserPicker"),
                    setFromUrl: function() {
                        return resolvedAlways();
                    },
                    getSelectedUsers: function() {
                        return [];
                    },
                    setSelectedUsers: function() {}
                };
            }
        },
        dateRangePicker: {
            create: function(onChange) {
                var period = { start: "2026-03-01", end: "2026-03-31" };
                if (onChange) onChange(period);
                return {
                    $el: jqStub.createNode("DateRangePicker"),
                    getPeriod: function() {
                        return period;
                    }
                };
            }
        },
        teamStore: {
            loadTeams: function() {
                return resolvedAlways(teams);
            },
            getTeams: function() {
                return teams;
            },
            getDisplayNameByKey: function() {
                return { u1: "User 1", u2: "User 2" };
            }
        },
        teamPicker: {
            create: function(options) {
                teamPickerSnapshots.push(normalize(options.teams || []));
                teamPickerCreateOptions.push(normalize(options));
                return {
                    $el: jqStub.createNode("TeamPicker"),
                    setSelectedTeamIds: function() {},
                    destroy: function() {}
                };
            }
        },
        teamManager: {
            create: function(parent, onChange) {
                popupParent = parent;
                popupOnChange = function(nextTeams) {
                    teams = normalize(nextTeams || []);
                    onChange(nextTeams);
                };
                return { close: function() {} };
            }
        }
    });

    var headerNode = root.__el.children[0];
    var teamsButtonNode = headerNode && headerNode.slots[".ujg-ua-teams-btn"];
    var popupHostNode = findChildByHtml(root.__el, "ujg-ua-popup-host");

    assert.match(headerNode.html, /ujg-ua-teams-btn/);
    assert.match(headerNode.html, /Команды/);
    assert.ok(teamsButtonNode, "teams button should have a click binding node");
    assert.ok(popupHostNode, "popup host should be mounted into the container");
    assert.deepEqual(teamPickerSnapshots, [[{ id: "team-1", name: "Alpha", memberKeys: ["u1"] }]]);
    assert.equal(teamPickerCreateOptions[0].emptyMultiLabel, "Выбор команд");

    triggerClick(teamsButtonNode);
    assert.equal(popupParent && popupParent.__el, popupHostNode);
    assert.equal(typeof popupOnChange, "function");

    popupOnChange([{ id: "team-2", name: "Beta", memberKeys: ["u2"] }]);
    assert.deepEqual(teamPickerSnapshots[1], [{ id: "team-2", name: "Beta", memberKeys: ["u2"] }]);
});

test("user-activity team manager button stays visible without multi-user sync", function() {
    var docStub = { __node: { label: "document", children: [], slots: {}, handlers: {} } };
    var jqStub = createRenderingJqueryStub(docStub);
    var mod = loadRendering(jqStub.$, {}, docStub);
    var root = jqStub.createNode("root");
    var popupParent = null;

    function resolvedAlways(value) {
        var d = createDeferred();
        d.always = function(handler) {
            d.done(handler);
            d.fail(handler);
            return d;
        };
        d.resolve(value);
        return d.promise();
    }

    mod.init(root, {
        userPicker: {
            create: function() {
                return {
                    $el: jqStub.createNode("UserPicker"),
                    setFromUrl: function() {
                        return resolvedAlways();
                    },
                    getSelected: function() {
                        return null;
                    }
                };
            }
        },
        dateRangePicker: {
            create: function(onChange) {
                var period = { start: "2026-03-01", end: "2026-03-31" };
                if (onChange) onChange(period);
                return {
                    $el: jqStub.createNode("DateRangePicker"),
                    getPeriod: function() {
                        return period;
                    }
                };
            }
        },
        teamStore: {
            loadTeams: function() {
                return resolvedAlways([]);
            },
            getTeams: function() {
                return [];
            },
            getDisplayNameByKey: function() {
                return {};
            }
        },
        teamPicker: {
            create: function() {
                return {
                    $el: jqStub.createNode("TeamPicker"),
                    setSelectedTeamIds: function() {},
                    destroy: function() {}
                };
            }
        },
        teamManager: {
            create: function(parent) {
                popupParent = parent;
                return { close: function() {} };
            }
        }
    });

    var headerNode = root.__el.children[0];
    var teamsButtonNode = headerNode && headerNode.slots[".ujg-ua-teams-btn"];

    assert.match(headerNode.html, /ujg-ua-teams-btn/);
    assert.ok(teamsButtonNode, "teams button should render with fallback user picker");
    (teamsButtonNode.handlers.click || []).forEach(function(binding) {
        binding.handler.call(teamsButtonNode, { target: teamsButtonNode, type: "click" });
    });
    assert.ok(popupParent, "team manager popup should open without multi-user sync");
});

test("user-activity team sync: URL teams param derives users", function() {
    var docStub = { __node: { label: "document", children: [], slots: {}, handlers: {} } };
    var jqStub = createRenderingJqueryStub(docStub);
    var mod = loadRendering(jqStub.$, {}, docStub);
    var store = {
        getDisplayNameByKey: function() {
            return { u1: "User One" };
        }
    };
    var teams = [{ id: "team-x", memberKeys: ["u1"] }];
    var out = mod.applyStateFromUrlParams({ teams: "team-x" }, teams, store);
    assert.equal(out.mode, "teams");
    assert.deepEqual(normalize(out.teamIds), normalize(["team-x"]));
    assert.deepEqual(normalize(out.users), normalize([{ name: "u1", displayName: "User One", key: "u1" }]));
});

test("user-activity team sync: URL teams param resolves JQL username from queryNameByKey", function() {
    var docStub = { __node: { label: "document", children: [], slots: {}, handlers: {} } };
    var jqStub = createRenderingJqueryStub(docStub);
    var mod = loadRendering(jqStub.$, {}, docStub);
    var store = {
        getDisplayNameByKey: function() {
            return { JIRAUSER12028: "Alice Example" };
        },
        getQueryNameByKey: function() {
            return { JIRAUSER12028: "alice.example" };
        }
    };
    var teams = [{ id: "team-legacy", memberKeys: ["JIRAUSER12028"] }];
    var out = mod.applyStateFromUrlParams({ teams: "team-legacy" }, teams, store);

    assert.equal(out.mode, "teams");
    assert.deepEqual(
        normalize(out.users),
        normalize([{ name: "alice.example", displayName: "Alice Example", key: "JIRAUSER12028" }])
    );
});

test("user-activity team sync: planUrlSerialization prefers teams when users match union", function() {
    var docStub = { __node: { label: "document", children: [], slots: {}, handlers: {} } };
    var jqStub = createRenderingJqueryStub(docStub);
    var mod = loadRendering(jqStub.$, {}, docStub);
    function resolveUser(k) {
        return { name: k, displayName: k, key: k };
    }
    var teams = [{ id: "t1", memberKeys: ["a"] }];
    var users = [{ name: "a", displayName: "a", key: "a" }];
    var plan = mod.planUrlSerialization(users, ["t1"], teams, resolveUser);
    assert.equal(plan.teams, "t1");
    assert.equal(plan.users, "");
    var planManual = mod.planUrlSerialization(
        [
            { name: "a", displayName: "a", key: "a" },
            { name: "extra", displayName: "extra", key: "extra" }
        ],
        ["t1"],
        teams,
        resolveUser
    );
    assert.equal(planManual.teams, "");
    assert.equal(planManual.users, "a,extra");
});

function createRenderingJqueryStub(documentStub) {
    function parseEventName(eventName) {
        var parts = String(eventName || "").split(".");
        return {
            type: parts[0] || "",
            namespace: parts.slice(1).join(".")
        };
    }

    function createElement(label, html) {
        return {
            label: label,
            html: html || "",
            children: [],
            slots: {},
            handlers: {}
        };
    }

    function inferLabel(html) {
        if (/<header\b/.test(html)) return "header";
        if (/<main\b/.test(html)) return "main";
        if (/Лог репозиторной активности/.test(html)) return "Repository Activity Log Error";
        if (/Репозиторная активность/.test(html)) return "Repo Activity Calendar Error";
        if (/Ошибка загрузки/.test(html)) return "Error";
        return "div";
    }

    function wrap(node) {
        return {
            __el: node,
            empty: function() {
                node.children = [];
                node.html = "";
                return this;
            },
            addClass: function() {
                return this;
            },
            append: function(child) {
                node.children.push(child && child.__el ? child.__el : child);
                return this;
            },
            html: function(value) {
                if (value === undefined) return node.html;
                node.html = String(value);
                return this;
            },
            find: function(selector) {
                if (!node.slots[selector]) node.slots[selector] = createElement(selector, selector);
                return wrap(node.slots[selector]);
            },
            on: function(eventName, selector, handler) {
                if (typeof selector === "function") handler = selector;
                var parsed = parseEventName(eventName);
                if (!node.handlers[parsed.type]) node.handlers[parsed.type] = [];
                node.handlers[parsed.type].push({
                    namespace: parsed.namespace,
                    handler: handler
                });
                return this;
            },
            off: function(eventName) {
                var parsed = parseEventName(eventName);
                var handlers = node.handlers[parsed.type] || [];
                node.handlers[parsed.type] = handlers.filter(function(binding) {
                    if (!parsed.namespace) return false;
                    return binding.namespace !== parsed.namespace;
                });
                if (!node.handlers[parsed.type].length) delete node.handlers[parsed.type];
                return this;
            },
            trigger: function(eventName) {
                var parsed = parseEventName(eventName);
                (node.handlers[parsed.type] || []).forEach(function(binding) {
                    binding.handler.call(node, { target: node, type: parsed.type });
                });
                return this;
            }
        };
    }

    function $(input) {
        if (input === documentStub) return wrap(documentStub.__node);
        if (input && input.__el) return input;
        if (typeof input === "string") return wrap(createElement(inferLabel(input), input));
        throw new Error("Unsupported jquery stub input");
    }

    $.Deferred = createDeferred;
    $.when = function() {
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
    };

    return {
        $: $,
        createNode: function(label) {
            return wrap(createElement(label, label));
        }
    };
}

function createRenderingHarness(options) {
    options = options || {};

    var period = options.period || { start: "2026-03-01", end: "2026-03-31" };
    var selectedUser = options.selectedUser || { name: "dtorzok", displayName: "Dima Torzok" };
    var selectedUsers = options.selectedUsers || null;
    var useMultiUserPicker = !!(options.useMultiUserPicker || (selectedUsers && selectedUsers.length));
    var useTeamSync = !!options.useTeamSync;
    var teams = options.teams || [];
    var displayNameByKey = options.displayNameByKey || {};
    var queryNameByKey = options.queryNameByKey || {};
    var windowStub = options.window || null;
    var rawData = options.rawData || {
        issues: [{ id: "1001", key: "CORE-1" }]
    };
    var processed = options.processed || {
        stats: { totalHours: 1 },
        dayMap: {
            "2026-03-08": { worklogs: [], changes: [], issues: ["CORE-1"], totalHours: 1 }
        },
        issueMap: {
            "CORE-1": { key: "CORE-1", summary: "Test task", type: "Task", status: "Done", totalTimeHours: 1 }
        },
        projectMap: {
            CORE: { key: "CORE", totalHours: 1, issueCount: 1, issues: ["CORE-1"] }
        },
        statusTransitions: {}
    };
    var repoFetchResult = options.repoFetchResult || {
        issueDevStatusMap: {
            "CORE-1": { detail: [{ repositories: [] }] }
        }
    };
    var repoActivity = options.repoActivity || {
        items: [{
            type: "commit",
            date: "2026-03-09",
            timestamp: "2026-03-09T10:00:00.000Z",
            repoName: "core-api",
            issueKey: "CORE-1",
            message: "Fix auth",
            hash: "abc123"
        }],
        dayMap: {},
        repoMap: {},
        stats: { totalEvents: 1 }
    };
    var documentStub = {
        __node: {
            label: "document",
            html: "",
            children: [],
            slots: {},
            handlers: {}
        },
        fullscreenElement: null,
        documentElement: {
            requestFullscreen: function() {
                return { catch: function() {} };
            }
        },
        exitFullscreen: function() {
            return { catch: function() {} };
        }
    };
    var jquery = createRenderingJqueryStub(documentStub);
    var events = {
        fetchAllDataCalls: [],
        fetchRepoArgs: null,
        fetchRepoArgsHistory: [],
        processRepoArgs: null,
        processRepoArgsHistory: [],
        unifiedCalendarRenderArgs: null,
        unifiedCalendarRenderArgsHistory: [],
        unifiedCalendarDayUpdates: [],
        repoLogCalls: [],
        aiReportCalls: [],
        aiReportCloses: 0,
        dailyShows: [],
        dailyHides: 0,
        jiraSelect: null,
        repoSelect: null,
        userChange: null,
        loaderUpdates: [],
        clearCacheCalls: 0
    };

    function resolvedPromise(value) {
        var d = createDeferred();
        d.resolve(value);
        return d.promise();
    }

    function rejectedPromise(value) {
        var d = createDeferred();
        d.reject(value);
        return d.promise();
    }

    function shiftOrValue(value, fallback) {
        if (Array.isArray(value)) {
            if (value.length) return value.shift();
            return fallback;
        }
        return value === undefined ? fallback : value;
    }

    var modules = {
        userPicker: useMultiUserPicker ? null : {
            create: function(_, onChange) {
                events.userChange = onChange;
                return {
                    $el: jquery.createNode("UserPicker"),
                    setFromUrl: function() {},
                    getSelected: function() {
                        return selectedUser;
                    }
                };
            }
        },
        multiUserPicker: useMultiUserPicker ? {
            create: function(_, onChange) {
                events.userChange = onChange;
                return {
                    $el: jquery.createNode("MultiUserPicker"),
                    setFromUrl: function() {},
                    getSelectedUsers: function() {
                        return selectedUsers || [];
                    },
                    setSelectedUsers: function(nextUsers, meta) {
                        selectedUsers = normalize(nextUsers || []);
                        onChange(normalize(selectedUsers), normalize(meta || {}));
                    }
                };
            }
        } : null,
        dateRangePicker: {
            create: function(onChange) {
                if (onChange) onChange(period);
                return {
                    $el: jquery.createNode("DateRangePicker"),
                    getPeriod: function() {
                        return period;
                    }
                };
            }
        },
        progressLoader: {
            create: function() {
                return {
                    $el: jquery.createNode("Loader"),
                    show: function() {},
                    update: function(progress) {
                        events.loaderUpdates.push(normalize(progress));
                    }
                };
            }
        },
        api: {
            clearCache: function() {
                events.clearCacheCalls += 1;
            },
            fetchAllData: function(username, startDate, endDate, onProgress) {
                events.fetchAllDataCalls.push({
                    username: username,
                    startDate: startDate,
                    endDate: endDate,
                    hasOnProgress: typeof onProgress === "function"
                });
                if (typeof options.fetchAllDataImpl === "function") {
                    return options.fetchAllDataImpl(username, startDate, endDate, onProgress, events);
                }
                return resolvedPromise(shiftOrValue(options.rawDataQueue, rawData));
            },
            fetchIssueComments: typeof options.fetchIssueCommentsImpl === "function"
                ? function(issueKeys, onProgress) {
                    return options.fetchIssueCommentsImpl(issueKeys, onProgress, events);
                }
                : undefined
        },
        repoApi: {
            fetchRepoActivityForIssues: function(issues, onProgress) {
                events.fetchRepoArgs = {
                    issues: issues,
                    hasOnProgress: typeof onProgress === "function"
                };
                events.fetchRepoArgsHistory.push(events.fetchRepoArgs);
                if (onProgress) onProgress({ phase: "repo-dev-status", loaded: 0, total: (issues || []).length });
                if (typeof options.fetchRepoImpl === "function") {
                    return options.fetchRepoImpl(issues, onProgress, events);
                }
                return options.repoShouldFail
                    ? rejectedPromise(options.repoFailure || "repo failed")
                    : resolvedPromise(shiftOrValue(options.repoFetchResultQueue, repoFetchResult));
            }
        },
        dataProcessor: {
            processData: function(currentRawData) {
                if (typeof options.processDataImpl === "function") {
                    return options.processDataImpl(currentRawData, events);
                }
                return shiftOrValue(options.processedQueue, processed);
            }
        },
        repoDataProcessor: {
            processRepoActivity: function(issueMap, issueDevStatusMap, user, startDate, endDate) {
                events.processRepoArgs = {
                    issueMap: issueMap,
                    issueDevStatusMap: issueDevStatusMap,
                    user: user,
                    startDate: startDate,
                    endDate: endDate
                };
                events.processRepoArgsHistory.push(events.processRepoArgs);
                if (typeof options.processRepoActivityImpl === "function") {
                    return options.processRepoActivityImpl(issueMap, issueDevStatusMap, user, startDate, endDate, events);
                }
                return shiftOrValue(options.repoActivityQueue, repoActivity);
            }
        },
        summaryCards: {
            create: function() {
                return {
                    $el: jquery.createNode("SummaryCards"),
                    render: function() {}
                };
            }
        },
        calendarHeatmap: {
            render: function() {
                return {
                    $el: jquery.createNode("Jira Activity Calendar"),
                    onSelectDate: function(handler) {
                        events.jiraSelect = handler;
                    }
                };
            }
        },
        unifiedCalendar: options.useUnifiedCalendar ? {
            render: function(dayMap, issueMap, selectedUsers, startDate, endDate) {
                events.unifiedCalendarRenderArgs = {
                    dayMap: dayMap,
                    issueMap: issueMap,
                    selectedUsers: selectedUsers,
                    startDate: startDate,
                    endDate: endDate
                };
                events.unifiedCalendarRenderArgsHistory.push(events.unifiedCalendarRenderArgs);
                return {
                    $el: jquery.createNode("Jira Activity Calendar"),
                    onSelectDate: function(handler) {
                        events.jiraSelect = handler;
                    },
                    updateDayCell: function(dateStr, dayData, issueMapArg) {
                        events.unifiedCalendarDayUpdates.push({
                            dateStr: dateStr,
                            dayData: dayData,
                            issueMap: issueMapArg
                        });
                    }
                };
            }
        } : null,
        repoCalendar: {
            render: function() {
                return {
                    $el: jquery.createNode("Repo Activity Calendar"),
                    onSelectDate: function(handler) {
                        events.repoSelect = handler;
                    }
                };
            }
        },
        dailyDetail: {
            create: function() {
                return {
                    $el: jquery.createNode("DailyDetail"),
                    show: function(dateStr, dayData, issueMap, selectedUsers) {
                        events.dailyShows.push({
                            dateStr: dateStr,
                            dayData: dayData,
                            issueMap: issueMap,
                            selectedUsers: selectedUsers
                        });
                    },
                    hide: function() {
                        events.dailyHides += 1;
                    }
                };
            }
        },
        projectBreakdown: {
            create: function() {
                return {
                    $el: jquery.createNode("ProjectBreakdown"),
                    render: function() {}
                };
            }
        },
        issueList: {
            create: function() {
                return {
                    $el: jquery.createNode("IssueList"),
                    render: function() {}
                };
            }
        },
        activityLog: {
            create: function() {
                return {
                    $el: jquery.createNode("Activity Log"),
                    render: function() {}
                };
            }
        },
        repoLog: {
            create: function() {
                return {
                    $el: jquery.createNode("Repository Activity Log"),
                    render: function(activity, selectedDate) {
                        events.repoLogCalls.push({
                            activity: activity,
                            selectedDate: selectedDate
                        });
                    }
                };
            }
        },
        aiReport: {
            open: function(parent, openOptions) {
                events.aiReportCalls.push({
                    parentLabel: parent && parent.__el ? parent.__el.label : "",
                    title: openOptions && openOptions.title || "",
                    context: normalize(openOptions && openOptions.context || {})
                });
                if (typeof options.aiReportOpenImpl === "function") {
                    return options.aiReportOpenImpl(parent, openOptions, events);
                }
                return {
                    close: function() {
                        events.aiReportCloses += 1;
                    }
                };
            }
        },
        teamStore: useTeamSync ? {
            loadTeams: function() {
                return resolvedAlways(teams);
            },
            getTeams: function() {
                return teams;
            },
            getDisplayNameByKey: function() {
                return displayNameByKey;
            },
            getQueryNameByKey: function() {
                return queryNameByKey;
            }
        } : null,
        teamPicker: useTeamSync ? {
            create: function() {
                return {
                    $el: jquery.createNode("TeamPicker"),
                    setSelectedTeamIds: function() {},
                    destroy: function() {}
                };
            }
        } : null
    };
    var rendering = loadRendering(jquery.$, {}, documentStub, windowStub);
    var root = jquery.createNode("root");

    function initInto(targetRoot) {
        rendering.init(targetRoot, modules);
        root = targetRoot;
    }

    function triggerClick(node) {
        (node && node.handlers && node.handlers.click || []).forEach(function(binding) {
            binding.handler.call(node, { target: node, type: "click" });
        });
    }

    initInto(root);

    return {
        events: events,
        get root() {
            return root;
        },
        period: period,
        rawData: rawData,
        processed: processed,
        repoFetchResult: repoFetchResult,
        repoActivity: repoActivity,
        selectedUser: selectedUser,
        documentStub: documentStub,
        mutateSelectedUser: function(nextValues) {
            Object.keys(nextValues || {}).forEach(function(key) {
                selectedUser[key] = nextValues[key];
            });
        },
        triggerUserChange: function(user) {
            if (events.userChange) events.userChange(user);
        },
        clickLoad: function() {
            var header = root.__el.children[0];
            triggerClick(header && header.slots[".ujg-ua-btn-load"]);
        },
        clickAiReport: function() {
            var header = root.__el.children[0];
            triggerClick(header && header.slots[".ujg-ua-btn-ai"]);
        },
        reinit: function() {
            initInto(jquery.createNode("root"));
        },
        getRenderKeydownHandlerCount: function() {
            return (documentStub.__node.handlers.keydown || []).filter(function(binding) {
                return binding.namespace === "ujgUA_rendering";
            }).length;
        },
        getDashboardLabels: function() {
            var main = root.__el.children[1];
            return (main && main.children || []).map(function(child) {
                return child && child.label || "";
            });
        }
    };
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

test("fetchIssueDevStatus reuses request cache for same issue", async function() {
    var $ = createJqueryStub(function(options) {
        if (options.data.dataType === "repository") {
            return resolvedAjax({ detail: [] });
        }
        if (options.data.dataType === "pullrequest") {
            return resolvedAjax({ detail: [] });
        }
        throw new Error("Unexpected ajax call");
    });
    var mod = loadRepoApi($);
    var issue = { id: "1001", key: "SDKU-1" };

    await mod.fetchIssueDevStatus(issue);
    assert.equal($.__calls.length, 2);
    await mod.fetchIssueDevStatus(issue);
    assert.equal($.__calls.length, 2);
});

test("fetchIssueDevStatus issues separate requests per issue id", async function() {
    var $ = createJqueryStub(function(options) {
        if (options.data.dataType === "repository") {
            return resolvedAjax({
                detail: [{ repositories: [{ id: "r-" + options.data.issueId }] }]
            });
        }
        if (options.data.dataType === "pullrequest") {
            return resolvedAjax({ detail: [] });
        }
        throw new Error("Unexpected ajax call");
    });
    var mod = loadRepoApi($);

    await mod.fetchIssueDevStatus({ id: "1", key: "A-1" });
    await mod.fetchIssueDevStatus({ id: "2", key: "A-2" });
    assert.equal($.__calls.length, 4);
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

test("processRepoActivity builds commit and PR events in range", function() {
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
                        url: "https://git/repo/pull-requests/42",
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
    var commitItem = repoActivity.items.find(function(item) {
        return item.type === "commit";
    });
    var prOpenedItem = repoActivity.items.find(function(item) {
        return item.type === "pull_request_opened";
    });
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
    assert.equal(commitItem.commitUrl, "https://git/repo/commits/abc123");
    assert.equal(prOpenedItem.pullRequestUrl, "https://git/repo/pull-requests/42");
    assert.equal(prOpenedItem.pullRequestAuthor, "Dima Torzok");
});

test("processRepoActivity keeps source day keys for offset timestamps", function() {
    var mod = loadRepoDataProcessor();
    var repoActivity = mod.processRepoActivity(
        {
            "CORE-1": { key: "CORE-1", summary: "Timezone task", status: "In Progress" }
        },
        {
            "CORE-1": {
                detail: [{
                    repositories: [{
                        name: "core-api",
                        commits: [{
                            id: "late30",
                            message: "Late 30th commit",
                            authorTimestamp: "2026-03-30T23:30:00-02:00",
                            author: { name: "tz-user", displayName: "Timezone User" }
                        }, {
                            id: "early31",
                            message: "Early 31st commit",
                            authorTimestamp: "2026-03-31T00:10:00-02:00",
                            author: { name: "tz-user", displayName: "Timezone User" }
                        }]
                    }]
                }]
            }
        },
        { name: "tz-user", displayName: "Timezone User" },
        "2026-03-30",
        "2026-03-31"
    );

    assert.equal(repoActivity.items.length, 2);
    assert.equal(repoActivity.items[0].date, "2026-03-30");
    assert.equal(repoActivity.items[1].date, "2026-03-31");
    assert.equal(repoActivity.dayMap["2026-03-30"].items.length, 1);
    assert.equal(repoActivity.dayMap["2026-03-31"].items.length, 1);
});

test("processRepoActivity prefers string source day over numeric commit timestamp", function() {
    var mod = loadRepoDataProcessor();
    var shiftedMs = Date.parse("2026-03-30T23:30:00-02:00");
    var repoActivity = mod.processRepoActivity(
        {
            "CORE-1": { key: "CORE-1", summary: "Timezone task", status: "In Progress" }
        },
        {
            "CORE-1": {
                detail: [{
                    repositories: [{
                        name: "core-api",
                        commits: [{
                            id: "mixed30",
                            message: "Mixed timestamp commit",
                            authorTimestamp: shiftedMs,
                            date: "2026-03-30T23:30:00-02:00",
                            author: { name: "tz-user", displayName: "Timezone User" }
                        }]
                    }]
                }]
            }
        },
        { name: "tz-user", displayName: "Timezone User" },
        "2026-03-30",
        "2026-03-31"
    );

    assert.equal(repoActivity.items.length, 1);
    assert.equal(repoActivity.items[0].date, "2026-03-30");
    assert.equal(repoActivity.dayMap["2026-03-30"].items.length, 1);
});

test("processRepoActivity matches multi-user selection passed as user objects array", function() {
    var mod = loadRepoDataProcessor();
    var repoActivity = mod.processRepoActivity(
        {
            "CORE-2": { key: "CORE-2", summary: "Second task", status: "In Progress" }
        },
        {
            "CORE-2": {
                detail: [{
                    repositories: [{
                        name: "core-api",
                        commits: [{
                            id: "def456",
                            message: "Second author commit",
                            authorTimestamp: "2026-03-08T11:00:00.000Z",
                            author: { displayName: "Alice Example" }
                        }]
                    }]
                }]
            }
        },
        [
            { name: "john.doe", displayName: "John Doe" },
            { key: "jira-alice", displayName: "Alice Example" }
        ],
        "2026-03-01",
        "2026-03-31"
    );

    assert.equal(repoActivity.items.length, 1);
    assert.equal(repoActivity.items[0].type, "commit");
    assert.equal(repoActivity.items[0].author, "Alice Example");
    assert.equal(repoActivity.items[0].issueKey, "CORE-2");
});

test("processRepoActivity hard-open keeps repo events from all authors in range", function() {
    var mod = loadRepoDataProcessor();
    var repoActivity = mod.processRepoActivity(
        {
            "CORE-OPEN": { key: "CORE-OPEN", summary: "Hard open task", status: "In Progress" }
        },
        {
            "CORE-OPEN": {
                detail: [{
                    repositories: [{
                        name: "core-open",
                        commits: [{
                            id: "a1",
                            message: "Alice commit",
                            authorTimestamp: "2026-03-18T09:00:00.000Z",
                            author: { name: "alice", displayName: "Alice Dev" }
                        }, {
                            id: "b1",
                            message: "Bob commit",
                            authorTimestamp: "2026-03-18T10:00:00.000Z",
                            author: { name: "bob", displayName: "Bob Dev" }
                        }]
                    }]
                }]
            }
        },
        { name: "alice", displayName: "Alice Dev" },
        "2026-03-18",
        "2026-03-18"
    );

    assert.deepEqual(normalize(repoActivity.items.map(function(item) {
        return item.author;
    })), ["Alice Dev", "Bob Dev"]);
});

test("processRepoActivity hard-open keeps reviewer activity from all participants in range", function() {
    var mod = loadRepoDataProcessor();
    var repoActivity = mod.processRepoActivity(
        {
            "CORE-OPEN-REV": { key: "CORE-OPEN-REV", summary: "Review stream", status: "In Progress" }
        },
        {
            "CORE-OPEN-REV": {
                detail: [{
                    repositories: [{
                        name: "core-open",
                        url: "https://git/core-open",
                        pullRequests: [{
                            id: "91",
                            title: "Shared review flow",
                            status: "OPEN",
                            createdDate: "2026-03-18T08:00:00.000Z",
                            author: { name: "repo-author", displayName: "Repo Author" },
                            reviewers: [{
                                user: { accountId: "rev-1", displayName: "Reviewer One" },
                                status: "NEEDS_WORK",
                                lastReviewedDate: "2026-03-18T09:00:00.000Z"
                            }, {
                                user: { accountId: "rev-2", displayName: "Reviewer Two" },
                                status: "APPROVED",
                                approvedDate: "2026-03-18T10:00:00.000Z"
                            }]
                        }]
                    }]
                }]
            }
        },
        { name: "alice", displayName: "Alice Dev" },
        "2026-03-18",
        "2026-03-18"
    );

    assert.deepEqual(normalize(repoActivity.items.map(function(item) {
        return item.type;
    })), ["pull_request_opened", "pull_request_needs_work", "pull_request_reviewed"]);
    assert.deepEqual(normalize(repoActivity.items.map(function(item) {
        return item.author;
    })), ["Repo Author", "Reviewer One", "Reviewer Two"]);
});

test("processRepoActivity: repo items include issue summary and status from issueMap", function() {
    var mod = loadRepoDataProcessor();
    var issueMap = {
        "ABC-123": { key: "ABC-123", summary: "Real summary", status: "In Progress" }
    };
    var issueDevStatusMap = {
        "ABC-123": {
            detail: [{
                repositories: [{
                    name: "demo-repo",
                    url: "https://git/demo",
                    commits: [{
                        id: "commit1",
                        message: "Do work",
                        authorTimestamp: "2026-03-15T10:00:00.000Z",
                        author: { displayName: "Commit Author" }
                    }],
                    pullRequests: [{
                        id: "pr1",
                        title: "Review work",
                        status: "OPEN",
                        createdDate: "2026-03-15T11:00:00.000Z",
                        author: { displayName: "Commit Author" },
                        reviewers: []
                    }]
                }]
            }]
        }
    };
    var repoActivity = mod.processRepoActivity(
        issueMap,
        issueDevStatusMap,
        { displayName: "Commit Author" },
        "2026-03-01",
        "2026-03-31"
    );
    var item = repoActivity.items.find(function(i) {
        return i.type === "commit";
    });
    var prItem = repoActivity.items.find(function(i) {
        return i.type === "pull_request_opened";
    });
    assert.ok(item, "expected commit repo item");
    assert.ok(prItem, "expected pull request repo item");
    assert.equal(item.issueSummary, "Real summary");
    assert.equal(item.issueStatus, "In Progress");
    assert.equal(item.author, "Commit Author");
    assert.equal(item.commitUrl, "https://git/demo/commits/commit1");
    assert.equal(prItem.issueSummary, "Real summary");
    assert.equal(prItem.issueStatus, "In Progress");
    assert.equal(prItem.author, "Commit Author");
    assert.equal(prItem.pullRequestUrl, "https://git/demo/pull-requests/pr1");
    assert.equal(prItem.pullRequestAuthor, "Commit Author");
});

test("processRepoActivity hard-open keeps branch commits reviewer decisions and PR author events", function() {
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
    })), ["pull_request_opened", "branch_commit", "pull_request_needs_work", "pull_request_reviewed"]);
    var branchCommit = repoActivity.items.find(function(item) {
        return item.type === "branch_commit";
    });
    var needsWork = repoActivity.items.find(function(item) {
        return item.type === "pull_request_needs_work";
    });
    assert.equal(repoActivity.stats.totalCommits, 1);
    assert.equal(repoActivity.stats.totalPullRequests, 3);
    assert.equal(repoActivity.stats.totalBranchesTouched, 1);
    assert.equal(repoActivity.dayMap["2026-03-09"].countsByType.branch_commit, 1);
    assert.equal(repoActivity.repoMap["core-web"].branches.length, 1);
    assert.equal(branchCommit.commitUrl, "https://git/core-web/commits/def456");
    assert.equal(needsWork.pullRequestAuthor, "someone-else");
    assert.deepEqual(normalize(needsWork.reviewerDetails), [
        { name: "Dima Torzok", status: "NEEDS_WORK" },
        { name: "Dima Torzok", status: "APPROVED" }
    ]);
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

test("processRepoActivity keeps branch_update when there are no branch commits in range", function() {
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

test("unified calendar Jira line renders issue link with target blank", function() {
    var mod = loadUnifiedCalendar(createHtmlJqueryStub());
    var start = new Date("2026-03-02T00:00:00.000Z");
    var end = new Date("2026-03-08T23:59:59.000Z");
    var dayMap = {
        "2026-03-08": {
            totalHours: 1,
            allWorklogs: [{
                timestamp: "2026-03-08T10:00:00.000Z",
                issueKey: "CORE-1",
                author: { displayName: "Test User" },
                timeSpentHours: 1,
                comment: ""
            }],
            allChanges: [],
            allComments: [],
            repoItems: []
        }
    };
    var issueMap = { "CORE-1": { key: "CORE-1", project: "CORE", summary: "T" } };
    var users = [{ name: "u1", displayName: "User One" }];
    var out = mod.render(dayMap, issueMap, users, start, end);
    var html = out.$el.html();
    assert.match(html, /<a href="https:\/\/jira\.example\.com\/browse\/CORE-1"[^>]*target="_blank"/);
    assert.match(html, />CORE-1<\/a>/);
});

test("unified calendar Jira line shows summary and done-state tooltip", function() {
    var mod = loadUnifiedCalendar(createHtmlJqueryStub());
    var start = new Date("2026-03-02T00:00:00.000Z");
    var end = new Date("2026-03-08T23:59:59.000Z");
    var out = mod.render({
        "2026-03-08": {
            totalHours: 1,
            allWorklogs: [{
                timestamp: "2026-03-08T10:00:00.000Z",
                issueKey: "CORE-1",
                author: { displayName: "Test User" },
                timeSpentHours: 1,
                comment: ""
            }],
            allChanges: [],
            allComments: [],
            repoItems: []
        }
    }, {
        "CORE-1": { key: "CORE-1", project: "CORE", summary: "Closed task summary", status: "Done" }
    }, [{ name: "u1", displayName: "User One" }], start, end);
    var html = out.$el.html();

    assert.match(html, /Closed task summary/);
    assert.match(html, /class="[^"]*ujg-ua-issue-key[^"]*ujg-ua-issue-done/);
    assert.doesNotMatch(html, /class="[^"]*ujg-ua-issue-summary[^"]*ujg-ua-issue-done/);
    assert.match(html, /title="Текущий статус: Done"/);
});

test("unified calendar Jira worklog shows worked day loggedAt and late marker", function() {
    var mod = loadUnifiedCalendar(createHtmlJqueryStub());
    var start = new Date("2026-03-30T00:00:00");
    var end = new Date("2026-04-05T23:59:59");
    var out = mod.render({
        "2026-04-02": {
            totalHours: 4,
            users: { u1: { totalHours: 4 } },
            allWorklogs: [{
                issueKey: "LAG-1",
                timestamp: "2026-04-02T09:00:00",
                started: "2026-04-02T09:00:00",
                created: "2026-04-03T08:00:00",
                workedDayKey: "2026-04-02",
                loggedAt: "2026-04-03T08:00:00",
                isLate: true,
                lagDurationHoursRaw: 8,
                lagScoreHours: 1.33,
                author: { name: "u1", displayName: "Ivan Ivanov" },
                timeSpentHours: 4,
                comment: ""
            }],
            allChanges: [],
            allComments: [],
            repoItems: []
        }
    }, {
        "LAG-1": { key: "LAG-1", summary: "Lag task", status: "In Progress" }
    }, [{ name: "u1", displayName: "Ivan Ivanov" }], start, end);
    var html = out.$el.html();

    assert.match(html, /за 02\.04/);
    assert.match(html, /внесено 03\.04 08:00/);
    assert.match(html, /отставание 8ч/);
    assert.match(html, /ujg-ua-worklog-late/);
});

test("unified calendar repo line shows issue link status badge and summary meta", function() {
    var mod = loadUnifiedCalendar(createHtmlJqueryStub());
    var start = new Date("2026-03-02T00:00:00.000Z");
    var end = new Date("2026-03-08T23:59:59.000Z");
    var dayMap = {
        "2026-03-04": {
            totalHours: 0,
            allWorklogs: [],
            allChanges: [],
            allComments: [],
            repoItems: [{
                type: "commit",
                timestamp: "2026-03-04T11:00:00.000Z",
                authorName: "Repo Dev",
                issueKey: "CORE-9",
                issueStatus: "In Progress",
                message: "fix: typo",
                issueSummary: "Different summary text for task"
            }]
        }
    };
    var users = [{ name: "u1", displayName: "User One" }];
    var issueMap = {
        "CORE-9": {
            key: "CORE-9",
            summary: "Different summary text for task",
            status: "In Progress",
            changelogs: [{
                field: "status",
                toString: "In Progress",
                timestamp: "2026-03-04T10:15:00"
            }]
        }
    };
    var out = mod.render(dayMap, issueMap, users, start, end);
    var html = out.$el.html();
    assert.match(html, /<a href="https:\/\/jira\.example\.com\/browse\/CORE-9"[^>]*target="_blank"/);
    assert.match(html, /ujg-ua-inline-status/);
    assert.match(html, /ujg-ua-status-active/);
    assert.match(html, /In Progress/);
    assert.match(html, /title="Текущий статус: In Progress \| Установлен: 04\.03\.2026 10:15"/);
    assert.match(html, /Different summary text for task/);
});

test("unified calendar repo line renders clickable commit hash link", function() {
    var mod = loadUnifiedCalendar(createHtmlJqueryStub());
    var start = new Date("2026-03-02T00:00:00.000Z");
    var end = new Date("2026-03-08T23:59:59.000Z");
    var out = mod.render({
        "2026-03-04": {
            totalHours: 0,
            allWorklogs: [],
            allChanges: [],
            allComments: [],
            repoItems: [{
                type: "commit",
                timestamp: "2026-03-04T11:00:00.000Z",
                authorName: "Repo Dev",
                issueKey: "CORE-9",
                commitUrl: "https://bitbucket/repo-a/commits/557bbc52515",
                hash: "557bbc52515",
                message: "fix: typo"
            }]
        }
    }, {}, [{ name: "u1", displayName: "User One" }], start, end);
    var html = out.$el.html();

    assert.match(html, /https:\/\/bitbucket\/repo-a\/commits\/557bbc52515/);
    assert.match(html, /ujg-ua-commit-link/);
    assert.match(html, />557bbc5251<\/a>/);
});

test("unified calendar hard-open shows full repo author label", function() {
    var mod = loadUnifiedCalendar(createHtmlJqueryStub());
    var start = new Date("2026-03-02T00:00:00.000Z");
    var end = new Date("2026-03-08T23:59:59.000Z");
    var out = mod.render({
        "2026-03-04": {
            totalHours: 0,
            allWorklogs: [],
            allChanges: [],
            allComments: [],
            repoItems: [{
                type: "commit",
                timestamp: "2026-03-04T11:00:00.000Z",
                authorName: "Ivanov Ivan Petrovich",
                issueKey: "CORE-OPEN",
                message: "full author visible"
            }]
        }
    }, {}, [{ name: "alice", displayName: "Alice Dev" }], start, end);
    var html = out.$el.html();

    assert.match(html, /Ivanov Ivan Petrovich/);
    assert.doesNotMatch(html, /class="ujg-ua-author">Ivanov<\/span>/);
});

test("unified calendar repo line keeps status without issue key and no dangling gap", function() {
    var mod = loadUnifiedCalendar(createHtmlJqueryStub());
    var start = new Date("2026-03-02T00:00:00.000Z");
    var end = new Date("2026-03-08T23:59:59.000Z");
    var dayMap = {
        "2026-03-04": {
            totalHours: 0,
            allWorklogs: [],
            allChanges: [],
            allComments: [],
            repoItems: [{
                type: "commit",
                timestamp: "2026-03-04T11:00:00.000Z",
                authorName: "Alice Dev",
                issueStatus: "Blocked",
                message: "Refactor escape path"
            }]
        }
    };
    var users = [{ name: "u1", displayName: "User One" }];
    var out = mod.render(dayMap, {}, users, start, end);
    var html = out.$el.html();

    assert.match(html, /<span class="ujg-ua-inline-status[^"]*ujg-ua-status-active[^"]*"[^>]*>Blocked<\/span>/);
    assert.match(html, /<span class="text-\[9px\] text-muted-foreground">Коммит<\/span> <span class="ujg-ua-author">Alice Dev<\/span> <span class="ujg-ua-inline-status[^"]*ujg-ua-status-active[^"]*"[^>]*>Blocked<\/span>/);
    assert.match(html, /<span class="[^"]*ujg-ua-repo-msg[^"]*">Refactor escape path<\/span>/);
    assert.doesNotMatch(html, /Alice Dev<\/span>\s{2,}<span class="ujg-ua-inline-status"/);
});

test("unified calendar weekend column stays after filter narrows away weekend hours", function() {
    var $ = createHtmlJqueryStub();
    var mod = loadUnifiedCalendar($);
    var start = new Date("2026-03-02T00:00:00.000Z");
    var end = new Date("2026-03-08T23:59:59.000Z");
    var users = [
        { name: "alice", displayName: "Alice Wonder", accountId: "acc-alice" },
        { name: "bob", displayName: "Bob Smith", accountId: "acc-bob" }
    ];
    var dayMap = {
        "2026-03-04": {
            totalHours: 2,
            users: { alice: { totalHours: 2 }, bob: { totalHours: 0 } },
            allWorklogs: [{
                timestamp: "2026-03-04T09:00:00.000Z",
                issueKey: "CORE-W",
                author: { displayName: "Alice Wonder", accountId: "acc-alice" },
                timeSpentHours: 2,
                comment: "WEEKDAY_ALICE"
            }],
            allChanges: [],
            allComments: [],
            repoItems: []
        },
        "2026-03-07": {
            totalHours: 1,
            users: { alice: { totalHours: 0 }, bob: { totalHours: 1 } },
            allWorklogs: [{
                timestamp: "2026-03-07T10:00:00.000Z",
                issueKey: "CORE-SAT",
                author: { displayName: "Bob Smith", accountId: "acc-bob" },
                timeSpentHours: 1,
                comment: "SAT_BOB_ONLY"
            }],
            allChanges: [],
            allComments: [],
            repoItems: []
        }
    };
    var out = mod.render(dayMap, {
        "CORE-W": { key: "CORE-W", summary: "W", project: "CORE" },
        "CORE-SAT": { key: "CORE-SAT", summary: "S", project: "CORE" }
    }, users, start, end);
    assert.match(out.$el.html(), /<span>Сб<\/span>/);
    assert.match(out.$el.html(), /SAT_BOB_ONLY/);

    out.$el.find('button[data-ua-cal-user-idx="1"]').trigger("click");
    var html1 = out.$el.html();
    assert.match(html1, /<span>Сб<\/span>/, "Saturday column must stay from raw dataset layout");
    assert.doesNotMatch(html1, /SAT_BOB_ONLY/);
    assert.match(html1, /WEEKDAY_ALICE/);
});

test("unified calendar render-time user filter toggles subset recomputes hours", function() {
    var $ = createHtmlJqueryStub();
    var mod = loadUnifiedCalendar($);
    var start = new Date("2026-03-02T00:00:00.000Z");
    var end = new Date("2026-03-08T23:59:59.000Z");
    var users = [
        { name: "alice", displayName: "Alice Wonder", accountId: "acc-alice" },
        { name: "bob", displayName: "Bob Smith", accountId: "acc-bob" }
    ];
    var dayMap = {
        "2026-03-04": {
            totalHours: 5,
            users: {
                alice: { totalHours: 2 },
                bob: { totalHours: 3 }
            },
            allWorklogs: [
                {
                    timestamp: "2026-03-04T09:00:00.000Z",
                    issueKey: "CORE-A",
                    author: { displayName: "Alice Wonder", accountId: "acc-alice" },
                    timeSpentHours: 2,
                    comment: "ALICE_TASK"
                },
                {
                    timestamp: "2026-03-04T10:00:00.000Z",
                    issueKey: "CORE-B",
                    author: { displayName: "Bob Smith", accountId: "acc-bob" },
                    timeSpentHours: 3,
                    comment: "BOB_TASK"
                }
            ],
            allChanges: [],
            allComments: [],
            repoItems: [{
                type: "commit",
                timestamp: "2026-03-04T11:00:00.000Z",
                authorName: "Bob Smith",
                message: "BOB_REPO_ONLY"
            }]
        }
    };
    var out = mod.render(dayMap, { "CORE-A": { key: "CORE-A", summary: "A" }, "CORE-B": { key: "CORE-B", summary: "B" } }, users, start, end);
    var html0 = out.$el.html();
    assert.match(html0, /ALICE_TASK/);
    assert.match(html0, /BOB_TASK/);
    assert.match(html0, /BOB_REPO_ONLY/);
    assert.match(html0, />5ч</);
    assert.match(html0, /Alice Wonder/);
    assert.match(html0, /Bob Smith/);

    out.$el.find('button[data-ua-cal-user-idx="1"]').trigger("click");
    var html1 = out.$el.html();
    assert.match(html1, /ALICE_TASK/);
    assert.doesNotMatch(html1, /BOB_TASK/);
    assert.doesNotMatch(html1, /BOB_REPO_ONLY/);
    assert.match(html1, />2ч</);
    assert.doesNotMatch(html1, />5ч</);
});

test("unified calendar hard-open while all users active stranger visible until narrowed", function() {
    var $ = createHtmlJqueryStub();
    var mod = loadUnifiedCalendar($);
    var start = new Date("2026-03-02T00:00:00.000Z");
    var end = new Date("2026-03-08T23:59:59.000Z");
    var users = [
        { name: "alice", displayName: "Alice Wonder", accountId: "acc-alice" },
        { name: "bob", displayName: "Bob Smith", accountId: "acc-bob" }
    ];
    var dayMap = {
        "2026-03-04": {
            totalHours: 1,
            users: { alice: { totalHours: 1 }, bob: { totalHours: 0 } },
            allWorklogs: [{
                timestamp: "2026-03-04T09:00:00.000Z",
                issueKey: "CORE-A",
                author: { displayName: "Alice Wonder", accountId: "acc-alice" },
                timeSpentHours: 1,
                comment: ""
            }],
            allChanges: [],
            allComments: [],
            repoItems: [{
                type: "commit",
                timestamp: "2026-03-04T12:00:00.000Z",
                authorName: "Outsider Not In Dashboard",
                message: "STRANGER_COMMIT"
            }]
        }
    };
    var out = mod.render(dayMap, { "CORE-A": { key: "CORE-A", summary: "S" } }, users, start, end);
    var h0 = out.$el.html();
    assert.match(h0, /STRANGER_COMMIT/);
    assert.match(h0, /Outsider Not In Dashboard/);

    out.$el.find('button[data-ua-cal-user-idx="1"]').trigger("click");
    var h1 = out.$el.html();
    assert.doesNotMatch(h1, /STRANGER_COMMIT/);
    assert.doesNotMatch(h1, /Outsider Not In Dashboard/);
    assert.match(h1, /CORE-A/);
});

test("unified calendar updateDayCell rerenders updated day content", function() {
    var mod = loadUnifiedCalendar(createHtmlJqueryStub());
    var start = new Date("2026-03-02T00:00:00.000Z");
    var end = new Date("2026-03-08T23:59:59.000Z");
    var users = [{ name: "u1", displayName: "User One" }];
    var out = mod.render({}, {}, users, start, end);

    assert.equal(typeof out.updateDayCell, "function");
    assert.doesNotMatch(out.$el.html(), /CORE-7|Updated cell summary/);

    out.updateDayCell("2026-03-04", {
        totalHours: 3,
        users: {
            u1: { totalHours: 3 }
        },
        allWorklogs: [{
            timestamp: "2026-03-04T10:00:00.000Z",
            issueKey: "CORE-7",
            author: { displayName: "User One" },
            timeSpentHours: 3,
            comment: "Investigated incremental render"
        }],
        allChanges: [],
        allComments: [],
        repoItems: []
    }, {
        "CORE-7": { key: "CORE-7", project: "CORE", summary: "Updated cell summary", status: "Open" }
    });

    var html = out.$el.html();
    assert.match(html, /data-date="2026-03-04"/);
    assert.match(html, /CORE-7/);
    assert.match(html, /Updated cell summary/);
    assert.match(html, /3ч/);
});

test("presentation consistency: repo author links and issue status align across calendar and day detail", function() {
    var dateStr = "2026-03-05";
    var issueKey = "PRES-9";
    var longSummary = "FULL_TITLE_" + new Array(45).join("abcdefghij");
    var summaryPattern = new RegExp('ujg-ua-detail-issue-summary[^>]*>' + escapeRegExp(longSummary) + '<\\/span>');
    var calendarSummaryPattern = new RegExp('ujg-ua-repo-summary[^>]*>' + escapeRegExp(longSummary) + '<\\/span>');
    assert.ok(longSummary.length > 120);
    var start = new Date("2026-03-01T00:00:00.000Z");
    var end = new Date("2026-03-09T23:59:59.000Z");
    var daySlice = {
        totalHours: 0,
        allWorklogs: [],
        allChanges: [],
        allComments: [],
        repoItems: [{
            type: "commit",
            timestamp: dateStr + "T16:00:00.000Z",
            author: "Ivanov Ivan Petrovich",
            issueKey: issueKey,
            issueStatus: "QA",
            message: "fix: align presentation",
            issueSummary: "fallback only"
        }]
    };
    var dayMap = {};
    dayMap[dateStr] = daySlice;
    var issueMap = {};
    issueMap[issueKey] = {
        key: issueKey,
        summary: longSummary,
        status: "In Progress",
        changelogs: [{
            field: "status",
            toString: "In Progress",
            timestamp: "2026-03-04T10:15:00"
        }]
    };

    var users = [{ name: "u1", displayName: "User One" }];
    var modCal = loadUnifiedCalendar(createHtmlJqueryStub());
    var calHtml = modCal.render(dayMap, issueMap, users, start, end).$el.html();

    var detailHtml = "";
    var $stub = function() {
        return {
            html: function(h) {
                if (arguments.length) {
                    detailHtml = h;
                    return this;
                }
                return detailHtml;
            },
            slideDown: function() {
                return this;
            },
            slideUp: function() {
                return this;
            },
            find: function() {
                return { on: function() {} };
            }
        };
    };
    loadDailyDetail($stub).create().show(dateStr, daySlice, issueMap, []);

    assert.match(calHtml, /class="ujg-ua-author">Ivanov Ivan Petrovich<\/span>/);
    assert.match(detailHtml, /class="ujg-ua-author">Ivanov Ivan Petrovich<\/span>/);
    assert.match(calHtml, /jira\.example\.com\/browse\/PRES-9/);
    assert.match(detailHtml, /jira\.example\.com\/browse\/PRES-9/);
    assert.match(calHtml, /ujg-ua-inline-status[^"]*ujg-ua-status-active[^"]*"[^>]*>In Progress</);
    assert.match(detailHtml, /ujg-ua-inline-status[^"]*ujg-ua-status-active[^"]*"[^>]*>In Progress</);
    assert.match(calHtml, /title="Текущий статус: In Progress \| Установлен: 04\.03\.2026 10:15"/);
    assert.match(detailHtml, /title="Текущий статус: In Progress \| Установлен: 04\.03\.2026 10:15"/);
    assert.match(calHtml, calendarSummaryPattern);
    assert.doesNotMatch(calHtml, /ujg-ua-repo-summary[^>]*>fallback only<\/span>/);
    assert.match(detailHtml, summaryPattern);
    assert.doesNotMatch(detailHtml, /ujg-ua-detail-issue-summary[^>]*>[^<]*…[^<]*<\/span>/);
    assert.match(calHtml, /Коммит/);
    assert.match(detailHtml, /Коммит/);
});

test("activity log renders issue link in column and expanded issue link", function() {
    var stub = createActivityLogJqueryStub();
    var mod = loadActivityLog(stub.$, {}, stub.doc);
    var log = mod.create();
    log.render({
        issueMap: {
            "CORE-1": {
                key: "CORE-1",
                summary: "Task summary",
                worklogs: [{
                    timestamp: "2026-03-08T10:00:00.000Z",
                    date: "2026-03-08",
                    author: { displayName: "Author One" },
                    timeSpentHours: 1,
                    comment: "note"
                }],
                changelogs: []
            }
        }
    });
    var h = stub.getTbodyHtml();
    assert.match(h, /<a href="https:\/\/jira\.example\.com\/browse\/CORE-1"[^>]*target="_blank"/);
    stub.clickExpandFirstRow();
    h = stub.getTbodyHtml();
    assert.match(h, /<a href="https:\/\/jira\.example\.com\/browse\/CORE-1"[^>]*target="_blank"/);
});

test("repo log renders issue link in issue column and details panel", function() {
    var mod = loadRepoLog(createHtmlJqueryStub());
    var log = mod.create();
    log.render({
        items: [{
            type: "commit",
            date: "2026-03-08",
            timestamp: "2026-03-08T10:00:00.000Z",
            repoName: "core-api",
            branchName: "main",
            issueKey: "CORE-1",
            message: "Fix auth",
            hash: "abc123"
        }]
    }, null);
    var html = log.$el.html();
    assert.match(html, /<a href="https:\/\/jira\.example\.com\/browse\/CORE-1"[^>]*target="_blank"/);
    log.$el.find('button[data-idx="0"]').trigger("click");
    html = log.$el.html();
    assert.match(html, /<a href="https:\/\/jira\.example\.com\/browse\/CORE-1"[^>]*target="_blank"/);
});

test("repo log renders rows for repository events", function() {
    var mod = loadRepoLog(createHtmlJqueryStub());
    var log = mod.create();

    log.render({
        items: [{
            type: "commit",
            date: "2026-03-08",
            timestamp: "2026-03-08T10:00:00.000Z",
            repoName: "core-api",
            branchName: "main",
            issueKey: "CORE-1",
            message: "Fix auth",
            hash: "abc123"
        }]
    }, null);

    assert.match(log.$el.html(), /core-api/);
    assert.match(log.$el.html(), /abc123/);
    assert.equal(countMatches(log.$el.html(), /<tr class="[^"]*ujg-ua-repo-row\b/g), 1);
});

test("repo log renders clickable commit link in row and details", function() {
    var mod = loadRepoLog(createHtmlJqueryStub());
    var log = mod.create();

    log.render({
        items: [{
            type: "commit",
            date: "2026-03-08",
            timestamp: "2026-03-08T10:00:00.000Z",
            repoName: "core-api",
            branchName: "main",
            issueKey: "CORE-1",
            message: "Fix auth",
            hash: "557bbc52515",
            commitUrl: "https://bitbucket/repo-a/commits/557bbc52515"
        }]
    }, null);

    assert.match(log.$el.html(), /https:\/\/bitbucket\/repo-a\/commits\/557bbc52515/);
    assert.match(log.$el.html(), /ujg-ua-commit-link/);
    assert.match(log.$el.html(), />557bbc5251<\/a>/);

    log.$el.find('button[data-idx="0"]').trigger("click");
    assert.match(log.$el.html(), /https:\/\/bitbucket\/repo-a\/commits\/557bbc52515/);
});

test("repo log filters rendered rows by selectedDate", function() {
    var mod = loadRepoLog(createHtmlJqueryStub());
    var log = mod.create();

    log.render({
        items: [{
            type: "commit",
            date: "2026-03-08",
            timestamp: "2026-03-08T10:00:00.000Z",
            repoName: "core-api",
            branchName: "main",
            issueKey: "CORE-1",
            message: "Fix auth",
            hash: "abc123"
        }, {
            type: "pull_request_merged",
            date: "2026-03-09",
            timestamp: "2026-03-09T12:00:00.000Z",
            repoName: "core-ui",
            branchName: "feature/ui",
            issueKey: "CORE-2",
            title: "Refine layout",
            status: "MERGED",
            hash: "def456"
        }]
    }, "2026-03-08");

    assert.match(log.$el.html(), /core-api/);
    assert.doesNotMatch(log.$el.html(), /core-ui/);
    assert.equal(countMatches(log.$el.html(), /<tr class="[^"]*ujg-ua-repo-row\b/g), 1);
});

test("repo log expands a row with author reviewers and raw details", function() {
    var mod = loadRepoLog(createHtmlJqueryStub());
    var log = mod.create();

    log.render({
        items: [{
            type: "pull_request_reviewed",
            date: "2026-03-09",
            timestamp: "2026-03-09T12:00:00.000Z",
            repoName: "core-api",
            branchName: "feature/auth",
            issueKey: "CORE-3",
            title: "Review auth",
            status: "APPROVED",
            author: "Dima Torzok",
            reviewers: ["Reviewer A", "Reviewer B"],
            raw: {
                id: "42",
                source: "bitbucket"
            }
        }]
    }, null);

    assert.doesNotMatch(log.$el.html(), /Reviewer A/);

    log.$el.find('button[data-idx="0"]').trigger("click");

    assert.match(log.$el.html(), /Reviewer A, Reviewer B/);
    assert.match(log.$el.html(), /Dima Torzok/);
    assert.match(log.$el.html(), /&quot;source&quot;:&quot;bitbucket&quot;/);
});

test("repo log keeps selected type filter visible after rerender", function() {
    var mod = loadRepoLog(createHtmlJqueryStub());
    var log = mod.create();

    log.render({
        items: [{
            type: "commit",
            date: "2026-03-08",
            timestamp: "2026-03-08T10:00:00.000Z",
            repoName: "core-api",
            issueKey: "CORE-1",
            message: "Fix auth"
        }, {
            type: "pull_request_reviewed",
            date: "2026-03-08",
            timestamp: "2026-03-08T12:00:00.000Z",
            repoName: "core-api",
            issueKey: "CORE-1",
            title: "Review auth"
        }]
    }, null);

    log.$el.find('select[data-filter="type"]').val("PR reviewed").trigger("change");

    assert.equal(countMatches(log.$el.html(), /<tr class="[^"]*ujg-ua-repo-row\b/g), 1);
    assert.match(log.$el.html(), /<option value="PR reviewed" selected="selected">PR reviewed<\/option>/);
});

test("repo log text filter matches visible type label", function() {
    var mod = loadRepoLog(createHtmlJqueryStub());
    var log = mod.create();

    log.render({
        items: [{
            type: "commit",
            date: "2026-03-08",
            timestamp: "2026-03-08T10:00:00.000Z",
            repoName: "core-api",
            issueKey: "CORE-1",
            message: "Fix auth"
        }, {
            type: "pull_request_reviewed",
            date: "2026-03-08",
            timestamp: "2026-03-08T12:00:00.000Z",
            repoName: "core-api",
            issueKey: "CORE-1",
            title: "Review auth"
        }]
    }, null);

    log.$el.find('input[data-filter="text"]').val("pr reviewed").trigger("input");

    assert.equal(countMatches(log.$el.html(), /<tr class="[^"]*ujg-ua-repo-row\b/g), 1);
    assert.match(log.$el.html(), /Review auth/);
    assert.doesNotMatch(log.$el.html(), /Fix auth/);
});

test("repo log uses localized shell and visible labels closer to activity log", function() {
    var mod = loadRepoLog(createHtmlJqueryStub());
    var log = mod.create();

    log.render({
        items: [{
            type: "commit",
            date: "2026-03-08",
            timestamp: "2026-03-08T10:00:00.000Z",
            repoName: "core-api",
            branchName: "main",
            issueKey: "CORE-1",
            message: "Fix auth",
            hash: "abc123"
        }]
    }, null);

    assert.match(log.$el.html(), /Лог репозиторной активности/);
    assert.match(log.$el.html(), />Дата</);
    assert.match(log.$el.html(), />Время</);
    assert.match(log.$el.html(), />Репозиторий</);
    assert.match(log.$el.html(), />Ветка</);
    assert.match(log.$el.html(), />Задача</);
    assert.match(log.$el.html(), />Тип</);
    assert.match(log.$el.html(), />Описание</);
    assert.match(log.$el.html(), />Статус\/хеш</);
    assert.match(log.$el.html(), /Репозиторий<\/span><select data-filter="repo"/);
    assert.match(log.$el.html(), /Описание<\/span><input data-filter="text"/);
});

test("repo log type filter supports custom config label outside built-in map", function() {
    var mod = loadRepoLog(createHtmlJqueryStub(), {}, {
        REPO_ACTIVITY_LABELS: {
            custom_deploy_event: "Деплой"
        }
    });
    var log = mod.create();

    log.render({
        items: [{
            type: "custom_deploy_event",
            date: "2026-03-08",
            timestamp: "2026-03-08T10:00:00.000Z",
            repoName: "core-api",
            issueKey: "CORE-1",
            title: "Deploy service"
        }, {
            type: "commit",
            date: "2026-03-08",
            timestamp: "2026-03-08T11:00:00.000Z",
            repoName: "core-api",
            issueKey: "CORE-1",
            message: "Fix auth"
        }]
    }, null);

    log.$el.find('select[data-filter="type"]').val("Деплой").trigger("change");

    assert.equal(countMatches(log.$el.html(), /<tr class="[^"]*ujg-ua-repo-row\b/g), 1);
    assert.match(log.$el.html(), /Deploy service/);
    assert.match(log.$el.html(), /<option value="Деплой" selected="selected">Деплой<\/option>/);
});

test("repo log renders filters directly inside table header cells", function() {
    var mod = loadRepoLog(createHtmlJqueryStub());
    var log = mod.create();

    log.render({
        items: [{
            type: "pull_request_reviewed",
            date: "2026-03-08",
            timestamp: "2026-03-08T12:00:00.000Z",
            repoName: "core-api",
            branchName: "feature/auth",
            issueKey: "CORE-1",
            title: "Review auth"
        }]
    }, null);

    assert.match(log.$el.html(), /<th[^>]*>.*Репозиторий<\/span><select data-filter="repo"/);
    assert.match(log.$el.html(), /<th[^>]*>.*Ветка<\/span><select data-filter="branch"/);
    assert.match(log.$el.html(), /<th[^>]*>.*Задача<\/span><select data-filter="issue"/);
    assert.match(log.$el.html(), /<th[^>]*>.*Тип<\/span><select data-filter="type"/);
    assert.match(log.$el.html(), /<th[^>]*>.*Описание<\/span><input data-filter="text"/);
});

test("repo log expand exposes explicit pull request metadata fields", function() {
    var mod = loadRepoLog(createHtmlJqueryStub());
    var log = mod.create();

    log.render({
        items: [{
            type: "pull_request_reviewed",
            date: "2026-03-09",
            timestamp: "2026-03-09T12:00:00.000Z",
            repoName: "core-api",
            branchName: "feature/auth",
            issueKey: "CORE-3",
            title: "Review auth",
            status: "APPROVED",
            author: "Dima Torzok",
            reviewers: ["Reviewer A", "Reviewer B"],
            raw: {
                id: "42",
                source: "bitbucket",
                title: "Review auth",
                status: "APPROVED"
            }
        }]
    }, null);

    log.$el.find('button[data-idx="0"]').trigger("click");

    assert.match(log.$el.html(), /PR ID:/);
    assert.match(log.$el.html(), /42/);
    assert.match(log.$el.html(), /PR заголовок:/);
    assert.match(log.$el.html(), /Review auth/);
    assert.match(log.$el.html(), /PR статус:/);
    assert.match(log.$el.html(), /APPROVED/);
    assert.match(log.$el.html(), /Ревьюеры:/);
    assert.match(log.$el.html(), /Reviewer A, Reviewer B/);
});

test("repo config exposes repo activity labels", function() {
    var config = loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "config.js"), {});

    assert.ok(config.REPO_ACTIVITY_LABELS);
    assert.equal(config.REPO_ACTIVITY_LABELS.commit, "Коммит");
    assert.equal(config.REPO_ACTIVITY_LABELS.pull_request_merged, "PR влит");
});

test("daily detail normalize merges worklog change comment repo with unified fields", function() {
    var mod = loadDailyDetail();
    var dayData = {
        worklogs: [{
            issueKey: "A-1",
            timestamp: "2026-03-15T10:00:00.000Z",
            author: { displayName: "John Doe" },
            timeSpentHours: 1,
            comment: "c1"
        }],
        changes: [{
            issueKey: "A-1",
            field: "status",
            timestamp: "2026-03-15T11:00:00.000Z",
            author: { displayName: "Jane" },
            fromString: "Open",
            toString: "Done"
        }],
        allComments: [{
            issueKey: "A-2",
            timestamp: "2026-03-15T12:00:00.000Z",
            author: { displayName: "Bob" },
            body: "hello"
        }],
        repoItems: [{
            issueKey: "A-2",
            timestamp: "2026-03-15T13:00:00.000Z",
            message: "commit msg",
            type: "commit",
            authorName: "Dev",
            repoName: "core-api",
            branchName: "main",
            hash: "557bbc52515",
            commitUrl: "https://bitbucket/core-api/commits/557bbc52515",
            issueSummary: "From repo only",
            issueStatus: "In Progress"
        }]
    };
    var issueMap = {
        "A-1": { key: "A-1", summary: "First issue", status: "Open" },
        "A-2": { key: "A-2", summary: "Second from map", status: "QA" }
    };
    var actions = mod.normalizeDayActions(dayData, issueMap);
    assert.equal(actions.length, 4);

    function pick(type) {
        return actions.filter(function(a) {
            return a.type === type;
        });
    }

    var wl = pick("worklog")[0];
    assert.equal(wl.issueKey, "A-1");
    assert.equal(wl.issueSummary, "First issue");
    assert.equal(wl.issueStatus, "Open");
    assert.equal(wl.author.displayName, "John Doe");
    assert.ok(String(wl.timestamp).length > 0);

    var ch = pick("change")[0];
    assert.equal(ch.issueSummary, "First issue");
    assert.equal(ch.author.displayName, "Jane");

    var cm = pick("comment")[0];
    assert.equal(cm.issueKey, "A-2");
    assert.equal(cm.issueSummary, "Second from map");
    assert.equal(cm.issueStatus, "QA");

    var rp = pick("repo")[0];
    assert.equal(rp.issueKey, "A-2");
    assert.equal(rp.issueSummary, "Second from map");
    assert.equal(rp.author.displayName, "Dev");
    assert.ok(String(rp.timestamp).length > 0);
    assert.equal(rp.repoName, "core-api");
    assert.equal(rp.branchName, "main");
    assert.equal(rp.hash, "557bbc52515");
    assert.equal(rp.commitUrl, "https://bitbucket/core-api/commits/557bbc52515");
});

test("daily detail normalize includes single-user comments array", function() {
    var mod = loadDailyDetail();
    var actions = mod.normalizeDayActions({
        comments: [{
            issueKey: "A-3",
            created: "2026-03-15T15:00:00.000Z",
            author: { displayName: "Solo User" },
            body: "single user comment"
        }]
    }, {
        "A-3": { key: "A-3", summary: "Single-user issue", status: "In Progress" }
    });

    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, "comment");
    assert.equal(actions[0].issueKey, "A-3");
    assert.equal(actions[0].issueSummary, "Single-user issue");
    assert.equal(actions[0].issueStatus, "In Progress");
    assert.equal(actions[0].author.displayName, "Solo User");
    assert.equal(actions[0].timestamp, "2026-03-15T15:00:00.000Z");
});

test("daily detail undated splits repo rows without timestamp", function() {
    var mod = loadDailyDetail();
    var dayData = {
        repoItems: [{
            issueKey: "R-1",
            message: "no time",
            authorName: "Alice",
            issueSummary: "S",
            issueStatus: "Open"
        }, {
            issueKey: "R-2",
            timestamp: "2026-03-15T14:00:00.000Z",
            message: "with time"
        }]
    };
    var actions = mod.normalizeDayActions(dayData, {});
    var split = mod.splitTimedAndUntimed(actions);
    assert.equal(split.undated.length, 1);
    assert.equal(split.timed.length, 1);
    assert.equal(split.undated[0].issueKey, "R-1");
    assert.equal(split.timed[0].issueKey, "R-2");
});

test("daily detail issue view renders separate Bitbucket commit and pull request sections", function() {
    var lastHtml = "";
    var $stub = function() {
        return {
            html: function(h) {
                if (arguments.length) {
                    lastHtml = h;
                    return this;
                }
                return lastHtml;
            },
            slideDown: function() {
                return this;
            },
            slideUp: function() {
                return this;
            },
            find: function() {
                return { on: function() {} };
            }
        };
    };
    var panel = loadDailyDetail($stub).create();
    panel.show("2026-03-17", {
        repoItems: [{
            type: "commit",
            timestamp: "2026-03-17T10:00:00.000Z",
            authorName: "Commit Dev",
            repoName: "evo-manager",
            branchName: "feature/16781",
            issueKey: "EVOSCADA-16781",
            issueSummary: "Update metadata",
            issueStatus: "In Progress",
            message: "EVOSCADA-16781 up version 3.10.36",
            hash: "557bbc52515",
            commitUrl: "https://bitbucket/evo-manager/commits/557bbc52515"
        }, {
            type: "pull_request_merged",
            timestamp: "2026-03-17T12:00:00.000Z",
            author: { displayName: "Reviewer One" },
            pullRequestAuthor: "Alice Dev",
            pullRequestId: "229",
            pullRequestUrl: "https://bitbucket/evo-manager/pull-requests/229",
            title: "EVOSCADA-16781 evo-manager -> 3.10.36",
            status: "MERGED",
            reviewerDetails: [
                { name: "Reviewer One", status: "APPROVED" },
                { name: "Reviewer Two", status: "APPROVED" }
            ],
            repoName: "evo-manager",
            branchName: "master",
            issueKey: "EVOSCADA-16781",
            issueSummary: "Update metadata",
            issueStatus: "In Progress"
        }]
    }, {
        "EVOSCADA-16781": {
            key: "EVOSCADA-16781",
            summary: "Update metadata",
            status: "In Progress"
        }
    }, []);

    assert.match(lastHtml, /Bitbucket за день/);
    assert.match(lastHtml, /Коммиты/);
    assert.match(lastHtml, /Pull requests/);
    assert.match(lastHtml, /https:\/\/bitbucket\/evo-manager\/commits\/557bbc52515/);
    assert.match(lastHtml, /https:\/\/bitbucket\/evo-manager\/pull-requests\/229/);
    assert.match(lastHtml, /Автор PR/);
    assert.match(lastHtml, /Кто сделал/);
    assert.match(lastHtml, /Reviewer One \(APPROVED\)/);
    assert.match(lastHtml, /Alice Dev/);
});

test("daily detail groupActionsByUser matches key name and displayName variants", function() {
    var mod = loadDailyDetail();
    var grouped = mod.groupActionsByUser([{
        issueKey: "A-1",
        type: "worklog",
        author: { key: "john.key", name: "jdoe", displayName: "John Doe" }
    }, {
        issueKey: "A-2",
        type: "comment",
        author: { key: "mary.key", name: "mary", displayName: "Mary Major" }
    }], [{
        key: "john.key"
    }, {
        displayName: "  mary major  "
    }]);

    var issueKeys = Object.keys(grouped).reduce(function(list, userKey) {
        return list.concat(grouped[userKey].map(function(action) {
            return action.issueKey;
        }));
    }, []).sort();

    assert.deepEqual(issueKeys, ["A-1", "A-2"]);
});

test("daily detail summary shows full issue title in panel html", function() {
    var lastHtml = "";
    var $stub = function() {
        return {
            html: function(h) {
                if (arguments.length) {
                    lastHtml = h;
                    return this;
                }
                return lastHtml;
            },
            slideDown: function() {
                return this;
            },
            slideUp: function() {
                return this;
            },
            find: function() {
                return { on: function() {} };
            }
        };
    };
    var mod = loadDailyDetail($stub);
    var longSummary = new Array(30).join("ABCDEFGHIJ");
    assert.ok(longSummary.length > 200);
    var panel = mod.create();
    panel.show("2026-03-15", {
        worklogs: [{
            issueKey: "LONG-1",
            timestamp: "2026-03-15T09:00:00.000Z",
            author: { displayName: "U" },
            timeSpentHours: 0.5,
            comment: ""
        }]
    }, {
        "LONG-1": { key: "LONG-1", summary: longSummary, status: "Open" }
    });
    assert.ok(lastHtml.indexOf(longSummary) !== -1, "expected full summary in rendered html");
    assert.equal(lastHtml.indexOf("…"), -1, "ellipsis should not appear in day-detail panel for issue title");
});

test("daily detail action line includes full author issue key and summary before comment label", function() {
    var lastHtml = "";
    var $stub = function() {
        return {
            html: function(h) {
                if (arguments.length) {
                    lastHtml = h;
                    return this;
                }
                return lastHtml;
            },
            slideDown: function() {
                return this;
            },
            slideUp: function() {
                return this;
            },
            find: function() {
                return { on: function() {} };
            }
        };
    };
    var panel = loadDailyDetail($stub).create();
    panel.show("2026-03-15", {
        comments: [{
            issueKey: "ORD-1",
            created: "2026-03-15T10:05:00.000Z",
            author: { displayName: "Alice Reviewer" },
            body: "comment body"
        }]
    }, {
        "ORD-1": { key: "ORD-1", summary: "Ordered task summary", status: "In Progress" }
    }, []);

    assert.match(
        lastHtml,
        /<span class="ujg-ua-time">\d{2}:\d{2}<\/span>\s*<span class="ujg-ua-author">Alice Reviewer<\/span>\s*<a [^>]*>ORD-1<\/a>\s*<span [^>]*class="[^"]*ujg-ua-issue-summary[^"]*"[^>]*>Ordered task summary<\/span>\s*— Комментарий/
    );
});

test("daily detail worklog shows worked day loggedAt and late marker", function() {
    var lastHtml = "";
    var $stub = function() {
        return {
            html: function(h) {
                if (arguments.length) {
                    lastHtml = h;
                    return this;
                }
                return lastHtml;
            },
            slideDown: function() {
                return this;
            },
            slideUp: function() {
                return this;
            },
            find: function() {
                return { on: function() {} };
            }
        };
    };
    loadDailyDetail($stub).create().show("2026-04-02", {
        worklogs: [{
            issueKey: "LAG-1",
            timestamp: "2026-04-02T09:00:00",
            started: "2026-04-02T09:00:00",
            created: "2026-04-03T08:00:00",
            workedDayKey: "2026-04-02",
            loggedAt: "2026-04-03T08:00:00",
            isLate: true,
            lagDurationHoursRaw: 8,
            lagScoreHours: 1.33,
            author: { displayName: "Ivan Ivanov" },
            timeSpentHours: 4
        }]
    }, {
        "LAG-1": { key: "LAG-1", summary: "Lag task", status: "In Progress" }
    }, []);

    assert.match(lastHtml, /Worklog 4ч/);
    assert.match(lastHtml, /за 02\.04/);
    assert.match(lastHtml, /внесено 03\.04 08:00/);
    assert.match(lastHtml, /отставание 8ч/);
});

function createDayDetailInteractiveStub() {
    var lastHtml = "";
    var handlers = Object.create(null);
    function el() {
        return {
            html: function(h) {
                if (arguments.length) {
                    handlers = Object.create(null);
                    lastHtml = String(h);
                    return this;
                }
                return lastHtml;
            },
            slideDown: function() {
                return this;
            },
            slideUp: function() {
                return this;
            },
            find: function(sel) {
                return {
                    on: function(ev, fn) {
                        if (!handlers[sel]) handlers[sel] = [];
                        handlers[sel].push(fn);
                    }
                };
            }
        };
    }
    var root = el();
    function $(input) {
        if (typeof input === "string" && /^\s*</.test(input)) {
            return root;
        }
        throw new Error("day detail jquery stub: unsupported " + input);
    }
    return {
        $: $,
        getHtml: function() {
            return lastHtml;
        },
        triggerClick: function(sel, mockThis) {
            (handlers[sel] || []).forEach(function(fn) {
                fn.call(mockThis || {}, { target: mockThis || {} });
            });
        },
        triggerChange: function(sel, mockThis) {
            (handlers[sel] || []).forEach(function(fn) {
                fn.call(mockThis || {}, { target: mockThis || {} });
            });
        }
    };
}

test("day detail defaults to issue mode", function() {
    var stub = createDayDetailInteractiveStub();
    var mod = loadDailyDetail(function(s) {
        return stub.$(s);
    });
    var panel = mod.create();
    var users = [
        { name: "u1", key: "u1", displayName: "Alice" },
        { name: "u2", key: "u2", displayName: "Bob" }
    ];
    panel.show("2026-03-15", {
        worklogs: [{
            issueKey: "X-1",
            timestamp: "2026-03-15T10:00:00.000Z",
            author: { name: "u1", displayName: "Alice" },
            timeSpentHours: 1,
            comment: ""
        }]
    }, { "X-1": { key: "X-1", summary: "T1", status: "Open" } }, users);

    var html = stub.getHtml();
    assert.match(html, /По задачам/);
    assert.equal(html.indexOf("ujg-ua-detail-timeline-grid"), -1, "issue mode should not render team timeline grid");
    assert.ok(html.indexOf("ujg-ua-detail-issue") !== -1, "issue mode should render issue groups");
});

test("day detail toggle switches to team view", function() {
    var stub = createDayDetailInteractiveStub();
    var mod = loadDailyDetail(function(s) {
        return stub.$(s);
    });
    var panel = mod.create();
    var users = [
        { name: "u1", key: "u1", displayName: "Alice" },
        { name: "u2", key: "u2", displayName: "Bob" }
    ];
    panel.show("2026-03-15", {
        worklogs: [{
            issueKey: "X-1",
            timestamp: "2026-03-15T10:00:00.000Z",
            author: { name: "u1", displayName: "Alice" },
            timeSpentHours: 1,
            comment: ""
        }]
    }, { "X-1": { key: "X-1", summary: "T1", status: "Open" } }, users);

    stub.triggerClick(".ujg-ua-detail-mode-team", {
        getAttribute: function(n) {
            return n === "data-ua-detail-mode" ? "team" : null;
        }
    });

    var html = stub.getHtml();
    assert.ok(html.indexOf("ujg-ua-detail-timeline-grid") !== -1, "team mode should render timeline grid");
});

test("day detail hard-open shows filter bar and keeps extra authors when all dashboard users enabled", function() {
    var stub = createDayDetailInteractiveStub();
    var mod = loadDailyDetail(function(s) {
        return stub.$(s);
    });
    var panel = mod.create();

    panel.show("2026-03-18", {
        allWorklogs: [{
            issueKey: "CORE-1",
            timestamp: "2026-03-18T09:00:00.000Z",
            author: { name: "alice", displayName: "Alice Dev" },
            timeSpentHours: 1,
            comment: "alice action"
        }, {
            issueKey: "CORE-2",
            timestamp: "2026-03-18T10:00:00.000Z",
            author: { name: "bob", displayName: "Bob Dev" },
            timeSpentHours: 1,
            comment: "bob action"
        }],
        allChanges: [],
        allComments: [],
        repoItems: []
    }, {
        "CORE-1": { key: "CORE-1", summary: "Alice task", status: "Open" },
        "CORE-2": { key: "CORE-2", summary: "Bob task", status: "Open" }
    }, [{ name: "alice", displayName: "Alice Dev" }]);

    var html = stub.getHtml();
    assert.match(html, /Alice task/);
    assert.match(html, /Bob task/);
    assert.match(html, /Alice Dev/);
    assert.match(html, /Bob Dev/);
    assert.ok(html.indexOf("ujg-ua-cal-user-filter-bar") !== -1, "expected day-detail user filter bar");
    assert.ok(html.indexOf("data-ua-detail-user-idx") !== -1);
});

test("day detail hard-open issue view narrows when a dashboard user is toggled off", function() {
    var stub = createDayDetailInteractiveStub();
    var mod = loadDailyDetail(function(s) {
        return stub.$(s);
    });
    var panel = mod.create();
    var users = [
        { name: "u1", key: "u1", displayName: "Alice" },
        { name: "u2", key: "u2", displayName: "Bob" }
    ];
    panel.show("2026-03-15", {
        worklogs: [{
            issueKey: "X-1",
            timestamp: "2026-03-15T10:00:00.000Z",
            author: { name: "u1", displayName: "Alice" },
            timeSpentHours: 1,
            comment: "alice only"
        }, {
            issueKey: "X-2",
            timestamp: "2026-03-15T11:00:00.000Z",
            author: { name: "u2", displayName: "Bob" },
            timeSpentHours: 1,
            comment: "bob only"
        }]
    }, {
        "X-1": { key: "X-1", summary: "Alice task", status: "Open" },
        "X-2": { key: "X-2", summary: "Bob task", status: "Open" }
    }, users);

    var html = stub.getHtml();
    assert.ok(html.indexOf("ujg-ua-cal-user-filter-bar") !== -1);
    assert.match(html, /Alice task/);
    assert.match(html, /Bob task/);

    stub.triggerClick("button.ujg-ua-cal-user-filter", {
        getAttribute: function(n) {
            return n === "data-ua-detail-user-idx" ? "1" : null;
        }
    });

    html = stub.getHtml();
    assert.match(html, /Alice task/);
    assert.equal(html.indexOf("Bob task"), -1);
});

test("day detail hard-open team view shows one column when other dashboard user toggled off", function() {
    var stub = createDayDetailInteractiveStub();
    var mod = loadDailyDetail(function(s) {
        return stub.$(s);
    });
    var panel = mod.create();
    var users = [
        { name: "u1", key: "u1", displayName: "Alice" },
        { name: "u2", key: "u2", displayName: "Bob" }
    ];
    panel.show("2026-03-15", {
        worklogs: [{
            issueKey: "X-1",
            timestamp: "2026-03-15T10:00:00.000Z",
            author: { name: "u1", displayName: "Alice" },
            timeSpentHours: 1,
            comment: ""
        }, {
            issueKey: "X-2",
            timestamp: "2026-03-15T11:00:00.000Z",
            author: { name: "u2", displayName: "Bob" },
            timeSpentHours: 1,
            comment: ""
        }]
    }, {
        "X-1": { key: "X-1", summary: "Alice task", status: "Open" },
        "X-2": { key: "X-2", summary: "Bob task", status: "Open" }
    }, users);

    stub.triggerClick("button.ujg-ua-cal-user-filter", {
        getAttribute: function(n) {
            return n === "data-ua-detail-user-idx" ? "1" : null;
        }
    });
    stub.triggerClick(".ujg-ua-detail-mode-team", {
        getAttribute: function() {
            return "team";
        }
    });

    var html = stub.getHtml();
    var cols = html.match(/<div class="ujg-ua-detail-user-col">/g);
    assert.equal(cols ? cols.length : 0, 1, "expected one user column when Bob filtered out");
});

test("day detail hard-open keeps repo activity visible by authorMeta", function() {
    var stub = createDayDetailInteractiveStub();
    var mod = loadDailyDetail(function(s) {
        return stub.$(s);
    });
    var panel = mod.create();
    var users = [
        { name: "u1", key: "u1", displayName: "Alice" },
        { name: "u2", key: "u2", displayName: "Bob" }
    ];
    panel.show("2026-03-31", {
        repoItems: [{
            type: "commit",
            timestamp: "2026-03-31T09:10:00.000Z",
            issueKey: "REP-1",
            issueSummary: "Repo task",
            issueStatus: "In Progress",
            author: "alice.repo",
            authorMeta: { name: "u1", displayName: "Alice" },
            repoName: "core-api",
            message: "Repo change visible for Alice",
            hash: "abc123def456",
            commitUrl: "https://git/repo/commits/abc123def456"
        }]
    }, {
        "REP-1": { key: "REP-1", summary: "Repo task", status: "In Progress" }
    }, users);

    var html = stub.getHtml();
    assert.match(html, /Bitbucket за день/);
    assert.match(html, /Repo change visible for Alice/);
    assert.match(html, /core-api/);

    stub.triggerClick("button.ujg-ua-cal-user-filter", {
        getAttribute: function(n) {
            return n === "data-ua-detail-user-idx" ? "0" : null;
        }
    });

    html = stub.getHtml();
    assert.equal(html.indexOf("Bitbucket за день"), -1, "repo day section hidden when Alice toggled off");
});

test("day detail render-time user filter issue view narrows jira and repo rows", function() {
    var stub = createDayDetailInteractiveStub();
    var mod = loadDailyDetail(function(s) {
        return stub.$(s);
    });
    var panel = mod.create();
    var users = [
        { name: "u1", key: "u1", displayName: "Alice" },
        { name: "u2", key: "u2", displayName: "Bob" }
    ];
    panel.show("2026-04-01", {
        worklogs: [{
            issueKey: "J-1",
            timestamp: "2026-04-01T08:00:00.000Z",
            author: { name: "u1", displayName: "Alice" },
            timeSpentHours: 1,
            comment: "alice wl"
        }],
        repoItems: [{
            type: "commit",
            timestamp: "2026-04-01T09:00:00.000Z",
            issueKey: "J-2",
            author: { name: "u2", displayName: "Bob" },
            repoName: "svc-bob",
            message: "bob commit msg",
            hash: "deadbeef",
            commitUrl: "https://git/c/deadbeef"
        }]
    }, {
        "J-1": { key: "J-1", summary: "Alice issue", status: "Open" },
        "J-2": { key: "J-2", summary: "Bob issue", status: "Open" }
    }, users);

    var html = stub.getHtml();
    assert.match(html, /Alice issue/);
    assert.match(html, /bob commit msg/);
    assert.match(html, /svc-bob/);

    stub.triggerClick("button.ujg-ua-cal-user-filter", {
        getAttribute: function(n) {
            return n === "data-ua-detail-user-idx" ? "1" : null;
        }
    });
    html = stub.getHtml();
    assert.match(html, /Alice issue/);
    assert.equal(html.indexOf("bob commit msg"), -1);
    assert.equal(html.indexOf("svc-bob"), -1);
});

test("day detail team view render-time user filter keeps columns for visible authors only", function() {
    var stub = createDayDetailInteractiveStub();
    var mod = loadDailyDetail(function(s) {
        return stub.$(s);
    });
    var panel = mod.create();
    var users = [
        { name: "u1", key: "u1", displayName: "Alice" },
        { name: "u2", key: "u2", displayName: "Bob" }
    ];
    panel.show("2026-04-02", {
        worklogs: [{
            issueKey: "TV-1",
            timestamp: "2026-04-02T10:00:00.000Z",
            author: { name: "u1", displayName: "Alice" },
            timeSpentHours: 1,
            comment: ""
        }, {
            issueKey: "TV-2",
            timestamp: "2026-04-02T11:00:00.000Z",
            author: { name: "u2", displayName: "Bob" },
            timeSpentHours: 1,
            comment: ""
        }]
    }, {
        "TV-1": { key: "TV-1", summary: "A", status: "Open" },
        "TV-2": { key: "TV-2", summary: "B", status: "Open" }
    }, users);

    stub.triggerClick(".ujg-ua-detail-mode-team", {
        getAttribute: function() {
            return "team";
        }
    });
    var html = stub.getHtml();
    var cols = html.match(/<div class="ujg-ua-detail-user-col">/g);
    assert.equal(cols ? cols.length : 0, 2);

    stub.triggerClick("button.ujg-ua-cal-user-filter", {
        getAttribute: function(n) {
            return n === "data-ua-detail-user-idx" ? "0" : null;
        }
    });
    html = stub.getHtml();
    cols = html.match(/<div class="ujg-ua-detail-user-col">/g);
    assert.equal(cols ? cols.length : 0, 1, "only visible authors get timeline columns");
    assert.match(html, /TV-2/);
});

test("day detail render-time user filter resets to all enabled when opening another day", function() {
    var stub = createDayDetailInteractiveStub();
    var mod = loadDailyDetail(function(s) {
        return stub.$(s);
    });
    var panel = mod.create();
    var users = [
        { name: "u1", key: "u1", displayName: "Alice" },
        { name: "u2", key: "u2", displayName: "Bob" }
    ];
    panel.show("2026-04-03", {
        worklogs: [{
            issueKey: "R1-1",
            timestamp: "2026-04-03T10:00:00.000Z",
            author: { name: "u1", displayName: "Alice" },
            timeSpentHours: 1,
            comment: ""
        }, {
            issueKey: "R1-2",
            timestamp: "2026-04-03T11:00:00.000Z",
            author: { name: "u2", displayName: "Bob" },
            timeSpentHours: 1,
            comment: ""
        }]
    }, {
        "R1-1": { key: "R1-1", summary: "Day1 A", status: "Open" },
        "R1-2": { key: "R1-2", summary: "Day1 B", status: "Open" }
    }, users);

    stub.triggerClick("button.ujg-ua-cal-user-filter", {
        getAttribute: function(n) {
            return n === "data-ua-detail-user-idx" ? "1" : null;
        }
    });
    assert.equal(stub.getHtml().indexOf("Day1 B"), -1);

    panel.show("2026-04-04", {
        worklogs: [{
            issueKey: "R2-1",
            timestamp: "2026-04-04T10:00:00.000Z",
            author: { name: "u1", displayName: "Alice" },
            timeSpentHours: 1,
            comment: ""
        }, {
            issueKey: "R2-2",
            timestamp: "2026-04-04T11:00:00.000Z",
            author: { name: "u2", displayName: "Bob" },
            timeSpentHours: 1,
            comment: ""
        }]
    }, {
        "R2-1": { key: "R2-1", summary: "Day2 A", status: "Open" },
        "R2-2": { key: "R2-2", summary: "Day2 B", status: "Open" }
    }, users);

    var html = stub.getHtml();
    assert.match(html, /Day2 A/);
    assert.match(html, /Day2 B/);
});

test("day detail team view builds one column per active author", function() {
    var stub = createDayDetailInteractiveStub();
    var mod = loadDailyDetail(function(s) {
        return stub.$(s);
    });
    var panel = mod.create();
    var users = [
        { name: "u1", key: "u1", displayName: "Alice" },
        { name: "u2", key: "u2", displayName: "Bob" },
        { name: "u3", key: "u3", displayName: "Carol" }
    ];
    panel.show("2026-03-16", {
        worklogs: [
            {
                issueKey: "A-1",
                timestamp: "2026-03-16T09:00:00.000Z",
                author: { name: "u1", displayName: "Alice" },
                timeSpentHours: 0.5,
                comment: ""
            },
            {
                issueKey: "A-2",
                timestamp: "2026-03-16T11:00:00.000Z",
                author: { name: "u2", displayName: "Bob" },
                timeSpentHours: 0.5,
                comment: ""
            }
        ]
    }, {
        "A-1": { key: "A-1", summary: "S1", status: "Open" },
        "A-2": { key: "A-2", summary: "S2", status: "Open" }
    }, users);

    stub.triggerClick(".ujg-ua-detail-mode-team", {
        getAttribute: function() {
            return "team";
        }
    });

    var html = stub.getHtml();
    assert.ok(html.indexOf("data-ua-detail-user-idx=\"2\"") !== -1, "Carol listed in day-detail filter bar");
    var iCols = html.indexOf("ujg-ua-detail-user-cols");
    assert.ok(iCols !== -1);
    assert.doesNotMatch(html.slice(iCols), /Carol/, "timeline columns only for authors with visible actions");
    var cols = html.match(/<div class="ujg-ua-detail-user-col">/g);
    assert.equal(cols ? cols.length : 0, 2, "expected two user columns for two active authors");
});

test("day detail team view keeps separate columns for duplicate visible identifiers", function() {
    var mod = loadDailyDetail();
    var selectedUsers = [
        { key: "u1", name: "shared-login", displayName: "Alex Same" },
        { key: "u2", name: "shared-login", displayName: "Alex Same" }
    ];
    var model = mod.buildTimelineModel([{
        issueKey: "COL-1",
        timestamp: "2026-03-16T09:00:00.000Z",
        type: "worklog",
        author: { key: "u1", name: "shared-login", displayName: "Alex Same" },
        timeSpentHours: 1
    }, {
        issueKey: "COL-2",
        timestamp: "2026-03-16T10:00:00.000Z",
        type: "worklog",
        author: { key: "u2", name: "shared-login", displayName: "Alex Same" },
        timeSpentHours: 1
    }], selectedUsers, "2026-03-16");

    assert.equal(model.users.length, 2);
    assert.equal(Object.keys(model.columns).length, 2);
    assert.deepEqual(
        normalize(model.users.map(function(user) {
            return model.columns[user.id].items.map(function(item) {
                return item.issueKey;
            });
        })),
        [["COL-1"], ["COL-2"]]
    );
});

test("day detail team timeline stacks near-simultaneous events at distinct vertical offsets", function() {
    var mod = loadDailyDetail();
    var users = [{ name: "u1", key: "u1", displayName: "Alice" }];
    var model = mod.buildTimelineModel([
        {
            issueKey: "STK-1",
            timestamp: "2026-03-16T10:00:00.000Z",
            type: "worklog",
            author: { name: "u1", displayName: "Alice" },
            timeSpentHours: 0.5,
            comment: ""
        },
        {
            issueKey: "STK-2",
            timestamp: "2026-03-16T10:00:00.000Z",
            type: "comment",
            author: { name: "u1", displayName: "Alice" },
            body: "same instant"
        }
    ], users, "2026-03-16");
    var html = mod.renderTeamTimeline(model);
    var tops = [];
    var re = /ujg-ua-detail-timeline-card" style="top:(\d+)px/g;
    var m;
    while ((m = re.exec(html)) !== null) tops.push(parseInt(m[1], 10));
    assert.ok(tops.length >= 2, "expected two timeline cards");
    assert.notEqual(tops[0], tops[1], "stacked cards must not share the same top offset");
});

test("day detail team timeline grid stretches when stacked cards need extra height", function() {
    var mod = loadDailyDetail();
    var users = [{ name: "u1", key: "u1", displayName: "Alice" }];
    var model = mod.buildTimelineModel([
        {
            issueKey: "STR-1",
            timestamp: "2026-03-16T10:00:00.000Z",
            type: "worklog",
            author: { name: "u1", displayName: "Alice" },
            timeSpentHours: 0.5,
            comment: ""
        },
        {
            issueKey: "STR-2",
            timestamp: "2026-03-16T10:00:00.000Z",
            type: "comment",
            author: { name: "u1", displayName: "Alice" },
            body: "same instant"
        },
        {
            issueKey: "STR-3",
            timestamp: "2026-03-16T10:00:00.000Z",
            type: "change",
            author: { name: "u1", displayName: "Alice" },
            fromString: "Open",
            toString: "In Progress"
        }
    ], users, "2026-03-16");
    var html = mod.renderTeamTimeline(model);
    var match = /ujg-ua-detail-timeline-grid relative" style="min-height:(\d+)px/.exec(html);

    assert.ok(match, "expected timeline grid height style");
    assert.ok(parseInt(match[1], 10) > 470, "expected stretched grid height above base size");
});

test("day detail team timeline matches author by accountId like repo-data-processor", function() {
    var mod = loadDailyDetail();
    var selectedUsers = [{ accountId: "jira-cloud-acc-99", displayName: "Cloud User" }];
    var model = mod.buildTimelineModel([{
        issueKey: "ACC-1",
        timestamp: "2026-03-16T12:00:00.000Z",
        type: "worklog",
        author: { accountId: "jira-cloud-acc-99" },
        timeSpentHours: 1,
        comment: ""
    }], selectedUsers, "2026-03-16");

    assert.equal(model.unmatched.length, 0);
    assert.equal(model.users.length, 1);
    assert.equal(model.columns[model.users[0].id].items.length, 1);
    assert.equal(model.columns[model.users[0].id].items[0].issueKey, "ACC-1");
});

test("day detail team view leaves ambiguous author unmatched instead of mislabeling", function() {
    var mod = loadDailyDetail();
    var selectedUsers = [
        { key: "u1", name: "u1", displayName: "Alex Same" },
        { key: "u2", name: "u2", displayName: "Alex Same" }
    ];
    var model = mod.buildTimelineModel([{
        issueKey: "AMB-1",
        timestamp: "2026-03-16T09:30:00.000Z",
        type: "comment",
        author: { displayName: "Alex Same" },
        body: "ambiguous"
    }], selectedUsers, "2026-03-16");

    assert.deepEqual(
        normalize(model.users.map(function(user) {
            return model.columns[user.id].items.length;
        })),
        [0, 0]
    );
    assert.equal(model.unmatched.length, 1);
    assert.equal(model.unmatched[0].issueKey, "AMB-1");
});

test("day detail team view puts untimed actions in separate block", function() {
    var stub = createDayDetailInteractiveStub();
    var mod = loadDailyDetail(function(s) {
        return stub.$(s);
    });
    var panel = mod.create();
    var users = [{ name: "u1", key: "u1", displayName: "Alice" }];
    panel.show("2026-03-17", {
        worklogs: [
            {
                issueKey: "U-1",
                timestamp: "",
                author: { name: "u1", displayName: "Alice" },
                timeSpentHours: 0.25,
                comment: "no time"
            },
            {
                issueKey: "U-2",
                timestamp: "2026-03-17T14:00:00.000Z",
                author: { name: "u1", displayName: "Alice" },
                timeSpentHours: 1,
                comment: ""
            }
        ]
    }, {
        "U-1": { key: "U-1", summary: "Untimed", status: "Open" },
        "U-2": { key: "U-2", summary: "Timed", status: "Open" }
    }, users);

    stub.triggerClick(".ujg-ua-detail-mode-team", {
        getAttribute: function() {
            return "team";
        }
    });

    var html = stub.getHtml();
    assert.ok(html.indexOf("ujg-ua-detail-timeline-grid") !== -1, "expected team timeline in team view");
    var iUnd = html.indexOf("ujg-ua-detail-undated");
    assert.ok(iUnd !== -1, "expected undated section in team view");
    assert.ok(html.indexOf("Без точного времени") !== -1);
    assert.ok(html.slice(iUnd).indexOf("Untimed") !== -1 || html.indexOf("U-1") !== -1);
});

test("day detail mode persists when opening another day", function() {
    var stub = createDayDetailInteractiveStub();
    var mod = loadDailyDetail(function(s) {
        return stub.$(s);
    });
    var panel = mod.create();
    var users = [{ name: "u1", key: "u1", displayName: "Alice" }];
    panel.show("2026-03-18", {
        worklogs: [{
            issueKey: "D-1",
            timestamp: "2026-03-18T10:00:00.000Z",
            author: { name: "u1", displayName: "Alice" },
            timeSpentHours: 1,
            comment: ""
        }]
    }, { "D-1": { key: "D-1", summary: "Day1", status: "Open" } }, users);

    stub.triggerClick(".ujg-ua-detail-mode-team", {
        getAttribute: function() {
            return "team";
        }
    });
    assert.ok(stub.getHtml().indexOf("ujg-ua-detail-timeline-grid") !== -1);

    panel.show("2026-03-19", {
        worklogs: [{
            issueKey: "D-2",
            timestamp: "2026-03-19T11:00:00.000Z",
            author: { name: "u1", displayName: "Alice" },
            timeSpentHours: 0.5,
            comment: ""
        }]
    }, { "D-2": { key: "D-2", summary: "Day2", status: "Open" } }, users);

    assert.ok(stub.getHtml().indexOf("ujg-ua-detail-timeline-grid") !== -1, "team mode should persist across days");
});

test("user activity data processor preserves Jira timestamps and authors for worklogs and status changes", function() {
    var mod = loadUserActivityDataProcessor();
    var rawData = {
        issues: [{
            key: "CORE-1",
            fields: {
                project: { key: "CORE", name: "Core" },
                status: { name: "Done" },
                issuetype: { name: "Task" },
                summary: "Test task"
            }
        }],
        details: {
            "CORE-1": {
                worklogs: [{
                    started: "2026-03-30T08:15:00.000Z",
                    timeSpentSeconds: 7200,
                    comment: "Worked",
                    author: { name: "u1", displayName: "Ivan Ivanov" }
                }],
                changelog: [{
                    created: "2026-03-30T10:45:00.000Z",
                    author: { name: "u1", displayName: "Ivan Ivanov" },
                    items: [{
                        field: "status",
                        fromString: "Open",
                        toString: "Done"
                    }]
                }]
            }
        }
    };

    var single = mod.processData(rawData, "u1", "2026-03-01", "2026-03-31");
    assert.equal(single.issueMap["CORE-1"].worklogs[0].started, "2026-03-30T08:15:00.000Z");
    assert.equal(single.issueMap["CORE-1"].worklogs[0].timestamp, "2026-03-30T08:15:00.000Z");
    assert.equal(single.issueMap["CORE-1"].worklogs[0].author.displayName, "Ivan Ivanov");
    assert.equal(single.dayMap["2026-03-30"].changes[0].created, "2026-03-30T10:45:00.000Z");
    assert.equal(single.dayMap["2026-03-30"].changes[0].timestamp, "2026-03-30T10:45:00.000Z");
    assert.equal(single.dayMap["2026-03-30"].changes[0].author.displayName, "Ivan Ivanov");

    var multi = mod.processMultiUserData([{
        username: "u1",
        displayName: "Ivan Ivanov",
        rawData: rawData,
        comments: {}
    }], "2026-03-01", "2026-03-31");
    assert.equal(multi.dayMap["2026-03-30"].allWorklogs[0].timestamp, "2026-03-30T08:15:00.000Z");
    assert.equal(multi.dayMap["2026-03-30"].allChanges[0].timestamp, "2026-03-30T10:45:00.000Z");
    assert.equal(multi.issueMap["CORE-1"].worklogs[0].author.displayName, "Ivan Ivanov");
});

test("user activity data processor preserves worklog created timestamp and lag fields", function() {
    var mod = loadUserActivityDataProcessor();
    var rawData = {
        issues: [{
            key: "CORE-LAG",
            fields: {
                summary: "Lag task",
                issuetype: { name: "Task" },
                status: { name: "In Progress" },
                project: { key: "CORE", name: "Core" }
            }
        }],
        details: {
            "CORE-LAG": {
                worklogs: [{
                    started: "2026-04-25T09:00:00",
                    created: "2026-04-26T08:00:00",
                    timeSpentSeconds: 14400,
                    comment: "late log",
                    author: { name: "u1", displayName: "Ivan Ivanov" }
                }],
                changelog: []
            }
        }
    };

    var single = mod.processData(rawData, "u1", "2026-04-24", "2026-04-30");
    var wl = single.dayMap["2026-04-25"].worklogs[0];

    assert.equal(wl.created, "2026-04-26T08:00:00");
    assert.equal(wl.loggedAt, "2026-04-26T08:00:00");
    assert.equal(wl.workedDayKey, "2026-04-25");
    assert.equal(wl.isLate, true);
    assert.equal(Math.round(wl.lagScoreHours * 100) / 100, 1.33);
});

test("user activity multi-user stats sums lagScoreHours per user", function() {
    var mod = loadUserActivityDataProcessor();
    var data = mod.processMultiUserData([{
        username: "u1",
        displayName: "Ivan Ivanov",
        rawData: {
            issues: [{
                key: "CORE-LAG",
                fields: {
                    summary: "Lag task",
                    issuetype: { name: "Task" },
                    status: { name: "In Progress" },
                    project: { key: "CORE", name: "Core" }
                }
            }],
            details: {
                "CORE-LAG": {
                    worklogs: [{
                        started: "2026-04-25T09:00:00",
                        created: "2026-04-26T08:00:00",
                        timeSpentSeconds: 14400,
                        author: { name: "u1", displayName: "Ivan Ivanov" }
                    }],
                    changelog: []
                }
            }
        },
        comments: {}
    }], "2026-04-24", "2026-04-30");

    assert.equal(Math.round(data.stats.userStats.u1.lagScoreHours * 100) / 100, 1.33);
});

test("summary cards user stats table renders lag column", function() {
    var mod = loadSummaryCards(createSummaryCardsJqueryStub());
    var widget = mod.create();

    widget.render({
        totalHours: 8,
        totalIssues: 1,
        totalProjects: 1,
        activeDays: 1,
        avgHoursPerDay: 8,
        userStats: {
            u1: {
                displayName: "Ivan Ivanov",
                totalHours: 4,
                activeDays: 1,
                daysWithoutWorklogs: 0,
                lagScoreHours: 1.33
            },
            u2: {
                displayName: "Petr Petrov",
                totalHours: 4,
                activeDays: 1,
                daysWithoutWorklogs: 0,
                lagScoreHours: 0
            }
        }
    });

    var html = widget.$el.html();
    assert.match(html, /Отставание/);
    assert.match(html, /Ivan Ivanov/);
    assert.match(html, /1\.3ч/);
});

test("unified calendar weekly lag table shows per-user lag totals", function() {
    var mod = loadUnifiedCalendar(createHtmlJqueryStub());
    var html = mod.render({
        "2026-04-02": {
            totalHours: 4,
            users: { u1: { totalHours: 4 }, u2: { totalHours: 0 } },
            allWorklogs: [{
                issueKey: "LAG-1",
                timestamp: "2026-04-02T09:00:00",
                started: "2026-04-02T09:00:00",
                created: "2026-04-03T08:00:00",
                workedDayKey: "2026-04-02",
                loggedAt: "2026-04-03T08:00:00",
                isLate: true,
                lagDurationHoursRaw: 8,
                lagScoreHours: 1.33,
                author: { name: "u1", displayName: "Ivan Ivanov" },
                timeSpentHours: 4
            }],
            allChanges: [],
            allComments: [],
            repoItems: []
        }
    }, {
        "LAG-1": { key: "LAG-1", summary: "Lag task", status: "In Progress", project: "CORE" }
    }, [
        { name: "u1", displayName: "Ivan Ivanov" },
        { name: "u2", displayName: "Petr Petrov" }
    ], new Date("2026-03-30T00:00:00"), new Date("2026-04-05T23:59:59")).$el.html();

    assert.match(html, /Суммарное отставание/);
    assert.match(html, /Ivan Ivanov/);
    assert.match(html, /1\.3ч/);
});

test("user-activity ai-report persists config and calls stored endpoint", async function() {
    var storageData = {};
    var storage = {
        getItem: function(key) {
            return Object.prototype.hasOwnProperty.call(storageData, key) ? storageData[key] : null;
        },
        setItem: function(key, value) {
            storageData[key] = String(value);
        }
    };
    var mod = loadAiReport();
    var config = mod.writeStoredConfig(storage, {
        url: "https://llm.example/v1/chat/completions",
        model: "qwen-coder-30b",
        apiKey: "sk-test"
    });
    var calls = [];

    assert.deepEqual(normalize(mod.readStoredConfig(storage)), normalize(config));

    var result = await mod.requestReport(config, {
        widgetTitle: "User Activity",
        widgetId: "user-activity",
        selectedUsers: [{ name: "u1", displayName: "Ivan Ivanov" }],
        period: { start: "2026-03-01", end: "2026-03-07" },
        widgetHtml: "<div>dashboard</div>"
    }, function(url, options) {
        calls.push({ url: url, options: normalize(options) });
        return Promise.resolve({
            ok: true,
            status: 200,
            text: function() {
                return Promise.resolve(JSON.stringify({
                    choices: [{
                        message: {
                            content: "Готовый AI-отчет"
                        }
                    }]
                }));
            }
        });
    });

    assert.equal(result.text, "Готовый AI-отчет");
    assert.equal(calls[0].url, "https://llm.example/v1/chat/completions");
    assert.equal(calls[0].options.headers.Authorization, "Bearer sk-test");

    var body = JSON.parse(calls[0].options.body);
    assert.equal(body.model, "qwen-coder-30b");
    assert.match(body.messages[1].content, /Ivan Ivanov/);
    assert.match(body.messages[1].content, /2026-03-01 \.\. 2026-03-07/);
});

test("rendering AI report button forwards context to isolated ai module", function() {
    var harness = createRenderingHarness({
        selectedUsers: [
            { name: "u1", displayName: "Ivan Ivanov" },
            { name: "u2", displayName: "Petr Petrov" }
        ],
        useMultiUserPicker: true
    });

    harness.clickAiReport();
    harness.clickAiReport();

    assert.equal(harness.events.aiReportCalls.length, 2);
    assert.equal(harness.events.aiReportCloses, 1);
    assert.equal(harness.events.aiReportCalls[0].title, "ИИ отчет по активности");
    assert.equal(harness.events.aiReportCalls[0].context.widgetId, "user-activity");
    assert.deepEqual(harness.events.aiReportCalls[0].context.period, normalize(harness.period));
    assert.deepEqual(harness.events.aiReportCalls[0].context.selectedUsers, normalize([
        { name: "u1", displayName: "Ivan Ivanov" },
        { name: "u2", displayName: "Petr Petrov" }
    ]));
    assert.match(harness.events.aiReportCalls[0].context.summary, /сравнение сотрудников/i);
});

test("repo modules are wired in main module and build order", function() {
    var mainSource = fs.readFileSync(path.join(__dirname, "..", "ujg-user-activity-modules", "main.js"), "utf8");
    var buildSource = fs.readFileSync(path.join(__dirname, "..", "build-user-activity.js"), "utf8");

    assert.match(mainSource, /"_ujgShared_teamStore", "_ujgShared_teamPicker", "_ujgUA_teamManager", "_ujgUA_aiReport"/);
    assert.match(mainSource, /repoLog: repoLog, aiReport: aiReport,/);
    assert.match(mainSource, /teamStore: uaTeamStore, teamPicker: teamPicker, teamManager: teamManager/);
    assert.match(mainSource, /"_ujgUA_api", "_ujgUA_repoApi", "_ujgUA_dataProcessor", "_ujgUA_repoDataProcessor"/);
    assert.match(mainSource, /"_ujgUA_calendarHeatmap", "_ujgUA_repoCalendar", "_ujgUA_dailyDetail"/);
    assert.match(mainSource, /"_ujgUA_activityLog", "_ujgUA_repoLog",\s*\n\s*"_ujgShared_teamStore", "_ujgShared_teamPicker", "_ujgUA_teamManager", "_ujgUA_aiReport",\s*\n\s*"_ujgUA_rendering"/);
    assert.match(mainSource, /repoApi: repoApi, dataProcessor: dataProcessor, repoDataProcessor: repoDataProcessor/);
    assert.match(mainSource, /summaryCards: summaryCards, calendarHeatmap: calendarHeatmap, repoCalendar: repoCalendar/);
    assert.match(mainSource, /issueList: issueList, activityLog: activityLog, repoLog: repoLog/);

    assert.match(buildSource, /file:\s*"team-store\.js"/);
    assert.match(buildSource, /file:\s*"team-picker\.js"/);
    assert.match(buildSource, /file:\s*"team-manager\.js"/);
    assert.match(buildSource, /file:\s*"request-cache\.js"/);
    var iRequestCache = buildSource.indexOf('file: "request-cache.js"');
    var iApi = buildSource.indexOf('file: "api.js"');
    var iRepoApi = buildSource.indexOf('file: "repo-api.js"');
    var iData = buildSource.indexOf('file: "data-processor.js"');
    var iRepoData = buildSource.indexOf('file: "repo-data-processor.js"');
    assert.ok(iRequestCache < iApi && iApi < iRepoApi && iRepoApi < iData && iData < iRepoData);
    var iHeat = buildSource.indexOf('file: "calendar-heatmap.js"');
    var iRepoCal = buildSource.indexOf('file: "repo-calendar.js"');
    var iDaily = buildSource.indexOf('file: "daily-detail.js"');
    assert.ok(iHeat < iRepoCal && iRepoCal < iDaily);
    var iAct = buildSource.indexOf('file: "activity-log.js"');
    var iRepoLog = buildSource.indexOf('file: "repo-log.js"');
    var iTeamManager = buildSource.indexOf('file: "team-manager.js"');
    var iAiReport = buildSource.indexOf('file: "ai-report.js"');
    var iRender = buildSource.indexOf('file: "rendering.js"');
    assert.ok(iAct < iRepoLog && iRepoLog < iTeamManager && iTeamManager < iAiReport && iAiReport < iRender);
});

test("public user activity bundle includes repo modules", function() {
    var builder = require(path.join(__dirname, "..", "build-user-activity.js"));
    builder.build();
    var bundleSource = fs.readFileSync(path.join(__dirname, "..", "ujg-user-activity.js"), "utf8");

    assert.match(bundleSource, /_ujgUA_repoApi/);
    assert.match(bundleSource, /_ujgUA_repoDataProcessor/);
    assert.match(bundleSource, /_ujgUA_repoCalendar/);
    assert.match(bundleSource, /_ujgUA_repoLog/);
    assert.match(bundleSource, /_ujgUA_teamManager/);
    assert.match(bundleSource, /_ujgUA_aiReport/);
    assert.match(bundleSource, /_ujgUA_requestCache/);
});

test("build-user-activity updates bundle atomically for concurrent bootstrap readers", function() {
    var builder = require(path.join(__dirname, "..", "build-user-activity.js"));
    var bootstrapBuilder = require(path.join(__dirname, "..", "build-widget-bootstrap-assets.js"));
    var outputPath = path.join(__dirname, "..", "ujg-user-activity.js");
    var originalBundle = fs.readFileSync(outputPath, "utf8");
    var originalWriteFileSync = fs.writeFileSync;
    var originalRenameSync = fs.renameSync;
    var simulatedConcurrentRead = false;

    try {
        fs.writeFileSync = function(filePath, data, encoding) {
            var resolved = path.resolve(String(filePath));
            if (path.basename(resolved).indexOf("ujg-user-activity.js") === 0) {
                var text = String(data);
                var partial = text.slice(0, Math.max(1, Math.floor(text.length / 2)));
                originalWriteFileSync.call(fs, filePath, partial, encoding);
                assert.doesNotThrow(function() {
                    bootstrapBuilder.buildAssets({
                        releaseRef: "atomic-test-ref",
                        assetBaseUrl: "https://cdn.jsdelivr.net/gh/skivbox-ii/jira",
                        widgets: [bootstrapBuilder.WIDGETS.userActivity]
                    });
                }, "bootstrap readers should not observe an incomplete public bundle during rebuild");
                simulatedConcurrentRead = true;
                return originalWriteFileSync.call(fs, filePath, data, encoding);
            }
            return originalWriteFileSync.apply(fs, arguments);
        };

        builder.build();
        assert.equal(simulatedConcurrentRead, true, "test should simulate a concurrent bootstrap read");
    } finally {
        fs.writeFileSync = originalWriteFileSync;
        fs.renameSync = originalRenameSync;
        originalWriteFileSync.call(fs, outputPath, originalBundle, "utf8");
        var tempPath = outputPath + ".tmp";
        if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
        }
    }
});

test("rendering appends repo blocks after Jira counterparts in dashboard order", function() {
    var harness = createRenderingHarness();

    assert.deepEqual(harness.getDashboardLabels(), [
        "SummaryCards",
        "Jira Activity Calendar",
        "Repo Activity Calendar",
        "DailyDetail",
        "ProjectBreakdown",
        "IssueList",
        "Activity Log",
        "Repository Activity Log"
    ]);
    assert.deepEqual(normalize(harness.events.fetchRepoArgs), {
        issues: normalize(harness.rawData.issues),
        hasOnProgress: true
    });
    assert.deepEqual(normalize(harness.events.processRepoArgs), {
        issueMap: normalize(harness.processed.issueMap),
        issueDevStatusMap: normalize(harness.repoFetchResult.issueDevStatusMap),
        user: normalize(harness.selectedUser),
        startDate: harness.period.start,
        endDate: harness.period.end
    });
    assert.deepEqual(normalize(harness.events.repoLogCalls), [{
        activity: normalize(harness.repoActivity),
        selectedDate: null
    }]);
});

test("rendering keeps Jira calendar wired to DailyDetail and repo calendar wired to repo log", function() {
    var harness = createRenderingHarness();

    harness.events.jiraSelect("2026-03-08");
    assert.equal(harness.events.dailyShows.length, 1);
    assert.equal(harness.events.dailyShows[0].dateStr, "2026-03-08");
    assert.equal(harness.events.repoLogCalls.length, 1);

    harness.events.repoSelect("2026-03-09");
    assert.equal(harness.events.dailyShows.length, 1);
    assert.equal(harness.events.repoLogCalls.length, 2);
    assert.equal(harness.events.repoLogCalls[1].selectedDate, "2026-03-09");

    harness.events.jiraSelect(null);
    assert.equal(harness.events.dailyHides, 1);
});

test("rendering with unified calendar syncs selected day to repo log", function() {
    var harness = createRenderingHarness({
        useUnifiedCalendar: true
    });

    assert.equal(harness.events.repoLogCalls.length, 1);
    assert.equal(harness.events.repoLogCalls[0].selectedDate, null);

    harness.events.jiraSelect("2026-03-09");
    assert.equal(harness.events.dailyShows.length, 1);
    assert.equal(harness.events.repoLogCalls.length, 2);
    assert.equal(harness.events.repoLogCalls[1].selectedDate, "2026-03-09");

    harness.events.jiraSelect(null);
    assert.equal(harness.events.dailyHides, 1);
    assert.equal(harness.events.repoLogCalls.length, 3);
    assert.equal(harness.events.repoLogCalls[2].selectedDate, null);
});

test("rendering passes current selected users snapshot to day detail on date click", function() {
    var harness = createRenderingHarness();

    harness.triggerUserChange({ name: "fresh-user", displayName: "Fresh User" });
    harness.events.jiraSelect("2026-03-08");

    assert.equal(harness.events.dailyShows.length, 1);
    assert.deepEqual(normalize(harness.events.dailyShows[0].selectedUsers), [{
        name: "fresh-user",
        displayName: "Fresh User"
    }]);
});

test("rendering with unified calendar keeps repo-only day entries in merged dayMap", function() {
    var harness = createRenderingHarness({
        useUnifiedCalendar: true,
        processed: {
            stats: { totalHours: 1 },
            dayMap: {
                "2026-03-08": { worklogs: [], changes: [], issues: ["CORE-1"], totalHours: 1 }
            },
            issueMap: {
                "CORE-1": { key: "CORE-1", summary: "Test task", type: "Task", status: "Done", totalTimeHours: 1 }
            },
            projectMap: {
                CORE: { key: "CORE", totalHours: 1, issueCount: 1, issues: ["CORE-1"] }
            },
            statusTransitions: {}
        },
        repoActivity: {
            items: [{
                type: "commit",
                date: "2026-03-09",
                timestamp: "2026-03-09T10:00:00.000Z",
                repoName: "core-api",
                issueKey: "CORE-1",
                message: "Repo-only day",
                hash: "abc123"
            }],
            dayMap: {
                "2026-03-09": {
                    items: [{
                        type: "commit",
                        date: "2026-03-09",
                        timestamp: "2026-03-09T10:00:00.000Z",
                        repoName: "core-api",
                        issueKey: "CORE-1",
                        message: "Repo-only day",
                        hash: "abc123"
                    }]
                }
            },
            repoMap: {},
            stats: { totalEvents: 1 }
        }
    });

    assert.ok(harness.events.unifiedCalendarRenderArgs, "expected unified calendar render call");
    assert.ok(harness.events.unifiedCalendarRenderArgs.dayMap["2026-03-09"], "expected repo-only day in merged dayMap");
    assert.equal(harness.events.unifiedCalendarRenderArgs.dayMap["2026-03-09"].repoItems.length, 1);
    assert.equal(harness.events.unifiedCalendarRenderArgs.dayMap["2026-03-09"].totalHours, 0);
});

test("rendering loads days newest-first for a single user", function() {
    var harness = createRenderingHarness({
        period: { start: "2026-03-01", end: "2026-03-03" },
        rawData: { issues: [] }
    });

    assert.deepEqual(harness.events.fetchAllDataCalls.map(function(call) {
        return {
            username: call.username,
            startDate: call.startDate,
            endDate: call.endDate
        };
    }), [{
        username: "dtorzok",
        startDate: "2026-03-03",
        endDate: "2026-03-03"
    }, {
        username: "dtorzok",
        startDate: "2026-03-02",
        endDate: "2026-03-02"
    }, {
        username: "dtorzok",
        startDate: "2026-03-01",
        endDate: "2026-03-01"
    }]);
});

test("rendering loads users sequentially within each day", function() {
    var harness = createRenderingHarness({
        useMultiUserPicker: true,
        selectedUsers: [
            { name: "u1", displayName: "User One" },
            { name: "u2", displayName: "User Two" }
        ],
        period: { start: "2026-03-01", end: "2026-03-02" },
        rawData: { issues: [] }
    });

    assert.deepEqual(harness.events.fetchAllDataCalls.map(function(call) {
        return call.username + ":" + call.startDate;
    }), [
        "u1:2026-03-02",
        "u2:2026-03-02",
        "u1:2026-03-01",
        "u2:2026-03-01"
    ]);
});

test("rendering updates unified calendar day-by-day during sequential load", function() {
    var harness = createRenderingHarness({
        useUnifiedCalendar: true,
        period: { start: "2026-03-01", end: "2026-03-02" },
        rawData: { issues: [] }
    });

    assert.deepEqual(harness.events.unifiedCalendarDayUpdates.map(function(update) {
        return update.dateStr;
    }), ["2026-03-02", "2026-03-01"]);
});

test("rendering does not auto load on init without URL filters", function() {
    var harness = createRenderingHarness({
        window: createWindowStub(""),
        selectedUser: { name: "first-user", displayName: "First User" },
        period: { start: "2026-03-08", end: "2026-03-08" }
    });

    assert.equal(harness.events.fetchAllDataCalls.length, 0);
    assert.equal(harness.events.fetchRepoArgsHistory.length, 0);
    assert.match(harness.root.__el.children[1].html, /Выберите пользователя и период/);
});

test("rendering auto loads on init when user filter is prefilled in URL", function() {
    var harness = createRenderingHarness({
        window: createWindowStub("?user=first-user"),
        selectedUser: { name: "first-user", displayName: "First User" },
        period: { start: "2026-03-08", end: "2026-03-08" },
        rawData: { issues: [] }
    });

    assert.deepEqual(normalize(harness.events.fetchAllDataCalls), [{
        username: "first-user",
        startDate: "2026-03-08",
        endDate: "2026-03-08",
        hasOnProgress: true
    }]);
});

test("rendering auto loads on init when users filter is prefilled in URL", function() {
    var harness = createRenderingHarness({
        useMultiUserPicker: true,
        selectedUsers: [{ name: "u1", displayName: "User One" }],
        window: createWindowStub("?users=u1"),
        period: { start: "2026-03-08", end: "2026-03-08" },
        rawData: { issues: [] }
    });

    assert.deepEqual(normalize(harness.events.fetchAllDataCalls), [{
        username: "u1",
        startDate: "2026-03-08",
        endDate: "2026-03-08",
        hasOnProgress: true
    }]);
});

test("rendering auto loads on init when team filter is prefilled in URL", function() {
    var harness = createRenderingHarness({
        useMultiUserPicker: true,
        useTeamSync: true,
        selectedUsers: [],
        teams: [{ id: "team-1", memberKeys: ["u1"] }],
        displayNameByKey: { u1: "User One" },
        queryNameByKey: { u1: "u1" },
        window: createWindowStub("?teams=team-1"),
        period: { start: "2026-03-08", end: "2026-03-08" },
        rawData: { issues: [] }
    });

    assert.deepEqual(normalize(harness.events.fetchAllDataCalls), [{
        username: "u1",
        startDate: "2026-03-08",
        endDate: "2026-03-08",
        hasOnProgress: true
    }]);
});

test("rendering keeps Jira blocks visible when repo loading fails", function() {
    var harness = createRenderingHarness({
        repoShouldFail: true
    });

    assert.deepEqual(harness.getDashboardLabels(), [
        "SummaryCards",
        "Jira Activity Calendar",
        "Repo Activity Calendar Error",
        "DailyDetail",
        "ProjectBreakdown",
        "IssueList",
        "Activity Log",
        "Repository Activity Log Error"
    ]);
    assert.equal(harness.events.processRepoArgs, null);
    assert.deepEqual(harness.events.repoLogCalls, []);
});

test("rendering ignores stale older request responses and keeps newer dashboard after manual reload", function() {
    var firstApi = createDeferred();
    var secondApi = createDeferred();
    var activeRepo = createDeferred();
    var apiCallCount = 0;
    var harness = createRenderingHarness({
        period: { start: "2026-03-08", end: "2026-03-08" },
        selectedUser: { name: "first-user", displayName: "First User" },
        fetchAllDataImpl: function() {
            apiCallCount += 1;
            return apiCallCount === 1 ? firstApi.promise() : secondApi.promise();
        },
        processDataImpl: function(currentRawData) {
            return currentRawData.processed;
        },
        fetchRepoImpl: function() {
            return activeRepo.promise();
        },
        processRepoActivityImpl: function(issueMap, issueDevStatusMap, user) {
            return {
                items: [],
                dayMap: {},
                repoMap: {},
                stats: { totalEvents: 0 },
                marker: user.name + ":" + Object.keys(issueDevStatusMap || {}).join(",")
            };
        }
    });

    harness.triggerUserChange({ name: "second-user", displayName: "Second User" });
    harness.clickLoad();

    secondApi.resolve({
        issues: [{ id: "2002", key: "SECOND-2" }],
        processed: {
            stats: { totalHours: 2 },
            dayMap: {},
            issueMap: { "SECOND-2": { key: "SECOND-2", summary: "second", totalTimeHours: 2 } },
            projectMap: { SECOND: { key: "SECOND", totalHours: 2, issueCount: 1, issues: ["SECOND-2"] } },
            statusTransitions: {}
        }
    });
    activeRepo.resolve({
        issueDevStatusMap: { "SECOND-2": { detail: [] } }
    });

    assert.equal(harness.events.processRepoArgsHistory.length, 2);
    assert.equal(harness.events.processRepoArgsHistory[0].user.name, "second-user");
    assert.equal(harness.events.processRepoArgsHistory[1].user.name, "second-user");

    firstApi.resolve({
        issues: [{ id: "1001", key: "FIRST-1" }],
        processed: {
            stats: { totalHours: 1 },
            dayMap: {},
            issueMap: { "FIRST-1": { key: "FIRST-1", summary: "first", totalTimeHours: 1 } },
            projectMap: { FIRST: { key: "FIRST", totalHours: 1, issueCount: 1, issues: ["FIRST-1"] } },
            statusTransitions: {}
        }
    });

    assert.equal(harness.events.processRepoArgsHistory.length, 2);
    assert.deepEqual(harness.getDashboardLabels(), [
        "SummaryCards",
        "Jira Activity Calendar",
        "Repo Activity Calendar",
        "DailyDetail",
        "ProjectBreakdown",
        "IssueList",
        "Activity Log",
        "Repository Activity Log"
    ]);
    assert.equal(harness.events.fetchAllDataCalls.length, 2);
    assert.equal(harness.events.fetchRepoArgsHistory.length, 2);
});

test("rendering invalidates in-flight request when selected user is cleared", function() {
    var apiDeferred = createDeferred();
    var harness = createRenderingHarness({
        period: { start: "2026-03-08", end: "2026-03-08" },
        fetchAllDataImpl: function() {
            return apiDeferred.promise();
        }
    });

    harness.triggerUserChange(null);
    apiDeferred.resolve({
        issues: [{ id: "1001", key: "FIRST-1" }]
    });

    assert.deepEqual(harness.getDashboardLabels(), []);
    assert.equal(harness.events.fetchRepoArgsHistory.length, 0);
    assert.match(harness.root.__el.children[1].html, /Выберите пользователя и период/);
});

test("rendering processes repo activity for request user snapshot, not later mutated currentUser", function() {
    var apiDeferred = createDeferred();
    var repoDeferred = createDeferred();
    var selectedUser = { name: "first-user", displayName: "First User" };
    var harness = createRenderingHarness({
        period: { start: "2026-03-08", end: "2026-03-08" },
        selectedUser: selectedUser,
        fetchAllDataImpl: function() {
            return apiDeferred.promise();
        },
        fetchRepoImpl: function() {
            return repoDeferred.promise();
        }
    });

    apiDeferred.resolve({
        issues: [{ id: "1001", key: "FIRST-1" }]
    });
    harness.mutateSelectedUser({
        name: "mutated-user",
        displayName: "Mutated User"
    });
    repoDeferred.resolve({
        issueDevStatusMap: { "FIRST-1": { detail: [] } }
    });

    assert.equal(harness.events.processRepoArgs.user.name, "first-user");
    assert.equal(harness.events.processRepoArgs.user.displayName, "First User");
});

test("rendering reinit does not accumulate keydown handlers", function() {
    var harness = createRenderingHarness();

    assert.equal(harness.getRenderKeydownHandlerCount(), 1);

    harness.reinit();
    assert.equal(harness.getRenderKeydownHandlerCount(), 1);

    harness.reinit();
    assert.equal(harness.getRenderKeydownHandlerCount(), 1);
});

test("request cache: second identical GET uses cache", async function() {
    var ajaxCount = 0;
    var $ = createJqueryStub(function() {
        ajaxCount += 1;
        var d = createDeferred();
        d.resolve({ id: 1 }, "success", {});
        return d.promise();
    });
    var rc = loadRequestCache($);
    var firstDone;
    var secondDone;

    await new Promise(function(res) {
        rc.cachedAjax({ url: "/x", type: "GET" }).done(function(a, b, c) {
            firstDone = [a, b, c];
            res();
        });
    });
    await new Promise(function(res) {
        rc.cachedAjax({ url: "/x", type: "GET" }).done(function(a, b, c) {
            secondDone = [a, b, c];
            res();
        });
    });

    assert.equal(ajaxCount, 1);
    assert.deepEqual(firstDone, [{ id: 1 }, "success", {}]);
    assert.deepEqual(secondDone, firstDone);
});

test("request cache: clearCache forces a new request", async function() {
    var ajaxCount = 0;
    var $ = createJqueryStub(function() {
        ajaxCount += 1;
        var d = createDeferred();
        d.resolve({}, "success", {});
        return d.promise();
    });
    var rc = loadRequestCache($);

    await rc.cachedAjax({ url: "/y", type: "GET" });
    rc.clearCache();
    await rc.cachedAjax({ url: "/y", type: "GET" });

    assert.equal(ajaxCount, 2);
});

test("request cache: different POST bodies are separate entries", async function() {
    var ajaxCount = 0;
    var $ = createJqueryStub(function() {
        ajaxCount += 1;
        var d = createDeferred();
        d.resolve({ n: ajaxCount }, "success", {});
        return d.promise();
    });
    var rc = loadRequestCache($);

    await rc.cachedAjax({ url: "/p", type: "POST", data: { a: 1 } });
    await rc.cachedAjax({ url: "/p", type: "POST", data: { a: 1 } });
    assert.equal(ajaxCount, 1);
    await rc.cachedAjax({ url: "/p", type: "POST", data: { b: 2 } });
    assert.equal(ajaxCount, 2);
});

test("request cache: failed response is not cached", async function() {
    var ajaxCount = 0;
    var $ = createJqueryStub(function() {
        ajaxCount += 1;
        return rejectedAjax("error");
    });
    var rc = loadRequestCache($);

    function expectFail(p) {
        return new Promise(function(resolve, reject) {
            p.fail(function(x) {
                resolve(x);
            }).done(function() {
                reject(new Error("expected ajax failure"));
            });
        });
    }

    await expectFail(rc.cachedAjax({ url: "/z", type: "GET" }));
    await expectFail(rc.cachedAjax({ url: "/z", type: "GET" }));
    assert.equal(ajaxCount, 2);
});

test("request cache: live and cached returns expose abort and then", async function() {
    var $ = createJqueryStub(function() {
        var d = createDeferred();
        d.resolve(0, "success", {});
        return d.promise();
    });
    var rc = loadRequestCache($);

    var live = rc.cachedAjax({ url: "/abort-shape", type: "GET" });
    assert.equal(typeof live.abort, "function");
    assert.equal(typeof live.then, "function");
    live.abort();
    await new Promise(function(res) {
        live.done(res);
    });

    var cached = rc.cachedAjax({ url: "/abort-shape", type: "GET" });
    assert.equal(typeof cached.abort, "function");
    assert.equal(typeof cached.then, "function");
    cached.abort();
});

test("request cache: live abort delegates to underlying jqXHR", function() {
    var abortCalls = 0;
    var $ = createJqueryStub(function() {
        var d = createDeferred();
        var p = d.promise();
        p.abort = function() {
            abortCalls += 1;
        };
        d.resolve({}, "success", {});
        return p;
    });
    var rc = loadRequestCache($);

    rc.cachedAjax({ url: "/delegate-abort", type: "GET" }).abort();
    assert.equal(abortCalls, 1);
});

test("request cache: PATCH with different bodies are separate entries", async function() {
    var ajaxCount = 0;
    var $ = createJqueryStub(function() {
        ajaxCount += 1;
        var d = createDeferred();
        d.resolve({ k: ajaxCount }, "success", {});
        return d.promise();
    });
    var rc = loadRequestCache($);

    await rc.cachedAjax({ url: "/patch", type: "PATCH", data: { x: 1 } });
    await rc.cachedAjax({ url: "/patch", type: "PATCH", data: { x: 1 } });
    assert.equal(ajaxCount, 1);
    await rc.cachedAjax({ url: "/patch", type: "PATCH", data: { x: 2 } });
    assert.equal(ajaxCount, 2);
});
