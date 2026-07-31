const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const loadAmdModule = require("./helpers/load-amd-module");

function normalize(value) {
    return JSON.parse(JSON.stringify(value));
}

function loadCommon() {
    return loadAmdModule(path.join(__dirname, "..", "_ujgCommon.js"), {
        jquery: {}
    });
}

function loadTimesheet(Common) {
    return loadAmdModule(path.join(__dirname, "..", "ujg-timesheet.js"), {
        jquery: {},
        _ujgCommon: Common,
        _ujgShared_llmClient: {}
    });
}

test("collectIssueWorklogs keeps aggregates and individual worklogs", function() {
    var Common = loadCommon();
    assert.equal(typeof Common.collectIssueWorklogs, "function");

    var result = Common.collectIssueWorklogs([
        {
            author: { accountId: "u2", displayName: "Bob" },
            timeSpentSeconds: 1800,
            comment: ""
        },
        {
            id: "10002",
            started: "2026-03-02T09:00:00.000+0300",
            author: { accountId: "u1", displayName: "Alice" },
            timeSpentSeconds: 1200,
            comment: "Sync"
        },
        {
            author: { accountId: "u1", displayName: "Alice" },
            timeSpentSeconds: 2400,
            comment: "Review"
        }
    ]);

    assert.deepEqual(normalize(result.authors), { u1: "Alice", u2: "Bob" });
    assert.equal(result.seconds, 5400);
    assert.deepEqual(normalize(result.comments), ["Sync", "Review"]);
    assert.deepEqual(normalize(result.worklogs), [
        { authorId: "u2", authorName: "Bob", seconds: 1800, comment: "" },
        { id: "10002", started: "2026-03-02T09:00:00.000+0300", authorId: "u1", authorName: "Alice", seconds: 1200, comment: "Sync" },
        { authorId: "u1", authorName: "Alice", seconds: 2400, comment: "Review" }
    ]);
});

test("filterDayDataByUsers recalculates issue data from matching worklogs only", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    assert.equal(typeof Timesheet.__test.filterDayDataByUsers, "function");

    var original = {
        key: "SDKU-1",
        seconds: 5400,
        comments: ["Sync", "Review"],
        authors: { u1: "Alice", u2: "Bob" },
        worklogs: [
            { authorId: "u2", authorName: "Bob", seconds: 1800, comment: "" },
            { authorId: "u1", authorName: "Alice", seconds: 1200, comment: "Sync" },
            { authorId: "u1", authorName: "Alice", seconds: 2400, comment: "Review" }
        ]
    };

    var filtered = Timesheet.__test.filterDayDataByUsers([original], ["u1"]);

    assert.equal(filtered.length, 1);
    assert.notEqual(filtered[0], original);
    assert.equal(filtered[0].seconds, 3600);
    assert.deepEqual(normalize(filtered[0].comments), ["Sync", "Review"]);
    assert.deepEqual(normalize(filtered[0].authors), { u1: "Alice" });
    assert.deepEqual(normalize(filtered[0].worklogs), [
        { authorId: "u1", authorName: "Alice", seconds: 1200, comment: "Sync" },
        { authorId: "u1", authorName: "Alice", seconds: 2400, comment: "Review" }
    ]);
    assert.equal(original.seconds, 5400);
    assert.equal(original.worklogs.length, 3);
});

test("filterDayDataByUsers drops issues without matching authors", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);

    var filtered = Timesheet.__test.filterDayDataByUsers([
        {
            key: "SDKU-1",
            seconds: 1800,
            comments: [],
            authors: { u2: "Bob" },
            worklogs: [{ authorId: "u2", authorName: "Bob", seconds: 1800, comment: "" }]
        }
    ], ["u1"]);

    assert.deepEqual(normalize(filtered), []);
});

