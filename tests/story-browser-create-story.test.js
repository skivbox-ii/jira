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

test("makeDefaultDraft initializes literal-port ui viewMode, activeTab, epicSelectionMode", function() {
    const CS = loadCreateStory();
    const draft = CS.makeDefaultDraft("PROJ");
    assert.equal(draft.ui.viewMode, "rows");
    assert.equal(draft.ui.activeTab, "activity");
    assert.equal(draft.ui.epicSelectionMode, "new");
    assert.equal(draft.ui.nextChildRowSeq, 0);
});

test("makeDefaultDraft assigns stable unique child.ui.rowId for each template child", function() {
    const CS = loadCreateStory();
    const draft = CS.makeDefaultDraft("P");
    const roles = ["SE", "FE", "BE", "QA", "DO"];
    assert.equal(draft.children.length, roles.length);
    const seen = {};
    draft.children.forEach(function(ch, i) {
        assert.ok(ch.ui && ch.ui.rowId, "child " + i + " has ui.rowId");
        const id = ch.ui.rowId;
        assert.equal(typeof id, "string");
        assert.ok(id.length > 0);
        assert.equal(seen[id], undefined, "rowId unique: " + id);
        seen[id] = true;
    });
});

test("draftRows uses child.ui.rowId as row keys for template children", function() {
    const CS = loadCreateStory();
    const draft = CS.makeDefaultDraft("K");
    const rows = CS.draftRows(draft);
    const keys = rows.map(function(r) {
        return r.key;
    });
    assert.ok(keys.indexOf("epic") >= 0);
    assert.ok(keys.indexOf("story") >= 0);
    draft.children.forEach(function(ch) {
        assert.ok(keys.indexOf(ch.ui.rowId) >= 0, "key for rowId " + ch.ui.rowId);
    });
    assert.equal(
        keys.filter(function(k) {
            return /^child-\d+$/.test(k);
        }).length,
        0,
        "no legacy numeric child-N keys when template rowIds exist"
    );
});

test("setEpicSelectionMode syncs draft.epicMode and draft.ui.epicSelectionMode", function() {
    const CS = loadCreateStory();
    const draft = CS.makeDefaultDraft("X");
    CS.setEpicSelectionMode(draft, "existing");
    assert.equal(draft.ui.epicSelectionMode, "existing");
    assert.equal(draft.epicMode, "existingEpic");
    CS.setEpicSelectionMode(draft, "new");
    assert.equal(draft.ui.epicSelectionMode, "new");
    assert.equal(draft.epicMode, "newEpic");
});

test("draftRows hides epic row for existing epic mode and restores for new", function() {
    const CS = loadCreateStory();
    const draft = CS.makeDefaultDraft("Z");
    CS.setEpicSelectionMode(draft, "existing");
    var keysEx = CS.draftRows(draft).map(function(r) {
        return r.key;
    });
    assert.ok(keysEx.indexOf("epic") < 0);
    assert.ok(keysEx.indexOf("story") >= 0);
    CS.setEpicSelectionMode(draft, "new");
    var keysNew = CS.draftRows(draft).map(function(r) {
        return r.key;
    });
    assert.ok(keysNew.indexOf("epic") >= 0);
});

test("legacy draft.epicMode existingEpic syncs ui.epicSelectionMode on validateDraft", function() {
    const CS = loadCreateStory();
    const draft = CS.makeDefaultDraft("L");
    assert.equal(draft.ui.epicSelectionMode, "new");
    draft.epicMode = "existingEpic";
    CS.validateDraft(draft, {});
    assert.equal(draft.ui.epicSelectionMode, "existing");
});

