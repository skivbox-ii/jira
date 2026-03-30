define("_ujgSB_create-story", ["jquery", "_ujgSB_config"], function($, config) {
    "use strict";

    var CREATE_TEMPLATE_ROLES = config.CREATE_TEMPLATE_ROLES || [];
    var EPIC_LINK_FIELD = config.EPIC_LINK_FIELD || "customfield_10014";
    var TYPE_BADGES = config.TYPE_BADGES || {};
    var ROLE_ESTIMATE_HOURS = {
        SE: 4,
        FE: 6,
        BE: 8,
        QA: 4,
        DO: 4
    };
    var PREVIEW_KEYS = {
        epic: "200",
        story: "240",
        SE: "410",
        FE: "420",
        BE: "430",
        QA: "440",
        DO: "450"
    };
    var ROLE_CHIP_CLASSES = {
        SE: "bg-blue-500/20 text-blue-400 border-blue-500/30",
        FE: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
        BE: "bg-orange-500/20 text-orange-400 border-orange-500/30",
        QA: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
        DO: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
    };

    function makeNode(issueType, summary, childRowId) {
        var ui = {
            editing: false,
            isDescriptionOpen: false,
            isLinkOpen: false,
            isBlockerOpen: false,
            isAccordionOpen: true
        };
        if (childRowId != null && String(childRowId).length) {
            ui.rowId = String(childRowId);
        }
        return {
            issueType: issueType,
            summary: summary != null ? String(summary) : "",
            description: "",
            assignee: null,
            estimate: null,
            components: [],
            labels: [],
            createdKey: null,
            errors: [],
            ui: ui
        };
    }

    function syncEpicUiFromEpicMode(draft) {
        if (!draft) {
            return;
        }
        if (!draft.ui) {
            draft.ui = {};
        }
        if (draft.epicMode === "existingEpic") {
            draft.ui.epicSelectionMode = "existing";
        } else {
            draft.ui.epicSelectionMode = "new";
        }
    }

    function setEpicSelectionMode(draft, mode) {
        if (!draft) {
            return;
        }
        if (!draft.ui) {
            draft.ui = {};
        }
        var m = String(mode || "");
        if (m === "existing") {
            draft.ui.epicSelectionMode = "existing";
            draft.epicMode = "existingEpic";
            draft.ui.epicSelectorOpen = true;
        } else if (m === "new") {
            draft.ui.epicSelectionMode = "new";
            draft.epicMode = "newEpic";
            draft.ui.epicSelectorOpen = false;
        }
    }

    function makeDefaultDraft(projectKey) {
        var key = projectKey != null ? String(projectKey) : "";
        var children = CREATE_TEMPLATE_ROLES.map(function(row) {
            return makeNode(row.issueType, row.summary, "child-" + row.role);
        });
        return {
            projectKey: key,
            mode: "draft",
            epicMode: "newEpic",
            existingEpicKey: "",
            epic: makeNode("Epic", ""),
            story: makeNode("Story", ""),
            children: children,
            ui: {
                formErrors: [],
                selector: null,
                selectorQuery: "",
                selectorRows: [],
                selectorLoading: false,
                selectorOpSeq: 0,
                selectorError: "",
                submitting: false,
                viewMode: "rows",
                activeTab: "activity",
                epicSelectionMode: "new",
                nextChildRowSeq: 0,
                epicSelectorOpen: false,
                commentsDraft: ""
            }
        };
    }

    function appendChildFromRoleChip(draft, roleCode) {
        if (!draft) {
            return;
        }
        if (!Array.isArray(draft.children)) {
            draft.children = [];
        }
        if (!draft.ui) {
            draft.ui = {};
        }
        var code = String(roleCode || "").toUpperCase();
        var tpl = null;
        for (var i = 0; i < CREATE_TEMPLATE_ROLES.length; i++) {
            if (CREATE_TEMPLATE_ROLES[i].role === code) {
                tpl = CREATE_TEMPLATE_ROLES[i];
                break;
            }
        }
        if (!tpl) {
            return;
        }
        if (typeof draft.ui.nextChildRowSeq !== "number") {
            draft.ui.nextChildRowSeq = 0;
        }
        draft.ui.nextChildRowSeq += 1;
        var rowId = "child-added-" + draft.ui.nextChildRowSeq;
        draft.children.push(makeNode(tpl.issueType, tpl.summary, rowId));
    }

    function toggleDescription(node) {
        if (!node || !node.ui) {
            return;
        }
        node.ui.isDescriptionOpen = !node.ui.isDescriptionOpen;
    }

    function isBlankSummary(summary) {
        return !String(summary != null ? summary : "").trim();
    }

    function normalizeUserSearchRows(body) {
        var users = (body && body.users) || [];
        return users.map(function(u) {
            if (!u || typeof u !== "object") {
                return { id: "", label: "" };
            }
            var name = u.name != null ? String(u.name) : "";
            var dn = u.displayName != null ? String(u.displayName) : name;
            return {
                id: name,
                label: dn || name,
                raw: u
            };
        });
    }

    function normalizeComponentRows(list) {
        var arr = Array.isArray(list) ? list : [];
        return arr.map(function(c) {
            if (!c) {
                return { id: "", label: "" };
            }
            var name = c.name != null ? String(c.name) : String(c.id != null ? c.id : "");
            return { id: name, label: name, raw: c };
        });
    }

    function normalizeLabelSearchRows(body) {
        var issues = (body && body.issues) || [];
        var seen = {};
        var out = [];
        issues.forEach(function(issue) {
            var labels = (issue.fields && issue.fields.labels) || [];
            labels.forEach(function(lab) {
                var s = String(lab);
                if (s && !seen[s]) {
                    seen[s] = true;
                    out.push({ id: s, label: s, raw: lab });
                }
            });
        });
        return out;
    }

    function hasSubmitValidationErrors(draft) {
        if (!draft) {
            return true;
        }
        if ((draft.ui.formErrors || []).length) {
            return true;
        }
        var rows = [draft.epic, draft.story].concat(draft.children || []);
        return rows.some(function(row) {
            return row && row.errors && row.errors.length;
        });
    }

    function validateDraft(draft, context) {
        if (!draft) {
            return;
        }
        syncEpicUiFromEpicMode(draft);
        var purpose = context && context.purpose ? String(context.purpose) : "";
        var rows = [draft.epic, draft.story].concat(draft.children || []);
        rows.forEach(function(row) {
            if (row) {
                row.errors = [];
            }
        });
        if (!draft.ui) {
            draft.ui = {};
        }
        draft.ui.formErrors = [];

        if (draft.epicMode === "newEpic") {
            if (draft.epic && isBlankSummary(draft.epic.summary)) {
                draft.epic.errors.push("Summary is required");
            }
        } else if (draft.epicMode === "existingEpic") {
            if (!String(draft.existingEpicKey != null ? draft.existingEpicKey : "").trim()) {
                draft.ui.formErrors.push("Выберите эпик");
            }
        }

        if (draft.story && isBlankSummary(draft.story.summary)) {
            draft.story.errors.push("Summary is required");
        }
        (draft.children || []).forEach(function(child) {
            if (child && isBlankSummary(child.summary)) {
                child.errors.push("Summary is required");
            }
        });

        if (purpose !== "submit") {
            if (draft.epicMode === "existingEpic") {
                draft.epic.errors = [];
            }
        }
    }

    function draftRows(draft) {
        syncEpicUiFromEpicMode(draft);
        var rows = [];
        if (draft.epicMode !== "existingEpic") {
            rows.push({ key: "epic", node: draft.epic });
        }
        rows.push({ key: "story", node: draft.story });
        (draft.children || []).forEach(function(child, i) {
            var rk =
                child && child.ui && child.ui.rowId != null && String(child.ui.rowId).length
                    ? String(child.ui.rowId)
                    : "child-" + i;
            rows.push({ key: rk, node: child });
        });
        return rows;
    }

    function modalRows(draft) {
        var rows = [{ key: "epic", node: draft.epic }, { key: "story", node: draft.story }];
        (draft.children || []).forEach(function(child, i) {
            var rk =
                child && child.ui && child.ui.rowId != null && String(child.ui.rowId).length
                    ? String(child.ui.rowId)
                    : "child-" + i;
            rows.push({ key: rk, node: child });
        });
        return rows;
    }

    function clearAllSummaryEditing(draft) {
        modalRows(draft).forEach(function(r) {
            if (r.node && r.node.ui) {
                r.node.ui.editing = false;
            }
        });
    }

    function rowClassSuffix(key) {
        return String(key || "").replace(/[^a-zA-Z0-9-]/g, "-");
    }

    function descriptionToggleLabel(node) {
        return node && node.ui && node.ui.isDescriptionOpen ? "- описание" : "+ описание";
    }

    function formatAjaxError(err) {
        if (!err) {
            return "Request failed";
        }
        var j = err.responseJSON;
        if (j && j.errorMessages && j.errorMessages.length) {
            return j.errorMessages.join(" ");
        }
        if (err.statusText) {
            return String(err.statusText);
        }
        return "Request failed";
    }

    function extractCreatedKey(res) {
        var k = res && res.key != null ? String(res.key).trim() : "";
        return k;
    }

    function buildIssueFields(projectKey, node, issueTypeName, extra) {
        var fields = {
            project: { key: String(projectKey || "") },
            summary: String(node.summary || "").trim(),
            issuetype: { name: String(issueTypeName || "") },
            description: node.description != null ? String(node.description) : ""
        };
        if (node.assignee && typeof node.assignee === "object") {
            if (node.assignee.accountId != null && String(node.assignee.accountId).trim()) {
                fields.assignee = { accountId: String(node.assignee.accountId).trim() };
            } else if (node.assignee.name != null && String(node.assignee.name).trim()) {
                fields.assignee = { name: String(node.assignee.name).trim() };
            }
        }
        var comps = node.components || [];
        if (comps.length) {
            fields.components = comps.map(function(c) {
                if (typeof c === "string") {
                    return { name: c };
                }
                var nm = c && c.name != null ? String(c.name) : "";
                return { name: nm };
            });
        }
        var labs = node.labels || [];
        if (labs.length) {
            fields.labels = labs.map(function(l) {
                if (typeof l === "string") {
                    return l;
                }
                return l && l.name != null ? String(l.name) : String(l.id != null ? l.id : "");
            });
        }
        extra = extra || {};
        if (extra.parentKey) {
            fields.parent = { key: String(extra.parentKey) };
        }
        if (extra.epicKey && EPIC_LINK_FIELD) {
            fields[EPIC_LINK_FIELD] = { key: String(extra.epicKey) };
        }
        return fields;
    }

    function createChildrenSequential(api, draft, startIndex) {
        var children = draft.children || [];
        if (startIndex >= children.length) {
            return Promise.resolve({ ok: true });
        }
        var ch = children[startIndex];
        if (ch.createdKey || isBlankSummary(ch.summary)) {
            return createChildrenSequential(api, draft, startIndex + 1);
        }
        ch.errors = [];
        var fields = buildIssueFields(draft.projectKey, ch, ch.issueType, {
            parentKey: draft.story.createdKey
        });
        return Promise.resolve(api.createIssue({ fields: fields })).then(
            function(res) {
                var ck = extractCreatedKey(res);
                if (!ck) {
                    ch.errors.push("Invalid create response (missing issue key)");
                    return { ok: false };
                }
                ch.createdKey = ck;
                return createChildrenSequential(api, draft, startIndex + 1);
            },
            function(err) {
                ch.errors.push(formatAjaxError(err));
                return { ok: false };
            }
        );
    }

    function submitCreateDraft(api, draft) {
        if (!api || !draft) {
            return Promise.resolve({ ok: false });
        }
        if (!draft.ui) {
            draft.ui = {};
        }
        syncEpicUiFromEpicMode(draft);
        if (draft.ui.submitting) {
            return Promise.resolve({ ok: false, skipped: true });
        }
        draft.ui.submitting = true;

        function finish(out) {
            draft.ui.submitting = false;
            return out;
        }

        function epicKeyResolved() {
            if (draft.epicMode === "existingEpic") {
                return String(draft.existingEpicKey != null ? draft.existingEpicKey : "").trim();
            }
            return draft.epic && draft.epic.createdKey ? String(draft.epic.createdKey) : "";
        }

        var p = Promise.resolve({ ok: true });

        p = p.then(function(prev) {
            if (!prev || prev.ok === false) {
                return prev;
            }
            if (draft.epicMode !== "newEpic") {
                return { ok: true };
            }
            if (draft.epic.createdKey) {
                return { ok: true };
            }
            var ef = buildIssueFields(draft.projectKey, draft.epic, "Epic", {});
            return Promise.resolve(api.createIssue({ fields: ef })).then(
                function(res) {
                    var ek = extractCreatedKey(res);
                    if (!ek) {
                        draft.epic.errors.push("Invalid create response (missing issue key)");
                        return { ok: false };
                    }
                    draft.epic.createdKey = ek;
                    return { ok: true };
                },
                function(err) {
                    draft.epic.errors.push(formatAjaxError(err));
                    return { ok: false };
                }
            );
        });

        p = p.then(function(prev) {
            if (!prev || prev.ok === false) {
                return prev;
            }
            var ek = epicKeyResolved();
            if (draft.story.createdKey) {
                return { ok: true };
            }
            var sf = buildIssueFields(draft.projectKey, draft.story, "Story", { epicKey: ek });
            return Promise.resolve(api.createIssue({ fields: sf })).then(
                function(res) {
                    var sk = extractCreatedKey(res);
                    if (!sk) {
                        draft.story.errors.push("Invalid create response (missing issue key)");
                        return { ok: false };
                    }
                    draft.story.createdKey = sk;
                    return { ok: true };
                },
                function(err) {
                    draft.story.errors.push(formatAjaxError(err));
                    return { ok: false };
                }
            );
        });

        p = p.then(function(prev) {
            if (!prev || prev.ok === false) {
                return prev;
            }
            return createChildrenSequential(api, draft, 0);
        });

        return p.then(
            function(result) {
                if (result && result.ok === false) {
                    return finish({ ok: false });
                }
                return finish({ ok: true });
            },
            function() {
                return finish({ ok: false });
            }
        );
    }

    function closeSelector(draft) {
        if (!draft.ui) {
            return;
        }
        draft.ui.selectorOpSeq = (draft.ui.selectorOpSeq || 0) + 1;
        draft.ui.selector = null;
        draft.ui.selectorQuery = "";
        draft.ui.selectorRows = [];
        draft.ui.selectorLoading = false;
        draft.ui.selectorError = "";
    }

    function applySelectorFailure($mount, draft, ctx, seq, startKind, startRowKey, err) {
        if (!selectorResponseStillValid(draft, ctx, seq, startKind, startRowKey)) {
            return;
        }
        if (!draft.ui) {
            return;
        }
        draft.ui.selectorLoading = false;
        draft.ui.selectorError = formatAjaxError(err);
        draft.ui.selectorRows = [];
        renderCreateModal($mount, draft, ctx);
    }

    function selectorResponseStillValid(draft, ctx, seq, startKind, startRowKey) {
        if (!draft || !draft.ui) {
            return false;
        }
        if (ctx && typeof ctx.isDraftActive === "function" && !ctx.isDraftActive()) {
            return false;
        }
        var sel = draft.ui.selector;
        if (!sel || sel.kind !== startKind || sel.rowKey !== startRowKey) {
            return false;
        }
        if (seq !== draft.ui.selectorOpSeq) {
            return false;
        }
        return true;
    }

    function openSelector(draft, rowKey, kind) {
        if (!draft.ui) {
            draft.ui = {};
        }
        draft.ui.selector = { rowKey: rowKey, kind: kind };
        draft.ui.selectorQuery = "";
        draft.ui.selectorRows = [];
        draft.ui.selectorError = "";
    }

    function rowNodeByKey(draft, rowKey) {
        if (rowKey === "epic") {
            return draft.epic;
        }
        if (rowKey === "story") {
            return draft.story;
        }
        var sk = String(rowKey || "");
        var m = /^child-(\d+)$/.exec(sk);
        if (m) {
            return (draft.children || [])[Number(m[1])];
        }
        var ch = draft.children || [];
        for (var i = 0; i < ch.length; i++) {
            var c = ch[i];
            if (c && c.ui && c.ui.rowId === sk) {
                return c;
            }
        }
        return null;
    }

    var LITERAL_PORT_OVERLAY_UTIL =
        "fixed inset-0 z-50 flex items-start justify-center pt-2 bg-black/60 backdrop-blur-sm";
    var LITERAL_PORT_DIALOG_UTIL =
        "bg-card border border-border rounded-lg shadow-2xl w-[95vw] max-w-[1800px] max-h-[96vh] flex flex-col";

    function ensureRenderableNode(node) {
        if (!node) {
            return;
        }
        if (!node.ui) {
            node.ui = {};
        }
        if (node.ui.editing == null) {
            node.ui.editing = false;
        }
        if (node.ui.isDescriptionOpen == null) {
            node.ui.isDescriptionOpen = false;
        }
        if (node.ui.isLinkOpen == null) {
            node.ui.isLinkOpen = false;
        }
        if (node.ui.isBlockerOpen == null) {
            node.ui.isBlockerOpen = false;
        }
        if (node.ui.isAccordionOpen == null) {
            node.ui.isAccordionOpen = true;
        }
        if (!Array.isArray(node.errors)) {
            node.errors = [];
        }
        if (!Array.isArray(node.components)) {
            node.components = [];
        }
        if (!Array.isArray(node.labels)) {
            node.labels = [];
        }
        if (!Array.isArray(node.links)) {
            node.links = [];
        }
        if (!Array.isArray(node.blockers)) {
            node.blockers = [];
        }
    }

    function roleCodeForNode(node) {
        var issueType = node && node.issueType != null ? String(node.issueType) : "";
        return TYPE_BADGES[issueType] || issueType || "?";
    }

    function previewIssueKey(draft, rowKey, node) {
        if (node && node.createdKey) {
            return String(node.createdKey);
        }
        var pk = draft && draft.projectKey != null ? String(draft.projectKey).trim() : "";
        if (rowKey === "epic") {
            return String(draft && draft.existingEpicKey ? draft.existingEpicKey : (pk ? pk + "-" + PREVIEW_KEYS.epic : "EPIC"));
        }
        if (rowKey === "story") {
            return pk ? pk + "-" + PREVIEW_KEYS.story : "STORY";
        }
        var role = roleCodeForNode(node);
        if (pk && PREVIEW_KEYS[role]) {
            return pk + "-" + PREVIEW_KEYS[role];
        }
        return "";
    }

    function defaultEstimateHoursForRow(draft, rowKey, node) {
        if (node && typeof node.estimate === "number" && isFinite(node.estimate)) {
            return Math.max(0, node.estimate);
        }
        if (rowKey === "story") {
            return (draft.children || []).reduce(function(total, child) {
                return total + defaultEstimateHoursForRow(draft, "", child);
            }, 0);
        }
        var role = roleCodeForNode(node);
        return ROLE_ESTIMATE_HOURS[role] || 0;
    }

    function estimateToken(draft, rowKey, node) {
        return "0/" + defaultEstimateHoursForRow(draft, rowKey, node) + "ч";
    }

    function summaryDisplayText(node, placeholder) {
        var txt = node && node.summary != null ? String(node.summary).trim() : "";
        return txt || String(placeholder || "\u2014");
    }

    function existingEpicSummary(draft, ctx) {
        var target = String(draft && draft.existingEpicKey ? draft.existingEpicKey : "");
        if (!target || !ctx || !ctx.getEpicOptions) {
            return "";
        }
        var opts = ctx.getEpicOptions() || [];
        for (var i = 0; i < opts.length; i++) {
            if (opts[i] && String(opts[i].key || "") === target) {
                return String(opts[i].summary || "");
            }
        }
        return "";
    }

    function compactTextButton(label, classes, onClick) {
        var $btn = $("<button type=\"button\"/>").addClass(classes).text(label);
        if (onClick) {
            $btn.on("click", function(ev) {
                if (ev && ev.stopPropagation) {
                    ev.stopPropagation();
                }
                onClick();
            });
        }
        return $btn;
    }

    function renderSummaryControl($mount, draft, ctx, row, placeholder) {
        var node = row.node;
        ensureRenderableNode(node);
        if (node.ui.editing) {
            var $summaryInput = $("<input/>")
                .attr("type", "text")
                .addClass("ujg-sb-inline-editor ujg-sb-create-summary-input text-[11px] font-medium")
                .val(node.summary);
            $summaryInput.on("input", function() {
                node.summary = $summaryInput.val();
            });
            $summaryInput.on("click", function(ev) {
                if (ev.stopPropagation) {
                    ev.stopPropagation();
                }
            });
            return $summaryInput;
        }
        var $summary = $("<span/>")
            .addClass(
                "ujg-sb-create-summary text-[11px] font-medium text-foreground cursor-pointer hover:bg-muted/20 rounded px-1 -mx-1 transition-colors"
            )
            .text(summaryDisplayText(node, placeholder));
        $summary.on("click", function() {
            clearAllSummaryEditing(draft);
            node.ui.editing = true;
            renderCreateModal($mount, draft, ctx);
        });
        return $summary;
    }

    function renderKeySpan($mount, draft, ctx, rowKey, node) {
        var $key = $("<span/>")
            .addClass(
                "font-mono text-[8px] text-primary/90 shrink-0 cursor-pointer hover:bg-muted/20 rounded px-1 -mx-1 transition-colors"
            )
            .text(previewIssueKey(draft, rowKey, node));
        if (rowKey === "epic") {
            $key.addClass("ujg-sb-create-epic-key");
            $key.on("click", function() {
                if (!draft.ui) {
                    draft.ui = {};
                }
                draft.ui.epicSelectorOpen = true;
                renderCreateModal($mount, draft, ctx);
            });
        }
        return $key;
    }

    function renderEpicSelector($mount, draft, ctx) {
        var $sel = $("<select/>").addClass("ujg-sb-inline-editor ujg-sb-create-epic-existing text-[8px]");
        $sel.append($("<option value=\"\">").text("Новый эпик"));
        (ctx.getEpicOptions ? ctx.getEpicOptions() : []).forEach(function(opt) {
            var k = opt && opt.key != null ? String(opt.key) : "";
            var lab = opt && opt.summary != null ? String(opt.summary) : k;
            $sel.append($("<option/>").attr("value", k).text(k + (lab && lab !== k ? " — " + lab : "")));
        });
        $sel.val(draft.existingEpicKey || "");
        $sel.on("change", function() {
            var raw = $sel.val();
            draft.existingEpicKey = raw != null ? String(raw) : "";
            if (!String(draft.existingEpicKey).trim()) {
                setEpicSelectionMode(draft, "new");
            } else {
                setEpicSelectionMode(draft, "existing");
            }
            renderCreateModal($mount, draft, ctx);
        });
        return $sel;
    }

    function renderAssigneeTrigger($mount, draft, ctx, row) {
        var node = row.node;
        var assigneeLabel = "Исполнитель";
        if (node.assignee && typeof node.assignee === "object" && node.assignee.displayName) {
            assigneeLabel = String(node.assignee.displayName);
        } else if (node.assignee && typeof node.assignee === "object" && node.assignee.name) {
            assigneeLabel = String(node.assignee.name);
        }
        return compactTextButton(
            assigneeLabel,
            "ujg-sb-create-assignee-trigger text-[7px] rounded px-1 border border-border text-muted-foreground hover:bg-muted/20",
            function() {
                openSelector(draft, row.key, "assignee");
                renderCreateModal($mount, draft, ctx);
            }
        );
    }

    function renderComponentTrigger($mount, draft, ctx, row, label) {
        return compactTextButton(
            label,
            "ujg-sb-create-component-trigger text-[7px] text-primary/50 hover:text-primary px-1",
            function() {
                openSelector(draft, row.key, "component");
                renderCreateModal($mount, draft, ctx);
            }
        );
    }

    function renderLabelTrigger($mount, draft, ctx, row, label) {
        return compactTextButton(
            label,
            "ujg-sb-create-label-trigger text-[7px] text-primary/50 hover:text-primary px-1",
            function() {
                openSelector(draft, row.key, "label");
                renderCreateModal($mount, draft, ctx);
            }
        );
    }

    function renderDescriptionTrigger($mount, draft, ctx, row, extraClasses) {
        return compactTextButton(
            descriptionToggleLabel(row.node),
            "ujg-sb-create-add-desc text-[7px] text-primary/50 hover:text-primary px-1 " + String(extraClasses || ""),
            function() {
                toggleDescription(row.node);
                renderCreateModal($mount, draft, ctx);
            }
        );
    }

    function renderLinkTrigger($mount, draft, ctx, row) {
        return compactTextButton(
            "+link",
            "ujg-sb-create-link-trigger text-[7px] text-primary/50 hover:text-primary px-1",
            function() {
                ensureRenderableNode(row.node);
                row.node.ui.isLinkOpen = !row.node.ui.isLinkOpen;
                renderCreateModal($mount, draft, ctx);
            }
        );
    }

    function renderBlockerTrigger($mount, draft, ctx, row) {
        return compactTextButton(
            "+ блокер",
            "ujg-sb-create-blocker-trigger text-[7px] text-primary/50 hover:text-primary px-1",
            function() {
                ensureRenderableNode(row.node);
                row.node.ui.isBlockerOpen = !row.node.ui.isBlockerOpen;
                renderCreateModal($mount, draft, ctx);
            }
        );
    }

    function renderChipList(node) {
        var $chips = $("<div/>").addClass("ujg-sb-chip-list flex flex-wrap gap-1");
        var count = 0;
        (node.components || []).forEach(function(c) {
            var nm = typeof c === "string" ? c : c && c.name;
            if (nm) {
                count += 1;
                $chips.append($("<span/>").addClass("ujg-sb-chip").text(String(nm)));
            }
        });
        (node.labels || []).forEach(function(lb) {
            count += 1;
            $chips.append($("<span/>").addClass("ujg-sb-chip ujg-sb-chip-label").text(String(lb)));
        });
        return count ? $chips : null;
    }

    function renderErrorsAndCreatedKey(node) {
        var $wrap = $("<div/>").addClass("flex flex-wrap items-center gap-1");
        var hasAny = false;
        if (node.createdKey) {
            hasAny = true;
            $wrap.append(
                $("<span/>")
                    .addClass("ujg-sb-create-created-key")
                    .text(String(node.createdKey))
            );
        }
        if (node.errors && node.errors.length) {
            hasAny = true;
            var $re = $("<div/>").addClass("ujg-sb-create-row-errors");
            node.errors.forEach(function(er) {
                $re.append($("<div/>").text(String(er)));
            });
            $wrap.append($re);
        }
        return hasAny ? $wrap : null;
    }

    function renderSupportArea($mount, draft, ctx, row, indentClasses) {
        var node = row.node;
        ensureRenderableNode(node);
        var $wrap = null;
        function ensureWrap() {
            if (!$wrap) {
                $wrap = $("<div/>").addClass(
                    "ujg-sb-create-row-support flex-1 min-w-0 " + String(indentClasses || "")
                );
            }
            return $wrap;
        }
        var $chips = renderChipList(node);
        if ($chips) {
            ensureWrap().append($chips);
        }
        var $meta = renderErrorsAndCreatedKey(node);
        if ($meta) {
            ensureWrap().append($meta);
        }
        if (node.ui.isDescriptionOpen) {
            var $desc = $("<textarea/>")
                .addClass("ujg-sb-inline-editor ujg-sb-create-desc-input")
                .val(node.description);
            $desc.on("input", function() {
                node.description = $desc.val();
            });
            ensureWrap().append($desc);
        }
        if (node.ui.isLinkOpen) {
            var $linkInput = $("<input/>")
                .attr("type", "text")
                .attr("placeholder", "Ссылка или ключ задачи")
                .addClass("ujg-sb-inline-editor ujg-sb-create-link-input")
                .val(node.ui.linkDraft || "");
            $linkInput.on("input", function() {
                node.ui.linkDraft = $linkInput.val();
            });
            ensureWrap().append($linkInput);
        }
        if (node.ui.isBlockerOpen) {
            var $blockerInput = $("<input/>")
                .attr("type", "text")
                .attr("placeholder", "Блокер")
                .addClass("ujg-sb-inline-editor ujg-sb-create-blocker-input")
                .val(node.ui.blockerDraft || "");
            $blockerInput.on("input", function() {
                node.ui.blockerDraft = $blockerInput.val();
            });
            ensureWrap().append($blockerInput);
        }
        var $selPan = renderSelectorPanel($mount, draft, ctx, row.key);
        if ($selPan) {
            ensureWrap().append($selPan);
        }
        return $wrap;
    }

    function renderEpicRow($mount, draft, ctx, row) {
        var node = row.node;
        ensureRenderableNode(node);
        var $row = $("<div/>").addClass(
            "ujg-sb-create-tree-row ujg-sb-create-row-epic flex items-center gap-1 px-1 py-[1px]"
        );
        if (node.errors && node.errors.length) {
            $row.addClass("ujg-sb-create-row-error");
        }
        var $controls = $("<div/>").addClass("ujg-sb-create-epic-controls flex items-center gap-1 flex-wrap flex-1 min-w-0");
        $controls.append(renderKeySpan($mount, draft, ctx, row.key, node));
        if (draft.epicMode === "existingEpic" || (draft.ui && draft.ui.epicSelectorOpen)) {
            $controls.append(renderEpicSelector($mount, draft, ctx));
            var epicSummary = existingEpicSummary(draft, ctx);
            if (epicSummary) {
                $controls.append($("<span/>").addClass("text-[9px] text-muted-foreground").text(epicSummary));
            }
        } else {
            $controls.append(
                $("<span/>")
                    .addClass("ujg-sb-create-type-label text-[9px] text-muted-foreground shrink-0")
                    .text("Эпик")
            );
            $controls.append(renderSummaryControl($mount, draft, ctx, row, "Эпик"));
            $controls.append(renderComponentTrigger($mount, draft, ctx, row, "+компонент"));
            $controls.append(renderLabelTrigger($mount, draft, ctx, row, "+метку"));
            $controls.append(renderDescriptionTrigger($mount, draft, ctx, row, ""));
        }
        $row.append($controls);
        var $support = renderSupportArea($mount, draft, ctx, row, "ml-3");
        if ($support) {
            $row.append($support);
        }
        return $row;
    }

    function renderStoryRow($mount, draft, ctx, row) {
        var node = row.node;
        ensureRenderableNode(node);
        var $row = $("<div/>").addClass(
            "ujg-sb-create-tree-row ujg-sb-create-row-story flex items-start gap-1 px-1 py-[1px] ml-3"
        );
        if (node.errors && node.errors.length) {
            $row.addClass("ujg-sb-create-row-error");
        }
        $row.append($("<span/>").addClass("text-[9px] text-muted-foreground shrink-0").text("├─"));
        var $main = $("<div/>").addClass("flex-1 min-w-0");
        var $top = $("<div/>").addClass("flex items-center gap-1 flex-wrap");
        $top.append($("<span/>").addClass("text-[9px] text-muted-foreground shrink-0").text("[S]"));
        $top.append(renderKeySpan($mount, draft, ctx, row.key, node));
        $top.append(renderSummaryControl($mount, draft, ctx, row, "Название истории"));
        $top.append($("<span/>").addClass("text-[8px] text-muted-foreground shrink-0").text("Open"));
        $top.append($("<span/>").addClass("font-mono text-[8px] text-muted-foreground shrink-0").text(estimateToken(draft, row.key, node)));
        $top.append(renderComponentTrigger($mount, draft, ctx, row, "+компонент"));
        $top.append(renderLabelTrigger($mount, draft, ctx, row, "+метку"));
        $top.append(renderDescriptionTrigger($mount, draft, ctx, row, ""));
        $main.append($top);
        var $support = renderSupportArea($mount, draft, ctx, row, "ml-6");
        if ($support) {
            $main.append($support);
        }
        $row.append($main);
        return $row;
    }

    function renderChildRow($mount, draft, ctx, row, variant) {
        var node = row.node;
        ensureRenderableNode(node);
        var role = roleCodeForNode(node);
        var rowClasses =
            "ujg-sb-create-tree-row ujg-sb-create-row-" +
            rowClassSuffix(row.key) +
            " flex items-start gap-1 px-1 py-[1px] ml-6";
        if (variant === "table") {
            rowClasses += " ujg-sb-create-child-table-row";
        } else {
            rowClasses += " ujg-sb-create-child-row";
        }
        var $row = $("<div/>").addClass(rowClasses);
        if (node.errors && node.errors.length) {
            $row.addClass("ujg-sb-create-row-error");
        }
        if (variant !== "accordion") {
            $row.append($("<span/>").addClass("text-[9px] text-muted-foreground shrink-0").text("├─"));
        }
        var $main = $("<div/>").addClass("flex-1 min-w-0");
        var $top = $("<div/>").addClass("flex items-center gap-1 flex-wrap");
        $top.append($("<span/>").addClass("ujg-sb-create-type-label text-[9px] text-muted-foreground shrink-0").text(role));
        $top.append($("<span/>").addClass("text-[8px] text-muted-foreground shrink-0").text("—"));
        $top.append(renderSummaryControl($mount, draft, ctx, row, summaryDisplayText(node, node.summary || role)));
        $top.append($("<span/>").addClass("text-[8px] text-muted-foreground shrink-0").text("—"));
        $top.append($("<span/>").addClass("font-mono text-[8px] text-muted-foreground shrink-0").text(estimateToken(draft, row.key, node)));
        $top.append($("<span/>").addClass("text-[8px] text-muted-foreground shrink-0").text("Open"));
        $top.append($("<span/>").addClass("text-[8px] text-muted-foreground shrink-0").text("SPR-24.06"));
        $top.append(renderComponentTrigger($mount, draft, ctx, row, "+ комп"));
        $top.append(renderLabelTrigger($mount, draft, ctx, row, "+ метку"));
        $top.append(renderLinkTrigger($mount, draft, ctx, row));
        $top.append(renderBlockerTrigger($mount, draft, ctx, row));
        $top.append(renderDescriptionTrigger($mount, draft, ctx, row, "ml-[28px]"));
        $top.append(renderAssigneeTrigger($mount, draft, ctx, row));
        $main.append($top);
        var $support = renderSupportArea($mount, draft, ctx, row, "ml-[28px]");
        if ($support) {
            $main.append($support);
        }
        $row.append($main);
        return $row;
    }

    function renderAccordionChild($mount, draft, ctx, row) {
        var node = row.node;
        ensureRenderableNode(node);
        var role = roleCodeForNode(node);
        var $item = $("<div/>").addClass("ujg-sb-create-accordion-item");
        var $head = $("<button type=\"button\"/>")
            .addClass("ujg-sb-create-accordion-head flex items-center gap-1 px-1 py-[1px]")
            .append(
                $("<span/>").addClass("text-[9px] text-muted-foreground shrink-0").text(role),
                $("<span/>").addClass("text-[11px] font-medium text-foreground").text(summaryDisplayText(node, node.summary || role))
            );
        $head.on("click", function() {
            node.ui.isAccordionOpen = !node.ui.isAccordionOpen;
            renderCreateModal($mount, draft, ctx);
        });
        $item.append($head);
        if (node.ui.isAccordionOpen) {
            $item.append(renderChildRow($mount, draft, ctx, row, "accordion"));
        }
        return $item;
    }

    function renderChildrenRowsForMode($mount, draft, ctx, childSpecs) {
        var mode = draft.ui && draft.ui.viewMode ? String(draft.ui.viewMode) : "rows";
        var viewClass =
            mode === "table"
                ? "ujg-sb-create-children-view ujg-sb-create-children-view-table"
                : mode === "accordion"
                  ? "ujg-sb-create-children-view ujg-sb-create-children-view-accordion"
                  : "ujg-sb-create-children-view ujg-sb-create-children-view-rows";
        var $view = $("<div/>").addClass(viewClass);
        if (mode === "table") {
            $view.append(
                $("<div/>")
                    .addClass("ujg-sb-create-child-table-head flex items-center gap-1 px-1 py-[1px] text-[7px] text-muted-foreground")
                    .text("Роль / задача / оценка / статус / спринт")
            );
            childSpecs.forEach(function(row) {
                $view.append(renderChildRow($mount, draft, ctx, row, "table"));
            });
            return $view;
        }
        if (mode === "accordion") {
            childSpecs.forEach(function(row) {
                $view.append(renderAccordionChild($mount, draft, ctx, row));
            });
            return $view;
        }
        childSpecs.forEach(function(row) {
            $view.append(renderChildRow($mount, draft, ctx, row, "rows"));
        });
        return $view;
    }

    function renderChildrenViewToolbar(draft, ctx, $mount) {
        var $bar = $("<div/>").addClass("ujg-sb-create-children-toolbar");
        var modes = [
            { id: "table", label: "Таблица" },
            { id: "accordion", label: "Аккордеон" },
            { id: "rows", label: "Строки" }
        ];
        modes.forEach(function(m) {
            var $btn = $("<button type=\"button\"/>")
                .addClass("ujg-sb-create-child-view-btn h-4 px-1.5 text-[7px] rounded flex items-center gap-0.5")
                .text(m.label);
            if ((draft.ui.viewMode || "rows") === m.id) {
                $btn.addClass("ujg-sb-create-child-view-btn--active bg-primary/20 text-primary");
            } else {
                $btn.addClass("text-muted-foreground hover:text-foreground hover:bg-muted/30");
            }
            $btn.on("click", function() {
                draft.ui.viewMode = m.id;
                renderCreateModal($mount, draft, ctx);
            });
            $bar.append($btn);
        });
        return $bar;
    }

    function renderRoleAddStrip(draft, ctx, $mount) {
        var $strip = $("<div/>").addClass("ujg-sb-create-role-add-strip");
        ["SE", "FE", "BE", "QA", "DO"].forEach(function(role) {
            var $btn = $("<button type=\"button\"/>")
                .addClass(
                    "ujg-sb-create-role-add-chip h-4 px-1.5 text-[7px] font-bold rounded border cursor-pointer hover:opacity-80 " +
                        (ROLE_CHIP_CLASSES[role] || "")
                )
                .text("+ " + role);
            $btn.on("click", function() {
                appendChildFromRoleChip(draft, role);
                renderCreateModal($mount, draft, ctx);
            });
            $strip.append($btn);
        });
        return $strip;
    }

    function renderBottomTabPanel(draft) {
        var active = draft.ui && draft.ui.activeTab ? String(draft.ui.activeTab) : "activity";
        var $panel = $("<div/>").addClass("ujg-sb-create-tab-panel");
        if (active === "comments") {
            $panel.addClass("ujg-sb-create-tab-panel-comments");
            var $textarea = $("<textarea/>")
                .addClass("ujg-sb-inline-editor ujg-sb-create-comments-input")
                .val(draft.ui.commentsDraft || "");
            $textarea.on("input", function() {
                draft.ui.commentsDraft = $textarea.val();
            });
            $panel.append($textarea);
            return $panel;
        }
        if (active === "worklog") {
            $panel
                .addClass("ujg-sb-create-tab-panel-worklog")
                .append($("<div/>").addClass("text-[8px] text-muted-foreground").text("Списаний пока нет"));
            return $panel;
        }
        $panel
            .addClass("ujg-sb-create-tab-panel-activity")
            .append(
                $("<div/>")
                    .addClass("text-[8px] text-muted-foreground")
                    .text("Активность появится после создания истории")
            );
        return $panel;
    }

    function renderBottomTabs(draft, ctx, $mount) {
        var $host = $("<div/>").addClass("ujg-sb-create-bottom-tabs");
        var tabs = [
            { key: "activity", hook: "ujg-sb-create-tab-activity", label: "Активность ( 0 )" },
            { key: "comments", hook: "ujg-sb-create-tab-comments", label: "Комментарии ( 0 )" },
            { key: "worklog", hook: "ujg-sb-create-tab-worklog", label: "Списания ( 0 )" }
        ];
        var active = draft.ui.activeTab || "activity";
        tabs.forEach(function(t) {
            var $btn = $("<button type=\"button\"/>")
                .addClass(
                    "ujg-sb-create-tab-btn " +
                        t.hook +
                        " inline-flex items-center justify-center whitespace-nowrap rounded-sm py-1.5 font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 h-5 text-[8px] px-2 data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:bg-background"
                )
                .text(t.label);
            if (active === t.key) {
                $btn.attr("data-state", "active");
                $btn.addClass("ujg-sb-create-tab-btn--active");
            } else {
                $btn.attr("data-state", "inactive");
            }
            $btn.on("click", function() {
                draft.ui.activeTab = t.key;
                renderCreateModal($mount, draft, ctx);
            });
            $host.append($btn);
        });
        return $host;
    }

    function renderSelectorPanel($mount, draft, ctx, rowKey) {
        var ui = draft.ui || {};
        var sel = ui.selector;
        if (!sel || sel.rowKey !== rowKey || !ctx || !ctx.api) {
            return null;
        }
        var $panel = $("<div/>").addClass("ujg-sb-create-selector-panel");
        var $inp = $("<input/>")
            .attr("type", "text")
            .addClass("ujg-sb-inline-editor ujg-sb-create-selector-search")
            .val(ui.selectorQuery || "");
        $inp.on("click", function(ev) {
            if (ev.stopPropagation) {
                ev.stopPropagation();
            }
        });
        $inp.on("input", function() {
            var q = $inp.val();
            draft.ui.selectorQuery = q;
            var kind = sel.kind;
            var pk = draft.projectKey;
            var startKind = kind;
            var startRowKey = rowKey;
            draft.ui.selectorOpSeq = (draft.ui.selectorOpSeq || 0) + 1;
            var seq = draft.ui.selectorOpSeq;
            draft.ui.selectorError = "";
            if (kind === "assignee") {
                draft.ui.selectorLoading = true;
                Promise.resolve(ctx.api.searchUsers(q)).then(
                    function(body) {
                        if (!selectorResponseStillValid(draft, ctx, seq, startKind, startRowKey)) {
                            return;
                        }
                        draft.ui.selectorRows = normalizeUserSearchRows(body);
                        draft.ui.selectorLoading = false;
                        draft.ui.selectorError = "";
                        renderCreateModal($mount, draft, ctx);
                    },
                    function(err) {
                        applySelectorFailure($mount, draft, ctx, seq, startKind, startRowKey, err);
                    }
                );
            } else if (kind === "component") {
                Promise.resolve(ctx.api.getProjectComponents(pk)).then(
                    function(raw) {
                        if (!selectorResponseStillValid(draft, ctx, seq, startKind, startRowKey)) {
                            return;
                        }
                        var all = normalizeComponentRows(raw);
                        var qq = String(q || "").toLowerCase();
                        draft.ui.selectorRows = all.filter(function(r) {
                            return !qq || String(r.label || "").toLowerCase().indexOf(qq) >= 0;
                        });
                        draft.ui.selectorError = "";
                        renderCreateModal($mount, draft, ctx);
                    },
                    function(err) {
                        applySelectorFailure($mount, draft, ctx, seq, startKind, startRowKey, err);
                    }
                );
            } else if (kind === "label") {
                Promise.resolve(ctx.api.searchLabels(pk, q)).then(
                    function(body) {
                        if (!selectorResponseStillValid(draft, ctx, seq, startKind, startRowKey)) {
                            return;
                        }
                        draft.ui.selectorRows = normalizeLabelSearchRows(body);
                        draft.ui.selectorError = "";
                        renderCreateModal($mount, draft, ctx);
                    },
                    function(err) {
                        applySelectorFailure($mount, draft, ctx, seq, startKind, startRowKey, err);
                    }
                );
            }
        });
        $panel.append($inp);
        if (ui.selectorLoading) {
            $panel.append($("<div/>").addClass("ujg-sb-create-selector-loading").text("…"));
        }
        if (ui.selectorError) {
            $panel.append(
                $("<div/>")
                    .addClass("ujg-sb-create-selector-error")
                    .text(String(ui.selectorError))
            );
        }
        (ui.selectorRows || []).forEach(function(row) {
            var $opt = $("<button type=\"button\"/>")
                .addClass("ujg-sb-create-selector-option")
                .text(row.label || row.id || "");
            $opt.on("click", function() {
                var node = rowNodeByKey(draft, rowKey);
                if (!node) {
                    return;
                }
                if (sel.kind === "assignee") {
                    node.assignee = row.raw && typeof row.raw === "object" ? row.raw : { name: row.id, displayName: row.label };
                } else if (sel.kind === "component") {
                    var nm = row.id || row.label;
                    if (nm && !node.components.some(function(c) {
                        return (typeof c === "string" ? c : c.name) === nm;
                    })) {
                        node.components.push({ name: nm });
                    }
                } else if (sel.kind === "label") {
                    var lb = row.id || row.label;
                    if (lb && node.labels.indexOf(lb) < 0) {
                        node.labels.push(lb);
                    }
                }
                closeSelector(draft);
                renderCreateModal($mount, draft, ctx);
            });
            $panel.append($opt);
        });
        setTimeout(function() {
            $inp.trigger("focus");
        }, 0);
        if (
            sel.kind === "assignee" &&
            !(ui.selectorRows && ui.selectorRows.length) &&
            !ui.selectorLoading &&
            !ui.selectorError
        ) {
            draft.ui.selectorOpSeq = (draft.ui.selectorOpSeq || 0) + 1;
            var seqA = draft.ui.selectorOpSeq;
            var skA = sel.kind;
            var srA = rowKey;
            draft.ui.selectorLoading = true;
            draft.ui.selectorError = "";
            Promise.resolve(ctx.api.searchUsers("")).then(
                function(body) {
                    if (!selectorResponseStillValid(draft, ctx, seqA, skA, srA)) {
                        return;
                    }
                    draft.ui.selectorRows = normalizeUserSearchRows(body);
                    draft.ui.selectorLoading = false;
                    draft.ui.selectorError = "";
                    renderCreateModal($mount, draft, ctx);
                },
                function(err) {
                    applySelectorFailure($mount, draft, ctx, seqA, skA, srA, err);
                }
            );
        }
        if (sel.kind === "component" && !(ui.selectorRows && ui.selectorRows.length) && !ui.selectorError) {
            draft.ui.selectorOpSeq = (draft.ui.selectorOpSeq || 0) + 1;
            var seqC = draft.ui.selectorOpSeq;
            var skC = sel.kind;
            var srC = rowKey;
            draft.ui.selectorError = "";
            Promise.resolve(ctx.api.getProjectComponents(draft.projectKey)).then(
                function(raw) {
                    if (!selectorResponseStillValid(draft, ctx, seqC, skC, srC)) {
                        return;
                    }
                    draft.ui.selectorRows = normalizeComponentRows(raw);
                    draft.ui.selectorError = "";
                    renderCreateModal($mount, draft, ctx);
                },
                function(err) {
                    applySelectorFailure($mount, draft, ctx, seqC, skC, srC, err);
                }
            );
        }
        if (sel.kind === "label" && !(ui.selectorRows && ui.selectorRows.length) && !ui.selectorError) {
            draft.ui.selectorOpSeq = (draft.ui.selectorOpSeq || 0) + 1;
            var seqL = draft.ui.selectorOpSeq;
            var skL = sel.kind;
            var srL = rowKey;
            draft.ui.selectorError = "";
            Promise.resolve(ctx.api.searchLabels(draft.projectKey, "")).then(
                function(body) {
                    if (!selectorResponseStillValid(draft, ctx, seqL, skL, srL)) {
                        return;
                    }
                    draft.ui.selectorRows = normalizeLabelSearchRows(body);
                    draft.ui.selectorError = "";
                    renderCreateModal($mount, draft, ctx);
                },
                function(err) {
                    applySelectorFailure($mount, draft, ctx, seqL, skL, srL, err);
                }
            );
        }
        return $panel;
    }

    function renderCreateModal($mount, draft, ctx) {
        if (!$mount || !draft) {
            return;
        }
        if (!draft.ui) {
            draft.ui = {};
        }
        if (draft.ui.selectorError == null) {
            draft.ui.selectorError = "";
        }
        ctx = ctx || {};
        var hasChrome = !!(ctx.onClose && ctx.onSubmit);
        $mount.empty();
        $mount.addClass("ujg-sb-popup-host");
        var $overlay = $("<div/>")
            .addClass("ujg-sb-create-overlay")
            .addClass(LITERAL_PORT_OVERLAY_UTIL);
        var $dialog = $("<div/>")
            .addClass("ujg-sb-create-dialog ujg-sb-create-ref-shell")
            .addClass(LITERAL_PORT_DIALOG_UTIL);
        var $header = $("<div/>").addClass("ujg-sb-create-header");
        var $kpi = $("<div/>").addClass("ujg-sb-create-kpi-header");
        var pk = draft.projectKey != null ? String(draft.projectKey).trim() : "";
        var storyHours = defaultEstimateHoursForRow(draft, "story", draft.story);
        $kpi.append(
            $("<div/>")
                .addClass("ujg-sb-create-kpi-line")
                .text((pk || "CORE") + " Σ " + storyHours + "ч оценка · 0ч списано · " + String((draft.children || []).length) + " задач")
        );
        var stSum =
            draft.story && draft.story.summary != null ? String(draft.story.summary).trim() : "";
        $kpi.append(
            $("<div/>")
                .addClass("ujg-sb-create-kpi-story-line")
                .text(stSum || "\u041d\u043e\u0432\u0430\u044f \u0438\u0441\u0442\u043e\u0440\u0438\u044f")
        );
        $header.append($kpi);
        if (hasChrome) {
            var $actions = $("<div/>").addClass("ujg-sb-create-header-actions");
            $actions.append(
                (function() {
                    var $sub = $("<button type=\"button\"/>")
                        .addClass(
                            "ujg-sb-create-submit h-4 px-2 text-[8px] rounded bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-40"
                        )
                        .text("\u0421\u043e\u0437\u0434\u0430\u0442\u044c")
                        .on("click", function() {
                            if (draft.ui && draft.ui.submitting) {
                                return;
                            }
                            if (ctx.onSubmit) {
                                ctx.onSubmit();
                            }
                        });
                    if (draft.ui && draft.ui.submitting) {
                        $sub.attr("disabled", "disabled");
                    }
                    return $sub;
                })()
            );
            $actions.append(
                $("<button type=\"button\"/>")
                    .addClass("ujg-sb-create-close h-4 px-2 text-[8px] rounded")
                    .text("\u0417\u0430\u043a\u0440\u044b\u0442\u044c")
                    .on("click", function() {
                        if (ctx.onClose) {
                            ctx.onClose();
                        }
                    })
            );
            $header.append($actions);
        }

        var $tree = $("<div/>").addClass("ujg-sb-create-tree");
        var $bodyInner = $("<div/>").addClass("p-2");

        var bannerMsgs = [].concat(draft.ui.formErrors || []);
        [draft.epic, draft.story].concat(draft.children || []).forEach(function(node) {
            if (node && node.errors && node.errors.length) {
                node.errors.forEach(function(er) {
                    bannerMsgs.push(er);
                });
            }
        });
        if (bannerMsgs.length) {
            var $fe = $("<div/>").addClass("ujg-sb-create-form-errors");
            bannerMsgs.forEach(function(msg) {
                $fe.append($("<div/>").text(String(msg)));
            });
            $tree.append($fe);
        }

        var epicSpec = null;
        var storySpec = null;
        var childSpecs = [];
        modalRows(draft).forEach(function(row) {
            if (row.key === "epic") {
                epicSpec = row;
            } else if (row.key === "story") {
                storySpec = row;
            } else {
                childSpecs.push(row);
            }
        });

        if (epicSpec) {
            $tree.append(renderEpicRow($mount, draft, ctx, epicSpec));
        }
        if (storySpec) {
            $tree.append(renderStoryRow($mount, draft, ctx, storySpec));
        }
        $tree.append(renderChildrenRowsForMode($mount, draft, ctx, childSpecs));

        $dialog.append($header);
        if (hasChrome) {
            $bodyInner.append(renderChildrenViewToolbar(draft, ctx, $mount));
            $bodyInner.append(renderRoleAddStrip(draft, ctx, $mount));
        }
        $bodyInner.append($tree);
        if (hasChrome) {
            $bodyInner.append(renderBottomTabPanel(draft));
        }
        var $bodyScroll = $("<div/>").addClass("flex-1 overflow-y-auto min-h-0");
        $bodyScroll.append($bodyInner);
        $dialog.append($bodyScroll);
        if (hasChrome) {
            $dialog.append(renderBottomTabs(draft, ctx, $mount));
        }
        $overlay.append($dialog);
        $mount.append($overlay);
    }

    return {
        makeDefaultDraft: makeDefaultDraft,
        toggleDescription: toggleDescription,
        validateDraft: validateDraft,
        hasSubmitValidationErrors: hasSubmitValidationErrors,
        renderCreateModal: renderCreateModal,
        submitCreateDraft: submitCreateDraft,
        normalizeUserSearchRows: normalizeUserSearchRows,
        normalizeComponentRows: normalizeComponentRows,
        normalizeLabelSearchRows: normalizeLabelSearchRows,
        draftRows: draftRows,
        buildIssueFields: buildIssueFields,
        setEpicSelectionMode: setEpicSelectionMode
    };
});