test("getCalendarUserIds prefers selected users and otherwise returns all users sorted by name", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    assert.equal(typeof Timesheet.__test.getCalendarUserIds, "function");

    assert.deepEqual(normalize(Timesheet.__test.getCalendarUserIds({
        u2: "Bob",
        u1: "Alice",
        u3: "Charlie"
    }, [])), ["u1", "u2", "u3"]);

    assert.deepEqual(normalize(Timesheet.__test.getCalendarUserIds({
        u2: "Bob",
        u1: "Alice"
    }, ["u2", "u9"])), ["u2"]);
});

test("getUserDropdownEntries keeps selected users pinned and highlighted", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    assert.equal(typeof Timesheet.__test.getUserDropdownEntries, "function");

    var entries = Timesheet.__test.getUserDropdownEntries({
        u3: "Charlie",
        u1: "Alice",
        u2: "Bob"
    }, ["u3", "u2"], "");

    assert.deepEqual(normalize(entries), [
        { id: "u2", name: "Bob", selected: true },
        { id: "u3", name: "Charlie", selected: true },
        { id: "u1", name: "Alice", selected: false }
    ]);
});

test("JQL presets keep active query editable without applying automatically", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    assert.equal(typeof Timesheet.__test.normalizeJqlPresets, "function");
    assert.equal(typeof Timesheet.__test.selectJqlPreset, "function");
    assert.equal(typeof Timesheet.__test.applyJqlPreset, "function");

    var normalized = Timesheet.__test.normalizeJqlPresets({
        activeId: "b",
        items: [
            { id: "a", name: "Проект A", jql: "project = A" },
            { id: "b", name: "Проект B", jql: "project = B" }
        ]
    }, "");

    var selected = Timesheet.__test.selectJqlPreset(normalized, "a");
    assert.equal(selected.currentJql, "project = A");
    assert.equal(selected.activeId, "a");
    assert.equal(normalized.items[1].jql, "project = B");

    var applied = Timesheet.__test.applyJqlPreset(selected, "project = A AND statusCategory != Done");
    assert.equal(applied.currentJql, "project = A AND statusCategory != Done");
    assert.equal(applied.activeId, "a");
    assert.deepEqual(normalize(applied.items), [
        { id: "a", name: "Проект A", jql: "project = A AND statusCategory != Done" },
        { id: "b", name: "Проект B", jql: "project = B" }
    ]);
});

test("JQL toolbar renders Lucide save and sparkle icons", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    assert.equal(typeof Timesheet.__test.jqlToolbarIcon, "function");

    var saveIcon = Timesheet.__test.jqlToolbarIcon("save");
    var llmIcon = Timesheet.__test.jqlToolbarIcon("sparkles");

    assert.match(saveIcon, /class="lucide lucide-save"/);
    assert.match(llmIcon, /class="lucide lucide-sparkles"/);
    assert.match(saveIcon, /aria-hidden="true"/);
    assert.match(llmIcon, /aria-hidden="true"/);
    assert.doesNotMatch(saveIcon + llmIcon, /[+μ]/);
});

test("fullscreen control renders Lucide maximize and minimize icons", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);

    assert.match(Timesheet.__test.toolbarIcon("maximize-2"), /class="lucide lucide-maximize-2"/);
    assert.match(Timesheet.__test.toolbarIcon("minimize-2"), /class="lucide lucide-minimize-2"/);
});

test("JQL action plan keeps select and save-as as drafts until apply", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    assert.equal(typeof Timesheet.__test.planJqlPresetAction, "function");

    var presets = Timesheet.__test.normalizeJqlPresets({
        activeId: "a",
        items: [
            { id: "a", name: "Проект A", jql: "project = A" },
            { id: "b", name: "Проект B", jql: "project = B" }
        ]
    }, "");

    var selected = Timesheet.__test.planJqlPresetAction(presets, "select", {
        presetId: "b"
    });
    assert.equal(selected.currentJql, "project = B");
    assert.equal(selected.appliedJql, null);
    assert.equal(selected.shouldReload, false);

    var saved = Timesheet.__test.planJqlPresetAction(selected.presets, "saveAs", {
        name: "Без закрытых",
        jql: "project = B AND statusCategory != Done"
    });
    assert.equal(saved.currentJql, "project = B AND statusCategory != Done");
    assert.equal(saved.appliedJql, null);
    assert.equal(saved.shouldReload, false);

    var applied = Timesheet.__test.planJqlPresetAction(saved.presets, "apply", {
        jql: saved.currentJql
    });
    assert.equal(applied.currentJql, "project = B AND statusCategory != Done");
    assert.equal(applied.appliedJql, "project = B AND statusCategory != Done");
    assert.equal(applied.shouldReload, true);
});

