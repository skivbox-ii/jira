const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
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

function hasClass(node, cls) {
    return !!(node && node.className && (" " + node.className + " ").indexOf(" " + cls + " ") >= 0);
}

function setClassName(node, className) {
    node.className = String(className || "").trim();
    if (node.className) {
        node.attributes.class = node.className;
    } else {
        delete node.attributes.class;
    }
}

function createNode(tagName) {
    return {
        tagName: String(tagName || "div").toUpperCase(),
        className: "",
        attributes: Object.create(null),
        properties: Object.create(null),
        style: {},
        children: [],
        parentNode: null,
        textContent: "",
        htmlContent: "",
        value: "",
        _listeners: Object.create(null),
        appendChild: function(child) {
            if (!child) return;
            child.parentNode = this;
            this.children.push(child);
        },
        removeChild: function(child) {
            var index = this.children.indexOf(child);
            if (index >= 0) {
                this.children.splice(index, 1);
                child.parentNode = null;
            }
        },
        addEventListener: function(type, handler) {
            (this._listeners[type] = this._listeners[type] || []).push(handler);
        },
        dispatchEvent: function(event) {
            if (!event.target) event.target = this;
            if (!event.stopPropagation) {
                event.stopPropagation = function() {
                    event._ujgStopped = true;
                };
            }
            if (!event.preventDefault) {
                event.preventDefault = function() {
                    event.defaultPrevented = true;
                };
            }
            var node = this;
            while (node) {
                event.currentTarget = node;
                ((node._listeners && node._listeners[event.type]) || []).slice().forEach(function(handler) {
                    handler.call(node, event);
                });
                if (event._ujgStopped || event.bubbles === false) break;
                node = node.parentNode;
            }
        },
        setAttribute: function(name, value) {
            var key = String(name);
            var stringValue = String(value);
            this.attributes[key] = stringValue;
            if (key === "class") setClassName(this, stringValue);
            if (key === "value") this.value = stringValue;
        },
        getAttribute: function(name) {
            var key = String(name);
            if (key === "class") return this.className || null;
            if (key === "value") return this.value;
            return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null;
        },
        querySelectorAll: function(selector) {
            var out = [];
            function walk(node) {
                if (matchesSelector(node, selector)) out.push(node);
                node.children.forEach(walk);
            }
            walk(this);
            return out;
        }
    };
}

function createHtmlNode(html) {
    var node = createNode("#html");
    node.htmlContent = String(html || "");
    return node;
}

function matchesSelector(node, selector) {
    if (!node || !selector) return false;
    if (selector.charAt(0) === ".") return hasClass(node, selector.slice(1));
    return node.tagName === String(selector).toUpperCase();
}

function nodeText(node) {
    if (!node) return "";
    var text = node.textContent || "";
    node.children.forEach(function(child) {
        text += nodeText(child);
    });
    return text;
}

function parseTag(spec) {
    var trimmed = String(spec || "").trim();
    var tagMatch = /^<\s*([a-z0-9-]+)/i.exec(trimmed);
    var node = createNode(tagMatch ? tagMatch[1] : "div");
    var attrPattern = /([a-zA-Z_:][a-zA-Z0-9_:\-.]*)="([^"]*)"/g;
    var attrMatch;
    while ((attrMatch = attrPattern.exec(trimmed))) {
        node.setAttribute(attrMatch[1], attrMatch[2]);
    }
    return node;
}

function createMiniJquery(documentNode) {
    function $(arg) {
        if (arg && arg.jquery) return arg;
        if (typeof arg === "string" && /^\s*</.test(arg)) {
            return wrap([parseTag(arg)]);
        }
        if (arg && arg.length != null && arg[0] != null && !arg.jquery && typeof arg !== "string") {
            return wrap(Array.prototype.slice.call(arg));
        }
        return wrap(arg ? [arg] : []);
    }

    function wrap(nodes) {
        var collection = Object.create($.fn);
        collection.length = nodes.length;
        collection.jquery = true;
        for (var i = 0; i < nodes.length; i++) {
            collection[i] = nodes[i];
        }
        return collection;
    }

    $.fn = {};

    $.fn.each = function(handler) {
        for (var i = 0; i < this.length; i++) {
            handler.call(this[i], i, this[i]);
        }
        return this;
    };

    $.fn.addClass = function(className) {
        var parts = String(className || "").trim().split(/\s+/).filter(Boolean);
        return this.each(function() {
            var current = this.className ? this.className.split(/\s+/).filter(Boolean) : [];
            parts.forEach(function(part) {
                if (current.indexOf(part) < 0) current.push(part);
            });
            setClassName(this, current.join(" "));
        });
    };

    $.fn.append = function() {
        var self = this;
        Array.prototype.slice.call(arguments).forEach(function(item) {
            if (item == null) return;
            var $item;
            if (typeof item === "string") {
                $item = wrap([createHtmlNode(item)]);
            } else if (item.jquery) {
                $item = item;
            } else {
                $item = $(item);
            }
            $item.each(function() {
                var child = this;
                self.each(function() {
                    this.appendChild(child);
                });
            });
        });
        return this;
    };

    $.fn.appendTo = function(target) {
        $(target).append(this);
        return this;
    };

    $.fn.empty = function() {
        return this.each(function() {
            this.children = [];
            this.textContent = "";
            this.htmlContent = "";
        });
    };

    $.fn.remove = function() {
        return this.each(function() {
            if (this.parentNode) this.parentNode.removeChild(this);
        });
    };

    $.fn.find = function(selector) {
        var out = [];
        this.each(function() {
            this.querySelectorAll(selector).forEach(function(node) {
                out.push(node);
            });
        });
        return wrap(out);
    };

    $.fn.on = function(type, handler) {
        return this.each(function() {
            this.addEventListener(type, handler);
        });
    };

    $.fn.off = function() {
        return this;
    };

    $.fn.trigger = function(type) {
        return this.each(function() {
            this.dispatchEvent({ type: type, bubbles: true });
        });
    };

    $.fn.text = function(value) {
        if (arguments.length === 0) {
            return this[0] ? nodeText(this[0]) : "";
        }
        return this.each(function() {
            this.children = [];
            this.htmlContent = "";
            this.textContent = String(value);
        });
    };

    $.fn.html = function(value) {
        if (arguments.length === 0) {
            return this[0] ? this[0].htmlContent : "";
        }
        return this.each(function() {
            this.children = [];
            this.textContent = "";
            this.htmlContent = String(value);
        });
    };

    $.fn.val = function(value) {
        if (arguments.length === 0) {
            return this[0] ? this[0].value : "";
        }
        return this.each(function() {
            this.value = String(value);
            this.attributes.value = this.value;
        });
    };

    $.fn.attr = function(name, value) {
        if (arguments.length === 1) {
            return this[0] ? this[0].getAttribute(name) : null;
        }
        return this.each(function() {
            this.setAttribute(name, value);
        });
    };

    $.fn.prop = function(name, value) {
        if (arguments.length === 1) {
            return this[0] ? this[0].properties[name] : undefined;
        }
        return this.each(function() {
            this.properties[name] = value;
        });
    };

    $.fn.toArray = function() {
        var out = [];
        for (var i = 0; i < this.length; i++) out.push(this[i]);
        return out;
    };

    $.Deferred = createDeferred;
    $.documentNode = documentNode;
    $.fn.jquery = true;

    return $;
}

