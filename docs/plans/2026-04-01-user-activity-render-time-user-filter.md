# User Activity Render-Time User Filter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Добавить независимые `multi-select` фильтры по пользователю в календарь и в детализацию дня, сохранив текущий `hard-open` и не меняя pipeline данных.

**Architecture:** Сырые `dayMap`, `issueMap` и `repoItems` остаются без изменений. Один общий helper в `utils.js` отвечает только за author match. `unified-calendar.js` строит временный `visibleDayMap` для текущего repaint, а `daily-detail.js` строит временный `visibleActions` перед `issue/team` рендером. `repo-data-processor.js`, `data-processor.js` и `rendering.js` не трогаются.

**Tech Stack:** AMD `define()`, jQuery, inline CSS через `config.js`, `node:test`, сборка `build-user-activity.js`, генерация runtime/bootstrap через `build-widget-bootstrap-assets.js`.

**Design doc:** `docs/plans/2026-04-01-user-activity-render-time-user-filter-design.md`

---

### Task 1: Добавить общий render-time helper для author match

**Files:**
- Modify: `ujg-user-activity-modules/utils.js`
- Test: `tests/user-activity-repo.test.js`

**Step 1: Write the failing test**

В `tests/user-activity-repo.test.js` через уже существующий `loadUserActivityUtils(...)` добавить тест на мягкое сопоставление автора:

```js
test("user-activity utils matches author against selected users by known identity fields", function() {
    var utils = loadUserActivityUtils({
        location: { origin: "https://jira.example.com" },
        AJS: { params: { baseURL: "" } }
    });

    assert.equal(utils.matchesSelectedUsers(
        { accountId: "acc-1", displayName: "Alice Repo" },
        [{ accountId: "acc-1", name: "alice", displayName: "Alice Dev" }]
    ), true);

    assert.equal(utils.matchesSelectedUsers(
        { name: "bob", displayName: "Bob Dev" },
        [{ key: "alice", name: "alice", displayName: "Alice Dev" }]
    ), false);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/user-activity-repo.test.js --test-name-pattern="matches author against selected users"`

Expected: FAIL because `matchesSelectedUsers(...)` does not exist yet.

**Step 3: Add minimal helper**

В `ujg-user-activity-modules/utils.js` добавить небольшой helper с внутренней нормализацией токенов:

```js
function matchesSelectedUsers(userLike, selectedUsers) {
    var authorTokens = collectIdentityTokens(userLike);
    if (!authorTokens.length) return false;
    return (selectedUsers || []).some(function(user) {
        var userTokens = collectIdentityTokens(user);
        return userTokens.some(function(token) {
            return authorTokens.indexOf(token) >= 0;
        });
    });
}
```

Внутренний `collectIdentityTokens(...)` должен использовать только уже известные поля:

- `accountId`
- `key`
- `name`
- `userName`
- `displayName`

**Step 4: Export helper**

Добавить `matchesSelectedUsers` в `return` объекта `utils`.

**Step 5: Run test to verify it passes**

Run: `node --test tests/user-activity-repo.test.js --test-name-pattern="matches author against selected users"`

Expected: PASS.

**Step 6: Commit**

```bash
git add ujg-user-activity-modules/utils.js tests/user-activity-repo.test.js
git commit -m "feat(user-activity): add render-time author match helper"
```

---

### Task 2: Добавить render-time user filter в unified calendar

**Files:**
- Modify: `ujg-user-activity-modules/unified-calendar.js`
- Modify: `ujg-user-activity-modules/config.js`
- Test: `tests/user-activity-repo.test.js`

**Step 1: Write the failing tests**

Добавить два теста.

Первый проверяет сам toggle и сужение видимых строк:

```js
test("unified calendar render-time user filter hides disabled users without touching raw data", function() {
    var mod = loadUnifiedCalendar(createHtmlJqueryStub());
    var users = [
        { name: "alice", displayName: "Alice Dev" },
        { name: "bob", displayName: "Bob Dev" }
    ];
    var widget = mod.render({
        "2026-03-18": {
            totalHours: 3,
            users: {
                alice: { totalHours: 2 },
                bob: { totalHours: 1 }
            },
            allWorklogs: [
                { issueKey: "CAL-1", timestamp: "2026-03-18T09:00:00.000Z", author: { name: "alice", displayName: "Alice Dev" }, timeSpentHours: 2 },
                { issueKey: "CAL-2", timestamp: "2026-03-18T10:00:00.000Z", author: { name: "bob", displayName: "Bob Dev" }, timeSpentHours: 1 }
            ],
            allChanges: [],
            allComments: [],
            repoItems: [
                { type: "commit", timestamp: "2026-03-18T11:00:00.000Z", authorName: "Alice Dev", author: { name: "alice", displayName: "Alice Dev" }, message: "Alice commit" },
                { type: "commit", timestamp: "2026-03-18T12:00:00.000Z", authorName: "Bob Dev", author: { name: "bob", displayName: "Bob Dev" }, message: "Bob commit" }
            ]
        }
    }, {}, users, new Date("2026-03-17T00:00:00.000Z"), new Date("2026-03-23T23:59:59.000Z"));

    widget.$el.find('button[data-ua-cal-user-idx="1"]').trigger("click");

    var html = widget.$el.html();
    assert.match(html, /Alice Dev/);
    assert.doesNotMatch(html, /Bob Dev/);
    assert.match(html, />2ч</);
});
```

