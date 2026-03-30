const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");
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

function loadRepoLog(jquery, utilsOverrides, configOverrides) {
    utilsOverrides = utilsOverrides || {};
    configOverrides = configOverrides || {};
    return loadAmdModule(path.join(__dirname, "..", "ujg-user-activity-modules", "repo-log.js"), {
        jquery: jquery,
        _ujgUA_config: configOverrides,
        _ujgUA_utils: Object.assign({
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

function loadRendering(jquery, utilsOverrides, documentStub) {
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
        encodeURIComponent: encodeURIComponent,
        decodeURIComponent: decodeURIComponent,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        document: documentStub,
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
        repoLogCalls: [],
        dailyShows: [],
        dailyHides: 0,
        jiraSelect: null,
        repoSelect: null,
        userChange: null
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
        userPicker: {
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
                    update: function() {}
                };
            }
        },
        api: {
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
            }
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
                    show: function(dateStr, dayData, issueMap) {
                        events.dailyShows.push({
                            dateStr: dateStr,
                            dayData: dayData,
                            issueMap: issueMap
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
        }
    };
    var rendering = loadRendering(jquery.$, {}, documentStub);
    var root = jquery.createNode("root");

    function initInto(targetRoot) {
        rendering.init(targetRoot, modules);
        root = targetRoot;
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

test("repo modules are wired in main module and build order", function() {
    var mainSource = fs.readFileSync(path.join(__dirname, "..", "ujg-user-activity-modules", "main.js"), "utf8");
    var buildSource = fs.readFileSync(path.join(__dirname, "..", "build-user-activity.js"), "utf8");

    assert.match(mainSource, /"_ujgUA_api", "_ujgUA_repoApi", "_ujgUA_dataProcessor", "_ujgUA_repoDataProcessor"/);
    assert.match(mainSource, /"_ujgUA_calendarHeatmap", "_ujgUA_repoCalendar", "_ujgUA_dailyDetail"/);
    assert.match(mainSource, /"_ujgUA_activityLog", "_ujgUA_repoLog", "_ujgUA_rendering"/);
    assert.match(mainSource, /repoApi: repoApi, dataProcessor: dataProcessor, repoDataProcessor: repoDataProcessor/);
    assert.match(mainSource, /summaryCards: summaryCards, calendarHeatmap: calendarHeatmap, repoCalendar: repoCalendar/);
    assert.match(mainSource, /issueList: issueList, activityLog: activityLog, repoLog: repoLog/);

    assert.match(buildSource, /"api\.js",\s*"repo-api\.js",\s*"data-processor\.js",\s*"repo-data-processor\.js"/);
    assert.match(buildSource, /"calendar-heatmap\.js",\s*"repo-calendar\.js",\s*"daily-detail\.js"/);
    assert.match(buildSource, /"activity-log\.js",\s*"repo-log\.js",\s*"rendering\.js"/);
});

test("public user activity bundle includes repo modules", function() {
    var builder = require(path.join(__dirname, "..", "build-user-activity.js"));
    builder.build();
    var bundleSource = fs.readFileSync(path.join(__dirname, "..", "ujg-user-activity.js"), "utf8");

    assert.match(bundleSource, /_ujgUA_repoApi/);
    assert.match(bundleSource, /_ujgUA_repoDataProcessor/);
    assert.match(bundleSource, /_ujgUA_repoCalendar/);
    assert.match(bundleSource, /_ujgUA_repoLog/);
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

test("rendering ignores stale older request responses and keeps newer dashboard", function() {
    var firstApi = createDeferred();
    var secondApi = createDeferred();
    var activeRepo = createDeferred();
    var apiCallCount = 0;
    var harness = createRenderingHarness({
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

    assert.equal(harness.events.processRepoArgsHistory.length, 1);
    assert.equal(harness.events.processRepoArgsHistory[0].user.name, "second-user");

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

    assert.equal(harness.events.processRepoArgsHistory.length, 1);
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
    assert.equal(harness.events.fetchRepoArgsHistory.length, 1);
});

test("rendering invalidates in-flight request when selected user is cleared", function() {
    var apiDeferred = createDeferred();
    var harness = createRenderingHarness({
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