test("JQL initialization keeps the saved draft separate from the applied query", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    assert.equal(typeof Timesheet.__test.resolveInitialJqlState, "function");

    var initial = Timesheet.__test.resolveInitialJqlState({
        savedJql: "project = A",
        hasSavedJql: true,
        storedPresets: {
            activeId: "b",
            items: [
                { id: "a", name: "Проект A", jql: "project = A" },
                { id: "b", name: "Проект B", jql: "project = B" }
            ]
        }
    });

    assert.equal(initial.appliedJql, "project = A");
    assert.equal(initial.inputJql, "project = B");
    assert.equal(initial.presets.activeId, "b");
});

test("new timesheet load invalidates prior load and keeps its JQL snapshot", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    assert.equal(typeof Timesheet.__test.beginTimesheetLoad, "function");
    assert.equal(typeof Timesheet.__test.isTimesheetLoadCurrent, "function");

    var state = { loadRevision: 0 };
    var first = Timesheet.__test.beginTimesheetLoad(state, ["2026-03-02"], "project = A");
    var second = Timesheet.__test.beginTimesheetLoad(state, ["2026-03-02"], "project = B");

    assert.equal(first.jqlFilter, "project = A");
    assert.equal(second.jqlFilter, "project = B");
    assert.equal(Timesheet.__test.isTimesheetLoadCurrent(state, first), false);
    assert.equal(Timesheet.__test.isTimesheetLoadCurrent(state, second), true);
});

test("JQL preset helpers can save as and delete active presets", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    var presets = Timesheet.__test.normalizeJqlPresets(null, "project = EVOSCADA");

    presets = Timesheet.__test.saveAsJqlPreset(presets, "Без закрытых", "project = EVOSCADA AND statusCategory != Done");
    assert.equal(presets.currentJql, "project = EVOSCADA AND statusCategory != Done");
    assert.equal(presets.items.length, 2);
    assert.equal(presets.items[1].name, "Без закрытых");

    presets = Timesheet.__test.deleteJqlPreset(presets, presets.activeId);
    assert.equal(presets.items.length, 1);
    assert.equal(presets.currentJql, "project = EVOSCADA");
});

test("JQL LLM prompt includes current JQL and known projects", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    assert.equal(typeof Timesheet.__test.collectProjectKeys, "function");
    assert.equal(typeof Timesheet.__test.buildJqlLlmRequest, "function");

    var projects = Timesheet.__test.collectProjectKeys({
        "2026-03-02": [{ key: "EVOSCADA-1" }, { key: "SDKU-2" }],
        "2026-03-03": [{ key: "EVOSCADA-3" }]
    });
    var request = Timesheet.__test.buildJqlLlmRequest({
        currentJql: "project = EVOSCADA",
        systemPrompt: "Верни только JQL.",
        userPrompt: "Исключи закрытые",
        projects: projects
    });

    assert.deepEqual(normalize(projects), ["EVOSCADA", "SDKU"]);
    assert.match(request.userPrompt, /Текущий JQL:\nproject = EVOSCADA/);
    assert.match(request.userPrompt, /Доступные проекты:\nEVOSCADA, SDKU/);
    assert.match(request.userPrompt, /Исключи закрытые/);
});

