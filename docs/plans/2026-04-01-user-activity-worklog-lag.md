# User Activity Worklog Lag Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Показать в User Activity, за какой день был списан worklog, отмечать позднее внесение и агрегировать суммарное отставание по пользователям за период и по неделям.

**Architecture:** `api.js` уже получает Jira worklog payload, поэтому новый fetch не нужен. Нужно сохранить `worklog.created` в processor, посчитать lag-метрики на уровне worklog, затем использовать их в `daily-detail.js`, `unified-calendar.js` и `summary-cards.js`. Недельная мини-таблица в календаре должна считаться из уже видимых worklog, чтобы автоматически уважать render-time user filter.

**Tech Stack:** AMD `define()`, jQuery, inline CSS через `config.js`, `node:test`, сборка `build-user-activity.js`, генерация runtime/bootstrap через `build-widget-bootstrap-assets.js`.

**Design doc:** `docs/plans/2026-04-01-user-activity-worklog-lag-design.md`

**Git rule for this repo:** не создавать commit, пока пользователь явно не попросит.

---

### Task 1: Сохранить `worklog.created` и посчитать lag-метрики в processor

**Files:**
- Modify: `ujg-user-activity-modules/utils.js`
- Modify: `ujg-user-activity-modules/data-processor.js`
- Test: `tests/user-activity-repo.test.js`

**Step 1: Write the failing tests**

В `tests/user-activity-repo.test.js` добавить два теста.

Первый на helper расчёта:

```js
test("user-activity utils: computes worklog lag score from started and created", function() {
    var utils = loadUserActivityUtils({
        location: { origin: "https://jira.example.com" },
        AJS: { params: { baseURL: "" } }
    });

    var meta = utils.getWorklogLagMeta("2026-04-25T09:00:00", "2026-04-26T08:00:00", 4);

    assert.equal(meta.workedDayKey, "2026-04-25");
    assert.equal(meta.isLate, true);
    assert.equal(Math.round(meta.lagDurationHoursRaw * 10) / 10, 8);
    assert.equal(Math.round(meta.lagScoreHours * 100) / 100, 1.33);
});
```

Второй на processor:

```js
test("user activity data processor preserves worklog created timestamp and lag fields", function() {
    var mod = loadUserActivityDataProcessor();
    var rawData = {
        issues: [{ key: "CORE-1", fields: { summary: "Lag task", issuetype: { name: "Task" }, status: { name: "In Progress" }, project: { key: "CORE", name: "Core" } } }],
        details: {
            "CORE-1": {
                worklogs: [{
                    started: "2026-04-25T09:00:00",
                    created: "2026-04-26T08:00:00",
                    timeSpentSeconds: 14400,
                    comment: "late log",
                    author: { name: "u1", displayName: "Ivan Ivanov" }
                }],
                changelog: []
            }
        }
    };

    var single = mod.processData(rawData, "u1", "2026-04-24", "2026-04-30");
    var wl = single.dayMap["2026-04-25"].worklogs[0];

    assert.equal(wl.created, "2026-04-26T08:00:00");
    assert.equal(wl.loggedAt, "2026-04-26T08:00:00");
    assert.equal(wl.workedDayKey, "2026-04-25");
    assert.equal(wl.isLate, true);
    assert.equal(Math.round(wl.lagScoreHours * 100) / 100, 1.33);
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test tests/user-activity-repo.test.js --test-name-pattern="worklog lag|created timestamp and lag fields"`

Expected: FAIL because helper and processor fields do not exist yet.

**Step 3: Write minimal implementation**

В `ujg-user-activity-modules/utils.js` добавить два маленьких helper:

```js
function getWorklogLagMeta(started, created, spentHours) {
    var startedDt = parseDate(started);
    var createdDt = parseDate(created);
    var workedDayKey = startedDt ? getDayKey(startedDt) : "";
    if (!startedDt || !createdDt) {
        return { workedDayKey: workedDayKey, loggedAt: created || "", isLate: false, lagDurationHoursRaw: 0, lagScoreHours: 0 };
    }
    var createdDayKey = getDayKey(createdDt);
    if (createdDayKey === workedDayKey) {
        return { workedDayKey: workedDayKey, loggedAt: created, isLate: false, lagDurationHoursRaw: 0, lagScoreHours: 0 };
    }
    var workedDayBoundary = new Date(workedDayKey + "T00:00:00");
    workedDayBoundary.setDate(workedDayBoundary.getDate() + 1);
    var lagDurationHoursRaw = Math.max(0, (createdDt.getTime() - workedDayBoundary.getTime()) / 3600000);
    return {
        workedDayKey: workedDayKey,
        loggedAt: created,
        isLate: lagDurationHoursRaw > 0,
        lagDurationHoursRaw: lagDurationHoursRaw,
        lagScoreHours: lagDurationHoursRaw * (Number(spentHours || 0) / 24)
    };
}
```

И helper форматирования для UI:

```js
function formatLagDurationHours(hours) {
    var total = Math.max(0, Number(hours || 0));
    var days = Math.floor(total / 24);
    var restHours = Math.floor(total - days * 24);
    if (days <= 0) return restHours + "ч";
    if (restHours <= 0) return days + "д";
    return days + "д " + restHours + "ч";
}
```

В `ujg-user-activity-modules/data-processor.js`:

- при создании `wlEntry` сохранить `created`;
- вызвать `utils.getWorklogLagMeta(...)`;
- скопировать в `wlEntry`:
  - `loggedAt`
  - `workedDayKey`
  - `isLate`
  - `lagDurationHoursRaw`
  - `lagScoreHours`
- в `processMultiUserData(...)` перенести эти поля при копировании `wlCopy`.

**Step 4: Export helpers**

Добавить в экспорт `utils`:

- `getWorklogLagMeta`
- `formatLagDurationHours`

**Step 5: Run tests to verify they pass**

Run: `node --test tests/user-activity-repo.test.js --test-name-pattern="worklog lag|created timestamp and lag fields"`

Expected: PASS.

**Step 6: Commit**

Не коммить без явного запроса пользователя. Если позже попросят commit, stage only:

```bash
git add ujg-user-activity-modules/utils.js ujg-user-activity-modules/data-processor.js tests/user-activity-repo.test.js
```

---

### Task 2: Показать late worklog в детализации дня и в календаре

**Files:**
- Modify: `ujg-user-activity-modules/daily-detail.js`
- Modify: `ujg-user-activity-modules/unified-calendar.js`
- Modify: `ujg-user-activity-modules/config.js`
- Test: `tests/user-activity-repo.test.js`

**Step 1: Write the failing tests**

Добавить тест на `daily-detail.js`:

```js
test("day detail worklog shows worked day loggedAt and late marker", function() {
    var html = "";
    var $stub = function() {
        return {
            html: function(v) { if (v !== undefined) html = String(v); return this; },
            slideDown: function() { return this; },
            slideUp: function() { return this; },
            find: function() { return { on: function() {} }; }
        };
    };
    loadDailyDetail($stub).create().show("2026-04-02", {
        worklogs: [{
            issueKey: "LAG-1",
            timestamp: "2026-04-02T09:00:00",
            started: "2026-04-02T09:00:00",
            created: "2026-04-03T08:00:00",
            workedDayKey: "2026-04-02",
            loggedAt: "2026-04-03T08:00:00",
            isLate: true,
            lagDurationHoursRaw: 8,
            lagScoreHours: 1.33,
            author: { displayName: "Ivan Ivanov" },
            timeSpentHours: 4
        }]
    }, {
        "LAG-1": { key: "LAG-1", summary: "Lag task", status: "In Progress" }
    }, []);

    assert.match(html, /Worklog 4ч/);
    assert.match(html, /за 02\.04/);
    assert.match(html, /внесено 03\.04 08:00/);
    assert.match(html, /отставание 8ч/);
});
```

И тест на календарь:

```js
test("unified calendar worklog shows late marker for not same-day logging", function() {
    var mod = loadUnifiedCalendar(createHtmlJqueryStub());
    var out = mod.render({
        "2026-04-02": {
            totalHours: 4,
            users: { u1: { totalHours: 4 } },
            allWorklogs: [{
                issueKey: "LAG-1",
                timestamp: "2026-04-02T09:00:00",
                started: "2026-04-02T09:00:00",
                created: "2026-04-03T08:00:00",
                workedDayKey: "2026-04-02",
                loggedAt: "2026-04-03T08:00:00",
                isLate: true,
                lagDurationHoursRaw: 8,
                lagScoreHours: 1.33,
                author: { name: "u1", displayName: "Ivan Ivanov" },
                timeSpentHours: 4
            }],
            allChanges: [],
            allComments: [],
            repoItems: []
        }
    }, {
        "LAG-1": { key: "LAG-1", summary: "Lag task", status: "In Progress" }
    }, [{ name: "u1", displayName: "Ivan Ivanov" }], new Date("2026-03-30T00:00:00.000Z"), new Date("2026-04-05T23:59:59.000Z"));

    var html = out.$el.html();
    assert.match(html, /за 02\.04/);
    assert.match(html, /внесено 03\.04 08:00/);
    assert.match(html, /отставание 8ч/);
    assert.match(html, /ujg-ua-worklog-late/);
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test tests/user-activity-repo.test.js --test-name-pattern="late marker|worked day loggedAt"`

Expected: FAIL because UI does not render lag metadata yet.

**Step 3: Write minimal implementation**

В `daily-detail.js` для `case "worklog"` добавить компактный secondary block:

```js
html += "Worklog " + h + "ч";
if (action.workedDayKey) html += ' <span class="ujg-ua-worklog-day">за ' + utils.escapeHtml(utils.formatDayMonth(action.workedDayKey)) + "</span>";
if (action.isLate) {
    html += ' <span class="ujg-ua-worklog-late">внесено ' + utils.escapeHtml(utils.formatDayMonthTime(action.loggedAt)) + "</span>";
    html += ' <span class="ujg-ua-worklog-late">отставание ' + utils.escapeHtml(utils.formatLagDurationHours(action.lagDurationHoursRaw)) + "</span>";
}
```

В `unified-calendar.js` для Jira worklog line добавить те же late fragments после `Worklog Xч`.

В `utils.js` добавить два маленьких format-helper:

- `formatDayMonth("2026-04-02") -> "02.04"`
- `formatDayMonthTime("2026-04-03T08:00:00") -> "03.04 08:00"`

В `config.js` добавить только минимальные стили:

- `.ujg-ua-worklog-day`
- `.ujg-ua-worklog-late`

Late badge должен быть warning-style, но без перестройки layout.

**Step 4: Run tests to verify they pass**

Run: `node --test tests/user-activity-repo.test.js --test-name-pattern="late marker|worked day loggedAt"`

Expected: PASS.

**Step 5: Commit**

Не коммить без явного запроса пользователя. Если позже попросят commit, stage only:

```bash
git add ujg-user-activity-modules/utils.js ujg-user-activity-modules/daily-detail.js ujg-user-activity-modules/unified-calendar.js ujg-user-activity-modules/config.js tests/user-activity-repo.test.js
```

---

### Task 3: Добавить агрегированное отставание в верхнюю таблицу и в недельную mini-table календаря

**Files:**
- Modify: `ujg-user-activity-modules/data-processor.js`
- Modify: `ujg-user-activity-modules/summary-cards.js`
- Modify: `ujg-user-activity-modules/unified-calendar.js`
- Test: `tests/user-activity-repo.test.js`

**Step 1: Write the failing tests**

Добавить тест на aggregation:

```js
test("user activity multi-user stats sums lagScoreHours per user", function() {
    var mod = loadUserActivityDataProcessor();
    var data = mod.processMultiUserData([
        {
            user: { name: "u1", displayName: "Ivan Ivanov" },
            rawData: {
                issues: [{ key: "LAG-1", fields: { summary: "Lag task", issuetype: { name: "Task" }, status: { name: "In Progress" }, project: { key: "CORE", name: "Core" } } }],
                details: {
                    "LAG-1": {
                        worklogs: [{
                            started: "2026-04-25T09:00:00",
                            created: "2026-04-26T08:00:00",
                            timeSpentSeconds: 14400,
                            author: { name: "u1", displayName: "Ivan Ivanov" }
                        }],
                        changelog: []
                    }
                }
            },
            comments: {}
        }
    ], "2026-04-24", "2026-04-30");

    assert.equal(Math.round(data.stats.userStats.u1.lagScoreHours * 100) / 100, 1.33);
});
```

И тест на календарную weekly mini-table:

```js
test("unified calendar weekly lag table shows per-user lag totals", function() {
    var mod = loadUnifiedCalendar(createHtmlJqueryStub());
    var html = mod.render(/* week with late worklogs for two users */).$el.html();

    assert.match(html, /Суммарное отставание/);
    assert.match(html, /Ivan Ivanov/);
    assert.match(html, /1\.3ч/);
});
```

Если понадобится, в тестовом файле добавь минимальный loader для `summary-cards.js` и отдельный test на колонку `Отставание`.

**Step 2: Run tests to verify they fail**

Run: `node --test tests/user-activity-repo.test.js --test-name-pattern="lagScoreHours|weekly lag table|Отставание"`

Expected: FAIL because aggregation and calendar summary do not exist yet.

**Step 3: Write minimal implementation**

В `data-processor.js`:

- при создании `userStats[username]` добавить `lagScoreHours: 0`;
- во время копирования worklog из `srcDay.worklogs` суммировать `w.lagScoreHours || 0`;
- в конце округлить `userStats[un].lagScoreHours` до 2 знаков.

В `summary-cards.js`:

- добавить колонку `Отставание`;
- рендерить её через тот же numeric format, что и `Часы`, но с двумя знаками после запятой при необходимости.

В `unified-calendar.js`:

- из уже построенного `visibleDayMap` собрать weekly lag totals по пользователям;
- построить helper вида:

```js
function buildWeeklyLagTableHtml(weekDates, visibleDayMap, selectedUsers, activeFlags) {
    // sum worklog.lagScoreHours by selected user
}
```

- вставить этот блок в правую `Σ`-ячейку под недельной суммой часов;
- если в неделе нет late worklog, не показывать пустую таблицу.

Важно: weekly lag table должна использовать только `visibleDayMap`, а не сырой `dayMap`, иначе фильтр календаря и weekly lag разойдутся.

**Step 4: Run tests to verify they pass**

Run: `node --test tests/user-activity-repo.test.js --test-name-pattern="lagScoreHours|weekly lag table|Отставание"`

Expected: PASS.

**Step 5: Commit**

Не коммить без явного запроса пользователя. Если позже попросят commit, stage only:

```bash
git add ujg-user-activity-modules/data-processor.js ujg-user-activity-modules/summary-cards.js ujg-user-activity-modules/unified-calendar.js tests/user-activity-repo.test.js
```

---

### Task 4: Пересобрать bundle и выполнить полную верификацию

**Files:**
- Modify: `ujg-user-activity.js`
- Modify: `ujg-user-activity.runtime.js`
- Modify: `ujg-user-activity.bootstrap.js`
- Modify: `ujg-*.bootstrap.js` после общего rebuild

**Step 1: Run focused tests**

Run:

```bash
node --test tests/user-activity-repo.test.js
```

Expected: PASS, `0 fail`.

**Step 2: Rebuild artifacts**

Run:

```bash
node build-user-activity.js
node build-widget-bootstrap-assets.js
```

Expected: exit `0`, обновлены committed artifacts.

**Step 3: Run bootstrap regression**

Run:

```bash
node --test tests/widget-bootstrap.test.js
```

Expected: PASS, `0 fail`.

**Step 4: Check diagnostics**

Run IDE diagnostics for changed files and fix any new lint errors.

Expected: no new errors in:

- `ujg-user-activity-modules/utils.js`
- `ujg-user-activity-modules/data-processor.js`
- `ujg-user-activity-modules/daily-detail.js`
- `ujg-user-activity-modules/unified-calendar.js`
- `ujg-user-activity-modules/summary-cards.js`
- `ujg-user-activity-modules/config.js`
- `tests/user-activity-repo.test.js`

**Step 5: Commit**

Не коммить без явного запроса пользователя. Если позже попросят commit, stage only:

```bash
git add ujg-user-activity-modules/utils.js ujg-user-activity-modules/data-processor.js ujg-user-activity-modules/daily-detail.js ujg-user-activity-modules/unified-calendar.js ujg-user-activity-modules/summary-cards.js ujg-user-activity-modules/config.js tests/user-activity-repo.test.js ujg-user-activity.js ujg-user-activity.runtime.js ujg-user-activity.bootstrap.js
```