test("validateDraft submit path honors setEpicSelectionMode existing (form error, not epic summary)", function() {
    const CS = loadCreateStory();
    const draft = CS.makeDefaultDraft("P");
    CS.setEpicSelectionMode(draft, "existing");
    draft.existingEpicKey = "";
    draft.epic.summary = "";
    draft.story.summary = "S";
    draft.children.forEach(function(c) {
        c.summary = "c";
    });
    CS.validateDraft(draft, { purpose: "submit" });
    assert.equal(
        draft.epic.errors.filter(function(e) {
            return String(e).toLowerCase().includes("summary");
        }).length,
        0,
        "existing epic mode should not require new epic summary"
    );
    assert.ok((draft.ui.formErrors || []).length > 0, "expect form error for missing epic key");
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

test("renderCreateModal: picking assignee from selector updates child-row assignee", async function() {
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
    const $trig = $mount.find(".ujg-sb-create-row-child-SE").find(".ujg-sb-create-assignee-trigger");
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
    assert.ok(draft.children[0].assignee);
    assert.equal(draft.children[0].assignee.name, "u1");
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
    $mount.find(".ujg-sb-create-row-child-SE").find(".ujg-sb-create-assignee-trigger").trigger("click");
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
    $mount.find(".ujg-sb-create-row-child-SE").find(".ujg-sb-create-assignee-trigger").trigger("click");
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
    $mount.find(".ujg-sb-create-row-child-SE").find(".ujg-sb-create-assignee-trigger").trigger("click");
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
    $mount.find(".ujg-sb-create-row-child-SE").find(".ujg-sb-create-assignee-trigger").trigger("click");
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

test("renderCreateModal literal-port: ref shell, KPI header, epic-in-row, child toggles, role chips", function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("PROJ");
    draft.story.summary = "Story title";
    draft.children.forEach(function(c) {
        c.summary = "child ok";
    });
    const $mount = $("<div/>");
    CS.renderCreateModal($mount, draft, {
        onClose: function() {},
        onSubmit: function() {},
        getEpicOptions: function() {
            return [{ key: "PROJ-9", summary: "Existing epic" }];
        }
    });

    const $dialog = $mount.find(".ujg-sb-create-dialog").first();
    assert.ok($dialog.length, "dialog");
    assert.ok(hasClass($dialog[0], "ujg-sb-create-ref-shell"), "dialog carries literal-port ref shell class");

    const $hdr = $mount.find(".ujg-sb-create-header").first();
    assert.ok($hdr.length, "header");
    assert.ok($hdr.find(".ujg-sb-create-kpi-header").length >= 1, "KPI-style summary header strip inside header");

    assert.equal($mount.find(".ujg-sb-create-epic-toolbar").length, 0, "epic mode not in detached top toolbar");

    const $epicRow = $mount.find(".ujg-sb-create-row-epic").first();
    assert.ok($epicRow.length, "epic row");
    assert.ok($epicRow.find(".ujg-sb-create-epic-controls").length >= 1, "epic selection lives on epic row");

    const $childBar = $mount.find(".ujg-sb-create-children-toolbar");
    assert.equal($childBar.length, 1, "child subtree view toolbar");
    ["Таблица", "Аккордеон", "Строки"].forEach(function(lab) {
        var found = false;
        $childBar.find(".ujg-sb-create-child-view-btn").each(function() {
            if (nodeText(this).indexOf(lab) >= 0) {
                found = true;
            }
        });
        assert.ok(found, "child view toggle label: " + lab);
    });

    const $strip = $mount.find(".ujg-sb-create-role-add-strip");
    assert.equal($strip.length, 1, "add-role chip strip");
    function compact(s) {
        return String(s || "").replace(/\s+/g, "");
    }
    ["+SE", "+FE", "+BE", "+QA", "+DO"].forEach(function(marker) {
        var hit = false;
        $strip.find(".ujg-sb-create-role-add-chip").each(function() {
            if (compact(nodeText(this)).indexOf(compact(marker)) >= 0) {
                hit = true;
            }
        });
        assert.ok(hit, "add-role chip " + marker);
    });

    assert.equal($mount.find(".ujg-sb-create-bottom-tabs").length, 1, "bottom tab strip");
    ["Активность", "Комментарии", "Списания"].forEach(function(lab) {
        var found = false;
        $mount.find(".ujg-sb-create-tab-btn").each(function() {
            if (nodeText(this).indexOf(lab) >= 0) {
                found = true;
            }
        });
        assert.ok(found, "bottom tab label: " + lab);
    });
});

test("renderCreateModal literal-port: omits legacy create-title shell hook", function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("PROJ");
    const $mount = $("<div/>");

    CS.renderCreateModal($mount, draft, {
        onClose: function() {},
        onSubmit: function() {},
        getEpicOptions: function() {
            return [];
        }
    });

    assert.equal($mount.find(".ujg-sb-create-title").length, 0, "legacy generic create title hook removed");
});

test("renderCreateModal literal-port: overlay and dialog carry reference utility classes", function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("P");
    const $mount = $("<div/>");
    CS.renderCreateModal($mount, draft, {
        onClose: function() {},
        onSubmit: function() {},
        getEpicOptions: function() {
            return [];
        }
    });
    const overlay = $mount.find(".ujg-sb-create-overlay")[0];
    const dialog = $mount.find(".ujg-sb-create-dialog")[0];
    assert.ok(overlay && dialog, "shell nodes");
    const overlayUtils =
        "fixed inset-0 z-50 flex items-start justify-center pt-2 bg-black/60 backdrop-blur-sm".split(/\s+/);
    overlayUtils.forEach(function(c) {
        assert.ok(hasClass(overlay, c), "overlay ref utility: " + c);
    });
    const dialogUtils =
        "bg-card border border-border rounded-lg shadow-2xl w-[95vw] max-w-[1800px] max-h-[96vh] flex flex-col".split(
            /\s+/
        );
    dialogUtils.forEach(function(c) {
        assert.ok(hasClass(dialog, c), "dialog ref utility: " + c);
    });
});

test("renderCreateModal literal-port: bottom tabs with stable hooks update activeTab", function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("P");
    draft.story.summary = "S";
    draft.children.forEach(function(c) {
        c.summary = "c";
    });
    const $mount = $("<div/>");
    CS.renderCreateModal($mount, draft, {
        onClose: function() {},
        onSubmit: function() {},
        getEpicOptions: function() {
            return [];
        }
    });
    assert.equal($mount.find(".ujg-sb-create-tab-activity").length, 1);
    assert.equal($mount.find(".ujg-sb-create-tab-comments").length, 1);
    assert.equal($mount.find(".ujg-sb-create-tab-worklog").length, 1);
    assert.ok(nodeText($mount.find(".ujg-sb-create-tab-activity")[0]).indexOf("Активность") >= 0);
    assert.ok(nodeText($mount.find(".ujg-sb-create-tab-comments")[0]).indexOf("Комментарии") >= 0);
    assert.ok(nodeText($mount.find(".ujg-sb-create-tab-worklog")[0]).indexOf("Списания") >= 0);
    assert.equal(draft.ui.activeTab, "activity");
    $mount.find(".ujg-sb-create-tab-comments").trigger("click");
    assert.equal(draft.ui.activeTab, "comments");
});

