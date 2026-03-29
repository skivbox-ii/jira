const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const loadAmdModule = require("./helpers/load-amd-module");

const MODULE_DIR = path.join(__dirname, "..", "ujg-story-browser-modules");

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
                if (!node) {
                    return;
                }
                if (matchesSelector(node, selector)) {
                    out.push(node);
                }
                (node.children || []).forEach(walk);
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
        return this;
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
            if (!this[0]) {
                return undefined;
            }
            if (name === "checked") {
                return !!this[0].properties.checked;
            }
            return this[0].properties[name];
        }
        return this.each(function() {
            this.properties = this.properties || {};
            this.properties[name] = value;
        });
    };

    $.fn.first = function() {
        return this.length ? wrap([this[0]]) : wrap([]);
    };

    $.documentNode = documentNode;
    return $;
}

function mockWindow() {
    return {
        location: {
            origin: "https://jira.example.com",
            protocol: "https:"
        },
        AJS: { params: { baseURL: "" } }
    };
}

function loadConfig() {
    return loadAmdModule(path.join(MODULE_DIR, "config.js"), {}, { window: mockWindow() });
}

function loadCreateStory() {
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const config = loadConfig();
    return loadAmdModule(path.join(MODULE_DIR, "create-story.js"), {
        _ujgSB_config: config,
        jquery: $
    });
}

function assertNodeShape(node) {
    assert.equal(typeof node.issueType, "string");
    assert.equal(typeof node.summary, "string");
    assert.equal(typeof node.description, "string");
    assert.ok("assignee" in node);
    assert.ok("estimate" in node);
    assert.ok(Array.isArray(node.components));
    assert.ok(Array.isArray(node.labels));
    assert.ok("createdKey" in node);
    assert.ok(Array.isArray(node.errors));
    assert.ok(node.ui && typeof node.ui === "object");
    assert.equal(typeof node.ui.editing, "boolean");
    assert.equal(typeof node.ui.isDescriptionOpen, "boolean");
}

test("makeDefaultDraft creates epic, story, and SE/FE/BE/QA/DO children", function() {
    const CS = loadCreateStory();
    const draft = CS.makeDefaultDraft("PROJ");

    assert.equal(draft.projectKey, "PROJ");
    assert.equal(draft.mode, "draft");
    assert.ok(draft.ui && typeof draft.ui === "object");

    assertNodeShape(draft.epic);
    assertNodeShape(draft.story);
    draft.children.forEach(assertNodeShape);

    assert.equal(draft.epic.issueType, "Epic");
    assert.equal(draft.story.issueType, "Story");
    assert.equal(draft.children.length, 5);

    const expectedRoles = [
        { role: "SE", issueType: "System Engineer", summary: "Анализ и описание функционала" },
        { role: "FE", issueType: "Frontend Task", summary: "Вёрстка / UI" },
        { role: "BE", issueType: "Backend Task", summary: "Реализация логики" },
        { role: "QA", issueType: "QA", summary: "Тестирование" },
        { role: "DO", issueType: "DevOps", summary: "Подготовка окружения / деплой" }
    ];
    expectedRoles.forEach(function(exp, i) {
        assert.equal(draft.children[i].issueType, exp.issueType, "child " + exp.role + " issueType");
        assert.equal(draft.children[i].summary, exp.summary, "child " + exp.role + " summary");
    });
});

test("toggleDescription toggles isDescriptionOpen on any row node", function() {
    const CS = loadCreateStory();
    const draft = CS.makeDefaultDraft("K");
    const node = draft.story;
    assert.equal(node.ui.isDescriptionOpen, false);
    CS.toggleDescription(node);
    assert.equal(node.ui.isDescriptionOpen, true);
    CS.toggleDescription(node);
    assert.equal(node.ui.isDescriptionOpen, false);
    CS.toggleDescription(draft.epic);
    assert.equal(draft.epic.ui.isDescriptionOpen, true);
});