test("available project loader merges Jira projects with current calendar projects", async function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    assert.equal(typeof Timesheet.__test.fetchAvailableProjectKeys, "function");

    var requestOptions = null;
    var projects = await Timesheet.__test.fetchAvailableProjectKeys(function(options) {
        requestOptions = options;
        return Promise.resolve([
            { id: "10001", key: "EVOSCADA", name: "SCADA" },
            { id: "10002", key: "SDKU", name: "SDKU" },
            { id: "10003", key: "EVOSCADA", name: "duplicate" }
        ]);
    }, "https://jira.example/rest/api/2/project", ["CURRENT"]);

    assert.deepEqual(normalize(requestOptions), {
        url: "https://jira.example/rest/api/2/project",
        type: "GET"
    });
    assert.deepEqual(normalize(projects), ["CURRENT", "EVOSCADA", "SDKU"]);
});

test("available project loader falls back to current calendar projects on Jira error", async function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);

    var projects = await Timesheet.__test.fetchAvailableProjectKeys(function() {
        return Promise.reject(new Error("Jira unavailable"));
    }, "https://jira.example/rest/api/2/project", ["EVOSCADA"]);

    assert.deepEqual(normalize(projects), ["EVOSCADA"]);
});

test("available project loader falls back when Jira returns an unexpected payload", async function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);

    var projects = await Timesheet.__test.fetchAvailableProjectKeys(function() {
        return Promise.resolve({ values: [{ key: "IGNORED" }] });
    }, "https://jira.example/rest/api/2/project", ["EVOSCADA"]);

    assert.deepEqual(normalize(projects), ["EVOSCADA"]);
});

test("timesheet migrates legacy User Activity LLM settings to shared storage", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    var LlmClient = loadAmdModule(path.join(__dirname, "..", "ujg-shared-modules", "llm-client.js"), {});
    var values = {
        "ujg-ua-ai-report-config": JSON.stringify({
            apiBase: "https://llm.example/v1",
            model: "qwen",
            apiKey: "secret"
        })
    };
    var storage = {
        getItem: function(key) {
            return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
        },
        setItem: function(key, value) {
            values[key] = String(value);
        }
    };

    var config = Timesheet.__test.readTimesheetLlmConfig(storage, LlmClient);

    assert.equal(config.model, "qwen");
    assert.equal(JSON.parse(values["ujg-shared-llm-config"]).apiBase, "https://llm.example/v1");
});

test("getUserDropdownEntries always shows selected users above filtered matches", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);

    var entries = Timesheet.__test.getUserDropdownEntries({
        u3: "Charlie",
        u1: "Alice",
        u2: "Bob"
    }, ["u3"], "ali");

    assert.deepEqual(normalize(entries), [
        { id: "u3", name: "Charlie", selected: true },
        { id: "u1", name: "Alice", selected: false }
    ]);
});

test("countWorkDays counts only Mon-Fri", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    var days = [
        new Date(2026, 2, 2), // Mon
        new Date(2026, 2, 3), // Tue
        new Date(2026, 2, 4), // Wed
        new Date(2026, 2, 5), // Thu
        new Date(2026, 2, 6), // Fri
        new Date(2026, 2, 7), // Sat
        new Date(2026, 2, 8), // Sun
    ];
    assert.equal(Timesheet.__test.countWorkDays(days), 5);
    assert.equal(Timesheet.__test.countWorkDays([]), 0);
});

test("computeUserReport computes metrics correctly", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    var days = [
        new Date(2026, 2, 2), // Mon
        new Date(2026, 2, 3), // Tue
        new Date(2026, 2, 4), // Wed
        new Date(2026, 2, 5), // Thu
        new Date(2026, 2, 6), // Fri
    ];
    var calendarData = {
        "2026-03-02": [{
            key: "T-1", seconds: 28800,
            worklogs: [{ authorId: "u1", seconds: 28800, authorName: "User1" }],
            authors: { "u1": "User1" }
        }],
        "2026-03-03": [{
            key: "T-2", seconds: 14400,
            worklogs: [{ authorId: "u1", seconds: 14400, authorName: "User1" }],
            authors: { "u1": "User1" }
        }],
    };
    var result = Timesheet.__test.computeUserReport("u1", days, calendarData);
    assert.equal(result.workDays, 5);
    assert.equal(result.expectedSeconds, 5 * 8 * 3600);
    assert.equal(result.totalSeconds, 28800 + 14400);
    assert.equal(result.daysWorked, 2);
    assert.equal(result.taskCount, 2);
    assert.equal(result.deficit, (5 * 8 * 3600) - (28800 + 14400));
});