Второй фиксирует поведение `hard-open`: пока включены все, автор вне `selectedUsers` всё ещё виден.

**Step 2: Run tests to verify they fail**

Run: `node --test tests/user-activity-repo.test.js --test-name-pattern="unified calendar render-time user filter|hard-open.*while all users active"`

Expected: FAIL because calendar has no filter UI and no render-time visible model.

**Step 3: Add local calendar filter state**

В `unified-calendar.js` внутри `render(...)` добавить локальный state по индексам `selectedUsersRef`:

```js
var activeCalendarUserIndexes = selectedUsersRef.map(function(_, index) {
    return index;
});
```

Нужны маленькие helpers:

- `buildCalendarUserFilterHtml(selectedUsers, activeIndexes)`
- `toggleActiveUserIndex(activeIndexes, index)`
- `allSelectedUsersActive(selectedUsers, activeIndexes)`

Кнопки фильтра должны иметь атрибут:

```html
data-ua-cal-user-idx="0"
```

**Step 4: Build visible day map at repaint time**

Перед вызовом `buildCalendarInnerHtml(...)` собирать временный `visibleDayMap`.

Минимальный ориентир:

```js
function buildVisibleDayMap(dayMap, selectedUsers, activeIndexes) {
    if (allSelectedUsersActive(selectedUsers, activeIndexes)) return dayMap;
    return Object.keys(dayMap || {}).reduce(function(acc, dateKey) {
        acc[dateKey] = buildVisibleDayData(dayMap[dateKey], selectedUsers, activeIndexes);
        return acc;
    }, {});
}
```

`buildVisibleDayData(...)` должен:

- фильтровать `allWorklogs`, `allChanges`, `allComments`, `repoItems`;
- сужать `users` до активных dashboard users;
- пересчитывать `totalHours` только по видимым worklog.

Для фильтра автора использовать только `utils.matchesSelectedUsers(...)`.

**Step 5: Bind calendar filter clicks**

Добавить обработчик:

```js
$el.on("click", "button[data-ua-cal-user-idx]", function() {
    var index = Number($(this).attr("data-ua-cal-user-idx"));
    activeCalendarUserIndexes = toggleActiveUserIndex(activeCalendarUserIndexes, index);
    repaint();
});
```

Не трогай `onSelectDate(...)` и current raw state календаря.

**Step 6: Add minimal styles**

В `config.js` добавить или переиспользовать стили панели фильтра:

- `.ujg-ua-cal-user-filter-bar`
- `.ujg-ua-cal-user-filter`
- `.ujg-ua-cal-user-filter-on`
- `.ujg-ua-cal-user-filter-off`

Без отдельного layout-компонента и без dropdown.

**Step 7: Run tests to verify they pass**

Run: `node --test tests/user-activity-repo.test.js --test-name-pattern="unified calendar render-time user filter|hard-open.*while all users active"`

Expected: PASS.

**Step 8: Commit**

```bash
git add ujg-user-activity-modules/unified-calendar.js ujg-user-activity-modules/config.js tests/user-activity-repo.test.js
git commit -m "feat(user-activity): add calendar render-time user filter"
```

---

### Task 3: Добавить независимый render-time user filter в day detail

**Files:**
- Modify: `ujg-user-activity-modules/daily-detail.js`
- Modify: `ujg-user-activity-modules/config.js`
- Test: `tests/user-activity-repo.test.js`

**Step 1: Write the failing tests**

Добавить тест на `issue view`:

```js
test("day detail render-time user filter narrows issue and repo sections independently", function() {
    var stub = createDayDetailInteractiveStub();
    var panel = loadDailyDetail(function(s) { return stub.$(s); }).create();
    var users = [
        { name: "alice", displayName: "Alice Dev" },
        { name: "bob", displayName: "Bob Dev" }
    ];

    panel.show("2026-03-18", {
        allWorklogs: [
            { issueKey: "DET-1", timestamp: "2026-03-18T09:00:00.000Z", author: { name: "alice", displayName: "Alice Dev" }, timeSpentHours: 1 },
            { issueKey: "DET-2", timestamp: "2026-03-18T10:00:00.000Z", author: { name: "bob", displayName: "Bob Dev" }, timeSpentHours: 1 }
        ],
        allChanges: [],
        allComments: [],
        repoItems: [
            { type: "commit", timestamp: "2026-03-18T11:00:00.000Z", authorMeta: { name: "alice", displayName: "Alice Dev" }, message: "Alice repo" },
            { type: "commit", timestamp: "2026-03-18T12:00:00.000Z", authorMeta: { name: "bob", displayName: "Bob Dev" }, message: "Bob repo" }
        ]
    }, {}, users);

    stub.$('button[data-ua-detail-user-idx="1"]').trigger("click");

    var html = stub.getHtml();
    assert.match(html, /Alice Dev/);
    assert.doesNotMatch(html, /Bob Dev/);
});
```

