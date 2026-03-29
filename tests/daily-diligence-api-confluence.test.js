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

function rejectedAjax(message) {
    var d = createDeferred();
    d.reject({ statusText: message }, "error");
    return d.promise();
}

function createJqueryStub(handler) {
    var calls = [];
    return {
        ajax: function(options) {
            calls.push(normalize(options));
            return handler(options);
        },
        Deferred: createDeferred,
        __calls: calls
    };
}

function loadApi(jquery) {
    return loadAmdModule(path.join(__dirname, "..", "ujg-daily-diligence-modules", "api-confluence.js"), {
        jquery: jquery,
        _ujgDD_config: {
            confluenceBaseUrl: "https://confluence.example.com"
        }
    });
}

function contentStub(title, type, version, spaceKey) {
    return {
        title: title,
        type: type,
        version: version,
        space: { key: spaceKey || "DOC" }
    };
}

test("fetchTeamActivity maps actions, unwraps nested content, and reports confluence progress", async function() {
    var progress = [];
    var jquery = createJqueryStub(function(options) {
        if (!/\/rest\/api\/content\/search$/.test(options.url)) {
            throw new Error("Unexpected AJAX: " + options.url);
        }
        assert.match(options.data.cql, /contributor="alice"/);
        assert.match(options.data.cql, /lastModified >= "2026-03-01"/);
        assert.match(options.data.cql, /lastModified <= "2026-03-07"/);
        assert.equal(options.data.expand, "history,space,version");
        assert.equal(options.data.limit, 200);
        assert.equal(options.data.start, 0);
        return resolvedAjax({
            totalSize: 3,
            results: [
                contentStub("New page", "page", {
                    when: "2026-03-02T12:00:00.000Z",
                    number: 1,
                    by: { userKey: "alice", username: "alice" }
                }),
                { content: contentStub("Edit page", "page", {
                    when: "2026-03-03T15:30:00.000Z",
                    number: 4,
                    by: { userKey: "alice" }
                }) },
                contentStub("Re: thread", "comment", {
                    when: "2026-03-04T09:00:00.000Z",
                    number: 1,
                    by: { username: "alice" }
                }, "TEAM")
            ]
        });
    });

    var api = loadApi(jquery);
    var result = await api.fetchTeamActivity(["alice"], "2026-03-01", "2026-03-07", function(u) {
        progress.push(normalize(u));
    });

    assert.equal(result.length, 3);
    assert.deepEqual(normalize(result.map(function(e) {
        return { date: e.date, pageTitle: e.pageTitle, space: e.space, action: e.action, userKey: e.userKey };
    })), [
        { date: "2026-03-02", pageTitle: "New page", space: "DOC", action: "created", userKey: "alice" },
        { date: "2026-03-03", pageTitle: "Edit page", space: "DOC", action: "updated", userKey: "alice" },
        { date: "2026-03-04", pageTitle: "Re: thread", space: "TEAM", action: "commented", userKey: "alice" }
    ]);
    assert.ok(progress.some(function(u) {
        return u.phase === "confluence" && u.loaded === 0 && u.total === 0;
    }));
    assert.ok(progress.some(function(u) {
        return u.phase === "confluence" && u.loaded === 3 && u.total === 3;
    }));
});

test("fetchTeamActivity keeps source calendar day and requested user key for accepted alias matches", async function() {
    var jquery = createJqueryStub(function(options) {
        if (!/\/rest\/api\/content\/search$/.test(options.url)) {
            throw new Error("Unexpected AJAX: " + options.url);
        }
        return resolvedAjax({
            totalSize: 1,
            results: [
                contentStub("Late edit", "page", {
                    when: "2026-03-01T00:30:00+03:00",
                    number: 2,
                    by: {
                        userKey: "confluence-user-123",
                        username: "alice-login"
                    }
                }, "TEAM")
            ]
        });
    });

    var api = loadApi(jquery);
    var result = await api.fetchTeamActivity(["alice-login"], "2026-03-01", "2026-03-05");

    assert.deepEqual(normalize(result), [
        {
            date: "2026-03-01",
            pageTitle: "Late edit",
            space: "TEAM",
            action: "updated",
            userKey: "alice-login"
        }
    ]);
});

