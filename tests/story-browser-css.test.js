"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSS_PATH = path.join(__dirname, "..", "ujg-story-browser.css");

function readCss() {
    return fs.readFileSync(CSS_PATH, "utf8");
}

function blocksForClass(css, className) {
    const esc = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const classRe = new RegExp("(^|[^A-Za-z0-9_-])\\." + esc + "(?=[^A-Za-z0-9_-]|$)");
    const re = /([^{}]+)\{([^{}]*)\}/g;
    const out = [];
    let m;
    while ((m = re.exec(css))) {
        if (classRe.test(m[1])) {
            out.push(m[2]);
        }
    }
    return out;
}

function blockForClass(css, className) {
    const blocks = blocksForClass(css, className);
    return blocks.length ? blocks.join("\n") : null;
}

test("story-browser CSS: 1 file exists", function() {
    assert.ok(fs.existsSync(CSS_PATH), "expected ujg-story-browser.css next to tests/");
});

test("story-browser CSS: 2 contract selectors and key properties", function() {
    const css = readCss();
    const selectors = [
        "ujg-story-browser",
        "ujg-sb-root",
        "ujg-sb-header",
        "ujg-sb-controls",
        "ujg-sb-view-buttons",
        "ujg-sb-action-buttons",
        "ujg-sb-view-host",
        "ujg-sb-view-active",
        "ujg-sb-progress",
        "ujg-sb-progress-bar",
        "ujg-sb-progress-fill",
        "ujg-sb-table-wrap",
        "ujg-sb-table",
        "ujg-sb-table-row-epic",
        "ujg-sb-table-row-story",
        "ujg-sb-problem-row",
        "ujg-sb-problem-cell",
        "ujg-sb-accordion-item",
        "ujg-sb-accordion-head",
        "ujg-sb-rows-wrap",
        "ujg-sb-row-card",
        "ujg-sb-type-epic",
        "ujg-sb-type-story",
        "ujg-sb-type-bug",
        "ujg-sb-type-task",
        "ujg-sb-type-subtask",
        "ujg-sb-type-frontend",
        "ujg-sb-type-backend",
        "ujg-sb-type-se",
        "ujg-sb-type-devops",
        "ujg-sb-type-qa",
        "ujg-sb-type-unknown",
        "ujg-sb-status-open",
        "ujg-sb-status-progress",
        "ujg-sb-status-todo",
        "ujg-sb-status-done",
        "ujg-sb-status-default",
        "ujg-sb-priority-highest",
        "ujg-sb-priority-high",
        "ujg-sb-priority-medium",
        "ujg-sb-priority-low",
        "ujg-sb-priority-lowest",
        "ujg-sb-priority-default",
        "ujg-sb-popup-host",
        "ujg-sb-create-overlay",
        "ujg-sb-create-dialog",
        "ujg-sb-create-header",
        "ujg-sb-create-tree",
        "ujg-sb-inline-editor",
        "ujg-sb-chip-trigger",
        "ujg-sb-chip-list",
        "ujg-sb-create-header-actions",
        "ujg-sb-create-submit",
        "ujg-sb-create-close",
        "ujg-sb-create-form-errors",
        "ujg-sb-create-epic-toolbar",
        "ujg-sb-create-epic-existing",
        "ujg-sb-create-row-error",
        "ujg-sb-create-assignee-trigger",
        "ujg-sb-create-component-trigger",
        "ujg-sb-create-label-trigger",
        "ujg-sb-create-selector-panel",
        "ujg-sb-create-selector-option",
        "ujg-sb-create-selector-search",
        "ujg-sb-create-selector-error",
        "ujg-sb-create-row-errors",
        "ujg-sb-create-created-key",
        "ujg-sb-chip"
    ];
    var si;
    for (si = 0; si < selectors.length; si++) {
        var cls = selectors[si];
        assert.match(css, new RegExp("\\." + cls.replace(/-/g, "\\-") + "\\b"), "missing rule for ." + cls);
    }

    const headerInner = blockForClass(css, "ujg-sb-header");
    assert.ok(headerInner, ".ujg-sb-header block");
    assert.match(headerInner, /position\s*:\s*sticky/i, "header should be sticky");
    assert.match(headerInner, /backdrop-filter|background-color/i, "header should have backdrop or bg");

    const rootBlock = blockForClass(css, "ujg-sb-root");
    assert.ok(rootBlock, ".ujg-sb-root block");
    assert.match(rootBlock, /display\s*:\s*flex/i, "root should be flex");
    assert.match(rootBlock, /flex-direction\s*:\s*column/i, "root should be column layout");
    assert.match(rootBlock, /flex\s*:\s*1\s+1\s+auto/i, "root should grow within widget");
    assert.match(rootBlock, /min-height\s*:\s*0/i, "root should allow nested overflow");

    assert.match(css, /\.ujg-story-browser\s+\.ujg-sb-view-host\b/, "view host should stay widget-scoped");

    const activeView = blockForClass(css, "ujg-sb-view-active");
    assert.ok(activeView, ".ujg-sb-view-active block");
    assert.match(activeView, /background-color\s*:\s*hsl/i, "active view should tint background");
    assert.match(activeView, /border-color\s*:\s*hsl/i, "active view should tint border");
    assert.match(activeView, /color\s*:\s*hsl/i, "active view should tint text");

    const tableWrap = blockForClass(css, "ujg-sb-table-wrap");
    assert.ok(tableWrap, ".ujg-sb-table-wrap block");
    assert.match(tableWrap, /overflow-x\s*:\s*auto/i, "table wrap horizontal scroll");

    const problemRow = blockForClass(css, "ujg-sb-problem-row");
    assert.ok(problemRow, ".ujg-sb-problem-row block");
    assert.match(problemRow, /background(?:-color)?\s*:/i, "problem row tinted background");

    const problemCell = blockForClass(css, "ujg-sb-problem-cell");
    assert.ok(problemCell, ".ujg-sb-problem-cell block");

    const epicRow = blockForClass(css, "ujg-sb-table-row-epic");
    const storyRow = blockForClass(css, "ujg-sb-table-row-story");
    assert.ok(epicRow && storyRow, "epic/story row blocks");
    assert.notEqual(epicRow.replace(/\s/g, ""), storyRow.replace(/\s/g, ""), "epic vs story should differ visually");

    const tableBlock = blockForClass(css, "ujg-sb-table");
    assert.ok(tableBlock, ".ujg-sb-table block");
    assert.match(tableBlock, /font-size/i, "compact table typography");

    const typePill = blockForClass(css, "ujg-sb-type-story");
    assert.ok(typePill, ".ujg-sb-type-story block");
    assert.match(typePill, /color\s*:\s*hsl/i, "type pill uses theme hsl()");

    const statusPill = blockForClass(css, "ujg-sb-status-open");
    assert.ok(statusPill, ".ujg-sb-status-open block");
    assert.match(statusPill, /background(?:-color)?\s*:\s*hsl/i, "status uses theme hsl()");

    const priPill = blockForClass(css, "ujg-sb-priority-high");
    assert.ok(priPill, ".ujg-sb-priority-high block");
    assert.match(priPill, /color\s*:\s*hsl|background(?:-color)?\s*:\s*hsl/i, "priority uses theme hsl()");
});