test("validateDraft reports missing summary on story and child rows", function() {
    const CS = loadCreateStory();
    const draft = CS.makeDefaultDraft("X");
    draft.story.summary = "";
    draft.children[0].summary = "   ";
    draft.children[1].summary = "ok";

    CS.validateDraft(draft, {});

    assert.ok(
        draft.story.errors.some(function(e) {
            return String(e).toLowerCase().includes("summary");
        }),
        "story should have summary error"
    );
    assert.ok(
        draft.children[0].errors.some(function(e) {
            return String(e).toLowerCase().includes("summary");
        }),
        "first child should have summary error"
    );
    assert.equal(
        draft.children[1].errors.filter(function(e) {
            return String(e).toLowerCase().includes("summary");
        }).length,
        0,
        "child with summary should not have summary error"
    );
});

test("validateDraft clears prior errors before re-run", function() {
    const CS = loadCreateStory();
    const draft = CS.makeDefaultDraft("Y");
    draft.story.summary = "";
    CS.validateDraft(draft, {});
    assert.ok(draft.story.errors.length > 0);
    draft.story.summary = "Fixed";
    CS.validateDraft(draft, {});
    assert.equal(
        draft.story.errors.filter(function(e) {
            return String(e).toLowerCase().includes("summary");
        }).length,
        0
    );
});

test("renderCreateModal renders popup shell, tree rows, and + описание per row", function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("PROJ");
    const $mount = $("<div/>");

    CS.renderCreateModal($mount, draft);

    const mountEl = $mount[0];
    assert.ok(hasClass(mountEl, "ujg-sb-popup-host"), "mount is the popup host");
    assert.equal(mountEl.children.length, 1, "mount has single direct child (overlay)");
    assert.ok(hasClass(mountEl.children[0], "ujg-sb-create-overlay"), "overlay is direct child of mount");
    assert.equal($mount.find(".ujg-story-browser").length, 0, "no extra widget root wrapper inside mount");

    assert.equal($mount.find(".ujg-sb-create-overlay").length, 1, "overlay");
    assert.equal($mount.find(".ujg-sb-create-dialog").length, 1, "dialog");
    assert.equal($mount.find(".ujg-sb-create-header").length, 1, "header");
    assert.equal($mount.find(".ujg-sb-create-tree").length, 1, "tree");

    const rows = $mount.find(".ujg-sb-create-tree-row");
    assert.equal(rows.length, 7, "epic + story + 5 role children");

    const addDesc = $mount.find(".ujg-sb-create-add-desc");
    assert.equal(addDesc.length, 7);
    addDesc.each(function() {
        assert.match(nodeText(this), /\+\s*описание/i);
    });
});

test("renderCreateModal: clicking summary enables inline summary editor for that row", function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("K");
    const $mount = $("<div/>");

    CS.renderCreateModal($mount, draft);
    let $storyRow = $mount.find(".ujg-sb-create-row-story");
    assert.equal($storyRow.find("input").length, 0, "summary starts as text, not input");

    $storyRow.find(".ujg-sb-create-summary").trigger("click");
    $storyRow = $mount.find(".ujg-sb-create-row-story");
    assert.equal($storyRow.find("input").length, 1);
    assert.ok(hasClass($storyRow.find("input")[0], "ujg-sb-inline-editor"));
    assert.ok(draft.story.ui.editing);
});

test("renderCreateModal: clicking + описание reveals description editor under row", function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("K");
    const $mount = $("<div/>");

    CS.renderCreateModal($mount, draft);
    let $storyRow = $mount.find(".ujg-sb-create-row-story");
    assert.equal($storyRow.find("textarea").length, 0);

    $storyRow.find(".ujg-sb-create-add-desc").trigger("click");
    $storyRow = $mount.find(".ujg-sb-create-row-story");
    assert.equal($storyRow.find("textarea").length, 1);
    assert.ok(hasClass($storyRow.find("textarea")[0], "ujg-sb-inline-editor"));
    assert.equal(draft.story.ui.isDescriptionOpen, true);
});