test("renderCreateModal literal-port: inner body uses reference body padding and key/title classes", function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("CORE");
    draft.story.summary = "Название истории";
    draft.children.forEach(function(c) {
        c.summary = "child";
    });
    draft.epicMode = "existingEpic";
    draft.existingEpicKey = "CORE-200";
    const $mount = $("<div/>");

    CS.renderCreateModal($mount, draft, {
        onClose: function() {},
        onSubmit: function() {},
        getEpicOptions: function() {
            return [{ key: "CORE-200", summary: "Эпик" }];
        }
    });

    const $body = $mount.find(".overflow-y-auto");
    assert.equal($body.length, 1, "literal-port scroll body");
    assert.equal($body.find(".p-2").length, 1, "inner body uses p-2 wrapper from reference");

    const $epicKey = $mount.find(".ujg-sb-create-epic-key").first();
    assert.ok($epicKey.length, "epic key node");
    ["text-[8px]", "text-primary/90", "cursor-pointer", "transition-colors"].forEach(function(cls) {
        assert.ok(hasClass($epicKey[0], cls), "epic key utility class " + cls);
    });
    assert.equal(nodeText($epicKey[0]), "CORE-200");

    const $storyTitle = $mount.find(".ujg-sb-create-row-story").find(".ujg-sb-create-summary").first();
    assert.ok($storyTitle.length, "story title node");
    ["font-medium", "text-foreground", "cursor-pointer", "transition-colors"].forEach(function(cls) {
        assert.ok(hasClass($storyTitle[0], cls), "story title utility class " + cls);
    });
    assert.equal(nodeText($storyTitle[0]), "Название истории");
});