function createTestEnv() {
    var documentNode = createNode("document");
    var $ = createMiniJquery(documentNode);
    var config = {
        WEEKDAYS_RU: ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"],
        MONTHS_RU: ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"],
        CONFLUENCE_ACTION_LABELS: {
            created: "создал",
            updated: "обновил",
            commented: "комментарий"
        }
    };
    var utils = {
        getDefaultRange: function() {
            return ["2026-03-09", "2026-03-13"];
        },
        getPresets: function() {
            return [
                { label: "Неделя", from: "2026-03-09", to: "2026-03-13" },
                { label: "2 недели", from: "2026-03-02", to: "2026-03-13" }
            ];
        },
        getDatesInRange: function(start, end) {
            var dates = [];
            var current = new Date(start + "T00:00:00Z");
            var limit = new Date(end + "T00:00:00Z");
            while (current <= limit) {
                dates.push(current.toISOString().slice(0, 10));
                current.setUTCDate(current.getUTCDate() + 1);
            }
            return dates;
        },
        escapeHtml: function(value) {
            return String(value || "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
        },
        icon: function(name, className) {
            return '<svg data-icon="' + name + '" class="' + String(className || "") + '"></svg>';
        },
        fmtReaction: function(minutes) {
            if (minutes < 60) return minutes + "м";
            var hours = Math.floor(minutes / 60);
            var rest = minutes % 60;
            return rest ? hours + "ч" + rest + "м" : hours + "ч";
        },
        reactionColor: function(minutes) {
            if (minutes <= 30) return "text-success";
            if (minutes <= 120) return "text-warning";
            return "text-destructive";
        }
    };
    return {
        documentNode: documentNode,
        $: $,
        config: config,
        utils: utils,
        $container: $("<div/>")
    };
}

function loadRendering(env) {
    return loadAmdModule(
        path.join(__dirname, "..", "ujg-daily-diligence-modules", "rendering.js"),
        {
            jquery: env.$,
            _ujgDD_config: env.config,
            _ujgDD_utils: env.utils,
            _ujgDD_apiJira: {},
            _ujgDD_apiBitbucket: {},
            _ujgDD_apiConfluence: {},
            _ujgDD_dataProcessor: {},
            _ujgDD_teamManager: {}
        },
        {
            document: env.documentNode,
            window: env.window || { document: env.documentNode },
            Date: env.Date || Date,
            setTimeout: setTimeout,
            clearTimeout: clearTimeout
        }
    );
}

function resolvedDeferred(value) {
    var deferred = createDeferred();
    deferred.resolve(value);
    return deferred.promise();
}

function rejectedDeferred() {
    var deferred = createDeferred();
    deferred.reject.apply(deferred, arguments);
    return deferred.promise();
}

function buildDay(date, overrides) {
    var base = {
        date: date,
        worklogs: [],
        changes: [],
        commits: [],
        confluence: [],
        pullRequests: [],
        totalHours: 0,
        issueKeys: [],
        worklogLoggedLate: false,
        hasEveningCommit: false
    };
    Object.keys(overrides || {}).forEach(function(key) {
        base[key] = overrides[key];
    });
    return base;
}

function createMappedDate(map) {
    var RealDate = Date;

    function FakeDate(value) {
        if (!(this instanceof FakeDate)) return new FakeDate(value);
        this._key = value;
        this._mapped = Object.prototype.hasOwnProperty.call(map, value) ? map[value] : null;
        this._real = this._mapped ? null : new RealDate(value);
    }

    FakeDate.now = RealDate.now.bind(RealDate);
    FakeDate.parse = RealDate.parse.bind(RealDate);
    FakeDate.UTC = RealDate.UTC.bind(RealDate);

    FakeDate.prototype.getDay = function() {
        return this._mapped && this._mapped.getDay != null ? this._mapped.getDay : this._real.getDay();
    };
    FakeDate.prototype.getDate = function() {
        return this._mapped && this._mapped.getDate != null ? this._mapped.getDate : this._real.getDate();
    };
    FakeDate.prototype.getMonth = function() {
        return this._mapped && this._mapped.getMonth != null ? this._mapped.getMonth : this._real.getMonth();
    };
    FakeDate.prototype.getUTCDay = function() {
        return this._mapped && this._mapped.getUTCDay != null ? this._mapped.getUTCDay : this._real.getUTCDay();
    };
    FakeDate.prototype.getUTCDate = function() {
        return this._mapped && this._mapped.getUTCDate != null ? this._mapped.getUTCDate : this._real.getUTCDate();
    };
    FakeDate.prototype.getUTCMonth = function() {
        return this._mapped && this._mapped.getUTCMonth != null ? this._mapped.getUTCMonth : this._real.getUTCMonth();
    };

    return FakeDate;
}

test("init loads teams and renders empty state without firing data APIs for empty team", function() {
    var env = createTestEnv();
    var rendering = loadRendering(env);
    var loadTeams = createDeferred();
    var jiraCalls = [];
    var bitbucketCalls = [];
    var confluenceCalls = [];

    rendering.init(env.$container, {
        config: env.config,
        utils: env.utils,
        apiJira: {
            fetchTeamData: function() {
                jiraCalls.push(Array.prototype.slice.call(arguments));
                return createDeferred().promise();
            }
        },
        apiBitbucket: {
            fetchTeamActivity: function() {
                bitbucketCalls.push(Array.prototype.slice.call(arguments));
                return createDeferred().promise();
            }
        },
        apiConfluence: {
            fetchTeamActivity: function() {
                confluenceCalls.push(Array.prototype.slice.call(arguments));
                return createDeferred().promise();
            }
        },
        dataProcessor: {
            processTeamData: function() {
                assert.fail("processTeamData should not run for an empty team");
            }
        },
        teamManager: {
            loadTeams: function() {
                return loadTeams.promise();
            },
            create: function() {
                return { close: function() {} };
            }
        },
        resize: function() {}
    });

    loadTeams.resolve([{ id: "team-empty", name: "Alpha", memberKeys: [] }]);

    assert.equal(jiraCalls.length, 0);
    assert.equal(bitbucketCalls.length, 0);
    assert.equal(confluenceCalls.length, 0);
    assert.equal(env.$container.find(".ujg-dd-empty").length, 1);
    assert.equal(env.$container.find(".ujg-dd-team-select").length, 1);
    assert.equal(env.$container.find(".ujg-dd-team-select").val(), "team-empty");
    assert.equal(env.$container.find(".ujg-dd-load-btn").prop("disabled"), false);
    assert.match(env.$container.text(), /Добавьте участников/);
    assert.match(env.$container.text(), /Team Dashboard/);
});

test("numeric team ids are normalized so selection and auto-load still work", function() {
    var env = createTestEnv();
    var rendering = loadRendering(env);
    var jiraDeferred = createDeferred();
    var bitbucketDeferred = createDeferred();
    var confluenceDeferred = createDeferred();
    var jiraCalls = [];

    rendering.init(env.$container, {
        config: env.config,
        utils: env.utils,
        apiJira: {
            fetchTeamData: function() {
                jiraCalls.push(Array.prototype.slice.call(arguments));
                return jiraDeferred.promise();
            }
        },
        apiBitbucket: {
            fetchTeamActivity: function() {
                return bitbucketDeferred.promise();
            }
        },
        apiConfluence: {
            fetchTeamActivity: function() {
                return confluenceDeferred.promise();
            }
        },
        dataProcessor: {
            processTeamData: function() {
                return {
                    u1: {
                        userKey: "u1",
                        issueMap: {
                            "SDKU-10": { key: "SDKU-10", summary: "Numeric id team" }
                        },
                        dayMap: {
                            "2026-03-09": buildDay("2026-03-09", {
                                worklogs: [{ issueKey: "SDKU-10", loggedAt: "09:00", timeSpentHours: 1 }],
                                totalHours: 1
                            }),
                            "2026-03-10": buildDay("2026-03-10"),
                            "2026-03-11": buildDay("2026-03-11"),
                            "2026-03-12": buildDay("2026-03-12"),
                            "2026-03-13": buildDay("2026-03-13")
                        }
                    }
                };
            }
        },
        teamManager: {
            loadTeams: function() {
                return resolvedDeferred([{ id: 42, name: "Numbers", memberKeys: ["u1"] }]);
            },
            create: function() {
                return { close: function() {} };
            }
        },
        resize: function() {}
    });

    assert.equal(env.$container.find(".ujg-dd-team-select").val(), "42");
    assert.equal(jiraCalls.length, 1);
    assert.deepEqual(jiraCalls[0].slice(0, 3), [["u1"], "2026-03-09", "2026-03-13"]);

    jiraDeferred.resolve({ issues: [] });
    bitbucketDeferred.resolve({ commits: [], pullRequests: [] });
    confluenceDeferred.resolve([]);

    assert.match(env.$container.text(), /Numeric id team/);
});

test("date stickers and weekday filtering follow local Date behavior from the reference page", function() {
    var env = createTestEnv();
    env.utils.getDefaultRange = function() {
        return ["2026-03-14", "2026-03-14"];
    };
    env.Date = createMappedDate({
        "2026-03-14": { getDay: 5, getDate: 13, getMonth: 2 },
        "2026-03-14T00:00:00Z": { getUTCDay: 6, getUTCDate: 14, getUTCMonth: 2 }
    });

    var rendering = loadRendering(env);
    var jiraDeferred = createDeferred();
    var bitbucketDeferred = createDeferred();
    var confluenceDeferred = createDeferred();

    rendering.init(env.$container, {
        config: env.config,
        utils: env.utils,
        apiJira: {
            fetchTeamData: function() {
                return jiraDeferred.promise();
            }
        },
        apiBitbucket: {
            fetchTeamActivity: function() {
                return bitbucketDeferred.promise();
            }
        },
        apiConfluence: {
            fetchTeamActivity: function() {
                return confluenceDeferred.promise();
            }
        },
        dataProcessor: {
            processTeamData: function() {
                return {
                    u1: {
                        userKey: "u1",
                        issueMap: {
                            "SDKU-9": { key: "SDKU-9", summary: "Local date item" }
                        },
                        dayMap: {
                            "2026-03-14": buildDay("2026-03-14", {
                                worklogs: [{ issueKey: "SDKU-9", loggedAt: "09:00", timeSpentHours: 1 }],
                                totalHours: 1
                            })
                        }
                    }
                };
            }
        },
        teamManager: {
            loadTeams: function() {
                return resolvedDeferred([{ id: "team-a", name: "Alpha", memberKeys: ["u1"] }]);
            },
            create: function() {
                return { close: function() {} };
            }
        },
        resize: function() {}
    });

    jiraDeferred.resolve({ issues: [] });
    bitbucketDeferred.resolve({ commits: [] });
    confluenceDeferred.resolve([]);

    var stickers = env.$container.find(".ujg-dd-date-sticker");
    assert.equal(stickers.length, 1);
    assert.equal(nodeText(stickers[0]), "Пт, 13 мар");
});

test("init auto-loads the first populated team and renders reverse-chronological weekday rows", function() {
    var env = createTestEnv();
    env.utils.getDefaultRange = function() {
        return ["2026-03-13", "2026-03-16"];
    };

    var rendering = loadRendering(env);
    var jiraDeferred = createDeferred();
    var bitbucketDeferred = createDeferred();
    var confluenceDeferred = createDeferred();
    var jiraCalls = [];
    var bitbucketCalls = [];
    var confluenceCalls = [];
    var processorCalls = [];
    var processed = {
        u1: {
            userKey: "u1",
            issueMap: {
                "SDKU-1": { key: "SDKU-1", summary: "Safe <summary>" }
            },
            dayMap: {
                "2026-03-13": buildDay("2026-03-13"),
                "2026-03-14": buildDay("2026-03-14", {
                    worklogs: [{ issueKey: "SDKU-1", loggedAt: "10:00", timeSpentHours: 1, comment: "weekend" }],
                    totalHours: 1
                }),
                "2026-03-15": buildDay("2026-03-15"),
                "2026-03-16": buildDay("2026-03-16", {
                    worklogs: [{ issueKey: "SDKU-1", loggedAt: "09:30", timeSpentHours: 2, comment: "done" }],
                    totalHours: 2
                })
            }
        },
        u2: {
            userKey: "u2",
            issueMap: {
                "SDKU-2": { key: "SDKU-2", summary: "Another task" }
            },
            dayMap: {
                "2026-03-13": buildDay("2026-03-13", {
                    changes: [{ issueKey: "SDKU-2", fromString: "Open", toString: "Done" }],
                    pullRequests: [{ repo: "SDKU/api", title: "Review queue", state: "OPEN", reactionMinutes: 65 }]
                }),
                "2026-03-14": buildDay("2026-03-14"),
                "2026-03-15": buildDay("2026-03-15"),
                "2026-03-16": buildDay("2026-03-16")
            }
        }
    };

    rendering.init(env.$container, {
        config: env.config,
        utils: env.utils,
        apiJira: {
            fetchTeamData: function() {
                jiraCalls.push(Array.prototype.slice.call(arguments));
                return jiraDeferred.promise();
            }
        },
        apiBitbucket: {
            fetchTeamActivity: function() {
                bitbucketCalls.push(Array.prototype.slice.call(arguments));
                return bitbucketDeferred.promise();
            }
        },
        apiConfluence: {
            fetchTeamActivity: function() {
                confluenceCalls.push(Array.prototype.slice.call(arguments));
                return confluenceDeferred.promise();
            }
        },
        dataProcessor: {
            processTeamData: function() {
                processorCalls.push(Array.prototype.slice.call(arguments));
                return processed;
            }
        },
        teamManager: {
            loadTeams: function() {
                return resolvedDeferred([{ id: "team-a", name: "Alpha", memberKeys: ["u1", "u2"] }]);
            },
            create: function() {
                return { close: function() {} };
            }
        },
        resize: function() {}
    });

    assert.equal(jiraCalls.length, 1);
    assert.deepEqual(jiraCalls[0].slice(0, 3), [["u1", "u2"], "2026-03-13", "2026-03-16"]);
    assert.equal(typeof jiraCalls[0][3], "function");
    assert.equal(bitbucketCalls.length, 1);
    assert.equal(confluenceCalls.length, 1);
    assert.equal(env.$container.find(".ujg-dd-loading").length, 1);

    jiraDeferred.resolve({ issues: ["jira"] });
    bitbucketDeferred.resolve({ commits: ["bitbucket"] });
    confluenceDeferred.resolve([{ pageTitle: "Page" }]);

    assert.equal(processorCalls.length, 1);
    assert.deepEqual(processorCalls[0].slice(3), [["u1", "u2"], "2026-03-13", "2026-03-16"]);

    var stickers = env.$container.find(".ujg-dd-date-sticker").toArray().map(function(node) {
        return nodeText(node);
    });
    assert.deepEqual(stickers, ["Пн, 16 мар", "Пт, 13 мар"]);
    assert.equal(env.$container.find(".ujg-dd-user-row").length, 2);
    assert.equal(env.$container.text().indexOf("Сб, 14 мар") >= 0, false);
    assert.match(env.$container.text(), /Safe <summary>/);
    assert.match(env.$container.text(), /SDKU-2/);
    assert.match(env.$container.text(), /Open/);
    assert.match(env.$container.text(), /Done/);
    assert.match(env.$container.text(), /open/);
    assert.equal(env.$container.text().indexOf("OPEN") >= 0, false);
});

test("teams button opens the popup and popup changes sync teams state then auto-load the new team", function() {
    var env = createTestEnv();
    var rendering = loadRendering(env);
    var jiraDeferred = createDeferred();
    var bitbucketDeferred = createDeferred();
    var confluenceDeferred = createDeferred();
    var popupParent = null;
    var popupOnChange = null;
    var jiraCalls = [];
    var processed = {
        u9: {
            userKey: "u9",
            issueMap: {
                "TASK-9": { key: "TASK-9", summary: "Popup refresh task" }
            },
            dayMap: {
                "2026-03-09": buildDay("2026-03-09", {
                    worklogs: [{ issueKey: "TASK-9", loggedAt: "10:00", timeSpentHours: 1.5 }],
                    totalHours: 1.5
                }),
                "2026-03-10": buildDay("2026-03-10"),
                "2026-03-11": buildDay("2026-03-11"),
                "2026-03-12": buildDay("2026-03-12"),
                "2026-03-13": buildDay("2026-03-13")
            }
        }
    };

    rendering.init(env.$container, {
        config: env.config,
        utils: env.utils,
        apiJira: {
            fetchTeamData: function() {
                jiraCalls.push(Array.prototype.slice.call(arguments));
                return jiraDeferred.promise();
            }
        },
        apiBitbucket: {
            fetchTeamActivity: function() {
                return bitbucketDeferred.promise();
            }
        },
        apiConfluence: {
            fetchTeamActivity: function() {
                return confluenceDeferred.promise();
            }
        },
        dataProcessor: {
            processTeamData: function() {
                return processed;
            }
        },
        teamManager: {
            loadTeams: function() {
                return resolvedDeferred([{ id: "team-empty", name: "Empty", memberKeys: [] }]);
            },
            create: function(parent, onChange) {
                popupParent = parent;
                popupOnChange = onChange;
                return { close: function() {} };
            }
        },
        resize: function() {}
    });

    assert.equal(env.$container.find(".ujg-dd-empty").length, 1);
    env.$container.find(".ujg-dd-teams-btn").trigger("click");

    assert.equal(popupParent[0], env.$container.find(".ujg-dd-popup-host")[0]);
    assert.equal(typeof popupOnChange, "function");

    popupOnChange([{ id: "team-live", name: "Live", memberKeys: ["u9"] }]);

    assert.equal(env.$container.find(".ujg-dd-team-select").val(), "team-live");
    assert.equal(jiraCalls.length, 1);
    assert.deepEqual(jiraCalls[0].slice(0, 3), [["u9"], "2026-03-09", "2026-03-13"]);
    assert.equal(env.$container.find(".ujg-dd-loading").length, 1);

    jiraDeferred.resolve({ issues: [] });
    bitbucketDeferred.resolve({ commits: [], pullRequests: [] });
    confluenceDeferred.resolve([]);

    assert.equal(env.$container.find(".ujg-dd-user-row").length, 1);
    assert.match(env.$container.text(), /Popup refresh task/);
});

test("popup overlay mounted through create survives renderer rerenders triggered by team updates", function() {
    var env = createTestEnv();
    var rendering = loadRendering(env);
    var jiraDeferred = createDeferred();
    var bitbucketDeferred = createDeferred();
    var confluenceDeferred = createDeferred();
    var popupParent = null;
    var popupOnChange = null;
    var overlayNode = createNode("div");

    setClassName(overlayNode, "test-popup-overlay");
    overlayNode.textContent = "Overlay stays mounted";

    rendering.init(env.$container, {
        config: env.config,
        utils: env.utils,
        apiJira: {
            fetchTeamData: function() {
                return jiraDeferred.promise();
            }
        },
        apiBitbucket: {
            fetchTeamActivity: function() {
                return bitbucketDeferred.promise();
            }
        },
        apiConfluence: {
            fetchTeamActivity: function() {
                return confluenceDeferred.promise();
            }
        },
        dataProcessor: {
            processTeamData: function() {
                return {
                    u1: {
                        userKey: "u1",
                        issueMap: {
                            "POP-1": { key: "POP-1", summary: "Popup host task" }
                        },
                        dayMap: {
                            "2026-03-09": buildDay("2026-03-09", {
                                worklogs: [{ issueKey: "POP-1", loggedAt: "12:00", timeSpentHours: 1 }],
                                totalHours: 1
                            }),
                            "2026-03-10": buildDay("2026-03-10"),
                            "2026-03-11": buildDay("2026-03-11"),
                            "2026-03-12": buildDay("2026-03-12"),
                            "2026-03-13": buildDay("2026-03-13")
                        }
                    }
                };
            }
        },
        teamManager: {
            loadTeams: function() {
                return resolvedDeferred([{ id: "team-empty", name: "Empty", memberKeys: [] }]);
            },
            create: function(parent, onChange) {
                popupParent = parent;
                popupOnChange = onChange;
                parent.append(overlayNode);
                return {
                    close: function() {
                        env.$(overlayNode).remove();
                    }
                };
            }
        },
        resize: function() {}
    });

    env.$container.find(".ujg-dd-teams-btn").trigger("click");

    assert.equal(popupParent[0], env.$container.find(".ujg-dd-popup-host")[0]);
    assert.equal(env.$container.find(".test-popup-overlay").length, 1);

    popupOnChange([{ id: "team-live", name: "Live", memberKeys: ["u1"] }]);

    assert.equal(env.$container.find(".ujg-dd-loading").length, 1);
    assert.equal(env.$container.find(".test-popup-overlay").length, 1);

    jiraDeferred.resolve({ issues: [] });
    bitbucketDeferred.resolve({ commits: [], pullRequests: [] });
    confluenceDeferred.resolve([]);

    assert.equal(env.$container.find(".test-popup-overlay").length, 1);
    assert.match(env.$container.text(), /Popup host task/);
});

test("presets dropdown closes on outside mousedown like the reference page", function() {
    var env = createTestEnv();
    var rendering = loadRendering(env);

    rendering.init(env.$container, {
        config: env.config,
        utils: env.utils,
        apiJira: {
            fetchTeamData: function() {
                return createDeferred().promise();
            }
        },
        apiBitbucket: {
            fetchTeamActivity: function() {
                return createDeferred().promise();
            }
        },
        apiConfluence: {
            fetchTeamActivity: function() {
                return createDeferred().promise();
            }
        },
        dataProcessor: {
            processTeamData: function() {
                return {};
            }
        },
        teamManager: {
            loadTeams: function() {
                return resolvedDeferred([{ id: "team-empty", name: "Alpha", memberKeys: [] }]);
            },
            create: function() {
                return { close: function() {} };
            }
        },
        resize: function() {}
    });

    env.$container.find(".ujg-dd-presets-toggle").trigger("click");
    assert.equal(env.$container.find(".ujg-dd-presets").attr("hidden"), null);

    env.documentNode.dispatchEvent({
        type: "mousedown",
        bubbles: true,
        target: createNode("div")
    });

    assert.equal(env.$container.find(".ujg-dd-presets").attr("hidden"), "hidden");
});

test("stale async responses are ignored when a later team load starts", function() {
    var env = createTestEnv();
    var rendering = loadRendering(env);
    var jiraDeferreds = [createDeferred(), createDeferred()];
    var bitbucketDeferreds = [createDeferred(), createDeferred()];
    var confluenceDeferreds = [createDeferred(), createDeferred()];
    var jiraCalls = [];
    var processorCalls = [];

    function processedFor(memberKey, summary) {
        var out = {};
        out[memberKey] = {
            userKey: memberKey,
            issueMap: {
                "TASK-1": { key: "TASK-1", summary: summary }
            },
            dayMap: {
                "2026-03-09": buildDay("2026-03-09", {
                    worklogs: [{ issueKey: "TASK-1", loggedAt: "11:00", timeSpentHours: 1 }],
                    totalHours: 1
                }),
                "2026-03-10": buildDay("2026-03-10"),
                "2026-03-11": buildDay("2026-03-11"),
                "2026-03-12": buildDay("2026-03-12"),
                "2026-03-13": buildDay("2026-03-13")
            }
        };
        return out;
    }

    rendering.init(env.$container, {
        config: env.config,
        utils: env.utils,
        apiJira: {
            fetchTeamData: function() {
                jiraCalls.push(Array.prototype.slice.call(arguments));
                return jiraDeferreds[jiraCalls.length - 1].promise();
            }
        },
        apiBitbucket: {
            fetchTeamActivity: function() {
                return bitbucketDeferreds[jiraCalls.length - 1].promise();
            }
        },
        apiConfluence: {
            fetchTeamActivity: function() {
                return confluenceDeferreds[jiraCalls.length - 1].promise();
            }
        },
        dataProcessor: {
            processTeamData: function(jiraData, bitbucketData, confluenceData, memberKeys) {
                processorCalls.push([jiraData, bitbucketData, confluenceData, memberKeys]);
                return memberKeys[0] === "u2"
                    ? processedFor("u2", "Fresh team data")
                    : processedFor("u1", "Stale team data");
            }
        },
        teamManager: {
            loadTeams: function() {
                return resolvedDeferred([
                    { id: "team-a", name: "Team A", memberKeys: ["u1"] },
                    { id: "team-b", name: "Team B", memberKeys: ["u2"] }
                ]);
            },
            create: function() {
                return { close: function() {} };
            }
        },
        resize: function() {}
    });

    assert.equal(jiraCalls.length, 1);
    assert.deepEqual(jiraCalls[0].slice(0, 3), [["u1"], "2026-03-09", "2026-03-13"]);

    env.$container.find(".ujg-dd-team-select").val("team-b").trigger("change");

    assert.equal(jiraCalls.length, 2);
    assert.deepEqual(jiraCalls[1].slice(0, 3), [["u2"], "2026-03-09", "2026-03-13"]);

    jiraDeferreds[1].resolve({ ticket: "fresh" });
    bitbucketDeferreds[1].resolve({ commits: ["fresh"] });
    confluenceDeferreds[1].resolve([{ title: "fresh" }]);

    assert.equal(processorCalls.length, 1);
    assert.match(env.$container.text(), /Fresh team data/);
    assert.equal(env.$container.text().indexOf("Stale team data") >= 0, false);

    jiraDeferreds[0].resolve({ ticket: "stale" });
    bitbucketDeferreds[0].resolve({ commits: ["stale"] });
    confluenceDeferreds[0].resolve([{ title: "stale" }]);

    assert.equal(processorCalls.length, 1);
    assert.match(env.$container.text(), /Fresh team data/);
    assert.equal(env.$container.text().indexOf("Stale team data") >= 0, false);
});

test("failed source load renders the compact error state in the content area", function() {
    var env = createTestEnv();
    var rendering = loadRendering(env);
    var jiraDeferred = createDeferred();

    rendering.init(env.$container, {
        config: env.config,
        utils: env.utils,
        apiJira: {
            fetchTeamData: function() {
                return jiraDeferred.promise();
            }
        },
        apiBitbucket: {
            fetchTeamActivity: function() {
                return createDeferred().promise();
            }
        },
        apiConfluence: {
            fetchTeamActivity: function() {
                return createDeferred().promise();
            }
        },
        dataProcessor: {
            processTeamData: function() {
                assert.fail("processTeamData should not run when a source request fails");
            }
        },
        teamManager: {
            loadTeams: function() {
                return resolvedDeferred([{ id: "team-a", name: "Alpha", memberKeys: ["u1"] }]);
            },
            create: function() {
                return { close: function() {} };
            }
        },
        resize: function() {}
    });

    jiraDeferred.reject({ status: 500 }, "error", "Jira exploded");

    assert.equal(env.$container.find(".ujg-dd-error").length, 1);
    assert.match(env.$container.text(), /Ошибка загрузки/);
    assert.match(env.$container.text(), /Jira exploded/);
});

test("bitbucket and confluence failures degrade to empty source data when Jira succeeds", function() {
    var env = createTestEnv();
    var rendering = loadRendering(env);
    var jiraDeferred = createDeferred();
    var processorCalls = [];

    rendering.init(env.$container, {
        config: env.config,
        utils: env.utils,
        apiJira: {
            fetchTeamData: function() {
                return jiraDeferred.promise();
            }
        },
        apiBitbucket: {
            fetchTeamActivity: function() {
                return rejectedDeferred({ status: 502 }, "error", "Bitbucket exploded");
            }
        },
        apiConfluence: {
            fetchTeamActivity: function() {
                return rejectedDeferred({ status: 503 }, "error", "Confluence exploded");
            }
        },
        dataProcessor: {
            processTeamData: function(jiraData, bitbucketData, confluenceData) {
                processorCalls.push([jiraData, bitbucketData, confluenceData]);
                return {};
            }
        },
        teamManager: {
            loadTeams: function() {
                return resolvedDeferred([{ id: "team-a", name: "Alpha", memberKeys: ["u1"] }]);
            },
            create: function() {
                return { close: function() {} };
            }
        },
        resize: function() {}
    });

    jiraDeferred.resolve({ issues: [] });

    assert.equal(processorCalls.length, 1);
    assert.deepEqual(processorCalls[0][0], { issues: [] });
    assert.deepEqual(JSON.parse(JSON.stringify(processorCalls[0][1])), { commits: [], pullRequests: [] });
    assert.deepEqual(JSON.parse(JSON.stringify(processorCalls[0][2])), []);
    assert.equal(env.$container.find(".ujg-dd-error").length, 0);
    assert.equal(env.$container.find(".ujg-dd-loading").length, 0);
    assert.equal(env.$container.text().indexOf("Bitbucket exploded") >= 0, false);
    assert.equal(env.$container.text().indexOf("Confluence exploded") >= 0, false);
});

test("synchronous processTeamData errors are surfaced as the compact error state", function() {
    var env = createTestEnv();
    var rendering = loadRendering(env);
    var jiraDeferred = createDeferred();
    var bitbucketDeferred = createDeferred();
    var confluenceDeferred = createDeferred();

    rendering.init(env.$container, {
        config: env.config,
        utils: env.utils,
        apiJira: {
            fetchTeamData: function() {
                return jiraDeferred.promise();
            }
        },
        apiBitbucket: {
            fetchTeamActivity: function() {
                return bitbucketDeferred.promise();
            }
        },
        apiConfluence: {
            fetchTeamActivity: function() {
                return confluenceDeferred.promise();
            }
        },
        dataProcessor: {
            processTeamData: function() {
                throw new Error("Processor boom");
            }
        },
        teamManager: {
            loadTeams: function() {
                return resolvedDeferred([{ id: "team-a", name: "Alpha", memberKeys: ["u1"] }]);
            },
            create: function() {
                return { close: function() {} };
            }
        },
        resize: function() {}
    });

    jiraDeferred.resolve({ issues: [] });
    bitbucketDeferred.resolve({ commits: [], pullRequests: [] });
    confluenceDeferred.resolve([]);

    assert.equal(env.$container.find(".ujg-dd-loading").length, 0);
    assert.equal(env.$container.find(".ujg-dd-error").length, 1);
    assert.match(env.$container.text(), /Processor boom/);
});

test("rejected loadTeams recovers with the compact error state", function() {
    var env = createTestEnv();
    var rendering = loadRendering(env);

    rendering.init(env.$container, {
        config: env.config,
        utils: env.utils,
        apiJira: {
            fetchTeamData: function() {
                assert.fail("fetchTeamData should not run when loadTeams rejects");
            }
        },
        apiBitbucket: {
            fetchTeamActivity: function() {
                assert.fail("fetchTeamActivity should not run when loadTeams rejects");
            }
        },
        apiConfluence: {
            fetchTeamActivity: function() {
                assert.fail("fetchTeamActivity should not run when loadTeams rejects");
            }
        },
        dataProcessor: {
            processTeamData: function() {
                assert.fail("processTeamData should not run when loadTeams rejects");
            }
        },
        teamManager: {
            loadTeams: function() {
                return rejectedDeferred({ responseText: "Team source failed" }, "error", "Team source failed");
            },
            create: function() {
                return { close: function() {} };
            }
        },
        resize: function() {}
    });

    assert.equal(env.$container.find(".ujg-dd-error").length, 1);
    assert.match(env.$container.text(), /Ошибка загрузки/);
    assert.match(env.$container.text(), /Team source failed/);
});

test("multiple renderer instances keep their own state and render independently", function() {
    var env = createTestEnv();
    var rendering = loadRendering(env);
    var $containerA = env.$("<div/>");
    var $containerB = env.$("<div/>");
    var jiraA = createDeferred();
    var bitbucketA = createDeferred();
    var confluenceA = createDeferred();
    var jiraB = createDeferred();
    var bitbucketB = createDeferred();
    var confluenceB = createDeferred();

    rendering.init($containerA, {
        config: env.config,
        utils: env.utils,
        apiJira: {
            fetchTeamData: function() {
                return jiraA.promise();
            }
        },
        apiBitbucket: {
            fetchTeamActivity: function() {
                return bitbucketA.promise();
            }
        },
        apiConfluence: {
            fetchTeamActivity: function() {
                return confluenceA.promise();
            }
        },
        dataProcessor: {
            processTeamData: function() {
                return {
                    ua: {
                        userKey: "ua",
                        issueMap: {
                            "A-1": { key: "A-1", summary: "Alpha gadget item" }
                        },
                        dayMap: {
                            "2026-03-09": buildDay("2026-03-09", {
                                worklogs: [{ issueKey: "A-1", loggedAt: "10:00", timeSpentHours: 1 }],
                                totalHours: 1
                            }),
                            "2026-03-10": buildDay("2026-03-10"),
                            "2026-03-11": buildDay("2026-03-11"),
                            "2026-03-12": buildDay("2026-03-12"),
                            "2026-03-13": buildDay("2026-03-13")
                        }
                    }
                };
            }
        },
        teamManager: {
            loadTeams: function() {
                return resolvedDeferred([{ id: "team-a", name: "A", memberKeys: ["ua"] }]);
            },
            create: function() {
                return { close: function() {} };
            }
        },
        resize: function() {}
    });

    rendering.init($containerB, {
        config: env.config,
        utils: env.utils,
        apiJira: {
            fetchTeamData: function() {
                return jiraB.promise();
            }
        },
        apiBitbucket: {
            fetchTeamActivity: function() {
                return bitbucketB.promise();
            }
        },
        apiConfluence: {
            fetchTeamActivity: function() {
                return confluenceB.promise();
            }
        },
        dataProcessor: {
            processTeamData: function() {
                return {
                    ub: {
                        userKey: "ub",
                        issueMap: {
                            "B-1": { key: "B-1", summary: "Beta gadget item" }
                        },
                        dayMap: {
                            "2026-03-09": buildDay("2026-03-09", {
                                worklogs: [{ issueKey: "B-1", loggedAt: "11:00", timeSpentHours: 2 }],
                                totalHours: 2
                            }),
                            "2026-03-10": buildDay("2026-03-10"),
                            "2026-03-11": buildDay("2026-03-11"),
                            "2026-03-12": buildDay("2026-03-12"),
                            "2026-03-13": buildDay("2026-03-13")
                        }
                    }
                };
            }
        },
        teamManager: {
            loadTeams: function() {
                return resolvedDeferred([{ id: "team-b", name: "B", memberKeys: ["ub"] }]);
            },
            create: function() {
                return { close: function() {} };
            }
        },
        resize: function() {}
    });

    jiraA.resolve({ issues: [] });
    bitbucketA.resolve({ commits: [], pullRequests: [] });
    confluenceA.resolve([]);
    jiraB.resolve({ issues: [] });
    bitbucketB.resolve({ commits: [], pullRequests: [] });
    confluenceB.resolve([]);

    assert.match($containerA.text(), /Alpha gadget item/);
    assert.equal($containerA.text().indexOf("Beta gadget item") >= 0, false);
    assert.match($containerB.text(), /Beta gadget item/);
    assert.equal($containerB.text().indexOf("Alpha gadget item") >= 0, false);
});

test("changing the selected range clears stale loaded data until the user reloads", function() {
    var env = createTestEnv();
    var rendering = loadRendering(env);
    var jiraCalls = [];
    var processCalls = [];

    rendering.init(env.$container, {
        config: env.config,
        utils: env.utils,
        apiJira: {
            fetchTeamData: function() {
                jiraCalls.push(Array.prototype.slice.call(arguments));
                return resolvedDeferred({ issues: [] });
            }
        },
        apiBitbucket: {
            fetchTeamActivity: function() {
                return resolvedDeferred({ commits: [], pullRequests: [] });
            }
        },
        apiConfluence: {
            fetchTeamActivity: function() {
                return resolvedDeferred([]);
            }
        },
        dataProcessor: {
            processTeamData: function(jiraData, bitbucketData, confluenceData, memberKeys, startDate) {
                processCalls.push([jiraData, bitbucketData, confluenceData, memberKeys, startDate]);
                return startDate === "2026-03-02"
                    ? {
                        u1: {
                            userKey: "u1",
                            issueMap: {
                                "RNG-2": { key: "RNG-2", summary: "Reloaded range task" }
                            },
                            dayMap: {
                                "2026-03-02": buildDay("2026-03-02", {
                                    worklogs: [{ issueKey: "RNG-2", loggedAt: "10:00", timeSpentHours: 1 }],
                                    totalHours: 1
                                }),
                                "2026-03-03": buildDay("2026-03-03"),
                                "2026-03-04": buildDay("2026-03-04"),
                                "2026-03-05": buildDay("2026-03-05"),
                                "2026-03-06": buildDay("2026-03-06"),
                                "2026-03-09": buildDay("2026-03-09"),
                                "2026-03-10": buildDay("2026-03-10"),
                                "2026-03-11": buildDay("2026-03-11"),
                                "2026-03-12": buildDay("2026-03-12"),
                                "2026-03-13": buildDay("2026-03-13")
                            }
                        }
                    }
                    : {
                        u1: {
                            userKey: "u1",
                            issueMap: {
                                "RNG-1": { key: "RNG-1", summary: "Loaded range task" }
                            },
                            dayMap: {
                                "2026-03-09": buildDay("2026-03-09", {
                                    worklogs: [{ issueKey: "RNG-1", loggedAt: "11:00", timeSpentHours: 2 }],
                                    totalHours: 2
                                }),
                                "2026-03-10": buildDay("2026-03-10"),
                                "2026-03-11": buildDay("2026-03-11"),
                                "2026-03-12": buildDay("2026-03-12"),
                                "2026-03-13": buildDay("2026-03-13")
                            }
                        }
                    };
            }
        },
        teamManager: {
            loadTeams: function() {
                return resolvedDeferred([{ id: "team-a", name: "Alpha", memberKeys: ["u1"] }]);
            },
            create: function() {
                return { close: function() {} };
            }
        },
        resize: function() {}
    });

    assert.equal(jiraCalls.length, 1);
    assert.deepEqual(jiraCalls[0].slice(0, 3), [["u1"], "2026-03-09", "2026-03-13"]);
    assert.equal(processCalls.length, 1);
    assert.match(env.$container.text(), /Loaded range task/);

    env.$container.find(".ujg-dd-start-date").val("2026-03-02").trigger("change");

    assert.equal(jiraCalls.length, 1);
    assert.equal(env.$container.find(".ujg-dd-user-row").length, 0);
    assert.equal(env.$container.text().indexOf("Loaded range task") >= 0, false);

    env.$container.find(".ujg-dd-load-btn").trigger("click");

    assert.equal(jiraCalls.length, 2);
    assert.deepEqual(jiraCalls[1].slice(0, 3), [["u1"], "2026-03-02", "2026-03-13"]);
    assert.equal(processCalls.length, 2);
    assert.match(env.$container.text(), /Reloaded range task/);
});

test("changing the range during a request invalidates the in-flight response", function() {
    var env = createTestEnv();
    var rendering = loadRendering(env);
    var jiraDeferreds = [createDeferred(), createDeferred()];
    var bitbucketDeferreds = [createDeferred(), createDeferred()];
    var confluenceDeferreds = [createDeferred(), createDeferred()];
    var jiraCalls = [];
    var processCalls = [];

    rendering.init(env.$container, {
        config: env.config,
        utils: env.utils,
        apiJira: {
            fetchTeamData: function() {
                jiraCalls.push(Array.prototype.slice.call(arguments));
                return jiraDeferreds[jiraCalls.length - 1].promise();
            }
        },
        apiBitbucket: {
            fetchTeamActivity: function() {
                return bitbucketDeferreds[jiraCalls.length - 1].promise();
            }
        },
        apiConfluence: {
            fetchTeamActivity: function() {
                return confluenceDeferreds[jiraCalls.length - 1].promise();
            }
        },
        dataProcessor: {
            processTeamData: function(jiraData, bitbucketData, confluenceData, memberKeys, startDate) {
                processCalls.push([jiraData, bitbucketData, confluenceData, memberKeys, startDate]);
                if (startDate === "2026-03-02") {
                    return {
                        u1: {
                            userKey: "u1",
                            issueMap: {
                                "NEW-1": { key: "NEW-1", summary: "Fresh range task" }
                            },
                            dayMap: {
                                "2026-03-02": buildDay("2026-03-02", {
                                    worklogs: [{ issueKey: "NEW-1", loggedAt: "09:30", timeSpentHours: 1 }],
                                    totalHours: 1
                                }),
                                "2026-03-03": buildDay("2026-03-03"),
                                "2026-03-04": buildDay("2026-03-04"),
                                "2026-03-05": buildDay("2026-03-05"),
                                "2026-03-06": buildDay("2026-03-06"),
                                "2026-03-09": buildDay("2026-03-09"),
                                "2026-03-10": buildDay("2026-03-10"),
                                "2026-03-11": buildDay("2026-03-11"),
                                "2026-03-12": buildDay("2026-03-12"),
                                "2026-03-13": buildDay("2026-03-13")
                            }
                        }
                    };
                }
                return {
                    u1: {
                        userKey: "u1",
                        issueMap: {
                            "OLD-1": { key: "OLD-1", summary: "Stale range task" }
                        },
                        dayMap: {
                            "2026-03-09": buildDay("2026-03-09", {
                                worklogs: [{ issueKey: "OLD-1", loggedAt: "15:00", timeSpentHours: 3 }],
                                totalHours: 3
                            }),
                            "2026-03-10": buildDay("2026-03-10"),
                            "2026-03-11": buildDay("2026-03-11"),
                            "2026-03-12": buildDay("2026-03-12"),
                            "2026-03-13": buildDay("2026-03-13")
                        }
                    }
                };
            }
        },
        teamManager: {
            loadTeams: function() {
                return resolvedDeferred([{ id: "team-a", name: "Alpha", memberKeys: ["u1"] }]);
            },
            create: function() {
                return { close: function() {} };
            }
        },
        resize: function() {}
    });

    assert.equal(jiraCalls.length, 1);
    assert.equal(env.$container.find(".ujg-dd-loading").length, 1);

    env.$container.find(".ujg-dd-start-date").val("2026-03-02").trigger("change");

    assert.equal(env.$container.find(".ujg-dd-loading").length, 0);
    assert.equal(env.$container.find(".ujg-dd-user-row").length, 0);

    jiraDeferreds[0].resolve({ issues: ["stale"] });
    bitbucketDeferreds[0].resolve({ commits: ["stale"], pullRequests: [] });
    confluenceDeferreds[0].resolve([{ title: "stale" }]);

    assert.equal(processCalls.length, 0);
    assert.equal(env.$container.text().indexOf("Stale range task") >= 0, false);

    env.$container.find(".ujg-dd-load-btn").trigger("click");

    assert.equal(jiraCalls.length, 2);
    assert.deepEqual(jiraCalls[1].slice(0, 3), [["u1"], "2026-03-02", "2026-03-13"]);

    jiraDeferreds[1].resolve({ issues: ["fresh"] });
    bitbucketDeferreds[1].resolve({ commits: ["fresh"], pullRequests: [] });
    confluenceDeferreds[1].resolve([{ title: "fresh" }]);

    assert.equal(processCalls.length, 1);
    assert.match(env.$container.text(), /Fresh range task/);
});

test("clicking another gadget date control closes this instance presets", function() {
    var env = createTestEnv();
    var rendering = loadRendering(env);
    var $containerA = env.$("<div/>");
    var $containerB = env.$("<div/>");

    function modulesFor(name) {
        return {
            config: env.config,
            utils: env.utils,
            apiJira: {
                fetchTeamData: function() {
                    return createDeferred().promise();
                }
            },
            apiBitbucket: {
                fetchTeamActivity: function() {
                    return createDeferred().promise();
                }
            },
            apiConfluence: {
                fetchTeamActivity: function() {
                    return createDeferred().promise();
                }
            },
            dataProcessor: {
                processTeamData: function() {
                    return {};
                }
            },
            teamManager: {
                loadTeams: function() {
                    return resolvedDeferred([{ id: name, name: name, memberKeys: [] }]);
                },
                create: function() {
                    return { close: function() {} };
                }
            },
            resize: function() {}
        };
    }

    rendering.init($containerA, modulesFor("Alpha"));
    rendering.init($containerB, modulesFor("Beta"));

    $containerA.find(".ujg-dd-presets-toggle").trigger("click");
    assert.equal($containerA.find(".ujg-dd-presets").attr("hidden"), null);

    env.documentNode.dispatchEvent({
        type: "mousedown",
        bubbles: true,
        target: $containerB.find(".ujg-dd-date-controls")[0]
    });

    assert.equal($containerA.find(".ujg-dd-presets").attr("hidden"), "hidden");
});

test("switching to an empty team via select clears loading and ignores the stale request failure", function() {
    var env = createTestEnv();
    var rendering = loadRendering(env);
    var jiraDeferred = createDeferred();

    rendering.init(env.$container, {
        config: env.config,
        utils: env.utils,
        apiJira: {
            fetchTeamData: function() {
                return jiraDeferred.promise();
            }
        },
        apiBitbucket: {
            fetchTeamActivity: function() {
                return createDeferred().promise();
            }
        },
        apiConfluence: {
            fetchTeamActivity: function() {
                return createDeferred().promise();
            }
        },
        dataProcessor: {
            processTeamData: function() {
                assert.fail("stale request should be ignored after switching to an empty team");
            }
        },
        teamManager: {
            loadTeams: function() {
                return resolvedDeferred([
                    { id: "team-live", name: "Live", memberKeys: ["u1"] },
                    { id: "team-empty", name: "Empty", memberKeys: [] }
                ]);
            },
            create: function() {
                return { close: function() {} };
            }
        },
        resize: function() {}
    });

    assert.equal(env.$container.find(".ujg-dd-loading").length, 1);

    env.$container.find(".ujg-dd-team-select").val("team-empty").trigger("change");

    assert.equal(env.$container.find(".ujg-dd-loading").length, 0);
    assert.equal(env.$container.find(".ujg-dd-error").length, 0);
    assert.equal(env.$container.find(".ujg-dd-empty").length, 1);

    jiraDeferred.reject({ responseText: "Old request failed" }, "error", "Old request failed");

    assert.equal(env.$container.find(".ujg-dd-error").length, 0);
    assert.equal(env.$container.find(".ujg-dd-empty").length, 1);
});

test("popup team updates invalidate an in-flight request when the selected team becomes empty", function() {
    var env = createTestEnv();
    var rendering = loadRendering(env);
    var jiraDeferred = createDeferred();
    var popupOnChange = null;

    rendering.init(env.$container, {
        config: env.config,
        utils: env.utils,
        apiJira: {
            fetchTeamData: function() {
                return jiraDeferred.promise();
            }
        },
        apiBitbucket: {
            fetchTeamActivity: function() {
                return createDeferred().promise();
            }
        },
        apiConfluence: {
            fetchTeamActivity: function() {
                return createDeferred().promise();
            }
        },
        dataProcessor: {
            processTeamData: function() {
                assert.fail("stale request should be ignored after popup empties the selected team");
            }
        },
        teamManager: {
            loadTeams: function() {
                return resolvedDeferred([{ id: "team-live", name: "Live", memberKeys: ["u1"] }]);
            },
            create: function(parent, onChange) {
                popupOnChange = onChange;
                return { close: function() {} };
            }
        },
        resize: function() {}
    });

    assert.equal(env.$container.find(".ujg-dd-loading").length, 1);

    env.$container.find(".ujg-dd-teams-btn").trigger("click");
    assert.equal(typeof popupOnChange, "function");

    popupOnChange([{ id: "team-live", name: "Live", memberKeys: [] }]);

    assert.equal(env.$container.find(".ujg-dd-loading").length, 0);
    assert.equal(env.$container.find(".ujg-dd-error").length, 0);
    assert.equal(env.$container.find(".ujg-dd-empty").length, 1);

    jiraDeferred.reject({ responseText: "Popup stale request failed" }, "error", "Popup stale request failed");

    assert.equal(env.$container.find(".ujg-dd-error").length, 0);
    assert.equal(env.$container.find(".ujg-dd-empty").length, 1);
});