test("renderCreateModal: description toggle label switches between + and - описание", function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("K");
    const $mount = $("<div/>");

    CS.renderCreateModal($mount, draft);
    let $storyRow = $mount.find(".ujg-sb-create-row-story");
    let $btn = $storyRow.find(".ujg-sb-create-add-desc");
    assert.match(nodeText($btn[0]), /^\s*\+\s*описание\s*$/i, "closed: + описание");

    $btn.trigger("click");
    $storyRow = $mount.find(".ujg-sb-create-row-story");
    $btn = $storyRow.find(".ujg-sb-create-add-desc");
    assert.match(nodeText($btn[0]), /^\s*\-\s*описание\s*$/i, "open: - описание");

    $btn.trigger("click");
    $storyRow = $mount.find(".ujg-sb-create-row-story");
    $btn = $storyRow.find(".ujg-sb-create-add-desc");
    assert.match(nodeText($btn[0]), /^\s*\+\s*описание\s*$/i, "closed again: + описание");
});

test("normalizeUserSearchRows maps picker users to label/id rows", function() {
    const CS = loadCreateStory();
    const rows = CS.normalizeUserSearchRows({
        users: [
            { name: "jdoe", displayName: "John Doe", accountId: "acc1" },
            { displayName: "Jane", name: "jane" }
        ]
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, "jdoe");
    assert.match(rows[0].label, /John/);
    assert.equal(rows[1].id, "jane");
});

test("normalizeComponentRows maps Jira components to rows", function() {
    const CS = loadCreateStory();
    const rows = CS.normalizeComponentRows([{ id: "1", name: "API" }, { name: "UI" }]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, "API");
    assert.equal(rows[0].label, "API");
    assert.equal(rows[1].id, "UI");
});

test("normalizeLabelSearchRows dedupes labels from search issues", function() {
    const CS = loadCreateStory();
    const rows = CS.normalizeLabelSearchRows({
        issues: [
            { fields: { labels: ["a", "b"] } },
            { fields: { labels: ["b", "c"] } }
        ]
    });
    assert.equal(rows.length, 3);
    assert.equal(rows[0].id, "a");
    assert.equal(rows[1].id, "b");
    assert.equal(rows[2].id, "c");
});

test("validateDraft submit: newEpic requires epic summary", function() {
    const CS = loadCreateStory();
    const draft = CS.makeDefaultDraft("P");
    draft.epicMode = "newEpic";
    draft.epic.summary = "";
    draft.story.summary = "Story ok";
    draft.children.forEach(function(c) {
        c.summary = "child ok";
    });
    CS.validateDraft(draft, { purpose: "submit" });
    assert.ok(draft.epic.errors.length > 0);
});

test("validateDraft submit: existingEpic requires epic key selection", function() {
    const CS = loadCreateStory();
    const draft = CS.makeDefaultDraft("P");
    draft.epicMode = "existingEpic";
    draft.existingEpicKey = "";
    draft.story.summary = "S";
    draft.children.forEach(function(c) {
        c.summary = "c";
    });
    CS.validateDraft(draft, { purpose: "submit" });
    assert.ok((draft.ui.formErrors || []).length > 0);
});

test("submitCreateDraft existingEpic creates story then children sequentially", async function() {
    const CS = loadCreateStory();
    const config = loadConfig();
    const draft = CS.makeDefaultDraft("PROJ");
    draft.epicMode = "existingEpic";
    draft.existingEpicKey = "PROJ-99";
    draft.story.summary = "My story";
    draft.children[0].summary = "C1";
    draft.children[1].summary = "C2";
    for (var i = 2; i < draft.children.length; i++) {
        draft.children[i].summary = "Cx" + i;
    }
    const order = [];
    const api = {
        createIssue: function(payload) {
            order.push(payload.fields.issuetype.name);
            if (payload.fields.issuetype.name === "Story") {
                return Promise.resolve({ key: "PROJ-10" });
            }
            return Promise.resolve({ key: "PROJ-11" });
        }
    };
    const result = await CS.submitCreateDraft(api, draft);
    assert.equal(result.ok, true);
    assert.equal(order[0], "Story");
    assert.ok(order.length >= 1 + draft.children.length);
    assert.equal(draft.story.createdKey, "PROJ-10");
    assert.equal(draft.children[0].createdKey != null && draft.children[0].createdKey !== "", true);
});

test("submitCreateDraft newEpic creates epic then story then children sequentially", async function() {
    const CS = loadCreateStory();
    const config = loadConfig();
    const draft = CS.makeDefaultDraft("PROJ");
    draft.epicMode = "newEpic";
    draft.epic.summary = "Epic sum";
    draft.story.summary = "Story sum";
    draft.children.forEach(function(c) {
        c.summary = "Ch " + c.issueType;
    });
    const order = [];
    var n = 0;
    const api = {
        createIssue: function(payload) {
            order.push(payload.fields.issuetype.name);
            n += 1;
            return Promise.resolve({ key: "PROJ-" + n });
        }
    };
    const result = await CS.submitCreateDraft(api, draft);
    assert.equal(result.ok, true);
    assert.equal(order[0], "Epic");
    assert.equal(order[1], "Story");
    assert.equal(order.length, 1 + 1 + draft.children.length);
    assert.equal(draft.epic.createdKey, "PROJ-1");
    assert.equal(draft.story.createdKey, "PROJ-2");
});

test("submitCreateDraft preserves created keys and marks failed child row", async function() {
    const CS = loadCreateStory();
    const config = loadConfig();
    const draft = CS.makeDefaultDraft("P");
    draft.epicMode = "existingEpic";
    draft.existingEpicKey = "P-1";
    draft.story.summary = "S";
    draft.children[0].summary = "OK";
    draft.children[1].summary = "BAD";
    draft.children[2].summary = "SKIP";
    for (var j = 3; j < draft.children.length; j++) {
        draft.children[j].summary = "X";
    }
    var call = 0;
    const api = {
        createIssue: function() {
            call += 1;
            if (call === 1) {
                return Promise.resolve({ key: "P-ST" });
            }
            if (call === 2) {
                return Promise.resolve({ key: "P-C1" });
            }
            return Promise.reject({ responseJSON: { errorMessages: ["fail"] } });
        }
    };
    const result = await CS.submitCreateDraft(api, draft);
    assert.equal(result.ok, false);
    assert.equal(draft.story.createdKey, "P-ST");
    assert.equal(draft.children[0].createdKey, "P-C1");
    assert.equal(draft.children[1].createdKey, null);
    assert.ok(draft.children[1].errors.length > 0);
    assert.equal(draft.children[2].createdKey, null);
});

test("submitCreateDraft retry only posts unresolved children", async function() {
    const CS = loadCreateStory();
    const config = loadConfig();
    const draft = CS.makeDefaultDraft("P");
    draft.epicMode = "existingEpic";
    draft.existingEpicKey = "P-1";
    draft.story.summary = "S";
    draft.story.createdKey = "P-ST";
    draft.children.forEach(function(c, idx) {
        c.summary = "Child " + idx;
        c.createdKey = "P-OLD-" + idx;
        c.errors = [];
    });
    draft.children[1].createdKey = null;
    draft.children[1].errors = ["prev"];
    const summaries = [];
    const api = {
        createIssue: function(payload) {
            summaries.push(payload.fields.summary);
            return Promise.resolve({ key: "P-B" });
        }
    };
    const result = await CS.submitCreateDraft(api, draft);
    assert.equal(result.ok, true);
    assert.deepEqual(summaries, ["Child 1"]);
});

test("renderCreateModal with ctx shows header actions and surfaces submit validation", function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("K");
    draft.story.summary = "";
    const $mount = $("<div/>");
    CS.validateDraft(draft, { purpose: "submit" });
    CS.renderCreateModal($mount, draft, {
        onClose: function() {},
        onSubmit: function() {},
        getEpicOptions: function() {
            return [];
        }
    });
    assert.ok($mount.find(".ujg-sb-create-submit").length >= 1);
    assert.ok($mount.find(".ujg-sb-create-close").length >= 1);
    assert.ok($mount.find(".ujg-sb-create-form-errors").length >= 1);
});