test("renderCreateModal literal-port: clicking epic key reveals inline epic selector in-row", function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("CORE");
    draft.story.summary = "S";
    draft.children.forEach(function(c) {
        c.summary = "c";
    });
    const $mount = $("<div/>");

    CS.renderCreateModal($mount, draft, {
        onClose: function() {},
        onSubmit: function() {},
        getEpicOptions: function() {
            return [{ key: "CORE-200", summary: "Эпик" }];
        }
    });

    assert.equal($mount.find(".ujg-sb-create-epic-existing").length, 0, "selector hidden initially");
    const $epicKey = $mount.find(".font-mono").first();
    assert.ok($epicKey.length, "epic key click target");
    $epicKey.trigger("click");
    assert.equal($mount.find(".ujg-sb-create-epic-existing").length, 1, "click opens inline epic selector");
});

test("renderCreateModal literal-port: child rows expose compact action strip including link and blocker", function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("CORE");
    draft.story.summary = "Название истории";
    draft.children.forEach(function(c) {
        c.summary = c.summary || "child";
    });
    const $mount = $("<div/>");

    CS.renderCreateModal($mount, draft, {
        onClose: function() {},
        onSubmit: function() {},
        getEpicOptions: function() {
            return [];
        }
    });

    const $seRow = $mount.find(".ujg-sb-create-row-child-SE").first();
    assert.ok($seRow.length, "SE child row rendered");
    const $descBtn = $seRow.find(".ujg-sb-create-add-desc").first();
    assert.ok($descBtn.length, "child description action button");
    ["text-[7px]", "text-primary/50", "hover:text-primary"].forEach(function(cls) {
        assert.ok(hasClass($descBtn[0], cls), "compact action utility class " + cls);
    });
    assert.equal($mount.find(".ujg-sb-create-row-story").find(".ujg-sb-create-assignee-trigger").length, 0, "story row does not render assignee pill");
    assert.ok($seRow.find(".ujg-sb-create-assignee-trigger").length >= 1, "child row keeps assignee pill");
    const childText = nodeText($seRow[0]);
    assert.match(childText, /\+\s*комп/i, "child row shows + комп");
    assert.match(childText, /\+\s*метку/i, "child row shows + метку");
    assert.match(childText, /\+\s*link/i, "child row shows +link");
    assert.match(childText, /\+\s*блокер/i, "child row shows + блокер");
});

test("renderCreateModal literal-port: view toggle buttons expose reference active and inactive states", function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("CORE");
    draft.story.summary = "Название истории";
    draft.children.forEach(function(c) {
        c.summary = c.summary || "child";
    });
    const $mount = $("<div/>");

    CS.renderCreateModal($mount, draft, {
        onClose: function() {},
        onSubmit: function() {},
        getEpicOptions: function() {
            return [];
        }
    });

    var rowsBtn = null;
    var tableBtn = null;
    var accordionBtn = null;
    $mount.find(".ujg-sb-create-child-view-btn").each(function() {
        var txt = nodeText(this);
        if (txt.indexOf("Строки") >= 0) rowsBtn = this;
        if (txt.indexOf("Таблица") >= 0) tableBtn = this;
        if (txt.indexOf("Аккордеон") >= 0) accordionBtn = this;
    });
    assert.ok(rowsBtn && tableBtn && accordionBtn, "all view-mode buttons present");
    ["h-4", "px-1.5", "text-[7px]", "rounded", "flex", "items-center", "gap-0.5", "bg-primary/20", "text-primary"].forEach(
        function(cls) {
            assert.ok(hasClass(rowsBtn, cls), "active rows button class " + cls);
        }
    );
    ["text-muted-foreground", "hover:text-foreground", "hover:bg-muted/30"].forEach(function(cls) {
        assert.ok(hasClass(tableBtn, cls), "inactive table button class " + cls);
        assert.ok(hasClass(accordionBtn, cls), "inactive accordion button class " + cls);
    });
});