test("story-browser CSS: standalone widget controls have semantic styles and token fallbacks", function() {
    const css = readCss();

    assert.match(css, /\.ujg-sb-title\s*\{[^{}]*font-size\s*:[^{}]*\}/i, "title should size itself without utility classes");
    assert.match(css, /\.ujg-sb-title\s*\{[^{}]*margin\s*:\s*0/i, "title should reset default h1 margin");
    assert.match(css, /\.ujg-sb-controls\s+select\s*\{[^{}]*border[^{}]*\}/i, "controls select should have semantic border styling");
    assert.match(css, /\.ujg-sb-controls\s+input\s*\{[^{}]*border[^{}]*\}/i, "controls input should have semantic border styling");
    assert.match(css, /\.ujg-sb-view-btn\s*\{[^{}]*padding[^{}]*\}/i, "view button should size itself without utility classes");
    assert.match(css, /\.ujg-sb-expand-all\s*\{[^{}]*padding[^{}]*\}/i, "expand button should size itself without utility classes");
    assert.match(css, /\.ujg-sb-collapse-all\s*\{[^{}]*padding[^{}]*\}/i, "collapse button should size itself without utility classes");
    assert.match(css, /var\(--foreground,\s*[^)]+\)/i, "theme tokens should provide foreground fallback");
    assert.match(css, /var\(--border,\s*[^)]+\)/i, "theme tokens should provide border fallback");
    assert.match(css, /var\(--primary,\s*[^)]+\)/i, "theme tokens should provide primary fallback");
});

test("story-browser CSS: 4 create-modal shell and inline editor layout", function() {
    const css = readCss();

    assert.match(css, /\.ujg-story-browser\s+\.ujg-sb-popup-host\b/, "popup host scoped under widget");
    assert.match(css, /\.ujg-sb-popup-host\s+\.ujg-sb-create-overlay\b/, "create overlay under dedicated popup host mount");
    assert.match(css, /\.ujg-story-browser\s+\.ujg-sb-create-overlay\b/, "create overlay scoped under widget");

    const overlay = blockForClass(css, "ujg-sb-create-overlay");
    assert.ok(overlay, ".ujg-sb-create-overlay block");
    assert.match(overlay, /position\s*:\s*fixed|position\s*:\s*absolute/i, "overlay covers viewport");

    const dialog = blockForClass(css, "ujg-sb-create-dialog");
    assert.ok(dialog, ".ujg-sb-create-dialog block");
    assert.match(dialog, /max-width|width/i, "dialog sized");

    const createHeader = blockForClass(css, "ujg-sb-create-header");
    assert.ok(createHeader, ".ujg-sb-create-header block");
    assert.match(createHeader, /position\s*:\s*sticky/i, "create header sticky");

    const tree = blockForClass(css, "ujg-sb-create-tree");
    assert.ok(tree, ".ujg-sb-create-tree block");
    assert.match(tree, /display\s*:\s*flex|flex-direction|gap/i, "tree row layout");

    const inlineEd = blockForClass(css, "ujg-sb-inline-editor");
    assert.ok(inlineEd, ".ujg-sb-inline-editor block");
    assert.match(inlineEd, /border|box-sizing/i, "inline editor bordered");

    const chipList = blockForClass(css, "ujg-sb-chip-list");
    const chipTrig = blockForClass(css, "ujg-sb-chip-trigger");
    assert.ok(chipList && chipTrig, "chip list and trigger blocks");
});
