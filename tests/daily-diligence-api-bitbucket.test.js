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

function extend(target) {
    var out = target || {};
    var i;
    var source;
    var key;
    for (i = 1; i < arguments.length; i++) {
        source = arguments[i] || {};
        for (key in source) {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
                out[key] = source[key];
            }
        }
    }
    return out;
}

function createJqueryStub(handler) {
    var calls = [];
    return {
        ajax: function(options) {
            calls.push(normalize(options));
            return handler(options);
        },
        Deferred: createDeferred,
        extend: extend,
        when: function() {
            var deferred = createDeferred();
            var inputs = Array.prototype.slice.call(arguments);
            var pending = inputs.length;
            var results = new Array(inputs.length);

            if (pending === 0) {
                deferred.resolve();
                return deferred.promise();
            }

            inputs.forEach(function(input, index) {
                input.done(function() {
                    results[index] = Array.prototype.slice.call(arguments);
                    pending -= 1;
                    if (pending === 0) {
                        deferred.resolve.apply(deferred, results);
                    }
                }).fail(function(err) {
                    deferred.reject(err);
                });
            });

            return deferred.promise();
        },
        __calls: calls
    };
}

function loadApi(jquery) {
    return loadAmdModule(path.join(__dirname, "..", "ujg-daily-diligence-modules", "api-bitbucket.js"), {
        jquery: jquery,
        _ujgDD_config: {
            bitbucketBaseUrl: "https://bitbucket.example.com"
        }
    });
}

function makePullRequest(id, authorName, reviewerName) {
    return {
        id: id,
        createdDate: Date.parse("2026-03-02T10:00:00.000Z"),
        updatedDate: Date.parse("2026-03-03T10:00:00.000Z"),
        author: { user: { name: authorName } },
        reviewers: reviewerName ? [{ user: { name: reviewerName } }] : [],
        fromRef: {
            repository: {
                slug: "repo-" + id,
                project: { key: "PROJ" }
            }
        }
    };
}

test("fetchTeamActivity requests dashboard PRs per user and role with dedupe", async function() {
    var sharedPr = makePullRequest(101, "u1", "u2");
    var reviewerOnlyPr = makePullRequest(102, "u2", "u1");
    var progress = [];

    var jquery = createJqueryStub(function(options) {
        if (/\/dashboard\/pull-requests$/.test(options.url)) {
            var user = options.data.user;
            var role = options.data.role;
            if (user === "u1" && role === "AUTHOR") return resolvedAjax({ values: [sharedPr] });
            if (user === "u1" && role === "REVIEWER") return resolvedAjax({ values: [reviewerOnlyPr] });
            if (user === "u2" && role === "AUTHOR") return resolvedAjax({ values: [reviewerOnlyPr] });
            if (user === "u2" && role === "REVIEWER") return resolvedAjax({ values: [sharedPr] });
            return resolvedAjax({ values: [] });
        }
        if (/\/rest\/api\/1\.0\/users\/[^/]+\/repos$/.test(options.url)) {
            return resolvedAjax({ values: [] });
        }
        throw new Error("Unexpected AJAX call: " + JSON.stringify(normalize(options)));
    });

    var api = loadApi(jquery);
    var result = await api.fetchTeamActivity(["u1", "u2"], "2026-03-01", "2026-03-05", function(update) {
        progress.push(normalize(update));
    });

    var prCalls = jquery.__calls.filter(function(call) {
        return /\/dashboard\/pull-requests$/.test(call.url);
    });
    var prCallKeys = prCalls.map(function(call) {
        return call.url + "|" + call.data.user + "|" + call.data.role;
    }).sort();

    assert.equal(result.pullRequests.length, 2);
    assert.deepEqual(normalize(result.pullRequests.map(function(pr) { return pr.id; }).sort()), [101, 102]);
    assert.equal(prCalls.length, 4);
    assert.deepEqual(prCallKeys, [
        "https://bitbucket.example.com/rest/api/latest/dashboard/pull-requests|u1|AUTHOR",
        "https://bitbucket.example.com/rest/api/latest/dashboard/pull-requests|u1|REVIEWER",
        "https://bitbucket.example.com/rest/api/latest/dashboard/pull-requests|u2|AUTHOR",
        "https://bitbucket.example.com/rest/api/latest/dashboard/pull-requests|u2|REVIEWER"
    ]);
    assert.ok(progress.some(function(update) {
        return update.phase === "bitbucket-pr" && update.loaded === 0 && update.total === 4;
    }));
    assert.ok(progress.some(function(update) {
        return update.phase === "bitbucket-pr" && update.loaded === 4 && update.total === 4;
    }));
});

test("fetchTeamActivity rejects when commit fetching fails", async function() {
    var jquery = createJqueryStub(function(options) {
        if (/\/dashboard\/pull-requests$/.test(options.url)) {
            return resolvedAjax({ values: [] });
        }
        if (options.url === "https://bitbucket.example.com/rest/api/1.0/users/u1/repos") {
            return resolvedAjax({
                values: [
                    {
                        slug: "repo-a",
                        project: { key: "PROJ" }
                    }
                ]
            });
        }
        if (options.url === "https://bitbucket.example.com/rest/api/latest/projects/PROJ/repos/repo-a/commits") {
            return rejectedAjax("commit fetch failed");
        }
        throw new Error("Unexpected AJAX call: " + JSON.stringify(normalize(options)));
    });

    var api = loadApi(jquery);

    await assert.rejects(
        Promise.resolve(api.fetchTeamActivity(["u1"], "2026-03-01", "2026-03-05")),
        /commit fetch failed/
    );
});