test("fetchTeamActivity follows pagination until totalSize is exhausted", async function() {
    var searchCalls = [];
    var jquery = createJqueryStub(function(options) {
        if (!/\/rest\/api\/content\/search$/.test(options.url)) {
            throw new Error("Unexpected AJAX: " + options.url);
        }
        searchCalls.push(options.data.start);
        if (options.data.start === 0) {
            var results = [];
            var i;
            for (i = 0; i < 200; i++) {
                results.push(contentStub("Bulk " + i, "page", {
                    when: "2026-03-02T10:00:00.000Z",
                    number: 2,
                    by: { userKey: "bob" }
                }));
            }
            return resolvedAjax({ totalSize: 203, results: results });
        }
        if (options.data.start === 200) {
            return resolvedAjax({
                totalSize: 203,
                results: [
                    contentStub("Tail a", "page", { when: "2026-03-02T11:00:00.000Z", number: 2, by: { userKey: "bob" } }),
                    contentStub("Tail b", "page", { when: "2026-03-02T12:00:00.000Z", number: 2, by: { userKey: "bob" } }),
                    contentStub("Tail c", "page", { when: "2026-03-02T13:00:00.000Z", number: 2, by: { userKey: "bob" } })
                ]
            });
        }
        throw new Error("Unexpected start: " + options.data.start);
    });

    var api = loadApi(jquery);
    var result = await api.fetchTeamActivity(["bob"], "2026-03-01", "2026-03-05");
    assert.equal(result.length, 203);
    assert.deepEqual(searchCalls, [0, 200]);
});

test("fetchTeamActivity keeps only entries attributable to the queried user across contributor searches", async function() {
    var progress = [];
    var jquery = createJqueryStub(function(options) {
        if (!/\/rest\/api\/content\/search$/.test(options.url)) {
            throw new Error("Unexpected AJAX: " + options.url);
        }
        if (/contributor="alice"/.test(options.data.cql)) {
            return resolvedAjax({
                totalSize: 2,
                results: [
                    contentStub("Alice page", "page", {
                        when: "2026-03-02T10:00:00.000Z",
                        number: 1,
                        by: { username: "alice" }
                    }),
                    contentStub("Shared page", "page", {
                        when: "2026-03-03T10:00:00.000Z",
                        number: 2,
                        by: { userKey: "bob" }
                    }, "TEAM")
                ]
            });
        }
        if (/contributor="bob"/.test(options.data.cql)) {
            return resolvedAjax({
                totalSize: 2,
                results: [
                    contentStub("Shared page", "page", {
                        when: "2026-03-03T10:00:00.000Z",
                        number: 2,
                        by: { userKey: "bob" }
                    }, "TEAM"),
                    contentStub("Bob page", "comment", {
                        when: "2026-03-04T10:00:00.000Z",
                        number: 1,
                        by: { userKey: "bob" }
                    })
                ]
            });
        }
        throw new Error("Unexpected CQL: " + options.data.cql);
    });

    var api = loadApi(jquery);
    var result = await api.fetchTeamActivity(["alice", "bob"], "2026-03-01", "2026-03-05", function(update) {
        progress.push(normalize(update));
    });

    assert.deepEqual(normalize(result.map(function(e) {
        return { pageTitle: e.pageTitle, action: e.action, userKey: e.userKey, space: e.space };
    })), [
        { pageTitle: "Alice page", action: "created", userKey: "alice", space: "DOC" },
        { pageTitle: "Shared page", action: "updated", userKey: "bob", space: "TEAM" },
        { pageTitle: "Bob page", action: "commented", userKey: "bob", space: "DOC" }
    ]);
    assert.deepEqual(progress[progress.length - 1], {
        phase: "confluence",
        loaded: 3,
        total: 3
    });
});

test("fetchTeamActivity resolves empty list without requests when no user keys", async function() {
    var jquery = createJqueryStub(function() {
        throw new Error("should not ajax");
    });
    var progress = [];
    var api = loadApi(jquery);
    var result = await api.fetchTeamActivity([], "2026-03-01", "2026-03-05", function(u) {
        progress.push(normalize(u));
    });
    assert.deepEqual(normalize(result), []);
    assert.deepEqual(progress, [{ phase: "confluence", loaded: 0, total: 0 }]);
});

test("fetchTeamActivity propagates ajax failure", async function() {
    var jquery = createJqueryStub(function() {
        return rejectedAjax("confluence down");
    });
    var api = loadApi(jquery);
    await assert.rejects(
        Promise.resolve(api.fetchTeamActivity(["x"], "2026-03-01", "2026-03-05")),
        /confluence down/
    );
});
