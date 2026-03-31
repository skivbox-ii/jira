const test = require("node:test");
const assert = require("node:assert/strict");
const assertLoose = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const loadAmdModule = require("./helpers/load-amd-module");

function createDeferred() {
    var state = "pending";
    var settledArgs = [];
    var doneHandlers = [];
    var failHandlers = [];
    var alwaysHandlers = [];
    var deferred = {
        resolve: function() {
            if (state !== "pending") return deferred;
            state = "resolved";
            settledArgs = Array.prototype.slice.call(arguments);
            doneHandlers.slice().forEach(function(handler) {
                handler.apply(null, settledArgs);
            });
            alwaysHandlers.slice().forEach(function(handler) {
                handler.apply(null, settledArgs);
            });
            alwaysHandlers.length = 0;
            return deferred;
        },
        reject: function() {
            if (state !== "pending") return deferred;
            state = "rejected";
            settledArgs = Array.prototype.slice.call(arguments);
            failHandlers.slice().forEach(function(handler) {
                handler.apply(null, settledArgs);
            });
            alwaysHandlers.slice().forEach(function(handler) {
                handler.apply(null, settledArgs);
            });
            alwaysHandlers.length = 0;
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
            } else {
                alwaysHandlers.push(handler);
            }
            return deferred;
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

function makeLocalStorage() {
    var store = Object.create(null);
    return {
        _data: store,
        getItem: function(k) {
            return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
        },
        setItem: function(k, v) {
            store[k] = String(v);
        },
        removeItem: function(k) {
            delete store[k];
        }
    };
}

function createFakeTimers() {
    var nextId = 1;
    var pending = Object.create(null);
    return {
        setTimeout: function(fn) {
            var id = nextId++;
            pending[id] = fn;
            return id;
        },
        clearTimeout: function(id) {
            delete pending[id];
        },
        runPending: function() {
            Object.keys(pending).forEach(function(id) {
                var fn = pending[id];
                delete pending[id];
                fn();
            });
        }
    };
}

function loadTeamStore(jquery, windowMock, localStorageMock, extraGlobals) {
    var globals = {
        window: windowMock,
        localStorage: localStorageMock,
        RegExp: RegExp,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout
    };
    if (extraGlobals) {
        Object.keys(extraGlobals).forEach(function(k) {
            globals[k] = extraGlobals[k];
        });
    }
    return loadAmdModule(
        path.join(__dirname, "..", "ujg-shared-modules", "team-store.js"),
        {
            jquery: jquery
        },
        globals
    );
}

function loadTeamPicker(jquery, extraGlobals) {
    var globals = Object.assign(
        {
            document: createFakeDocument(),
            setTimeout: setTimeout,
            clearTimeout: clearTimeout
        },
        extraGlobals || {}
    );
    return loadAmdModule(
        path.join(__dirname, "..", "ujg-shared-modules", "team-picker.js"),
        {
            jquery: jquery
        },
        globals
    );
}

function loadSharedModuleTwiceInAmdContext(fileName, amdId) {
    var filePath = path.join(__dirname, "..", "ujg-shared-modules", fileName);
    var source = fs.readFileSync(filePath, "utf8");
    var amdRegistry = Object.create(null);
    var defineCalls = 0;
    var sandbox = {
        define: function(name, deps, factory) {
            if (typeof deps === "function") {
                factory = deps;
                deps = [];
            }
            if (Object.prototype.hasOwnProperty.call(amdRegistry, name)) {
                throw new Error("duplicate define: " + name);
            }
            amdRegistry[name] = {
                deps: deps || [],
                factory: factory
            };
            defineCalls += 1;
        },
        requirejs: {
            defined: function(name) {
                return Object.prototype.hasOwnProperty.call(amdRegistry, name);
            }
        }
    };
    sandbox.define.amd = true;

    vm.runInNewContext(source, sandbox, { filename: filePath });
    vm.runInNewContext(source, sandbox, { filename: filePath });

    assert.ok(Object.prototype.hasOwnProperty.call(amdRegistry, amdId));
    return defineCalls;
}

function loadTeamManager(jquery, windowMock, localStorageMock, configOverrides, extraGlobals) {
    var config = {
        jiraBaseUrl: "https://jira.example.com",
        STORAGE_KEY: "ujg-dd-teams",
        ICONS: {
            users: "<svg></svg>",
            plus: "<svg></svg>",
            trash2: "<svg></svg>",
            x: "<svg></svg>",
            userPlus: "<svg></svg>",
            arrowLeft: "<svg></svg>"
        }
    };
    if (configOverrides) {
        Object.keys(configOverrides).forEach(function(k) {
            config[k] = configOverrides[k];
        });
    }
    var utils = {
        escapeHtml: function(t) {
            return String(t || "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
        },
        icon: function(name, cls) {
            var svg = config.ICONS[name] || "";
            if (!svg) return "";
            if (cls) {
                return svg.replace("<svg ", '<svg class="' + utils.escapeHtml(cls) + '" ');
            }
            return svg;
        },
        pluralize: function(n, one, few, many) {
            var x = Math.abs(Math.floor(Number(n))) % 100;
            var x1 = x % 10;
            if (x > 10 && x < 20) return many;
            if (x1 > 1 && x1 < 5) return few;
            if (x1 === 1) return one;
            return many;
        }
    };
    var globals = {
        window: windowMock,
        localStorage: localStorageMock,
        RegExp: RegExp,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout
    };
    if (extraGlobals) {
        Object.keys(extraGlobals).forEach(function(k) {
            globals[k] = extraGlobals[k];
        });
    }
    var sharedTeamStore = loadAmdModule(
        path.join(__dirname, "..", "ujg-shared-modules", "team-store.js"),
        {
            jquery: jquery
        },
        globals
    );
    return loadAmdModule(
        path.join(__dirname, "..", "ujg-daily-diligence-modules", "team-manager.js"),
        {
            jquery: jquery,
            _ujgShared_teamStore: sharedTeamStore,
            _ujgDD_config: config,
            _ujgDD_utils: utils
        },
        globals
    );
}

test("shared team-store skips duplicate AMD define when loader already has the module", function() {
    assert.equal(loadSharedModuleTwiceInAmdContext("team-store.js", "_ujgShared_teamStore"), 1);
});

test("shared team-picker skips duplicate AMD define when loader already has the module", function() {
    assert.equal(loadSharedModuleTwiceInAmdContext("team-picker.js", "_ujgShared_teamPicker"), 1);
});

test("shared team-store normalizes teams and matches team-manager loadTeams", async function() {
    var ls = makeLocalStorage();
    var remote = [{ id: "t1", name: "Alpha", memberKeys: [] }];
    var jq = createJqueryStub(function(options) {
        if (options.type === "GET" && options.url.indexOf("/rest/api/2/dashboard/77/properties/ujg-dd-teams") !== -1) {
            return resolvedAjax({ key: "ujg-dd-teams", value: { teams: remote } });
        }
        return resolvedAjax({});
    });
    var win = { location: { search: "?selectPageId=77", origin: "https://jira.example.com" }, AJS: { params: {} } };
    var store = loadTeamStore(jq, win, ls);
    var tm = loadTeamManager(jq, win, ls);

    assert.deepEqual(
        store.normalizeTeams([{ id: "platform", name: "Platform", memberKeys: ["u1", "u2"] }]),
        [{ id: "platform", name: "Platform", memberKeys: ["u1", "u2"] }]
    );

    var fromStore = await new Promise(function(resolve, reject) {
        store.loadTeams().done(resolve).fail(reject);
    });
    var fromManager = await new Promise(function(resolve, reject) {
        tm.loadTeams().done(resolve).fail(reject);
    });
    assert.deepEqual(fromStore, fromManager);
});

test("shared team-store create respects provided jiraBaseUrl and storageKey", async function() {
    var ls = makeLocalStorage();
    ls.setItem("custom-teams", JSON.stringify({ teams: [{ id: "loc", name: "Local", memberKeys: [] }] }));
    var remote = [{ id: "rt", name: "Remote", memberKeys: [] }];
    var jq = createJqueryStub(function(options) {
        if (options.type === "GET" && options.url === "https://custom.example/jira/rest/api/2/dashboard/77/properties/custom-teams") {
            return resolvedAjax({ key: "custom-teams", value: { teams: remote } });
        }
        if (options.type === "PUT" && options.url === "https://custom.example/jira/rest/api/2/dashboard/77/properties/custom-teams") {
            return resolvedAjax({});
        }
        return resolvedAjax({});
    });
    var win = { location: { search: "?selectPageId=77", origin: "https://jira.example.com" }, AJS: { params: {} } };
    var storeMod = loadTeamStore(jq, win, ls);
    var store = storeMod.create({
        jiraBaseUrl: "https://custom.example/jira",
        storageKey: "custom-teams"
    });

    var loaded = await new Promise(function(resolve, reject) {
        store.loadTeams().done(resolve).fail(reject);
    });
    assert.deepEqual(loaded, remote);

    await new Promise(function(resolve, reject) {
        store.saveTeams([{ id: "sv", name: "Saved", memberKeys: [] }]).done(resolve).fail(reject);
    });

    assert.equal(
        jq.__calls.filter(function(call) {
            return call.url === "https://custom.example/jira/rest/api/2/dashboard/77/properties/custom-teams";
        }).length,
        2
    );
    assert.deepEqual(JSON.parse(ls.getItem("custom-teams")).teams, [{ id: "sv", name: "Saved", memberKeys: [] }]);
});

test("shared team-picker reports selected team ids (multi and single)", function() {
    var $ = enrichMiniJquery(createMiniJquery());
    var pickerMod = loadTeamPicker($, { document: createFakeDocument() });
    var teams = [
        { id: "a", name: "Alpha", memberKeys: [] },
        { id: "b", name: "Beta", memberKeys: [] }
    ];
    var multiIds = [];
    var $wrap = $("<div/>");
    var multi = pickerMod.create({
        mode: "multi",
        teams: teams,
        selectedTeamIds: [],
        onChange: function(ids) {
            multiIds.push(ids.slice());
        },
        $container: $wrap
    });
    multi.openPanel();
    var $panel = $wrap.find(".ujg-st-team-picker-panel");
    var $cb0 = $panel.find(".ujg-st-team-picker-cb").eq(0);
    var $cb1 = $panel.find(".ujg-st-team-picker-cb").eq(1);
    $cb0.prop("checked", true);
    $cb0[0].dispatchEvent({ type: "change", bubbles: true });
    assert.equal(JSON.stringify(multiIds[multiIds.length - 1]), JSON.stringify(["a"]));
    $cb1.prop("checked", true);
    $cb1[0].dispatchEvent({ type: "change", bubbles: true });
    assert.equal(JSON.stringify(multi.getSelectedTeamIds().slice().sort()), JSON.stringify(["a", "b"]));
    $wrap.find(".ujg-st-team-picker-reset")[0].dispatchEvent({ type: "click", bubbles: true });
    assert.equal(JSON.stringify(multi.getSelectedTeamIds()), JSON.stringify([]));

    var singleIds = [];
    var $w2 = $("<div/>");
    var single = pickerMod.create({
        mode: "single",
        teams: teams,
        selectedTeamIds: [],
        onChange: function(ids) {
            singleIds.push(ids.slice());
        },
        $container: $w2
    });
    single.openPanel();
    var $radio1 = $w2.find(".ujg-st-team-picker-radio").eq(1);
    $radio1.prop("checked", true);
    $radio1[0].dispatchEvent({ type: "change", bubbles: true });
    assert.equal(JSON.stringify(single.getSelectedTeamIds()), JSON.stringify(["b"]));
    assert.equal(JSON.stringify(singleIds[singleIds.length - 1]), JSON.stringify(["b"]));
});

test("shared team-picker supports custom labels and destroy detaches document listener", function() {
    var trackedDocument = createTrackedDocument();
    var $ = enrichMiniJquery(createMiniJquery());
    var pickerMod = loadTeamPicker($, { document: trackedDocument });
    var $wrap = $("<div/>");
    var picker = pickerMod.create({
        mode: "single",
        teams: [{ id: "a", name: "Alpha", memberKeys: ["u1", "u2"] }],
        selectedTeamIds: ["a"],
        getTeamLabel: function(team) {
            return team.name + " (" + team.memberKeys.length + ")";
        },
        $container: $wrap
    });

    assert.equal($wrap.find(".ujg-st-team-picker-trigger").text(), "Alpha (2)");

    picker.openPanel();

    assert.equal(trackedDocument.totalListeners(), 1);
    assert.equal($wrap.find(".ujg-st-team-picker-row").eq(0)[0].children[1].textContent, "Alpha (2)");

    picker.destroy();

    assert.equal(trackedDocument.totalListeners(), 0);
    assert.equal($wrap.find(".ujg-st-team-picker").length, 0);
});

test("detectDashboardId reads selectPageId from URL or AJS.params", function() {
    var ls = makeLocalStorage();
    var jq = createJqueryStub(function() {
        return resolvedAjax({});
    });
    var tm1 = loadTeamManager(jq, { location: { search: "?selectPageId=99901" } }, ls);
    assert.equal(tm1.detectDashboardId(), "99901");

    var tm2 = loadTeamManager(jq, { location: { search: "" }, AJS: { params: { selectPageId: 42 } } }, ls);
    assert.equal(tm2.detectDashboardId(), "42");
});

test("loadTeams uses dashboard property when GET succeeds", async function() {
    var ls = makeLocalStorage();
    var remote = [{ id: "t1", name: "Alpha", memberKeys: [] }];
    var jq = createJqueryStub(function(options) {
        if (options.type === "GET" && options.url.indexOf("/rest/api/2/dashboard/77/properties/ujg-dd-teams") !== -1) {
            return resolvedAjax({ key: "ujg-dd-teams", value: { teams: remote } });
        }
        return resolvedAjax({});
    });
    var tm = loadTeamManager(jq, { location: { search: "?selectPageId=77" }, AJS: { params: {} } }, ls);
    var out = await new Promise(function(resolve, reject) {
        tm.loadTeams().done(resolve).fail(reject);
    });
    assert.deepEqual(out, remote);
    assert.deepEqual(tm.getTeams(), remote);
    assert.equal(jq.__calls.length, 1);
});

test("loadTeams falls back to localStorage when GET fails", async function() {
    var ls = makeLocalStorage();
    ls.setItem("ujg-dd-teams", JSON.stringify({ teams: [{ id: "loc", name: "L", memberKeys: [] }] }));
    var jq = createJqueryStub(function(options) {
        if (options.type === "GET" && options.url.indexOf("/properties/ujg-dd-teams") !== -1) {
            return rejectedAjax({ status: 404 });
        }
        return resolvedAjax({});
    });
    var tm = loadTeamManager(jq, { location: { search: "?selectPageId=1" } }, ls);
    var out = await new Promise(function(resolve, reject) {
        tm.loadTeams().done(resolve).fail(reject);
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "loc");
});

test("loadTeams uses localStorage when dashboard id is missing", async function() {
    var ls = makeLocalStorage();
    ls.setItem("ujg-dd-teams", JSON.stringify({ teams: [{ id: "x", name: "X", memberKeys: [] }] }));
    var jq = createJqueryStub(function() {
        return resolvedAjax({});
    });
    var tm = loadTeamManager(jq, { location: { search: "" } }, ls);
    var out = await new Promise(function(resolve, reject) {
        tm.loadTeams().done(resolve).fail(reject);
    });
    assert.equal(out[0].id, "x");
    assert.equal(jq.__calls.filter(function(c) {
        return c.type === "GET" && String(c.url || "").indexOf("dashboard") !== -1;
    }).length, 0);
});

test("saveTeams sends PUT and mirrors localStorage", async function() {
    var ls = makeLocalStorage();
    var next = [{ id: "a", name: "A", memberKeys: ["u1"] }];
    var jq = createJqueryStub(function(options) {
        if (options.type === "PUT" && options.url.indexOf("/rest/api/2/dashboard/5/properties/ujg-dd-teams") !== -1) {
            var body = JSON.parse(options.data);
            assert.deepEqual(body.teams, next);
            assert.ok(body.displayNameByKey && typeof body.displayNameByKey === "object");
            return resolvedAjax({});
        }
        return resolvedAjax({});
    });
    var tm = loadTeamManager(jq, { location: { search: "?selectPageId=5" } }, ls);
    await new Promise(function(resolve, reject) {
        tm.saveTeams(next).done(resolve).fail(reject);
    });
    assert.deepEqual(tm.getTeams(), next);
    var cached = JSON.parse(ls.getItem("ujg-dd-teams"));
    assert.deepEqual(cached.teams, next);
    assert.ok(cached.displayNameByKey && typeof cached.displayNameByKey === "object");
});

test("saveTeams rejects when PUT fails but keeps localStorage", async function() {
    var ls = makeLocalStorage();
    var next = [{ id: "b", name: "B", memberKeys: [] }];
    var jq = createJqueryStub(function(options) {
        if (options.type === "PUT") {
            return rejectedAjax({ status: 403 });
        }
        return resolvedAjax({});
    });
    var tm = loadTeamManager(jq, { location: { search: "?selectPageId=5" } }, ls);
    await assert.rejects(
        new Promise(function(resolve, reject) {
            tm.saveTeams(next).done(resolve).fail(function() {
                reject(new Error("fail"));
            });
        }),
        /fail/
    );
    assert.deepEqual(tm.getTeams(), next);
    var disk = JSON.parse(ls.getItem("ujg-dd-teams"));
    assert.deepEqual(disk.teams, next);
    assert.ok(disk.displayNameByKey && typeof disk.displayNameByKey === "object");
});

test("searchUsers normalizes rows to key and displayName", async function() {
    var ls = makeLocalStorage();
    var jq = createJqueryStub(function(options) {
        if (String(options.url || "").indexOf("/rest/api/2/user/search") !== -1) {
            return resolvedAjax([
                { accountId: "acc-1", displayName: "One" },
                { key: "legacy", name: "Legacy Name" },
                { username: "u3", displayName: "Three" }
            ]);
        }
        return resolvedAjax([]);
    });
    var tm = loadTeamManager(jq, { location: { search: "" } }, ls);
    var rows = await new Promise(function(resolve, reject) {
        tm.searchUsers("q").done(resolve).fail(reject);
    });
    assertLoose.deepEqual(rows, [
        { key: "acc-1", displayName: "One" },
        { key: "legacy", displayName: "Legacy Name" },
        { key: "u3", displayName: "Three" }
    ]);
    var getCall = jq.__calls.find(function(c) {
        return String(c.url || "").indexOf("user/search") !== -1;
    });
    assert.equal(getCall.data.username, "q");
    assert.equal(getCall.data.maxResults, 20);
});

function enrichMiniJquery($) {
    $.fn.eq = function(idx) {
        var col = Object.create($.fn);
        var n = this[idx];
        col.length = n ? 1 : 0;
        col[0] = n;
        col.jquery = true;
        return col;
    };
    $.fn.prop = function(name, val) {
        if (arguments.length === 1) {
            if (name === "checked") return !!(this[0] && this[0]._checked);
            return undefined;
        }
        this.each(function() {
            if (name === "checked") this._checked = !!val;
        });
        return this;
    };
    $.fn.attr = function(name, val) {
        if (arguments.length === 1) {
            return this[0] && this[0]._attrs ? this[0]._attrs[name] : undefined;
        }
        this.each(function() {
            this._attrs = this._attrs || {};
            this._attrs[name] = val;
        });
        return this;
    };
    var origCss = $.fn.css;
    $.fn.css = function(k, v) {
        if (arguments.length === 2 && k === "display") {
            this.each(function() {
                this._ujgDisplay = v;
            });
            return this;
        }
        return origCss.apply(this, arguments);
    };
    $.fn.show = function() {
        return this.css("display", "block");
    };
    $.fn.hide = function() {
        return this.css("display", "none");
    };
    return $;
}

function createFakeDocument() {
    return {
        addEventListener: function() {},
        removeEventListener: function() {}
    };
}

function createTrackedDocument() {
    var listeners = Object.create(null);

    function getBucket(type) {
        var key = String(type || "");
        if (!listeners[key]) listeners[key] = [];
        return listeners[key];
    }

    return {
        addEventListener: function(type, handler) {
            getBucket(type).push(handler);
        },
        removeEventListener: function(type, handler) {
            var bucket = getBucket(type);
            var idx = bucket.indexOf(handler);
            if (idx >= 0) bucket.splice(idx, 1);
        },
        totalListeners: function() {
            return Object.keys(listeners).reduce(function(sum, type) {
                return sum + listeners[type].length;
            }, 0);
        }
    };
}

function createMiniJquery() {
    function parseTag(spec) {
        var m = /^<\s*(\w+)/i.exec(spec.trim());
        var tag = m ? m[1].toUpperCase() : "DIV";
        return {
            tagName: tag,
            className: "",
            style: {},
            _listeners: {},
            children: [],
            parentNode: null,
            appendChild: function(ch) {
                ch.parentNode = this;
                this.children.push(ch);
            },
            removeChild: function(ch) {
                var i = this.children.indexOf(ch);
                if (i >= 0) this.children.splice(i, 1);
                ch.parentNode = null;
            },
            addEventListener: function(ev, fn) {
                (this._listeners[ev] = this._listeners[ev] || []).push(fn);
            },
            dispatchEvent: function(ev) {
                if (!ev.target) ev.target = this;
                if (!ev.stopPropagation) {
                    ev.stopPropagation = function() {
                        ev._ujgStopped = true;
                    };
                }
                var node = this;
                while (node) {
                    ev.currentTarget = node;
                    var list = (node._listeners && node._listeners[ev.type]) || [];
                    list.slice().forEach(function(fn) {
                        fn.call(node, ev);
                    });
                    if (ev._ujgStopped || ev.bubbles === false) break;
                    node = node.parentNode;
                }
            },
            getAttribute: function() {
                return null;
            },
            querySelectorAll: function(sel) {
                var cls = sel.charAt(0) === "." ? sel.slice(1) : sel;
                var out = [];
                function walk(n) {
                    if (n.className && (" " + n.className + " ").indexOf(" " + cls + " ") >= 0) {
                        out.push(n);
                    }
                    n.children.forEach(walk);
                }
                walk(this);
                return out;
            }
        };
    }

    function $(arg) {
        if (arg && arg.jquery) return arg;
        if (typeof arg === "string" && /^\s*</.test(arg)) {
            return wrap([parseTag(arg)]);
        }
        if (arg && arg.length != null && arg[0] != null && !arg.jquery) {
            return wrap(Array.prototype.slice.call(arg));
        }
        return wrap(arg ? [arg] : []);
    }
    $.fn = $.prototype;

    function wrap(nodes) {
        var col = Object.create($.fn);
        col.length = nodes.length;
        for (var i = 0; i < nodes.length; i++) col[i] = nodes[i];
        col.jquery = true;
        return col;
    }

    $.fn.addClass = function(c) {
        var parts = String(c).trim().split(/\s+/);
        this.each(function() {
            var cur = this.className ? this.className.split(/\s+/).filter(Boolean) : [];
            parts.forEach(function(p) {
                if (p && cur.indexOf(p) < 0) cur.push(p);
            });
            this.className = cur.join(" ");
        });
        return this;
    };
    $.fn.each = function(fn) {
        for (var i = 0; i < this.length; i++) fn.call(this[i], i, this[i]);
        return this;
    };
    $.fn.append = function() {
        var self = this;
        for (var ai = 0; ai < arguments.length; ai++) {
            var other = arguments[ai];
            if (other == null) continue;
            var $o;
            if (typeof other === "string") {
                var span = parseTag("<span/>");
                span.innerHTML = other;
                $o = wrap([span]);
            } else if (other.jquery) {
                $o = other;
            } else {
                $o = $(other);
            }
            $o.each(function() {
                var ch = this;
                self.each(function() {
                    this.appendChild(ch);
                });
            });
        }
        return this;
    };
    $.fn.appendTo = function(target) {
        var $t = $(target);
        $t.append(this);
        return this;
    };
    $.fn.remove = function() {
        this.each(function() {
            if (this.parentNode) this.parentNode.removeChild(this);
        });
        return this;
    };
    $.fn.empty = function() {
        this.each(function() {
            while (this.children && this.children.length) {
                this.removeChild(this.children[0]);
            }
        });
        return this;
    };
    $.fn.find = function(sel) {
        var acc = [];
        this.each(function() {
            var q = this.querySelectorAll(sel);
            for (var i = 0; i < q.length; i++) acc.push(q[i]);
        });
        return wrap(acc);
    };
    function matchesClass(el, cls) {
        return el && el.className && (" " + el.className + " ").indexOf(" " + cls + " ") >= 0;
    }

    $.fn.on = function(ev, sel, fn) {
        if (typeof sel === "function") {
            fn = sel;
            sel = null;
        }
        this.each(function() {
            var node = this;
            if (!sel) {
                node.addEventListener(ev, fn);
                return;
            }
            var want = sel.charAt(0) === "." ? sel.slice(1) : sel;
            node.addEventListener(ev, function(e) {
                var t = e.target;
                while (t && t !== node) {
                    if (matchesClass(t, want)) {
                        fn.call(t, e);
                        return;
                    }
                    t = t.parentNode;
                }
            });
        });
        return this;
    };
    $.fn.off = function() {
        var ev = arguments[0];
        var fn = arguments[1];
        this.each(function() {
            if (typeof this.removeEventListener === "function" && ev && fn) {
                this.removeEventListener(ev, fn);
            }
        });
        return this;
    };
    $.fn.val = function(v) {
        if (arguments.length === 0) return this[0] ? this[0]._value || "" : "";
        this.each(function() {
            this._value = v;
        });
        return this;
    };
    $.fn.closest = function(sel) {
        var cls = sel.charAt(0) === "." ? sel.slice(1) : sel;
        var out = [];
        this.each(function() {
            var n = this;
            while (n) {
                if (n.className && (" " + n.className + " ").indexOf(" " + cls + " ") >= 0) {
                    out.push(n);
                    break;
                }
                n = n.parentNode;
            }
        });
        return wrap(out);
    };
    $.fn.toArray = function() {
        var a = [];
        for (var i = 0; i < this.length; i++) a.push(this[i]);
        return a;
    };
    $.fn.trigger = function(type) {
        this.each(function() {
            this.dispatchEvent({ type: type, bubbles: true });
        });
        return this;
    };
    $.fn.html = function(h) {
        if (arguments.length === 0) return "";
        return this;
    };
    $.fn.text = function(t) {
        if (arguments.length === 0) return this[0] ? this[0].textContent || "" : "";
        this.each(function() {
            this.textContent = t;
        });
        return this;
    };
    $.fn.css = function() {
        return this;
    };
    $.fn.attr = function() {
        return this;
    };
    $.fn.focus = function() {
        return this;
    };

    $.extend = function(a, b) {
        if (!b) return a;
        Object.keys(b).forEach(function(k) {
            a[k] = b[k];
        });
        return a;
    };
    $.Deferred = createDeferred;
    $.ajax = function() {
        return resolvedAjax([]);
    };

    return $;
}

test("create tolerates legacy teams without memberKeys after loadTeams", async function() {
    var ls = makeLocalStorage();
    ls.setItem("ujg-dd-teams", JSON.stringify({ teams: [{ id: "legacy", name: "Legacy" }] }));
    var ajax = createJqueryStub(function() {
        return resolvedAjax({});
    });
    var $ = createMiniJquery();
    $.ajax = ajax.ajax;
    $.Deferred = ajax.Deferred;

    var tm = loadTeamManager($, { location: { search: "" } }, ls);
    await new Promise(function(resolve, reject) {
        tm.loadTeams().done(resolve).fail(reject);
    });

    var $parent = $("<div/>");
    assert.doesNotThrow(function() {
        tm.create($parent, function() {});
    });
    assert.equal($parent.find(".ujg-dd-teams-overlay").length, 1);
    assert.equal(Array.isArray(tm.getTeams()[0].memberKeys), true);
    assert.equal(tm.getTeams()[0].memberKeys.length, 0);
});

test("render clears pending debounced search before rerender", async function() {
    var ls = makeLocalStorage();
    var timers = createFakeTimers();
    var ajax = createJqueryStub(function(options) {
        if (options.type === "PUT") {
            return resolvedAjax({});
        }
        if (String(options.url || "").indexOf("/rest/api/2/user/search") !== -1) {
            return resolvedAjax([{ accountId: "u1", displayName: "Ann" }]);
        }
        return resolvedAjax({});
    });
    var $ = createMiniJquery();
    $.ajax = ajax.ajax;
    $.Deferred = ajax.Deferred;

    var tm = loadTeamManager(
        $,
        { location: { search: "?selectPageId=9" } },
        ls,
        null,
        {
            setTimeout: timers.setTimeout,
            clearTimeout: timers.clearTimeout
        }
    );
    await new Promise(function(resolve, reject) {
        tm.loadTeams().done(resolve).fail(reject);
    });

    var $parent = $("<div/>");
    tm.create($parent, function() {});

    $parent.find(".ujg-dd-teams-new")[0].dispatchEvent({ type: "click", bubbles: true });
    $parent.find(".ujg-dd-teams-new-name").val("Alpha");
    $parent.find(".ujg-dd-teams-create-submit")[0].dispatchEvent({ type: "click", bubbles: true });

    var $searchInput = $parent.find(".ujg-dd-teams-user-search");
    assert.equal($searchInput.length, 1);
    $searchInput.val("ann");
    $searchInput[0].dispatchEvent({ type: "input" });

    assert.equal(ajax.__calls.filter(function(call) {
        return String(call.url || "").indexOf("/rest/api/2/user/search") !== -1;
    }).length, 0);

    $parent.find(".ujg-dd-teams-new")[0].dispatchEvent({ type: "click", bubbles: true });
    timers.runPending();

    assert.equal(ajax.__calls.filter(function(call) {
        return String(call.url || "").indexOf("/rest/api/2/user/search") !== -1;
    }).length, 0);
});

test("create appends overlay and new team triggers onChange", async function() {
    var ls = makeLocalStorage();
    var saved = [];
    var jq = createJqueryStub(function(options) {
        if (options.type === "PUT") {
            saved.push(JSON.parse(options.data));
            return resolvedAjax({});
        }
        return resolvedAjax({});
    });
    var $ = createMiniJquery();
    var jquery = $;
    jquery.ajax = jq.ajax;
    jquery.Deferred = jq.Deferred;

    var tm = loadTeamManager(jquery, { location: { search: "?selectPageId=9" } }, ls);
    await new Promise(function(resolve, reject) {
        tm.loadTeams().done(resolve).fail(reject);
    });

    var $parent = $("<div/>");
    var changes = [];
    var ctrl = tm.create($parent, function(teams) {
        changes.push(JSON.parse(JSON.stringify(teams)));
    });

    var overlay = $parent.find(".ujg-dd-teams-overlay");
    assert.equal(overlay.length, 1);

    var newBtn = $parent.find(".ujg-dd-teams-new");
    assert.equal(newBtn.length, 1);
    newBtn[0].dispatchEvent({ type: "click", bubbles: true });

    var input = $parent.find(".ujg-dd-teams-new-name");
    assert.equal(input.length, 1);
    input.val("Team Z");
    var createBtn = $parent.find(".ujg-dd-teams-create-submit");
    createBtn[0].dispatchEvent({ type: "click", bubbles: true });

    await new Promise(function(r) {
        setImmediate(r);
    });

    assert.equal(changes.length >= 1, true);
    assert.equal(changes[changes.length - 1].length, 1);
    assert.equal(changes[changes.length - 1][0].name, "Team Z");
    assert.equal(saved.length >= 1, true);

    ctrl.close();
    assert.equal($parent.find(".ujg-dd-teams-overlay").length, 0);
});

test("loadTeams restores memberLabel from persisted displayNameByKey (localStorage)", async function() {
    var ls = makeLocalStorage();
    ls.setItem(
        "ujg-dd-teams",
        JSON.stringify({
            teams: [{ id: "t1", name: "Crew", memberKeys: ["JIRAUSER12028"] }],
            displayNameByKey: { JIRAUSER12028: "Ivan Petrov" }
        })
    );
    var jq = createJqueryStub(function() {
        return resolvedAjax({});
    });
    var tm = loadTeamManager(jq, { location: { search: "" } }, ls);
    await new Promise(function(resolve, reject) {
        tm.loadTeams().done(resolve).fail(reject);
    });
    assert.equal(tm.memberLabel("JIRAUSER12028"), "Ivan Petrov");
});

test("loadTeams restores display names from dashboard property payload", async function() {
    var ls = makeLocalStorage();
    var remote = [{ id: "t1", name: "Crew", memberKeys: ["acc-99"] }];
    var jq = createJqueryStub(function(options) {
        if (options.type === "GET" && options.url.indexOf("/rest/api/2/dashboard/77/properties/ujg-dd-teams") !== -1) {
            return resolvedAjax({
                key: "ujg-dd-teams",
                value: {
                    teams: remote,
                    displayNameByKey: { "acc-99": "Cloud User" }
                }
            });
        }
        return resolvedAjax({});
    });
    var tm = loadTeamManager(jq, { location: { search: "?selectPageId=77" }, AJS: { params: {} } }, ls);
    await new Promise(function(resolve, reject) {
        tm.loadTeams().done(resolve).fail(reject);
    });
    assert.equal(tm.memberLabel("acc-99"), "Cloud User");
});

test("saveTeams PUT includes displayNameByKey merged from loaded local metadata", async function() {
    var ls = makeLocalStorage();
    ls.setItem(
        "ujg-dd-teams",
        JSON.stringify({
            teams: [{ id: "a", name: "A", memberKeys: ["u1"] }],
            displayNameByKey: { u1: "Saved Name" }
        })
    );
    var putBodies = [];
    var jq = createJqueryStub(function(options) {
        if (options.type === "GET" && options.url.indexOf("/properties/ujg-dd-teams") !== -1) {
            return resolvedAjax({ key: "ujg-dd-teams", value: { teams: [{ id: "a", name: "A", memberKeys: ["u1"] }] } });
        }
        if (options.type === "PUT" && options.url.indexOf("/properties/ujg-dd-teams") !== -1) {
            putBodies.push(JSON.parse(options.data));
            return resolvedAjax({});
        }
        return resolvedAjax({});
    });
    var tm = loadTeamManager(jq, { location: { search: "?selectPageId=5" } }, ls);
    await new Promise(function(resolve, reject) {
        tm.loadTeams().done(resolve).fail(reject);
    });
    await new Promise(function(resolve, reject) {
        tm.saveTeams(tm.getTeams()).done(resolve).fail(reject);
    });
    assert.equal(putBodies.length, 1);
    assert.deepEqual(putBodies[0].displayNameByKey.u1, "Saved Name");
});

test("legacy teams without displayNameByKey backfill display names via GET /rest/api/2/user", async function() {
    var ls = makeLocalStorage();
    ls.setItem(
        "ujg-dd-teams",
        JSON.stringify({
            teams: [{ id: "leg", name: "Legacy", memberKeys: ["JIRAUSER12028"] }]
        })
    );
    var userCalls = [];
    var jq = createJqueryStub(function(options) {
        var url = String(options.url || "");
        if (url.indexOf("/rest/api/2/user") !== -1 && url.indexOf("user/search") === -1) {
            userCalls.push(options);
            assert.equal(options.data.key, "JIRAUSER12028");
            return resolvedAjax({ key: "JIRAUSER12028", displayName: "Alice Example" });
        }
        return resolvedAjax({});
    });
    var tm = loadTeamManager(jq, { location: { search: "" } }, ls);
    await new Promise(function(resolve, reject) {
        tm.loadTeams().done(resolve).fail(reject);
    });
    assert.equal(userCalls.length, 1);
    assert.equal(tm.memberLabel("JIRAUSER12028"), "Alice Example");
    var cached = JSON.parse(ls.getItem("ujg-dd-teams"));
    assert.equal(cached.displayNameByKey.JIRAUSER12028, "Alice Example");
});
