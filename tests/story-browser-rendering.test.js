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
    return loadAmdModule(path.join(MODULE_DIR, "config.js"), {}, windowImpl ? { window: windowImpl } : {});
}

function loadUtils(windowImpl) {
    const config = loadConfig(windowImpl);
    return loadAmdModule(path.join(MODULE_DIR, "utils.js"), {
        _ujgSB_config: config
    });
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
        type: "",
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
            if (key === "type") this.type = stringValue;
            if (key === "colspan") this.colSpan = stringValue;
            if (key === "placeholder") this.placeholder = stringValue;
        },
        getAttribute: function(name) {
            var key = String(name);
            if (key === "class") return this.className || null;
            if (key === "value") return this.value;
            if (key === "type") return this.type || null;
            if (key === "colspan") return this.colSpan != null ? String(this.colSpan) : null;
            if (key === "placeholder") return this.placeholder != null ? String(this.placeholder) : null;
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

    $.fn.removeClass = function(className) {
        var parts = String(className || "").trim().split(/\s+/).filter(Boolean);
        return this.each(function() {
            var current = this.className ? this.className.split(/\s+/).filter(Boolean) : [];
            var next = current.filter(function(c) {
                return parts.indexOf(c) < 0;
            });
            setClassName(this, next.join(" "));
        });
    };

    $.fn.css = function(prop, value) {
        if (arguments.length === 1 && typeof prop === "string") {
            return this[0] && this[0].style ? this[0].style[prop] : "";
        }
        if (arguments.length === 1 && prop && typeof prop === "object") {
            var self = this;
            Object.keys(prop).forEach(function(k) {
                self.css(k, prop[k]);
            });
            return this;
        }
        return this.each(function() {
            this.style = this.style || {};
            this.style[prop] = value;
        });
    };

    $.fn.append = function() {
        var self = this;
        Array.prototype.slice.call(arguments).forEach(function(item) {
            if (item == null) return;
            var $item = item.jquery ? item : $(item);
            $item.each(function() {
                var child = this;
                self.each(function() {
                    this.appendChild(child);
                });
            });
        });
        return this;
    };

    $.fn.empty = function() {
        return this.each(function() {
            this.children = [];
            this.textContent = "";
            this.htmlContent = "";
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

    $.fn.on = function(type, arg2, arg3) {
        var delegateSelector;
        var handler;
        if (typeof arg2 === "string") {
            delegateSelector = arg2;
            handler = arg3;
        } else {
            handler = arg2;
        }
        return this.each(function() {
            var root = this;
            this.addEventListener(type, function(ev) {
                if (!delegateSelector) {
                    handler.call(ev.target, ev);
                    return;
                }
                var t = ev.target;
                while (t && t !== root) {
                    if (matchesSelector(t, delegateSelector)) {
                        handler.call(t, ev);
                        return;
                    }
                    t = t.parentNode;
                }
            });
        });
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

    $.documentNode = documentNode;
    return $;
}

test("mini jquery css supports getter and object setter without shadowing", function() {
    var documentNode = createNode("document");
    var $ = createMiniJquery(documentNode);
    var $el = $("<div/>");

    $el.css({ width: "80%", marginLeft: "12px" });

    assert.equal($el.css("width"), "80%");
    assert.equal($el.css("marginLeft"), "12px");
});

function loadCreateStory($, config) {
    return loadAmdModule(path.join(MODULE_DIR, "create-story.js"), {
        jquery: $,
        _ujgSB_config: config
    });
}

function loadRendering($, config, utils) {
    var createStory = loadCreateStory($, config);
    return loadAmdModule(
        path.join(MODULE_DIR, "rendering.js"),
        {
            jquery: $,
            _ujgSB_config: config,
            _ujgSB_utils: utils,
            "_ujgSB_create-story": createStory
        },
        {
            window: { document: { createElement: function() {} } }
        }
    );
}

const TABLE_HEADERS = [
    "Классификация",
    "Ключ",
    "Название",
    "Статус",
    "Спринт",
    "Метки",
    "Компоненты"
];

function sampleTree() {
    return [
        {
            key: "EPIC-1",
            summary: "Root epic",
            type: "Epic",
            badge: "E",
            classification: "EPIC",
            classificationMissing: false,
            browseUrl: "https://jira.example.com/browse/EPIC-1",
            status: "In Progress",
            sprint: "Sprint 1",
            assignee: "Alice",
            priority: "High",
            labels: ["x"],
            components: ["Platform"],
            created: "2026-01-01T00:00:00.000Z",
            updated: "2026-01-02T00:00:00.000Z",
            estimate: 3600,
            totalDone: 1,
            totalCount: 3,
            progress: 1 / 3,
            children: [
                {
                    key: "STORY-1",
                    summary: "Child story",
                    type: "Story",
                    badge: "S",
                    classification: "STORY",
                    classificationMissing: false,
                    browseUrl: "https://jira.example.com/browse/STORY-1",
                    status: "Open",
                    sprint: "Sprint 1",
                    assignee: "Bob",
                    priority: "Medium",
                    labels: ["frontend"],
                    components: ["UI"],
                    created: "2026-01-03T00:00:00.000Z",
                    updated: "2026-01-04T00:00:00.000Z",
                    estimate: 0,
                    children: []
                }
            ]
        }
    ];
}

function orphanTree() {
    return [
        {
            key: "__orphans__",
            summary: "Без эпика",
            type: "",
            badge: "",
            status: "",
            sprint: "",
            assignee: "",
            priority: "",
            labels: [],
            created: "",
            updated: "",
            estimate: 0,
            children: [
                {
                    key: "STORY-O1",
                    summary: "Orphan story",
                    type: "Story",
                    badge: "S",
                    status: "In Progress",
                    sprint: "Sprint 2",
                    assignee: "Nina",
                    priority: "Medium",
                    labels: [],
                    created: "",
                    updated: "",
                    estimate: 0,
                    children: [
                        {
                            key: "SUB-O1",
                            summary: "Nested orphan subtask",
                            type: "Sub-task",
                            badge: "ST",
                            status: "Open",
                            sprint: "Sprint 2",
                            assignee: "Oleg",
                            priority: "Low",
                            labels: [],
                            created: "",
                            updated: "",
                            estimate: 0,
                            children: []
                        }
                    ]
                }
            ]
        }
    ];
}

test("header renders title, filters, view buttons, and actions", function() {
    var documentNode = createNode("document");
    var $ = createMiniJquery(documentNode);
    var config = loadConfig(mockWindow());
    var utils = loadUtils(mockWindow());
    var rendering = loadRendering($, config, utils);
    var $c = $("<div/>");

    rendering.init($c, {
        state: {
            project: "P1",
            selectedEpicKeys: ["EPIC-1"],
            filters: { status: "Open", sprint: "Sprint 1", search: "" },
            projects: [{ key: "P1", name: "Project One" }],
            filterOptions: {
                statuses: ["Open", "Done"],
                sprints: ["Sprint 1"],
                epics: [{ key: "EPIC-1", summary: "Root epic" }]
            }
        }
    });
    rendering.renderHeader();

    assert.match($c.text(), /Stories Dashboard/);
    assert.equal($c.find(".ujg-sb-title").length, 1);
    assert.equal($c.find(".ujg-sb-picker-project").length, 1);
    assert.equal($c.find(".ujg-sb-picker-status").length, 1);
    assert.equal($c.find(".ujg-sb-picker-epic").length, 1);
    assert.equal($c.find(".ujg-sb-picker-sprint").length, 1);
    assert.equal($c.find(".ujg-sb-picker-trigger").length, 4);
    assert.equal($c.find(".ujg-sb-picker-search-input").length, 4);
    assert.equal($c.find(".ujg-sb-picker-chip").length, 1);
    assert.equal($c.find(".ujg-sb-project-select").length, 1);
    var $status = $c.find(".ujg-sb-status-select");
    assert.equal($status.length, 1);
    assert.equal($c.find(".ujg-sb-picker-chip").text(), "EPIC-1");
    assert.ok(nodeText($status[0]).indexOf("Все статусы") >= 0 || $status[0].tagName === "SELECT");
    assert.equal($c.find(".ujg-sb-search").attr("placeholder"), "Поиск...");
    assert.ok(nodeText($c.find(".ujg-sb-view-table")[0]).indexOf("Таблица") >= 0);
    assert.ok(nodeText($c.find(".ujg-sb-view-accordion")[0]).indexOf("Аккордеон") >= 0);
    assert.ok(nodeText($c.find(".ujg-sb-view-rows")[0]).indexOf("Строки") >= 0);
    assert.ok(nodeText($c.find(".ujg-sb-expand-all")[0]).indexOf("Развернуть") >= 0);
    assert.ok(nodeText($c.find(".ujg-sb-collapse-all")[0]).indexOf("Свернуть") >= 0);
    assert.equal($c.find(".ujg-sb-header").length, 1);
    assert.equal($c.find(".ujg-sb-header-inner").length, 1);
});

test("table view renders 7 headers and epic or story hierarchy with indentation", function() {
    var documentNode = createNode("document");
    var $ = createMiniJquery(documentNode);
    var config = loadConfig(mockWindow());
    var utils = loadUtils(mockWindow());
    var rendering = loadRendering($, config, utils);
    var $c = $("<div/>");
    var tree = sampleTree();

    rendering.init($c, {});
    rendering.renderHeader();
    rendering.renderTree(tree, "table", {});

    var ths = $c.find("th").toArray();
    assert.equal(ths.length, 7);
    for (var i = 0; i < 7; i++) {
        assert.equal(nodeText(ths[i]).trim(), TABLE_HEADERS[i]);
    }

    var bodyTextCollapsed = $c.find(".ujg-sb-view-host").text();
    assert.ok(bodyTextCollapsed.indexOf("EPIC-1") >= 0);
    assert.equal(bodyTextCollapsed.indexOf("STORY-1") >= 0, false);

    rendering.renderTree(tree, "table", { "EPIC-1": true });
    var bodyTextExpanded = $c.find(".ujg-sb-view-host").text();
    assert.ok(bodyTextExpanded.indexOf("STORY-1") >= 0);

    var storyRow = $c.find(".ujg-sb-table-row-story").toArray()[0];
    assert.ok(storyRow);
    assert.ok(hasClass(storyRow, "ujg-sb-depth-1"));
});

test("table view renders problem summary row with colspan 7 after epic when problemItems set", function() {
    var documentNode = createNode("document");
    var $ = createMiniJquery(documentNode);
    var config = loadConfig(mockWindow());
    var utils = loadUtils(mockWindow());
    var rendering = loadRendering($, config, utils);
    var $c = $("<div/>");
    var tree = [
        {
            key: "EPIC-P",
            summary: "Epic with blockers",
            type: "Epic",
            badge: "E",
            status: "Open",
            sprint: "",
            assignee: "",
            priority: "",
            labels: [],
            created: "",
            updated: "",
            estimate: 0,
            children: [],
            problemItems: [
                { badge: "SE", key: "CORE-115", text: "Ожидание API контракта" }
            ]
        }
    ];

    rendering.init($c, {});
    rendering.renderHeader();
    rendering.renderTree(tree, "table", { "EPIC-P": true });

    var prob = $c.find(".ujg-sb-problem-row");
    assert.equal(prob.length, 1);
    assert.ok(hasClass(prob[0], "ujg-sb-problem-row"));
    var cell = prob[0].children[0];
    assert.ok(cell && cell.tagName === "TD");
    assert.equal(cell.getAttribute("colspan"), "7");
    var rowText = nodeText(prob[0]);
    assert.ok(rowText.indexOf("CORE-115") >= 0);
    assert.ok(rowText.indexOf("Ожидание API контракта") >= 0);
});

test("table view renders clickable key links, compact metadata, and missing classification badge", function() {
    var documentNode = createNode("document");
    var $ = createMiniJquery(documentNode);
    var config = loadConfig(mockWindow());
    var utils = loadUtils(mockWindow());
    var rendering = loadRendering($, config, utils);
    var $c = $("<div/>");
    var tree = [
        {
            key: "EPIC-7",
            summary: "Epic root",
            type: "Epic",
            badge: "E",
            classification: "EPIC",
            classificationMissing: false,
            browseUrl: "https://jira.example.com/browse/EPIC-7",
            status: "Open",
            sprint: "",
            labels: [],
            components: [],
            children: [
                {
                    key: "STORY-7",
                    summary: "Story row",
                    type: "Story",
                    badge: "S",
                    classification: "STORY",
                    classificationMissing: false,
                    browseUrl: "https://jira.example.com/browse/STORY-7",
                    status: "Open",
                    sprint: "Sprint 7",
                    labels: ["story"],
                    components: ["Web"],
                    children: [
                        {
                            key: "TASK-7",
                            summary: "Task without prefix",
                            type: "Task",
                            badge: "T",
                            classification: "NO PREFIX",
                            classificationMissing: true,
                            browseUrl: "https://jira.example.com/browse/TASK-7",
                            status: "Open",
                            sprint: "Sprint 7",
                            labels: ["backend", "api"],
                            components: ["Core", "REST"],
                            children: []
                        }
                    ]
                }
            ]
        }
    ];

    rendering.init($c, {});
    rendering.renderHeader();
    rendering.renderTree(tree, "table", { "EPIC-7": true });

    var links = $c.find(".ujg-sb-key-link").toArray();
    var componentCells = $c.find(".ujg-sb-col-components").toArray().map(function(node) {
        return nodeText(node);
    }).join("|");
    var labelCells = $c.find(".ujg-sb-col-labels").toArray().map(function(node) {
        return nodeText(node);
    }).join("|");
    assert.equal(links.length, 3);
    assert.equal(links[0].getAttribute("href"), "https://jira.example.com/browse/EPIC-7");
    assert.equal(links[2].getAttribute("href"), "https://jira.example.com/browse/TASK-7");
    assert.ok(componentCells.indexOf("Core, REST") >= 0);
    assert.ok(labelCells.indexOf("backend, api") >= 0);
    assert.equal($c.find(".ujg-sb-classification-missing").length, 1);
    assert.ok($c.find(".ujg-sb-classification-missing").text().indexOf("NO PREFIX") >= 0);
});

test("table view renders orphan bucket label and nested non-epic descendants without leaking internal key", function() {
    var documentNode = createNode("document");
    var $ = createMiniJquery(documentNode);
    var config = loadConfig(mockWindow());
    var utils = loadUtils(mockWindow());
    var rendering = loadRendering($, config, utils);
    var $c = $("<div/>");
    var tree = orphanTree();

    rendering.init($c, {});
    rendering.renderHeader();
    rendering.renderTree(tree, "table", { "__orphans__": true });

    var text = $c.find(".ujg-sb-view-host").text();
    assert.ok(text.indexOf("Без эпика") >= 0);
    assert.ok(text.indexOf("STORY-O1") >= 0);
    assert.ok(text.indexOf("SUB-O1") >= 0);
    assert.equal(text.indexOf("__orphans__") >= 0, false);

    var rows = $c.find(".ujg-sb-tr").toArray();
    var storyRow = rows.find(function(row) {
        return row.attributes["data-key"] === "STORY-O1";
    });
    var subtaskRow = rows.find(function(row) {
        return row.attributes["data-key"] === "SUB-O1";
    });

    assert.ok(storyRow);
    assert.ok(subtaskRow);
    assert.ok(hasClass(storyRow, "ujg-sb-depth-1"));
    assert.ok(hasClass(subtaskRow, "ujg-sb-depth-2"));
});

test("accordion view renders section structure with head and body", function() {
    var documentNode = createNode("document");
    var $ = createMiniJquery(documentNode);
    var config = loadConfig(mockWindow());
    var utils = loadUtils(mockWindow());
    var rendering = loadRendering($, config, utils);
    var $c = $("<div/>");
    var tree = sampleTree();

    rendering.init($c, {});
    rendering.renderHeader();
    rendering.renderTree(tree, "accordion", { "EPIC-1": true });

    assert.equal($c.find(".ujg-sb-accordion-item").length, 1);
    assert.equal($c.find(".ujg-sb-accordion-head").length, 1);
    assert.equal($c.find(".ujg-sb-accordion-body").length, 1);
    assert.ok($c.find(".ujg-sb-accordion-head").text().indexOf("EPIC-1") >= 0);
    assert.ok($c.find(".ujg-sb-accordion-body").text().indexOf("STORY-1") >= 0);
});

test("accordion view renders nested descendants under open orphan bucket without child expanded flags", function() {
    var documentNode = createNode("document");
    var $ = createMiniJquery(documentNode);
    var config = loadConfig(mockWindow());
    var utils = loadUtils(mockWindow());
    var rendering = loadRendering($, config, utils);
    var $c = $("<div/>");
    var tree = orphanTree();

    rendering.init($c, {});
    rendering.renderHeader();
    rendering.renderTree(tree, "accordion", { "__orphans__": true });

    var bodyText = $c.find(".ujg-sb-accordion-body").text();
    assert.ok(bodyText.indexOf("STORY-O1") >= 0);
    assert.ok(bodyText.indexOf("SUB-O1") >= 0);
    assert.equal(bodyText.indexOf("__orphans__") >= 0, false);
});

test("accordion view exposes a toggle for nested epic descendants", function() {
    var documentNode = createNode("document");
    var $ = createMiniJquery(documentNode);
    var config = loadConfig(mockWindow());
    var utils = loadUtils(mockWindow());
    var rendering = loadRendering($, config, utils);
    var $c = $("<div/>");
    var calls = [];
    var tree = [
        {
            key: "EPIC-1",
            summary: "Root epic",
            type: "Epic",
            badge: "E",
            status: "Open",
            sprint: "",
            assignee: "",
            priority: "",
            labels: [],
            created: "",
            updated: "",
            estimate: 0,
            children: [
                {
                    key: "EPIC-2",
                    summary: "Nested epic",
                    type: "Epic",
                    badge: "E",
                    status: "Open",
                    sprint: "",
                    assignee: "",
                    priority: "",
                    labels: [],
                    created: "",
                    updated: "",
                    estimate: 0,
                    children: [
                        {
                            key: "STORY-2",
                            summary: "Nested child story",
                            type: "Story",
                            badge: "S",
                            status: "Open",
                            sprint: "",
                            assignee: "",
                            priority: "",
                            labels: [],
                            created: "",
                            updated: "",
                            estimate: 0,
                            children: []
                        }
                    ]
                }
            ]
        }
    ];

    rendering.init($c, {
        onToggleExpandedKey: function(key) {
            calls.push(key);
        }
    });
    rendering.renderHeader();
    rendering.renderTree(tree, "accordion", { "EPIC-1": true });

    assert.equal($c.find(".ujg-sb-acc-toggle").length, 1);
    $c.find(".ujg-sb-acc-toggle").trigger("click");
    assert.deepEqual(calls, ["EPIC-2"]);
});

test("rows view renders compact stacked rows with hierarchy indentation", function() {
    var documentNode = createNode("document");
    var $ = createMiniJquery(documentNode);
    var config = loadConfig(mockWindow());
    var utils = loadUtils(mockWindow());
    var rendering = loadRendering($, config, utils);
    var $c = $("<div/>");
    var tree = sampleTree();

    rendering.init($c, {});
    rendering.renderHeader();
    rendering.renderTree(tree, "rows", { "EPIC-1": true });

    var items = $c.find(".ujg-sb-row-item");
    assert.ok(items.length >= 2);
    assert.ok(hasClass(items[0], "ujg-sb-depth-0"));
    assert.ok(hasClass(items[1], "ujg-sb-depth-1"));
    var t = $c.find(".ujg-sb-view-host").text();
    assert.ok(t.indexOf("EPIC-1") >= 0 && t.indexOf("STORY-1") >= 0);
});

test("rows view exposes a row toggle for expandable roots", function() {
    var documentNode = createNode("document");
    var $ = createMiniJquery(documentNode);
    var config = loadConfig(mockWindow());
    var utils = loadUtils(mockWindow());
    var rendering = loadRendering($, config, utils);
    var $c = $("<div/>");
    var calls = [];

    rendering.init($c, {
        onToggleExpandedKey: function(key) {
            calls.push(key);
        }
    });
    rendering.renderHeader();
    rendering.renderTree(sampleTree(), "rows", {});

    var bodyCollapsed = $c.find(".ujg-sb-view-host").text();
    assert.ok(bodyCollapsed.indexOf("EPIC-1") >= 0);
    assert.equal(bodyCollapsed.indexOf("STORY-1") >= 0, false);
    assert.equal($c.find(".ujg-sb-row-toggle").length, 1);

    $c.find(".ujg-sb-row-toggle").trigger("click");
    assert.deepEqual(calls, ["EPIC-1"]);
});

test("rows view renders orphan bucket and nested non-epic descendants without leaking internal key", function() {
    var documentNode = createNode("document");
    var $ = createMiniJquery(documentNode);
    var config = loadConfig(mockWindow());
    var utils = loadUtils(mockWindow());
    var rendering = loadRendering($, config, utils);
    var $c = $("<div/>");
    var tree = orphanTree();

    rendering.init($c, {});
    rendering.renderHeader();
    rendering.renderTree(tree, "rows", { "__orphans__": true });

    var items = $c.find(".ujg-sb-row-item");
    var text = $c.find(".ujg-sb-view-host").text();

    assert.equal(items.length, 3);
    assert.ok(hasClass(items[0], "ujg-sb-depth-0"));
    assert.ok(hasClass(items[1], "ujg-sb-depth-1"));
    assert.ok(hasClass(items[2], "ujg-sb-depth-2"));
    assert.ok(text.indexOf("Без эпика") >= 0);
    assert.ok(text.indexOf("STORY-O1") >= 0);
    assert.ok(text.indexOf("SUB-O1") >= 0);
    assert.equal(text.indexOf("__orphans__") >= 0, false);
});


test("header renders История button in actions area", function() {
    var documentNode = createNode("document");
    var $ = createMiniJquery(documentNode);
    var config = loadConfig(mockWindow());
    var utils = loadUtils(mockWindow());
    var rendering = loadRendering($, config, utils);
    var $c = $("<div/>");

    rendering.init($c, {});
    rendering.renderHeader();

    var $btn = $c.find(".ujg-sb-open-history");
    assert.equal($btn.length, 1);
    assert.ok(nodeText($btn[0]).indexOf("История") >= 0);
});

test("clicking История calls onOpenCreateStory", function() {
    var documentNode = createNode("document");
    var $ = createMiniJquery(documentNode);
    var config = loadConfig(mockWindow());
    var utils = loadUtils(mockWindow());
    var rendering = loadRendering($, config, utils);
    var $c = $("<div/>");
    var calls = 0;

    rendering.init($c, {
        onOpenCreateStory: function() {
            calls += 1;
        }
    });
    rendering.renderHeader();

    $c.find(".ujg-sb-open-history").trigger("click");
    assert.equal(calls, 1);
});

test("init creates dedicated popup host for modal mount", function() {
    var documentNode = createNode("document");
    var $ = createMiniJquery(documentNode);
    var config = loadConfig(mockWindow());
    var utils = loadUtils(mockWindow());
    var rendering = loadRendering($, config, utils);
    var $c = $("<div/>");
    var draft = {
        projectKey: "P1",
        mode: "draft",
        epic: { issueType: "Epic", summary: "", description: "", ui: { editing: false, isDescriptionOpen: false } },
        story: { issueType: "Story", summary: "S", description: "", ui: { editing: false, isDescriptionOpen: false } },
        children: [],
        ui: {}
    };

    rendering.init($c, {});
    assert.equal($c.find(".ujg-sb-popup-host").length, 1);

    rendering.renderTree(sampleTree(), "table", { "EPIC-1": true });
    rendering.renderCreateStoryModal(draft);

    assert.equal($c.find(".ujg-sb-view-host").find(".ujg-sb-create-overlay").length, 0);
    assert.equal($c.find(".ujg-sb-popup-host").find(".ujg-sb-create-overlay").length, 1);
    assert.ok($c.find(".ujg-sb-view-host").text().indexOf("STORY-1") >= 0);
});

test("clearCreateStoryModal empties popup host without touching view host", function() {
    var documentNode = createNode("document");
    var $ = createMiniJquery(documentNode);
    var config = loadConfig(mockWindow());
    var utils = loadUtils(mockWindow());
    var rendering = loadRendering($, config, utils);
    var $c = $("<div/>");
    var draft = {
        projectKey: "P1",
        mode: "draft",
        epic: { issueType: "Epic", summary: "", description: "", ui: { editing: false, isDescriptionOpen: false } },
        story: { issueType: "Story", summary: "S", description: "", ui: { editing: false, isDescriptionOpen: false } },
        children: [],
        ui: {}
    };

    rendering.init($c, {});
    rendering.renderTree(sampleTree(), "table", { "EPIC-1": true });
    rendering.renderCreateStoryModal(draft);
    assert.equal($c.find(".ujg-sb-popup-host").find(".ujg-sb-create-overlay").length, 1);

    rendering.clearCreateStoryModal();
    assert.equal($c.find(".ujg-sb-popup-host").find(".ujg-sb-create-overlay").length, 0);
    assert.ok($c.find(".ujg-sb-view-host").text().indexOf("STORY-1") >= 0);
});

test("renderCreateStoryModal exposes literal-port create-modal hooks (create-story renderer)", function() {
    var documentNode = createNode("document");
    var $ = createMiniJquery(documentNode);
    var config = loadConfig(mockWindow());
    var utils = loadUtils(mockWindow());
    var CS = loadCreateStory($, config);
    var rendering = loadRendering($, config, utils);
    var $c = $("<div/>");
    var draft = CS.makeDefaultDraft("P1");
    draft.story.summary = "S";
    draft.children.forEach(function(c) {
        c.summary = "c";
    });
    rendering.init($c, {
        onCloseCreateStory: function() {},
        onSubmitCreateStory: function() {}
    });
    rendering.renderCreateStoryModal(draft);
    var $host = $c.find(".ujg-sb-popup-host");
    var $dialog = $host.find(".ujg-sb-create-dialog");
    assert.equal($dialog.length, 1, "dialog rendered in popup host");
    assert.ok(hasClass($dialog[0], "ujg-sb-create-ref-shell"), "ref shell on dialog");
    var $header = $host.find(".ujg-sb-create-header");
    assert.equal($header.length, 1, "header rendered");
    assert.ok($($header[0]).find(".ujg-sb-create-kpi-header").length >= 1, "KPI header");
    assert.equal($host.find(".ujg-sb-create-epic-toolbar").length, 0, "no legacy epic toolbar");
    var $epicRow = $host.find(".ujg-sb-create-row-epic");
    assert.equal($epicRow.length, 1, "epic row rendered");
    assert.ok($($epicRow[0]).find(".ujg-sb-create-epic-controls").length >= 1, "epic controls on epic row");
    var $childBar = $host.find(".ujg-sb-create-children-toolbar");
    assert.equal($childBar.length, 1, "child toolbar rendered");
    var $childBtns = $($childBar[0]).find(".ujg-sb-create-child-view-btn");
    assert.equal($childBtns.length, 3, "three child-area toggles");
    ["Таблица", "Аккордеон", "Строки"].forEach(function(lab) {
        var hit = false;
        $childBtns.each(function() {
            if (nodeText(this).indexOf(lab) >= 0) {
                hit = true;
            }
        });
        assert.ok(hit, "child toggle " + lab);
    });
    var $roleStrip = $host.find(".ujg-sb-create-role-add-strip");
    assert.equal($roleStrip.length, 1, "role chip strip rendered");
    var $roleChips = $($roleStrip[0]).find(".ujg-sb-create-role-add-chip");
    assert.equal($roleChips.length, 5, "five add-role chips");
    ["+SE", "+FE", "+BE", "+QA", "+DO"].forEach(function(marker) {
        var compact = marker.replace(/\s+/g, "");
        var hit = false;
        $roleChips.each(function() {
            if (nodeText(this).replace(/\s+/g, "").indexOf(compact) >= 0) {
                hit = true;
            }
        });
        assert.ok(hit, "role chip " + marker);
    });
    assert.equal($host.find(".ujg-sb-create-bottom-tabs").length, 1, "bottom tab strip on dialog");
    assert.equal($host.find(".ujg-sb-create-tab-activity").length, 1);
    assert.equal($host.find(".ujg-sb-create-tab-comments").length, 1);
    assert.equal($host.find(".ujg-sb-create-tab-worklog").length, 1);
});

test("view mode and expand or collapse callbacks fire when buttons clicked", function() {
    var documentNode = createNode("document");
    var $ = createMiniJquery(documentNode);
    var config = loadConfig(mockWindow());
    var utils = loadUtils(mockWindow());
    var rendering = loadRendering($, config, utils);
    var $c = $("<div/>");
    var calls = [];

    rendering.init($c, {
        onViewMode: function(mode) {
            calls.push(["view", mode]);
        },
        onExpandAll: function() {
            calls.push(["expand"]);
        },
        onCollapseAll: function() {
            calls.push(["collapse"]);
        }
    });
    rendering.renderHeader();

    $c.find(".ujg-sb-view-accordion").trigger("click");
    $c.find(".ujg-sb-expand-all").trigger("click");
    $c.find(".ujg-sb-collapse-all").trigger("click");

    assert.deepEqual(calls, [["view", "accordion"], ["expand"], ["collapse"]]);
});

test("renderProgress removes progress UI on clear and shows loading ratio when provided", function() {
    var documentNode = createNode("document");
    var $ = createMiniJquery(documentNode);
    var config = loadConfig(mockWindow());
    var utils = loadUtils(mockWindow());
    var rendering = loadRendering($, config, utils);
    var $c = $("<div/>");

    rendering.init($c, {});
    rendering.renderProgress(3, 10);
    var label = $c.find(".ujg-sb-progress-label").text();
    assert.equal($c.find(".ujg-sb-progress").length, 1);
    assert.ok(label.indexOf("3") >= 0 && label.indexOf("10") >= 0);

    rendering.renderProgress(0, 0);
    assert.equal($c.find(".ujg-sb-progress").length, 0);
    assert.equal($c.find(".ujg-sb-progress-label").length, 0);
    assert.equal($c.text(), "");
});