test("renderCreateModal: picking assignee from selector updates draft.story.assignee", async function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("K");
    draft.story.summary = "S";
    draft.children.forEach(function(c) {
        c.summary = "c";
    });
    const $mount = $("<div/>");
    let lastQuery = "";
    CS.renderCreateModal($mount, draft, {
        api: {
            searchUsers: function(q) {
                lastQuery = String(q);
                return Promise.resolve({ users: [{ name: "u1", displayName: "User One" }] });
            },
            getProjectComponents: function() {
                return Promise.resolve([]);
            },
            searchLabels: function() {
                return Promise.resolve({ issues: [] });
            }
        },
        onClose: function() {},
        onSubmit: function() {},
        getEpicOptions: function() {
            return [];
        }
    });
    const $trig = $mount.find(".ujg-sb-create-row-story").find(".ujg-sb-create-assignee-trigger");
    assert.ok($trig.length >= 1, "assignee trigger present");
    $trig.trigger("click");
    const $search = $mount.find(".ujg-sb-create-selector-search");
    assert.ok($search.length >= 1);
    $search.val("User");
    $search.trigger("input");
    await new Promise(function(r) {
        setImmediate(r);
    });
    const $pick = $mount.find(".ujg-sb-create-selector-option").first();
    assert.ok($pick.length >= 1);
    $pick.trigger("click");
    assert.ok(draft.story.assignee);
    assert.equal(draft.story.assignee.name, "u1");
    assert.equal(lastQuery, "User");
});