test("renderCreateModal literal-port: role chips use compact role-specific palette classes", function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("CORE");
    draft.story.summary = "Название истории";
    draft.children.forEach(function(c) {
        c.summary = c.summary || "child";
    });
    const $mount = $("<div/>");

    CS.renderCreateModal($mount, draft, {
        onClose: function() {},
        onSubmit: function() {},
        getEpicOptions: function() {
            return [];
        }
    });

    const roleExpectations = {
        "+ SE": ["bg-blue-500/20", "text-blue-400", "border-blue-500/30"],
        "+ FE": ["bg-cyan-500/20", "text-cyan-400", "border-cyan-500/30"],
        "+ BE": ["bg-orange-500/20", "text-orange-400", "border-orange-500/30"],
        "+ QA": ["bg-yellow-500/20", "text-yellow-400", "border-yellow-500/30"],
        "+ DO": ["bg-emerald-500/20", "text-emerald-400", "border-emerald-500/30"]
    };
    const shared = ["h-4", "px-1.5", "text-[7px]", "font-bold", "rounded", "border", "cursor-pointer", "hover:opacity-80"];

    Object.keys(roleExpectations).forEach(function(label) {
        let match = null;
        $mount.find(".ujg-sb-create-role-add-chip").each(function() {
            if (nodeText(this).replace(/\s+/g, " ").trim() === label) {
                match = this;
            }
        });
        assert.ok(match, "role chip present: " + label);
        shared.concat(roleExpectations[label]).forEach(function(cls) {
            assert.ok(hasClass(match, cls), "role chip " + label + " class " + cls);
        });
    });
});

test("renderCreateModal: clearing inline epic select to blank restores newEpic and full epic row", function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("PROJ");
    draft.story.summary = "S";
    draft.children.forEach(function(c) {
        c.summary = "c";
    });
    CS.setEpicSelectionMode(draft, "existing");
    draft.existingEpicKey = "PROJ-9";
    const $mount = $("<div/>");
    CS.renderCreateModal($mount, draft, {
        onClose: function() {},
        onSubmit: function() {},
        getEpicOptions: function() {
            return [{ key: "PROJ-9", summary: "Existing epic" }];
        }
    });
    assert.equal(draft.epicMode, "existingEpic");
    assert.equal(
        $mount.find(".ujg-sb-create-row-epic").first().find(".ujg-sb-create-type-label").length,
        0,
        "no full epic type row while existing epic chosen"
    );

    const $sel = $mount.find(".ujg-sb-create-epic-existing").first();
    assert.ok($sel.length >= 1, "epic key select present");
    $sel.val("");
    $sel.trigger("change");

    assert.equal(draft.epicMode, "newEpic");
    assert.equal(draft.ui.epicSelectionMode, "new");
    assert.equal(String(draft.existingEpicKey || ""), "");
    const $labels = $mount.find(".ujg-sb-create-row-epic").first().find(".ujg-sb-create-type-label");
    assert.ok($labels.length >= 1, "full epic row returns with type label");
    assert.match(nodeText($labels[0]), /Epic|Эпик/i);
});

