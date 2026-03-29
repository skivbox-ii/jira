const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const loadAmdModule = require("./helpers/load-amd-module");

const MODULE_DIR = path.join(__dirname, "..", "ujg-story-browser-modules");

function mockWindow(overrides) {
    return {
        location: {
            origin: "https://jira.example.com",
            protocol: "https:",
            ...(overrides && overrides.location)
        },
        AJS: overrides && overrides.AJS !== undefined ? overrides.AJS : { params: { baseURL: "" } }
    };
}

function loadConfig(windowImpl) {
    return loadAmdModule(
        path.join(MODULE_DIR, "config.js"),
        {},
        windowImpl ? { window: windowImpl } : {}
    );
}

function loadUtils(windowImpl) {
    const config = loadConfig(windowImpl);
    return loadAmdModule(path.join(MODULE_DIR, "utils.js"), {
        _ujgSB_config: config
    });
}

function createLocalStorageMock() {
    const store = Object.create(null);
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

function loadStorage(localStorageImpl, windowImpl) {
    const config = loadConfig(windowImpl);
    const globals = {};
    if (localStorageImpl) globals.localStorage = localStorageImpl;
    return loadAmdModule(
        path.join(MODULE_DIR, "storage.js"),
        { _ujgSB_config: config },
        globals
    );
}

function assertIssueFieldContract(fields, expectedFields) {
    assert.equal(typeof fields, "string");
    assert.equal(fields, expectedFields.join(","));
    const actual = fields.split(",");
    expectedFields.forEach(function(field) {
        assert.ok(actual.includes(field), "missing ISSUE_FIELDS entry: " + field);
    });
    assert.equal(new Set(actual).size, actual.length);
}

function assertTypeBadgeMappings(typeBadges, expectedMappings) {
    Object.keys(expectedMappings).forEach(function(typeName) {
        assert.equal(typeBadges[typeName], expectedMappings[typeName]);
    });
}

test("_ujgSB_config exposes baseUrl from window origin", function() {
    const cfg = loadConfig(mockWindow());
    assert.equal(cfg.baseUrl, "https://jira.example.com");
});

test("_ujgSB_config exposes TYPE_BADGES and STATUS_DONE", function() {
    const cfg = loadConfig(mockWindow());
    assertTypeBadgeMappings(cfg.TYPE_BADGES, {
        Epic: "E",
        Story: "S",
        Bug: "B",
        Task: "T",
        "Sub-task": "ST",
        "Подзадача": "ST",
        "Frontend Task": "FE",
        "Backend Task": "BE",
        "System Engineer": "SE",
        DevOps: "DO",
        QA: "QA"
    });
    assert.equal(typeof cfg.STATUS_DONE.has, "function");
    assert.ok(cfg.STATUS_DONE.has("Done"));
    assert.ok(cfg.STATUS_DONE.has("Closed"));
    assert.ok(cfg.STATUS_DONE.has("Resolved"));
    assert.ok(cfg.STATUS_DONE.has("Готово"));
    assert.ok(cfg.STATUS_DONE.has("Закрыт"));
    assert.ok(cfg.STATUS_DONE.has("Закрыта"));
    assert.ok(cfg.STATUS_DONE.has("Завершен"));
    assert.ok(cfg.STATUS_DONE.has("Завершён"));
    assert.ok(cfg.STATUS_DONE.has("Завершена"));
    assert.ok(cfg.STATUS_DONE.has("Выполнено"));
    assert.equal(cfg.STATUS_COLORS["Готово"], cfg.STATUS_COLORS.Done);
    assert.equal(cfg.STATUS_COLORS["Закрыт"], cfg.STATUS_COLORS.Done);
    assert.equal(cfg.STATUS_COLORS["Закрыта"], cfg.STATUS_COLORS.Done);
    assert.equal(cfg.STATUS_COLORS["Завершен"], cfg.STATUS_COLORS.Done);
    assert.equal(cfg.STATUS_COLORS["Завершена"], cfg.STATUS_COLORS.Done);
    assert.equal(cfg.STATUS_COLORS["Открыт"], cfg.STATUS_COLORS.Open);
    assert.equal(cfg.STATUS_COLORS["В работе"], cfg.STATUS_COLORS["In Progress"]);
});

test("_ujgSB_config field ids and ISSUE_FIELDS", function() {
    const cfg = loadConfig(mockWindow());
    assert.equal(cfg.EPIC_LINK_FIELD, "customfield_10014");
    assert.equal(cfg.SPRINT_FIELD, "customfield_10020");
    assert.equal(cfg.STORAGE_KEY, "ujg-sb-state");
    assert.equal(cfg.EPIC_ISSUE_TYPE, "Epic");
    assert.equal(cfg.STORY_ISSUE_TYPE, "Story");
    assert.deepEqual(Array.from(cfg.CHILD_LINK_NAMES || []), ["child", "is_child"]);
    assertIssueFieldContract(cfg.ISSUE_FIELDS, [
        "summary",
        "status",
        "assignee",
        "issuetype",
        "priority",
        "timeoriginalestimate",
        "timetracking",
        "timespent",
        "components",
        "labels",
        "fixVersions",
        "parent",
        "issuelinks",
        "created",
        "updated",
        cfg.EPIC_LINK_FIELD,
        cfg.SPRINT_FIELD
    ]);
    assert.ok(cfg.ICONS && typeof cfg.ICONS === "object");
    assert.ok(cfg.TYPE_COLORS && typeof cfg.TYPE_COLORS === "object");
    assert.ok(cfg.STATUS_COLORS && typeof cfg.STATUS_COLORS === "object");
    assert.ok(cfg.PRIORITY_COLORS && typeof cfg.PRIORITY_COLORS === "object");
});

test("_ujgSB_utils escapeHtml and icon", function() {
    const utils = loadUtils(mockWindow());
    assert.equal(utils.escapeHtml('<a href="x">y</a>'), "&lt;a href=&quot;x&quot;&gt;y&lt;/a&gt;");
    assert.equal(utils.escapeHtml(""), "");
    const cfg = loadConfig(mockWindow());
    cfg.ICONS.testIcon = '<svg data-test="1"></svg>';
    const utilsWithIcon = loadAmdModule(path.join(MODULE_DIR, "utils.js"), {
        _ujgSB_config: cfg
    });
    assert.ok(utilsWithIcon.icon("testIcon", "c1").includes('class="c1"'));
    assert.ok(utilsWithIcon.icon("testIcon", '"><script').includes("&quot;&gt;&lt;script"));
});

test("_ujgSB_utils formatDate formatHours formatSP", function() {
    const utils = loadUtils(mockWindow());
    assert.equal(utils.formatDate("2026-03-15T10:00:00.000Z"), "2026-03-15");
    assert.equal(utils.formatDate(null), "");
    assert.equal(utils.formatHours(0), "—");
    assert.equal(utils.formatHours(3600), "1ч");
    assert.equal(utils.formatHours(3660), "1ч1м");
    assert.equal(utils.formatSP(5), "5");
    assert.equal(utils.formatSP(null), "—");
});

test("_ujgSB_utils getTypeBadge unknown types use initials", function() {
    const utils = loadUtils(mockWindow());
    assert.equal(utils.getTypeBadge("Story"), "S");
    assert.equal(utils.getTypeBadge("Epic"), "E");
    assert.equal(utils.getTypeBadge("Random Thing"), "RT");
    assert.equal(utils.getTypeBadge("Monolith"), "MO");
    assert.equal(utils.getTypeBadge({ name: "Story" }), "S");
    assert.equal(utils.getTypeBadge({ name: "Random Thing" }), "RT");
});

test("_ujgSB_utils getTypeColor getStatusClass getStatusName isDone", function() {
    const utils = loadUtils(mockWindow());
    assert.ok(typeof utils.getTypeColor("Story") === "string");
    assert.equal(utils.getStatusClass({ name: "Done" }), utils.getStatusClass({ name: "done" }));
    assert.equal(utils.getStatusClass({ name: "Готово" }), utils.getStatusClass({ name: "Done" }));
    assert.equal(utils.getStatusClass({ name: "Закрыт" }), utils.getStatusClass({ name: "Done" }));
    assert.equal(utils.getStatusClass({ name: "Закрыта" }), utils.getStatusClass({ name: "Done" }));
    assert.equal(utils.getStatusClass({ name: "Завершен" }), utils.getStatusClass({ name: "Done" }));
    assert.equal(utils.getStatusClass({ name: "Завершена" }), utils.getStatusClass({ name: "Done" }));
    assert.equal(utils.getStatusClass({ name: "Открыт" }), utils.getStatusClass({ name: "Open" }));
    assert.equal(utils.getStatusClass({ name: "В работе" }), utils.getStatusClass({ name: "In Progress" }));
    assert.equal(utils.getStatusName({ name: "In Progress" }), "In Progress");
    assert.equal(utils.getStatusName(null), "");
    assert.equal(utils.isDone({ name: "Done" }), true);
    assert.equal(utils.isDone({ name: "done" }), true);
    assert.equal(utils.isDone({ name: "Closed" }), true);
    assert.equal(utils.isDone("resolved"), true);
    assert.equal(utils.isDone({ name: "Resolved" }), true);
    assert.equal(utils.isDone({ name: "Готово" }), true);
    assert.equal(utils.isDone({ name: "готово" }), true);
    assert.equal(utils.isDone({ name: "Закрыт" }), true);
    assert.equal(utils.isDone({ name: "Закрыта" }), true);
    assert.equal(utils.isDone({ name: "завершен" }), true);
    assert.equal(utils.isDone({ name: "Завершён" }), true);
    assert.equal(utils.isDone({ name: "Завершена" }), true);
    assert.equal(utils.isDone({ name: "Выполнено" }), true);
    assert.equal(utils.isDone({ name: "Open" }), false);
    assert.equal(utils.isDone({ name: "Открыт" }), false);
});

test("_ujgSB_utils getPriorityClass getPriorityName", function() {
    const utils = loadUtils(mockWindow());
    assert.ok(typeof utils.getPriorityClass({ name: "High" }) === "string");
    assert.equal(utils.getPriorityName({ name: "Medium" }), "Medium");
    assert.equal(utils.getPriorityName(null), "");
});

test("_ujgSB_utils getSprintName handles object array and Jira string", function() {
    const utils = loadUtils(mockWindow());
    assert.equal(utils.getSprintName({ name: "Solo" }), "Solo");
    assert.equal(
        utils.getSprintName([{ name: "A" }, { name: "B" }]),
        "A, B"
    );
    const jiraStr =
        "com.atlassian.greenhopper.service.sprint.Sprint@deadbeef[id=1,rapidViewId=2,state=CLOSED,name=Sprint 9,startDate=...,endDate=...,completeDate=...]";
    assert.equal(utils.getSprintName(jiraStr), "Sprint 9");
    assert.equal(utils.getSprintName([jiraStr]), "Sprint 9");
    const jiraStrWithComma =
        "com.atlassian.greenhopper.service.sprint.Sprint@deadbeef[id=2,rapidViewId=2,state=ACTIVE,name=Sprint 9, API + Mobile,startDate=...,endDate=...,completeDate=...]";
    assert.equal(utils.getSprintName(jiraStrWithComma), "Sprint 9, API + Mobile");
    assert.equal(utils.getSprintName(null), "");
});

test("_ujgSB_storage save and load round-trip and defaults", function() {
    const ls = createLocalStorageMock();
    const storage = loadStorage(ls, mockWindow());
    const state = {
        project: "PROJ",
        viewMode: "tree",
        epicFilter: "E-1",
        selectedEpicKeys: ["E-1", "E-2"],
        statusFilter: "open",
        sprintFilter: "42"
    };
    storage.save(state);
    assert.ok(Object.prototype.hasOwnProperty.call(ls._data, "ujg-sb-state"));
    const parsed = JSON.parse(ls._data["ujg-sb-state"]);
    assert.equal(parsed.project, "PROJ");
    assert.equal(parsed.viewMode, "tree");
    assert.equal(parsed.epicFilter, "E-1");
    assert.equal(parsed.selectedEpicKeys.join("|"), "E-1|E-2");
    assert.equal(parsed.statusFilter, "open");
    assert.equal(parsed.sprintFilter, "42");

    const loaded = storage.load();
    assert.equal(loaded.project, state.project);
    assert.equal(loaded.viewMode, state.viewMode);
    assert.equal(loaded.epicFilter, state.epicFilter);
    assert.equal(loaded.selectedEpicKeys.join("|"), "E-1|E-2");
    assert.equal(loaded.statusFilter, state.statusFilter);
    assert.equal(loaded.sprintFilter, state.sprintFilter);
});

test("_ujgSB_storage load returns defaults when missing or invalid", function() {
    const ls = createLocalStorageMock();
    const storage = loadStorage(ls, mockWindow());
    const defaults = storage.load();
    assert.equal(defaults.project, null);
    assert.equal(defaults.viewMode, "all");
    assert.equal(defaults.epicFilter, "");
    assert.equal(Array.isArray(defaults.selectedEpicKeys), true);
    assert.equal(defaults.selectedEpicKeys.length, 0);
    assert.equal(defaults.statusFilter, "");
    assert.equal(defaults.sprintFilter, "");

    ls.setItem("ujg-sb-state", "not-json{");
    const bad = storage.load();
    assert.equal(bad.project, null);
    assert.equal(bad.viewMode, "all");
    assert.equal(bad.epicFilter, "");
    assert.equal(Array.isArray(bad.selectedEpicKeys), true);
    assert.equal(bad.selectedEpicKeys.length, 0);
    assert.equal(bad.statusFilter, "");
    assert.equal(bad.sprintFilter, "");

    ls.setItem("ujg-sb-state", JSON.stringify({ project: "X" }));
    const partial = storage.load();
    assert.equal(partial.project, "X");
    assert.equal(partial.viewMode, "all");
    assert.equal(partial.epicFilter, "");
    assert.equal(Array.isArray(partial.selectedEpicKeys), true);
    assert.equal(partial.selectedEpicKeys.length, 0);
    assert.equal(partial.statusFilter, "");
    assert.equal(partial.sprintFilter, "");
});

test("_ujgSB_storage migrates legacy epicFilter into selectedEpicKeys", function() {
    const ls = createLocalStorageMock();
    ls.setItem("ujg-sb-state", JSON.stringify({
        project: "PROJ",
        epicFilter: "E-10"
    }));
    const storage = loadStorage(ls, mockWindow());
    const loaded = storage.load();

    assert.equal(loaded.epicFilter, "E-10");
    assert.equal(Array.isArray(loaded.selectedEpicKeys), true);
    assert.equal(loaded.selectedEpicKeys.length, 1);
    assert.equal(loaded.selectedEpicKeys[0], "E-10");
});