test("renderCreateModal: component selector adds component to draft row", async function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("K");
    draft.story.summary = "S";
    draft.children.forEach(function(c) {
        c.summary = "c";
    });
    const $mount = $("<div/>");
    CS.renderCreateModal($mount, draft, {
        api: {
            searchUsers: function() {
                return Promise.resolve({ users: [] });
            },
            getProjectComponents: function() {
                return Promise.resolve([{ name: "API" }]);
            },
            searchLabels: function() {
                return Promise.resolve({ issues: [] });
            }
        },
        onClose: function() {},
        onSubmit: function() {},
        getEpicOptions: function() {
            return [];
        }
    });
    $mount.find(".ujg-sb-create-row-story").find(".ujg-sb-create-component-trigger").trigger("click");
    await new Promise(function(r) {
        setImmediate(r);
    });
    const $opt = $mount.find(".ujg-sb-create-selector-option").first();
    assert.ok($opt.length >= 1);
    $opt.trigger("click");
    assert.ok(draft.story.components.some(function(c) {
        return c.name === "API";
    }));
});

test("renderCreateModal: label selector adds label to draft row", async function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("K");
    draft.story.summary = "S";
    draft.children.forEach(function(c) {
        c.summary = "c";
    });
    const $mount = $("<div/>");
    CS.renderCreateModal($mount, draft, {
        api: {
            searchUsers: function() {
                return Promise.resolve({ users: [] });
            },
            getProjectComponents: function() {
                return Promise.resolve([]);
            },
            searchLabels: function() {
                return Promise.resolve({ issues: [{ fields: { labels: ["security"] } }] });
            }
        },
        onClose: function() {},
        onSubmit: function() {},
        getEpicOptions: function() {
            return [];
        }
    });
    $mount.find(".ujg-sb-create-row-story").find(".ujg-sb-create-label-trigger").trigger("click");
    await new Promise(function(r) {
        setImmediate(r);
    });
    const $opt = $mount.find(".ujg-sb-create-selector-option").first();
    assert.ok($opt.length >= 1);
    $opt.trigger("click");
    assert.ok(draft.story.labels.indexOf("security") >= 0);
});

test("buildIssueFields prefers assignee accountId over name", function() {
    const CS = loadCreateStory();
    const node = {
        summary: "S",
        description: "",
        assignee: { accountId: "acc-1", name: "legacy" },
        components: [],
        labels: []
    };
    const fields = CS.buildIssueFields("PROJ", node, "Story", {});
    assert.equal(fields.assignee.accountId, "acc-1");
    assert.equal(fields.assignee.name, undefined);
});

test("buildIssueFields falls back to assignee name when no accountId", function() {
    const CS = loadCreateStory();
    const node = {
        summary: "S",
        description: "",
        assignee: { name: "jdoe" },
        components: [],
        labels: []
    };
    const fields = CS.buildIssueFields("PROJ", node, "Story", {});
    assert.equal(fields.assignee.name, "jdoe");
    assert.equal(fields.assignee.accountId, undefined);
});