test("renderCreateModal: child view toggle updates only draft.ui.viewMode", function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("P");
    draft.story.summary = "S";
    draft.children.forEach(function(c) {
        c.summary = "c";
    });
    const n = draft.children.length;
    const $mount = $("<div/>");
    CS.renderCreateModal($mount, draft, {
        onClose: function() {},
        onSubmit: function() {},
        getEpicOptions: function() {
            return [];
        }
    });
    const $btns = $mount.find(".ujg-sb-create-child-view-btn");
    let $tableBtn = null;
    $btns.each(function() {
        if (nodeText(this).indexOf("Таблица") >= 0) {
            $tableBtn = this;
        }
    });
    assert.ok($tableBtn, "table view button");
    $tableBtn.dispatchEvent({ type: "click", bubbles: true });
    assert.equal(draft.ui.viewMode, "table");
    assert.equal(draft.children.length, n);
});

test("renderCreateModal: child view toggle changes rendered child layout variant", function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("CORE");
    draft.story.summary = "Story title";
    draft.children.forEach(function(c) {
        c.summary = c.summary || "child";
    });
    const $mount = $("<div/>");
    CS.renderCreateModal($mount, draft, {
        onClose: function() {},
        onSubmit: function() {},
        getEpicOptions: function() {
            return [];
        }
    });

    assert.equal($mount.find(".ujg-sb-create-children-view-rows").length, 1, "rows layout by default");
    $mount.find(".ujg-sb-create-child-view-btn").each(function() {
        if (nodeText(this).indexOf("Таблица") >= 0) {
            $(this).trigger("click");
        }
    });
    assert.equal($mount.find(".ujg-sb-create-children-view-table").length, 1, "table layout after click");
    assert.equal($mount.find(".ujg-sb-create-children-view-rows").length, 0, "rows layout removed after table click");
    $mount.find(".ujg-sb-create-child-view-btn").each(function() {
        if (nodeText(this).indexOf("Аккордеон") >= 0) {
            $(this).trigger("click");
        }
    });
    assert.equal($mount.find(".ujg-sb-create-children-view-accordion").length, 1, "accordion layout after click");
    assert.equal($mount.find(".ujg-sb-create-children-view-table").length, 0, "table layout removed after accordion click");
});

test("renderCreateModal: bottom tabs switch visible content panel", function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("CORE");
    draft.story.summary = "Story title";
    draft.children.forEach(function(c) {
        c.summary = c.summary || "child";
    });
    const $mount = $("<div/>");
    CS.renderCreateModal($mount, draft, {
        onClose: function() {},
        onSubmit: function() {},
        getEpicOptions: function() {
            return [];
        }
    });

    assert.equal($mount.find(".ujg-sb-create-tab-panel-activity").length, 1, "activity panel by default");
    assert.equal($mount.find(".ujg-sb-create-tab-panel-comments").length, 0, "comments hidden initially");
    $mount.find(".ujg-sb-create-tab-comments").trigger("click");
    assert.equal($mount.find(".ujg-sb-create-tab-panel-comments").length, 1, "comments panel after click");
    assert.equal($mount.find(".ujg-sb-create-tab-panel-activity").length, 0, "activity panel removed after comments click");
    $mount.find(".ujg-sb-create-tab-worklog").trigger("click");
    assert.equal($mount.find(".ujg-sb-create-tab-panel-worklog").length, 1, "worklog panel after click");
    assert.equal($mount.find(".ujg-sb-create-tab-panel-comments").length, 0, "comments panel removed after worklog click");
});