И отдельный тест на `team view`: после сужения должны остаться только колонки авторов из видимых действий.

**Step 2: Run tests to verify they fail**

Run: `node --test tests/user-activity-repo.test.js --test-name-pattern="day detail render-time user filter|team view.*visible actions"`

Expected: FAIL because `day detail` still renders all actions and has no independent filter UI.

**Step 3: Add independent day-detail filter state**

В `create()` рядом с `currentMode` добавить локальный state фильтра:

```js
var activeDetailUserIndexes = [];
```

При первом `show(...)` и при изменении состава `selectedUsers` инициализировать этот state как «все включены».

**Step 4: Render day-detail filter UI**

Рядом с `renderModeToggle(mode)` вывести строку кнопок по `selectedUsers` с атрибутом:

```html
data-ua-detail-user-idx="0"
```

Использовать те же классы из `config.js`, что и в календаре.

**Step 5: Filter normalized actions before all downstream renderers**

После `normalizeDayActions(dayData, issueMap)` собрать `visibleActions`:

```js
var visibleActions = filterActionsForRender(normalized, selectedUsers, activeDetailUserIndexes);
```

Контракт `filterActionsForRender(...)`:

- если активны все пользователи, вернуть `normalized` как есть;
- если никто не активен, вернуть `[]`;
- иначе оставить только actions, для которых `utils.matchesSelectedUsers(action.author, activeUsers)` вернёт `true`.

Дальше:

- `issue view` использует только `visibleActions`;
- `team view` вызывает `buildTimelineModel(visibleActions, [], date)`;
- `renderRepoDaySections(...)` получает только `visibleRepoActions`.

Не возвращай старый `selectedUsers`-based filter внутрь `buildTimelineModel(...)`.

**Step 6: Bind day-detail filter clicks**

Добавить обработчик:

```js
$el.find('button[data-ua-detail-user-idx]').on("click", function() {
    var index = Number($(this).attr("data-ua-detail-user-idx"));
    activeDetailUserIndexes = toggleActiveUserIndex(activeDetailUserIndexes, index);
    rerender();
});
```

Режим `По задачам / По команде` должен продолжать жить независимо от user filter.

**Step 7: Run tests to verify they pass**

Run: `node --test tests/user-activity-repo.test.js --test-name-pattern="day detail render-time user filter|team view.*visible actions"`

Expected: PASS.

**Step 8: Commit**

```bash
git add ujg-user-activity-modules/daily-detail.js ujg-user-activity-modules/config.js tests/user-activity-repo.test.js
git commit -m "feat(user-activity): add day detail render-time user filter"
```

---

### Task 4: Пересобрать bundle/runtime и прогнать релевантную проверку

**Files:**
- Modify: `ujg-user-activity.js`
- Modify: `ujg-user-activity.runtime.js`
- Modify: `ujg-user-activity.bootstrap.js`
- Modify: `ujg-project-analytics.bootstrap.js`
- Modify: `ujg-sprint-health.bootstrap.js`
- Modify: `ujg-story-browser.bootstrap.js`
- Modify: `ujg-timesheet.bootstrap.js`
- Modify: `ujg-timesheet.v0.bootstrap.js`
- Test: `tests/user-activity-repo.test.js`
- Test: `tests/widget-bootstrap.test.js`

**Step 1: Run focused source tests**

Run: `node --test tests/user-activity-repo.test.js --test-name-pattern="matches author against selected users|render-time user filter|hard-open.*while all users active"`

Expected: PASS.

**Step 2: Rebuild user-activity bundle**

Run: `node build-user-activity.js`

Expected: `ujg-user-activity.js` rebuilt without errors.

**Step 3: Verify rebuilt source bundle**

Run: `node --test tests/user-activity-repo.test.js`

Expected: PASS.

**Step 4: Sync runtime/bootstrap assets**

Run: `node build-widget-bootstrap-assets.js`

Expected:

- `ujg-user-activity.runtime.js` updated;
- `ujg-user-activity.bootstrap.js` updated;
- generator may also touch other `*.bootstrap.js`.

**Step 5: Run bootstrap verification**

Run: `node --test tests/widget-bootstrap.test.js`

Expected: PASS.

**Step 6: Check final file set**

Run: `git status --short`

Expected: changed only expected source, test, bundle, runtime and bootstrap files.

**Step 7: Commit**

```bash
git add ujg-user-activity-modules/utils.js \
        ujg-user-activity-modules/unified-calendar.js \
        ujg-user-activity-modules/daily-detail.js \
        ujg-user-activity-modules/config.js \
        tests/user-activity-repo.test.js \
        ujg-user-activity.js \
        ujg-user-activity.runtime.js \
        ujg-user-activity.bootstrap.js \
        ujg-project-analytics.bootstrap.js \
        ujg-sprint-health.bootstrap.js \
        ujg-story-browser.bootstrap.js \
        ujg-timesheet.bootstrap.js \
        ujg-timesheet.v0.bootstrap.js
git commit -m "feat(user-activity): add render-time user filters"
```