test("submitCreateDraft ignores second call while first chain is in flight", async function() {
    const CS = loadCreateStory();
    const config = loadConfig();
    const draft = CS.makeDefaultDraft("P");
    draft.epicMode = "existingEpic";
    draft.existingEpicKey = "P-1";
    draft.story.summary = "S";
    draft.children.forEach(function(c) {
        c.summary = "c";
    });
    var inFlight = 0;
    var createCount = 0;
    const api = {
        createIssue: function() {
            createCount += 1;
            inFlight += 1;
            return new Promise(function(resolve) {
                setTimeout(function() {
                    inFlight -= 1;
                    resolve({ key: "P-" + createCount });
                }, 5);
            });
        }
    };
    const p1 = CS.submitCreateDraft(api, draft);
    const p2 = CS.submitCreateDraft(api, draft);
    const r2 = await p2;
    assert.equal(r2.skipped, true);
    assert.equal(r2.ok, false);
    await p1;
    assert.equal(createCount, 1 + draft.children.length);
});

test("submitCreateDraft surfaces epic create failure on epic row and stops chain", async function() {
    const CS = loadCreateStory();
    const config = loadConfig();
    const draft = CS.makeDefaultDraft("P");
    draft.epicMode = "newEpic";
    draft.epic.summary = "E";
    draft.story.summary = "S";
    draft.children.forEach(function(c) {
        c.summary = "c";
    });
    var storyTried = false;
    const api = {
        createIssue: function(payload) {
            if (payload.fields.issuetype.name === "Epic") {
                return Promise.reject({ responseJSON: { errorMessages: ["epic bad"] } });
            }
            storyTried = true;
            return Promise.resolve({ key: "P-9" });
        }
    };
    const result = await CS.submitCreateDraft(api, draft);
    assert.equal(result.ok, false);
    assert.ok(draft.epic.errors.some(function(e) {
        return String(e).indexOf("epic bad") >= 0;
    }));
    assert.equal(storyTried, false);
    assert.equal(draft.story.createdKey, null);
});

test("submitCreateDraft surfaces story create failure on story row", async function() {
    const CS = loadCreateStory();
    const config = loadConfig();
    const draft = CS.makeDefaultDraft("P");
    draft.epicMode = "existingEpic";
    draft.existingEpicKey = "P-EP";
    draft.story.summary = "S";
    draft.children.forEach(function(c) {
        c.summary = "c";
    });
    var childTried = false;
    const api = {
        createIssue: function(payload) {
            if (payload.fields.issuetype.name === "Story") {
                return Promise.reject({ statusText: "Bad Request" });
            }
            childTried = true;
            return Promise.resolve({ key: "P-9" });
        }
    };
    const result = await CS.submitCreateDraft(api, draft);
    assert.equal(result.ok, false);
    assert.ok(draft.story.errors.length > 0);
    assert.equal(childTried, false);
});

test("submitCreateDraft treats missing issue key in response as child failure", async function() {
    const CS = loadCreateStory();
    const config = loadConfig();
    const draft = CS.makeDefaultDraft("P");
    draft.epicMode = "existingEpic";
    draft.existingEpicKey = "P-1";
    draft.story.summary = "S";
    draft.children.forEach(function(c) {
        c.summary = "c";
    });
    var phase = 0;
    const api = {
        createIssue: function() {
            phase += 1;
            if (phase === 1) {
                return Promise.resolve({ key: "P-ST" });
            }
            return Promise.resolve({ id: "12345" });
        }
    };
    const result = await CS.submitCreateDraft(api, draft);
    assert.equal(result.ok, false);
    assert.equal(draft.story.createdKey, "P-ST");
    assert.ok(
        draft.children[0].errors.some(function(e) {
            return String(e).toLowerCase().indexOf("key") >= 0;
        })
    );
});