test("renderCreateModal literal-port: bottom tabs expose reference utility and state classes", function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("CORE");
    draft.story.summary = "Story title";
    draft.children.forEach(function(c) {
        c.summary = c.summary || "child";
    });
    const $mount = $("<div/>");

    CS.renderCreateModal($mount, draft, {
        onClose: function() {},
        onSubmit: function() {},
        getEpicOptions: function() {
            return [];
        }
    });

    const $activity = $mount.find(".ujg-sb-create-tab-activity").first();
    const $comments = $mount.find(".ujg-sb-create-tab-comments").first();
    assert.ok($activity.length && $comments.length, "activity and comments tabs present");
    [
        "inline-flex",
        "items-center",
        "justify-center",
        "whitespace-nowrap",
        "rounded-sm",
        "py-1.5",
        "font-medium",
        "transition-all",
        "h-5",
        "text-[8px]",
        "px-2",
        "data-[state=active]:bg-background",
        "data-[state=active]:text-foreground"
    ].forEach(function(cls) {
        assert.ok(hasClass($activity[0], cls), "bottom tab utility class " + cls);
    });
    assert.equal($activity.attr("data-state"), "active", "activity tab marked active");
    assert.equal($comments.attr("data-state"), "inactive", "comments tab marked inactive");
});

test("renderCreateModal: +FE chip appends children with template issueType/summary and unique rowIds", function() {
    const CS = loadCreateStory();
    const documentNode = createNode("document");
    const $ = createMiniJquery(documentNode);
    const draft = CS.makeDefaultDraft("K");
    draft.story.summary = "S";
    draft.children.forEach(function(c) {
        c.summary = "c";
    });
    const before = draft.children.length;
    const $mount = $("<div/>");
    CS.renderCreateModal($mount, draft, {
        onClose: function() {},
        onSubmit: function() {},
        getEpicOptions: function() {
            return [];
        }
    });
    const $strip = $mount.find(".ujg-sb-create-role-add-strip");
    let $fe = null;
    $strip.find(".ujg-sb-create-role-add-chip").each(function() {
        if (nodeText(this).replace(/\s+/g, "").indexOf("+FE") >= 0) {
            $fe = this;
        }
    });
    assert.ok($fe, "+FE chip");
    $fe.dispatchEvent({ type: "click", bubbles: true });
    $fe.dispatchEvent({ type: "click", bubbles: true });
    assert.equal(draft.children.length, before + 2);
    const tail = draft.children.slice(before);
    assert.equal(tail[0].issueType, "Frontend Task");
    assert.equal(tail[0].summary, "Вёрстка / UI");
    assert.equal(tail[1].issueType, "Frontend Task");
    const ids = draft.children.map(function(ch) {
        return ch.ui && ch.ui.rowId;
    });
    const seen = {};
    ids.forEach(function(id) {
        assert.ok(id, "rowId set");
        assert.equal(seen[id], undefined, "unique rowId: " + id);
        seen[id] = true;
    });
});

test("submitCreateDraft newEpic creates appended role row after template children", async function() {
    const CS = loadCreateStory();
    const draft = CS.makeDefaultDraft("PROJ");
    draft.epicMode = "newEpic";
    draft.epic.summary = "E";
    draft.story.summary = "Story sum";
    draft.children.forEach(function(c) {
        c.summary = "Ch " + c.issueType;
    });
    draft.children.push({
        issueType: "QA",
        summary: "Extra QA",
        description: "",
        assignee: null,
        estimate: null,
        components: [],
        labels: [],
        createdKey: null,
        errors: [],
        ui: { editing: false, isDescriptionOpen: false, rowId: "child-append-test-1" }
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
    assert.equal(order.length, 1 + 1 + draft.children.length);
    assert.equal(order[order.length - 1], "QA");
});

test("buildIssueFields omits issue link / blocker style payload keys", function() {
    const CS = loadCreateStory();
    const node = {
        summary: "S",
        description: "D",
        assignee: null,
        components: [],
        labels: []
    };
    const fields = CS.buildIssueFields("PROJ", node, "Story", { parentKey: "P-1", epicKey: "P-EP" });
    const keys = Object.keys(fields);
    assert.ok(keys.indexOf("issuelinks") < 0);
    assert.ok(keys.indexOf("issueLinks") < 0);
    assert.ok(
        !keys.some(function(k) {
            return /issuelink/i.test(k);
        }),
        "no issuelink-like field keys"
    );
});