test("computeUserReport returns zero deficit when fully logged", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    var days = [new Date(2026, 2, 2)]; // Mon
    var calendarData = {
        "2026-03-02": [{
            key: "T-1", seconds: 28800,
            worklogs: [{ authorId: "u1", seconds: 28800, authorName: "User1" }],
            authors: { "u1": "User1" }
        }],
    };
    var result = Timesheet.__test.computeUserReport("u1", days, calendarData);
    assert.equal(result.deficit, 0);
    assert.equal(result.totalSeconds, 28800);
});

test("computeWeekSummary aggregates hours, projects, and issue types", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    var weekDays = [
        new Date(2026, 2, 2), // Mon
        new Date(2026, 2, 3), // Tue
        new Date(2026, 2, 4), // Wed
        new Date(2026, 2, 5), // Thu
        new Date(2026, 2, 6), // Fri
        null, // Sat placeholder
        null, // Sun placeholder
    ];
    var calendarData = {
        "2026-03-02": [
            { key: "PROJ-1", seconds: 14400, issueType: "Story", worklogs: [], authors: {} },
            { key: "PROJ-2", seconds: 7200, issueType: "Task", worklogs: [], authors: {} },
        ],
        "2026-03-03": [
            { key: "PROJ-1", seconds: 10800, issueType: "Story", worklogs: [], authors: {} },
            { key: "OTHER-5", seconds: 3600, issueType: "Bug", worklogs: [], authors: {} },
        ],
    };
    var result = Timesheet.__test.computeWeekSummary(weekDays, [], calendarData);
    assert.equal(result.totalSeconds, 14400 + 7200 + 10800 + 3600);
    assert.equal(result.expectedSeconds, 5 * 8 * 3600);
    assert.equal(result.workDays, 5);
    assert.equal(result.daysWorked, 2);
    assert.equal(result.taskCount, 3);
    assert.equal(result.projects["PROJ"], 14400 + 7200 + 10800);
    assert.equal(result.projects["OTHER"], 3600);
    assert.equal(result.issueTypes["Story"], 1); // PROJ-1 counted once
    assert.equal(result.issueTypes["Task"], 1);
    assert.equal(result.issueTypes["Bug"], 1);
});

test("computeMonthSummary adds utilization and project percentages", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    var days = [new Date(2026, 2, 2)]; // Mon
    var calendarData = {
        "2026-03-02": [
            { key: "A-1", seconds: 21600, issueType: "Story", worklogs: [], authors: {} },
            { key: "B-1", seconds: 7200, issueType: "Task", worklogs: [], authors: {} },
        ],
    };
    var result = Timesheet.__test.computeMonthSummary(days, [], calendarData);
    assert.equal(result.totalSeconds, 28800);
    assert.equal(result.expectedSeconds, 28800);
    assert.equal(result.utilization, 100);
    assert.equal(result.projectPcts["A"], 75);
    assert.equal(result.projectPcts["B"], 25);
});