test("renderCreateModal disables submit while draft.ui.submitting", function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("K");
    draft.story.summary = "S";
    draft.children.forEach(function(c) {
        c.summary = "c";
    });
    draft.ui.submitting = true;
    const $mount = $("<div/>");
    CS.renderCreateModal($mount, draft, {
        onClose: function() {},
        onSubmit: function() {},
        getEpicOptions: function() {
            return [];
        }
    });
    const btn = $mount.find(".ujg-sb-create-submit")[0];
    assert.equal(btn.getAttribute("disabled"), "disabled");
});

test("assignee selector ignores stale search result when a newer query completed", async function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("K");
    draft.story.summary = "S";
    draft.children.forEach(function(c) {
        c.summary = "c";
    });
    const $mount = $("<div/>");
    CS.renderCreateModal($mount, draft, {
        isDraftActive: function() {
            return true;
        },
        api: {
            searchUsers: function(q) {
                var qq = String(q);
                if (qq === "slow") {
                    return new Promise(function(resolve) {
                        setTimeout(function() {
                            resolve({ users: [{ name: "slow", displayName: "Slow User" }] });
                        }, 40);
                    });
                }
                return Promise.resolve({ users: [{ name: "fast", displayName: "Fast User" }] });
            },
            getProjectComponents: function() {
                return Promise.resolve([]);
            },
            searchLabels: function() {
                return Promise.resolve({ issues: [] });
            }
        },
        onClose: function() {},
        onSubmit: function() {},
        getEpicOptions: function() {
            return [];
        }
    });
    $mount.find(".ujg-sb-create-row-story").find(".ujg-sb-create-assignee-trigger").trigger("click");
    const $search = $mount.find(".ujg-sb-create-selector-search");
    $search.val("slow");
    $search.trigger("input");
    $search.val("fast");
    $search.trigger("input");
    await new Promise(function(r) {
        setTimeout(r, 15);
    });
    assert.equal(draft.ui.selectorRows[0] && draft.ui.selectorRows[0].id, "fast");
    await new Promise(function(r) {
        setTimeout(r, 50);
    });
    assert.equal(draft.ui.selectorRows[0] && draft.ui.selectorRows[0].id, "fast");
});

test("selector async does not rerender when isDraftActive becomes false", async function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("K");
    draft.story.summary = "S";
    draft.children.forEach(function(c) {
        c.summary = "c";
    });
    const $mount = $("<div/>");
    var active = true;
    CS.renderCreateModal($mount, draft, {
        isDraftActive: function() {
            return active;
        },
        api: {
            searchUsers: function() {
                return new Promise(function(resolve) {
                    setTimeout(function() {
                        resolve({ users: [{ name: "late", displayName: "Late" }] });
                    }, 25);
                });
            },
            getProjectComponents: function() {
                return Promise.resolve([]);
            },
            searchLabels: function() {
                return Promise.resolve({ issues: [] });
            }
        },
        onClose: function() {},
        onSubmit: function() {},
        getEpicOptions: function() {
            return [];
        }
    });
    $mount.find(".ujg-sb-create-row-story").find(".ujg-sb-create-assignee-trigger").trigger("click");
    active = false;
    await new Promise(function(r) {
        setTimeout(r, 40);
    });
    assert.equal(draft.ui.selectorRows.length, 0);
});

test("assignee selector: searchUsers rejection clears loading and shows selector error", async function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("K");
    draft.story.summary = "S";
    draft.children.forEach(function(c) {
        c.summary = "c";
    });
    const $mount = $("<div/>");
    CS.renderCreateModal($mount, draft, {
        isDraftActive: function() {
            return true;
        },
        api: {
            searchUsers: function() {
                return Promise.reject({ responseJSON: { errorMessages: ["picker down"] } });
            },
            getProjectComponents: function() {
                return Promise.resolve([]);
            },
            searchLabels: function() {
                return Promise.resolve({ issues: [] });
            }
        },
        onClose: function() {},
        onSubmit: function() {},
        getEpicOptions: function() {
            return [];
        }
    });
    $mount.find(".ujg-sb-create-row-story").find(".ujg-sb-create-assignee-trigger").trigger("click");
    await new Promise(function(r) {
        setImmediate(r);
    });
    assert.equal(draft.ui.selectorLoading, false);
    assert.match(String(draft.ui.selectorError || ""), /picker down/);
    assert.ok($mount.find(".ujg-sb-create-selector-error").length >= 1);
});

test("component selector: getProjectComponents rejection shows selector error", async function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("K");
    draft.story.summary = "S";
    draft.children.forEach(function(c) {
        c.summary = "c";
    });
    const $mount = $("<div/>");
    CS.renderCreateModal($mount, draft, {
        isDraftActive: function() {
            return true;
        },
        api: {
            searchUsers: function() {
                return Promise.resolve({ users: [] });
            },
            getProjectComponents: function() {
                return Promise.reject({ statusText: "Forbidden" });
            },
            searchLabels: function() {
                return Promise.resolve({ issues: [] });
            }
        },
        onClose: function() {},
        onSubmit: function() {},
        getEpicOptions: function() {
            return [];
        }
    });
    $mount.find(".ujg-sb-create-row-story").find(".ujg-sb-create-component-trigger").trigger("click");
    await new Promise(function(r) {
        setImmediate(r);
    });
    assert.match(String(draft.ui.selectorError || ""), /Forbidden|Request failed/i);
    assert.ok($mount.find(".ujg-sb-create-selector-error").length >= 1);
});

test("label selector: searchLabels rejection shows selector error", async function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("K");
    draft.story.summary = "S";
    draft.children.forEach(function(c) {
        c.summary = "c";
    });
    const $mount = $("<div/>");
    CS.renderCreateModal($mount, draft, {
        isDraftActive: function() {
            return true;
        },
        api: {
            searchUsers: function() {
                return Promise.resolve({ users: [] });
            },
            getProjectComponents: function() {
                return Promise.resolve([]);
            },
            searchLabels: function() {
                return Promise.reject({ responseJSON: { errorMessages: ["label search failed"] } });
            }
        },
        onClose: function() {},
        onSubmit: function() {},
        getEpicOptions: function() {
            return [];
        }
    });
    $mount.find(".ujg-sb-create-row-story").find(".ujg-sb-create-label-trigger").trigger("click");
    await new Promise(function(r) {
        setImmediate(r);
    });
    assert.match(String(draft.ui.selectorError || ""), /label search failed/);
    assert.ok($mount.find(".ujg-sb-create-selector-error").length >= 1);
});

test("selector rejection ignored when superseded by newer request", async function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("K");
    draft.story.summary = "S";
    draft.children.forEach(function(c) {
        c.summary = "c";
    });
    const $mount = $("<div/>");
    var call = 0;
    CS.renderCreateModal($mount, draft, {
        isDraftActive: function() {
            return true;
        },
        api: {
            searchUsers: function(q) {
                call += 1;
                if (call === 1) {
                    return new Promise(function(_, rej) {
                        setTimeout(function() {
                            rej({ responseJSON: { errorMessages: ["stale fail"] } });
                        }, 60);
                    });
                }
                return Promise.resolve({ users: [{ name: "ok", displayName: "OK User" }] });
            },
            getProjectComponents: function() {
                return Promise.resolve([]);
            },
            searchLabels: function() {
                return Promise.resolve({ issues: [] });
            }
        },
        onClose: function() {},
        onSubmit: function() {},
        getEpicOptions: function() {
            return [];
        }
    });
    $mount.find(".ujg-sb-create-row-story").find(".ujg-sb-create-assignee-trigger").trigger("click");
    await new Promise(function(r) {
        setImmediate(r);
    });
    const $search = $mount.find(".ujg-sb-create-selector-search");
    $search.val("x");
    $search.trigger("input");
    await new Promise(function(r) {
        setImmediate(r);
    });
    assert.equal(draft.ui.selectorRows[0] && draft.ui.selectorRows[0].id, "ok");
    assert.equal(draft.ui.selectorError || "", "");
    await new Promise(function(r) {
        setTimeout(r, 80);
    });
    assert.equal(draft.ui.selectorRows[0] && draft.ui.selectorRows[0].id, "ok");
    assert.equal(draft.ui.selectorError || "", "");
});