test("mass worklog helpers select weekdays to create and existing self worklogs to update", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    assert.equal(typeof Timesheet.__test.buildMassWorklogPlan, "function");

    var plan = Timesheet.__test.buildMassWorklogPlan({
        issueKey: "EKTSM-857",
        seconds: 28800,
        currentUserId: "u1",
        startDate: "2026-03-02",
        endDate: "2026-03-10",
        comment: "Работа по задаче",
        calendarData: {
            "2026-03-02": [
                {
                    key: "EKTSM-857",
                    worklogs: [{ id: "w-1", authorId: "u1", seconds: 28800, comment: "Старый комментарий", started: "2026-03-02T10:00:00.000+0300" }]
                }
            ],
            "2026-03-03": [
                {
                    key: "OTHER-1",
                    worklogs: [{ authorId: "u1", seconds: 14400 }]
                }
            ],
            "2026-03-04": [
                {
                    key: "EKTSM-857",
                    worklogs: [{ authorId: "u2", seconds: 28800 }]
                }
            ]
        }
    });

    assert.deepEqual(normalize(plan.updateWorklogs), [
        {
            dayKey: "2026-03-02",
            worklogId: "w-1",
            started: "2026-03-02T10:00:00.000+0300",
            seconds: 28800,
            existingComment: "Старый комментарий"
        }
    ]);
    assert.deepEqual(normalize(plan.skipDates), []);
    assert.deepEqual(normalize(plan.dates), [
        "2026-03-03",
        "2026-03-04",
        "2026-03-05",
        "2026-03-06",
        "2026-03-09",
        "2026-03-10"
    ]);
});

test("mass worklog helpers skip existing self worklogs when requested comment is already set", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);

    var plan = Timesheet.__test.buildMassWorklogPlan({
        issueKey: "EKTSM-857",
        seconds: 28800,
        currentUserId: "u1",
        startDate: "2026-03-02",
        endDate: "2026-03-02",
        comment: "Уже такой",
        calendarData: {
            "2026-03-02": [
                {
                    key: "EKTSM-857",
                    worklogs: [{ id: "w-1", authorId: "u1", seconds: 28800, comment: "Уже такой" }]
                }
            ]
        }
    });

    assert.deepEqual(normalize(plan.dates), []);
    assert.deepEqual(normalize(plan.updateWorklogs), []);
    assert.deepEqual(normalize(plan.skipDates), ["2026-03-02"]);
});

test("mass worklog payload uses only the user supplied comment", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);

    var payload = Timesheet.__test.buildWorklogPayload("2026-03-06", 3600, "Комментарий пользователя");

    assert.equal(payload.comment, "Комментарий пользователя");
    assert.equal(payload.timeSpentSeconds, 3600);
    assert.match(payload.started, /^2026-03-06T09:00:00\.000[+-]\d{4}$/);
});

test("parseWorklogSeconds accepts hours and minutes for mass worklog form", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);

    assert.equal(Timesheet.__test.parseWorklogSeconds("8h"), 28800);
    assert.equal(Timesheet.__test.parseWorklogSeconds("7.5"), 27000);
    assert.equal(Timesheet.__test.parseWorklogSeconds("1h 30m"), 5400);
    assert.equal(Timesheet.__test.parseWorklogSeconds("45m"), 2700);
    assert.equal(Timesheet.__test.parseWorklogSeconds(""), 0);
});

test("mass worklog helpers normalize reversed date ranges and format Jira started timestamp", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);

    var plan = Timesheet.__test.buildMassWorklogPlan({
        issueKey: "EKTSM-857",
        seconds: 3600,
        currentUserId: "u1",
        startDate: "2026-03-08",
        endDate: "2026-03-06",
        calendarData: {}
    });

    assert.deepEqual(normalize(plan.dates), ["2026-03-06"]);
    assert.match(Timesheet.__test.formatJiraStarted("2026-03-06"), /^2026-03-06T09:00:00\.000[+-]\d{4}$/);
});

test("computeWeekSummary in group mode scales capacity by active users", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    var weekDays = [
        new Date(2026, 2, 2), // Mon
        new Date(2026, 2, 3), // Tue
        new Date(2026, 2, 4), // Wed
        new Date(2026, 2, 5), // Thu
        new Date(2026, 2, 6), // Fri
    ];
    var calendarData = {
        "2026-03-02": [{
            key: "TEAM-1",
            seconds: 57600,
            issueType: "Story",
            authors: { u1: "Alice", u2: "Bob" },
            worklogs: [
                { authorId: "u1", authorName: "Alice", seconds: 28800, comment: "" },
                { authorId: "u2", authorName: "Bob", seconds: 28800, comment: "" }
            ]
        }]
    };

    var result = Timesheet.__test.computeWeekSummary(weekDays, [], calendarData, { groupSummary: true });

    assert.equal(result.totalSeconds, 57600);
    assert.equal(result.activeUserCount, 2);
    assert.equal(result.expectedSeconds, 2 * 5 * 8 * 3600);
    assert.equal(result.utilization, 20);
});

test("computeMonthSummary in group mode reports active users instead of single-user norm", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    var days = [new Date(2026, 2, 2)]; // Mon
    var calendarData = {
        "2026-03-02": [{
            key: "TEAM-1",
            seconds: 57600,
            issueType: "Task",
            authors: { u1: "Alice", u2: "Bob" },
            worklogs: [
                { authorId: "u1", authorName: "Alice", seconds: 28800, comment: "" },
                { authorId: "u2", authorName: "Bob", seconds: 28800, comment: "" }
            ]
        }]
    };

    var result = Timesheet.__test.computeMonthSummary(days, [], calendarData, { groupSummary: true });

    assert.equal(result.activeUserCount, 2);
    assert.equal(result.expectedSeconds, 2 * 8 * 3600);
    assert.equal(result.utilization, 100);
    assert.match(Timesheet.__test.formatSummaryHeadline(result, true), /2/);
    assert.doesNotMatch(Timesheet.__test.formatSummaryHeadline(result, true), /\/\s*8h|\/\s*40h/i);
});

test("getWeekTransitions filters changelog entries by week date range", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    var weekDays = [
        new Date(2026, 2, 2), // Mon
        new Date(2026, 2, 3), // Tue
        null, null, null, null, null,
    ];
    var taskKeys = { "T-1": true, "T-2": true };
    var changelogData = {
        "T-1": [
            { date: "2026-03-02T10:00:00.000+0000", from: "Open", to: "In Progress" },
            { date: "2026-03-10T10:00:00.000+0000", from: "In Progress", to: "Done" },
        ],
        "T-2": [
            { date: "2026-03-03T14:00:00.000+0000", from: "Open", to: "Review" },
        ],
    };
    var result = normalize(Timesheet.__test.getWeekTransitions(weekDays, taskKeys, changelogData));
    assert.equal(result.length, 2);
    var t1 = result.find(function(r) { return r.key === "T-1"; });
    var t2 = result.find(function(r) { return r.key === "T-2"; });
    assert.ok(t1);
    assert.deepEqual(t1.changes, ["Open \u2192 In Progress"]);
    assert.ok(t2);
    assert.deepEqual(t2.changes, ["Open \u2192 Review"]);
});

test("getWeekTransitions carries issue summaries from changelog metadata", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    var weekDays = [
        new Date(2026, 2, 2),
        new Date(2026, 2, 3),
        null, null, null, null, null,
    ];
    var result = normalize(Timesheet.__test.getWeekTransitions(weekDays, { "T-1": true }, {
        "T-1": {
            summary: "Проработка требований",
            transitions: [
                { date: "2026-03-02T10:00:00.000+0000", from: "Open", to: "In Progress" }
            ]
        }
    }));

    assert.equal(result.length, 1);
    assert.equal(result[0].summary, "Проработка требований");
});

test("buildTransitionMassWorklogTemplate uses first workday and eight hours", function() {
    var Common = loadCommon();
    var Timesheet = loadTimesheet(Common);
    var template = Timesheet.__test.buildTransitionMassWorklogTemplate({
        key: "T-1",
        summary: "Проработка требований"
    }, [
        null,
        new Date(2026, 2, 7), // Sat
        new Date(2026, 2, 2), // Mon
        new Date(2026, 2, 3), // Tue
    ]);

    assert.deepEqual(normalize(template), {
        issueKey: "T-1",
        dayKey: "2026-03-02",
        seconds: 28800,
        summary: "Проработка требований"
    });
});
