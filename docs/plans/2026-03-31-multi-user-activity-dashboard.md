# Multi-User Activity Dashboard — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Расширить дашборд активности для работы с несколькими пользователями — мультиселект, объединённый календарь, таймстемпы, подсветка отсутствия трудозатрат.

**Architecture:** Параллельная загрузка данных по пользователям через существующий `api.fetchAllData()`. Мультипользовательский `dayMap` с разбивкой по авторам. Объединённый календарь Jira+Repo с двухпроходным рендером для выравнивания границы блоков. Все действия содержат реальные таймстемпы и авторов из API.

**Tech Stack:** jQuery, AMD/define(), AUI (Atlassian UI), Jira REST API v2, конкатенационная сборка через `build-user-activity.js`.

**Design doc:** `docs/plans/2026-03-31-multi-user-activity-dashboard-design.md`

---

### Task 1: Создать multi-user-picker.js

**Files:**
- Create: `ujg-user-activity-modules/multi-user-picker.js`
- Delete reference: `ujg-user-activity-modules/user-picker.js` (оставить файл, убрать из MODULE_ORDER позже)

**Step 1: Создать модуль multi-user-picker.js**

Новый AMD-модуль `_ujgUA_multiUserPicker` с API:
```javascript
define("_ujgUA_multiUserPicker", ["jquery", "_ujgUA_config", "_ujgUA_api"], function($, config, api) {
    // ...
    return {
        create: function($container, onChange) { ... },
        getSelectedUsers: function() { ... },
        setFromUrl: function(urlParams) { ... }
    };
});
```

Использовать `api.searchUsers(query)` для поиска (уже есть в `api.js`).

Состояние модуля:
```javascript
var selectedUsers = [];  // [{ name, displayName, key }]
var searchResults = [];
```

UI-элементы:
- `$triggerBtn` — AUI-кнопка, текст: «0 пользователей» / «Иванов И.» / «N выбрано»
- `$panel` — выпадающая панель (position: absolute, z-index: 1000)
  - `$searchInput` — `<input type="search" placeholder="Поиск пользователей...">`
  - `$selectedChips` — блок чипов: `<span class="ujg-ua-user-chip">Иванов <button class="ujg-ua-chip-remove">×</button></span>`
  - `$resultsList` — результаты поиска: `<label><input type="checkbox"> Иванов И.И.</label>`
  - `$clearBtn` — «Сбросить всех»

Поведение:
- Клик на `$triggerBtn` → toggle `$panel`
- Input в `$searchInput` → debounce 300ms → `api.searchUsers(query)` → рендер `$resultsList`
- Чекбокс в результатах → добавить/убрать из `selectedUsers` → обновить чипы → вызвать `onChange(selectedUsers)`
- Крестик на чипе → убрать из `selectedUsers` → обновить UI → `onChange(selectedUsers)`
- Клик снаружи → скрыть `$panel`
- URL: при `setFromUrl` — парсить `users=name1,name2`, искать через API по именам и добавить в selectedUsers

**Step 2: Добавить CSS-стили в config.js**

В `CONFIG` или отдельным блоком стилей добавить:
```css
.ujg-ua-multi-picker { position: relative; display: inline-block; }
.ujg-ua-picker-panel { position: absolute; top: 100%; left: 0; z-index: 1000; background: #fff; border: 1px solid #ccc; border-radius: 3px; box-shadow: 0 2px 8px rgba(0,0,0,.15); min-width: 280px; max-height: 400px; overflow-y: auto; }
.ujg-ua-user-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; margin: 2px; background: #deebff; border-radius: 12px; font-size: 12px; }
.ujg-ua-chip-remove { border: none; background: none; cursor: pointer; font-size: 14px; color: #666; padding: 0 2px; }
.ujg-ua-picker-search { width: 100%; padding: 6px 8px; border: none; border-bottom: 1px solid #eee; }
.ujg-ua-picker-results label { display: block; padding: 4px 8px; cursor: pointer; }
.ujg-ua-picker-results label:hover { background: #f4f5f7; }
```

**Step 3: Commit**

```bash
git add ujg-user-activity-modules/multi-user-picker.js
git commit -m "feat(user-activity): add multi-user-picker component"
```

---

### Task 2: Обновить api.js — добавить fetchIssueComments

**Files:**
- Modify: `ujg-user-activity-modules/api.js`

**Step 1: Добавить функцию fetchIssueComments**

После существующих функций в `api.js` добавить:
```javascript
function fetchIssueComments(issueKeys, onProgress) {
    var results = {};
    var completed = 0;
    var deferred = $.Deferred();

    if (!issueKeys || issueKeys.length === 0) {
        deferred.resolve(results);
        return deferred.promise();
    }

    var queue = issueKeys.slice();
    var maxConcurrent = CONFIG.maxConcurrent || 5;
    var running = 0;

    function processNext() {
        while (running < maxConcurrent && queue.length > 0) {
            var key = queue.shift();
            running++;
            (function(issueKey) {
                $.ajax({
                    url: baseUrl + "/rest/api/2/issue/" + issueKey + "/comment",
                    type: "GET",
                    dataType: "json"
                }).done(function(data) {
                    results[issueKey] = (data.comments || []).map(function(c) {
                        return {
                            id: c.id,
                            author: {
                                name: c.author.name || c.author.key,
                                displayName: c.author.displayName
                            },
                            body: c.body,
                            created: c.created,
                            updated: c.updated
                        };
                    });
                }).fail(function() {
                    results[issueKey] = [];
                }).always(function() {
                    running--;
                    completed++;
                    if (onProgress) onProgress(completed, issueKeys.length);
                    if (queue.length > 0) {
                        processNext();
                    } else if (running === 0) {
                        deferred.resolve(results);
                    }
                });
            })(key);
        }
    }

    processNext();
    return deferred.promise();
}
```

**Step 2: Экспортировать функцию**

В `return` объекте модуля добавить `fetchIssueComments: fetchIssueComments`.

**Step 3: Commit**

```bash
git add ujg-user-activity-modules/api.js
git commit -m "feat(user-activity): add fetchIssueComments API method"
```

---

### Task 3: Обновить data-processor.js — мультипользовательский dayMap

**Files:**
- Modify: `ujg-user-activity-modules/data-processor.js`

**Step 1: Добавить функцию processMultiUserData**

Новая функция принимает массив `{ username, rawData, comments }` и возвращает мультипользовательский `dayMap`:

```javascript
function processMultiUserData(usersData, startDate, endDate) {
    var dayMap = {};
    var issueMap = {};
    var projectMap = {};
    var stats = { totalHours: 0, totalIssues: 0, activeDays: 0, userStats: {} };

    usersData.forEach(function(userData) {
        var username = userData.username;
        var singleResult = processData(userData.rawData, username, startDate, endDate);

        // Merge issueMap
        Object.keys(singleResult.issueMap).forEach(function(key) {
            if (!issueMap[key]) {
                issueMap[key] = singleResult.issueMap[key];
            }
        });

        // Merge projectMap
        Object.keys(singleResult.projectMap || {}).forEach(function(pkey) {
            if (!projectMap[pkey]) projectMap[pkey] = { totalHours: 0, issues: [] };
            projectMap[pkey].totalHours += (singleResult.projectMap[pkey].totalHours || 0);
        });

        // Build per-user dayMap entries
        Object.keys(singleResult.dayMap).forEach(function(dateKey) {
            if (!dayMap[dateKey]) {
                dayMap[dateKey] = {
                    users: {},
                    allWorklogs: [],
                    allChanges: [],
                    allComments: [],
                    totalHours: 0,
                    repoItems: []
                };
            }
            var src = singleResult.dayMap[dateKey];
            dayMap[dateKey].users[username] = {
                worklogs: (src.worklogs || []).map(function(w) {
                    w.author = { name: username, displayName: userData.displayName };
                    w.timestamp = w.started || w.date;
                    return w;
                }),
                changes: (src.changes || []).map(function(c) {
                    c.author = c.author || { name: username, displayName: userData.displayName };
                    c.timestamp = c.created || c.date;
                    return c;
                }),
                comments: [],
                totalHours: src.totalHours || 0
            };

            dayMap[dateKey].allWorklogs = dayMap[dateKey].allWorklogs.concat(
                dayMap[dateKey].users[username].worklogs
            );
            dayMap[dateKey].allChanges = dayMap[dateKey].allChanges.concat(
                dayMap[dateKey].users[username].changes
            );
            dayMap[dateKey].totalHours += (src.totalHours || 0);
        });

        stats.userStats[username] = {
            displayName: userData.displayName,
            totalHours: singleResult.stats.totalHours,
            activeDays: singleResult.stats.activeDays,
            daysWithoutWorklogs: 0
        };
        stats.totalHours += singleResult.stats.totalHours;
    });

    // Merge comments into dayMap
    usersData.forEach(function(userData) {
        if (!userData.comments) return;
        Object.keys(userData.comments).forEach(function(issueKey) {
            (userData.comments[issueKey] || []).forEach(function(comment) {
                if (comment.author.name.toLowerCase() !== userData.username.toLowerCase()) return;
                var dateKey = comment.created ? comment.created.substring(0, 10) : null;
                if (!dateKey || !dayMap[dateKey]) return;
                var entry = {
                    issueKey: issueKey,
                    author: comment.author,
                    body: comment.body,
                    timestamp: comment.created,
                    type: "comment"
                };
                if (dayMap[dateKey].users[userData.username]) {
                    dayMap[dateKey].users[userData.username].comments.push(entry);
                }
                dayMap[dateKey].allComments.push(entry);
            });
        });
    });

    // Sort all arrays by timestamp
    Object.keys(dayMap).forEach(function(dateKey) {
        var day = dayMap[dateKey];
        day.allWorklogs.sort(byTimestamp);
        day.allChanges.sort(byTimestamp);
        day.allComments.sort(byTimestamp);
    });

    // Calculate daysWithoutWorklogs per user
    var allWorkdays = getWorkdaysInRange(startDate, endDate);
    Object.keys(stats.userStats).forEach(function(username) {
        var count = 0;
        allWorkdays.forEach(function(dateKey) {
            var day = dayMap[dateKey];
            if (!day || !day.users[username] || day.users[username].totalHours === 0) {
                count++;
            }
        });
        stats.userStats[username].daysWithoutWorklogs = count;
    });

    stats.totalIssues = Object.keys(issueMap).length;

    return { dayMap: dayMap, issueMap: issueMap, projectMap: projectMap, stats: stats };
}

function byTimestamp(a, b) {
    return (a.timestamp || "").localeCompare(b.timestamp || "");
}

function getWorkdaysInRange(startDate, endDate) {
    var days = [];
    var d = new Date(startDate);
    var end = new Date(endDate);
    while (d <= end) {
        var dow = d.getDay();
        if (dow !== 0 && dow !== 6) {
            days.push(getDayKey(d));
        }
        d.setDate(d.getDate() + 1);
    }
    return days;
}
```

**Step 2: Экспортировать**

Добавить `processMultiUserData` в return-объект модуля.

**Step 3: Commit**

```bash
git add ujg-user-activity-modules/data-processor.js
git commit -m "feat(user-activity): add multi-user data processing"
```

---

### Task 4: Создать unified-calendar.js

**Files:**
- Create: `ujg-user-activity-modules/unified-calendar.js`

**Step 1: Создать модуль**

AMD-модуль `_ujgUA_unifiedCalendar`. Основная структура аналогична `calendar-heatmap.js`, но:

1. **Ячейка дня** содержит три зоны:
   - Заголовок (дата + чипы пользователей)
   - Верхний блок (Jira: ворклоги + комментарии + changelog)
   - Нижний блок (Repo: коммиты, PR, ветки)

2. **Рендер чипов пользователей:**
```javascript
function renderUserChips(dayData, selectedUsers, dateKey) {
    var html = '<div class="ujg-ua-day-chips">';
    var today = getDayKey(new Date());
    var isWeekend = isWeekendDay(dateKey);
    var isFuture = dateKey > today;

    selectedUsers.forEach(function(user) {
        var userData = dayData.users[user.name] || { totalHours: 0 };
        var hours = userData.totalHours;
        var isRed = !isWeekend && !isFuture && hours === 0;
        var cls = isRed ? "ujg-ua-chip-red" : "ujg-ua-chip-normal";
        html += '<span class="ujg-ua-user-day-chip ' + cls + '">';
        html += escapeHtml(user.displayName.split(" ")[0]); // фамилия
        html += ' <b>' + formatHours(hours) + '</b>';
        html += '</span>';
    });
    html += '</div>';
    return html;
}
```

3. **Рендер верхнего блока (Jira):**
```javascript
function renderJiraBlock(dayData, issueMap) {
    var items = [].concat(
        (dayData.allWorklogs || []).map(function(w) {
            return { ts: w.timestamp, html: renderWorklogLine(w, issueMap) };
        }),
        (dayData.allChanges || []).map(function(c) {
            return { ts: c.timestamp, html: renderChangeLine(c, issueMap) };
        }),
        (dayData.allComments || []).map(function(c) {
            return { ts: c.timestamp, html: renderCommentLine(c, issueMap) };
        })
    );
    items.sort(function(a, b) { return (a.ts || "").localeCompare(b.ts || ""); });

    var html = '<div class="ujg-ua-jira-block">';
    items.forEach(function(item) { html += item.html; });
    html += '</div>';
    return html;
}
```

Каждая строка действия: `[HH:MM] [Автор] [Ключ задачи] [Описание]`

4. **Рендер нижнего блока (Repo):**
```javascript
function renderRepoBlock(dayData) {
    var items = (dayData.repoItems || []).slice();
    items.sort(function(a, b) { return (a.timestamp || "").localeCompare(b.timestamp || ""); });

    var html = '<div class="ujg-ua-repo-block">';
    if (items.length === 0) {
        html += '</div>';
        return html;
    }
    items.forEach(function(item) {
        var time = formatTime(item.timestamp);
        var icon = CONFIG.REPO_ICONS[item.type] || "●";
        html += '<div class="ujg-ua-repo-line">';
        html += '<span class="ujg-ua-time">' + time + '</span> ';
        html += icon + ' ';
        html += '<span class="ujg-ua-author">' + escapeHtml(item.author || "") + '</span> ';
        html += escapeHtml(item.message || item.name || "");
        html += '</div>';
    });
    html += '</div>';
    return html;
}
```

5. **Двухпроходный рендер для выравнивания границы:**
```javascript
function alignRowBorders($table) {
    $table.find("tr").each(function() {
        var $cells = $(this).find("td[data-date]");
        if ($cells.length === 0) return;
        var maxH = 0;
        $cells.each(function() {
            var h = $(this).find(".ujg-ua-jira-block").outerHeight();
            if (h > maxH) maxH = h;
        });
        $cells.each(function() {
            $(this).find(".ujg-ua-jira-block").css("min-height", maxH + "px");
        });
    });
}
```

Вызывается через `requestAnimationFrame` после вставки DOM:
```javascript
requestAnimationFrame(function() {
    alignRowBorders($table);
});
```

6. **API модуля:**
```javascript
return {
    create: function($container, dayMap, issueMap, repoActivity, selectedUsers, startDate, endDate) { ... },
    onSelectDate: function(callback) { ... }
};
```

**Step 2: CSS для объединённого календаря**

Добавить в `config.js`:
```css
.ujg-ua-day-chips { display: flex; flex-wrap: wrap; gap: 2px; padding: 2px 4px; border-bottom: 1px solid #eee; }
.ujg-ua-user-day-chip { font-size: 10px; padding: 1px 5px; border-radius: 8px; white-space: nowrap; }
.ujg-ua-chip-normal { background: #e3fcef; color: #006644; }
.ujg-ua-chip-red { background: #ffebe6; color: #bf2600; font-weight: bold; }
.ujg-ua-jira-block { padding: 4px; border-bottom: 1px dashed #dfe1e6; }
.ujg-ua-repo-block { padding: 4px; background: #f4f5f7; }
.ujg-ua-time { color: #6b778c; font-size: 10px; font-family: monospace; }
.ujg-ua-author { color: #0052cc; font-size: 11px; }
.ujg-ua-repo-line, .ujg-ua-jira-line { font-size: 11px; line-height: 1.4; padding: 1px 0; }
.ujg-ua-day-cell { vertical-align: top; border: 1px solid #dfe1e6; }
.ujg-ua-day-cell-red-border { border: 2px solid #de350b; }
```

**Step 3: Commit**

```bash
git add ujg-user-activity-modules/unified-calendar.js
git commit -m "feat(user-activity): create unified calendar with Jira+Repo blocks"
```

---

### Task 5: Обновить daily-detail.js — авторы и таймстемпы

**Files:**
- Modify: `ujg-user-activity-modules/daily-detail.js`

**Step 1: Переписать функцию show()**

Изменить `show(date, dayData, issueMap)` для работы с мультипользовательским dayData:

1. Собрать все действия из `dayData.allWorklogs`, `dayData.allChanges`, `dayData.allComments`, `dayData.repoItems`
2. Сгруппировать по issueKey
3. Внутри группы отсортировать по timestamp
4. Для каждого действия показать: `HH:MM Автор — Тип действия Детали`

Структура рендера:
```javascript
function renderDayDetail(date, dayData, issueMap) {
    var allActions = [];

    (dayData.allWorklogs || []).forEach(function(w) {
        allActions.push({
            issueKey: w.issueKey,
            timestamp: w.timestamp || w.started || w.date,
            author: w.author,
            type: "worklog",
            hours: w.timeSpentHours,
            comment: w.comment
        });
    });

    (dayData.allChanges || []).forEach(function(c) {
        allActions.push({
            issueKey: c.issueKey,
            timestamp: c.timestamp || c.created,
            author: c.author,
            type: "change",
            field: c.field,
            fromString: c.fromString,
            toString: c.toString
        });
    });

    (dayData.allComments || []).forEach(function(c) {
        allActions.push({
            issueKey: c.issueKey,
            timestamp: c.timestamp || c.created,
            author: c.author,
            type: "comment",
            body: c.body
        });
    });

    (dayData.repoItems || []).forEach(function(r) {
        allActions.push({
            issueKey: r.issueKey || null,
            timestamp: r.timestamp || r.authorTimestamp,
            author: { name: r.authorName, displayName: r.authorName },
            type: "repo",
            subtype: r.type,
            message: r.message || r.name
        });
    });

    // Group by issueKey
    var grouped = {};
    var unlinked = [];
    allActions.forEach(function(a) {
        if (a.issueKey) {
            if (!grouped[a.issueKey]) grouped[a.issueKey] = [];
            grouped[a.issueKey].push(a);
        } else {
            unlinked.push(a);
        }
    });

    // Sort within groups
    Object.keys(grouped).forEach(function(key) {
        grouped[key].sort(byTimestamp);
    });
    unlinked.sort(byTimestamp);

    // Render
    var html = '';
    Object.keys(grouped).forEach(function(issueKey) {
        var issue = issueMap[issueKey] || {};
        html += '<div class="ujg-ua-detail-issue">';
        html += '<div class="ujg-ua-detail-issue-header">';
        html += '<a href="' + baseUrl + '/browse/' + issueKey + '" target="_blank">' + issueKey + '</a>';
        html += ' ' + escapeHtml(issue.summary || '');
        html += '</div>';
        grouped[issueKey].forEach(function(action) {
            html += renderActionLine(action);
        });
        html += '</div>';
    });

    if (unlinked.length > 0) {
        html += '<div class="ujg-ua-detail-unlinked">';
        html += '<div class="ujg-ua-detail-issue-header">Без привязки к задаче</div>';
        unlinked.forEach(function(action) {
            html += renderActionLine(action);
        });
        html += '</div>';
    }

    return html;
}

function renderActionLine(action) {
    var time = formatTime(action.timestamp);
    var author = action.author ? escapeHtml(action.author.displayName || action.author.name) : "";
    var html = '<div class="ujg-ua-detail-action">';
    html += '<span class="ujg-ua-time">' + time + '</span> ';
    html += '<span class="ujg-ua-author">' + author + '</span> — ';

    switch (action.type) {
        case "worklog":
            html += 'Worklog ' + formatHours(action.hours);
            if (action.comment) html += '<div class="ujg-ua-detail-comment">"' + escapeHtml(action.comment) + '"</div>';
            break;
        case "change":
            html += escapeHtml(action.fromString || "") + ' → ' + escapeHtml(action.toString || "");
            break;
        case "comment":
            html += 'Комментарий';
            if (action.body) html += '<div class="ujg-ua-detail-comment">"' + escapeHtml(truncate(action.body, 200)) + '"</div>';
            break;
        case "repo":
            html += (action.subtype || "commit") + ' ' + escapeHtml(action.message || "");
            break;
    }
    html += '</div>';
    return html;
}
```

**Step 2: Commit**

```bash
git add ujg-user-activity-modules/daily-detail.js
git commit -m "feat(user-activity): add authors and timestamps to daily detail"
```

---

### Task 6: Обновить activity-log.js — реальные таймстемпы

**Files:**
- Modify: `ujg-user-activity-modules/activity-log.js`

**Step 1: Заменить Math.random() на реальные таймстемпы**

Найти место где генерируются случайные HH:MM (строки с `Math.random()` или `Math.floor(Math.random() * 24)`) и заменить на:

```javascript
// Вместо:
// var hours = Math.floor(Math.random() * 24);
// var minutes = Math.floor(Math.random() * 60);

// Использовать:
var timestamp = entry.timestamp || entry.started || entry.created || entry.date;
var time = formatTime(timestamp);
```

**Step 2: Добавить колонку «Автор»**

В заголовок таблицы добавить колонку «Автор». В каждую строку — `entry.author.displayName`.

**Step 3: Commit**

```bash
git add ujg-user-activity-modules/activity-log.js
git commit -m "fix(user-activity): use real timestamps in activity log, add author column"
```

---

### Task 7: Обновить summary-cards.js — разбивка по пользователям

**Files:**
- Modify: `ujg-user-activity-modules/summary-cards.js`

**Step 1: Добавить пользовательскую статистику**

В функцию рендера карточек добавить секцию с разбивкой по пользователям:
- Таблица: Пользователь | Часы | Активных дней | Дней без W/L
- Строка с красным для пользователей с `daysWithoutWorklogs > 0`

Данные берутся из `stats.userStats`:
```javascript
if (stats.userStats && Object.keys(stats.userStats).length > 1) {
    var html = '<div class="ujg-ua-user-stats-table"><table>';
    html += '<tr><th>Пользователь</th><th>Часы</th><th>Активных дней</th><th>Без трудозатрат</th></tr>';
    Object.keys(stats.userStats).forEach(function(username) {
        var us = stats.userStats[username];
        var cls = us.daysWithoutWorklogs > 0 ? 'ujg-ua-stat-warn' : '';
        html += '<tr class="' + cls + '">';
        html += '<td>' + escapeHtml(us.displayName) + '</td>';
        html += '<td>' + formatHours(us.totalHours) + '</td>';
        html += '<td>' + us.activeDays + '</td>';
        html += '<td>' + us.daysWithoutWorklogs + '</td>';
        html += '</tr>';
    });
    html += '</table></div>';
}
```

**Step 2: Commit**

```bash
git add ujg-user-activity-modules/summary-cards.js
git commit -m "feat(user-activity): add per-user stats breakdown in summary cards"
```

---

### Task 8: Обновить rendering.js — оркестрация

**Files:**
- Modify: `ujg-user-activity-modules/rendering.js`

**Step 1: Заменить userPicker на multiUserPicker**

В `renderShell()`:
- Заменить вызов `userPicker.create($userSlot, onChange)` на `multiUserPicker.create($userSlot, onChange)`
- `onChange` теперь получает массив `selectedUsers` вместо одного пользователя

**Step 2: Переписать loadData для нескольких пользователей**

```javascript
function loadData(selectedUsers, period, onProgress) {
    activeRequestId++;
    var myRequestId = activeRequestId;

    var promises = selectedUsers.map(function(user) {
        return api.fetchAllData(user.name, period.start, period.end, function(phase, current, total) {
            if (onProgress) onProgress(user.displayName, phase, current, total);
        }).then(function(rawData) {
            return { username: user.name, displayName: user.displayName, rawData: rawData };
        });
    });

    $.when.apply($, promises).then(function() {
        if (myRequestId !== activeRequestId) return;
        var usersData = Array.prototype.slice.call(arguments);
        if (usersData.length === 1 && !Array.isArray(usersData[0])) {
            usersData = [usersData[0]];
        }

        // Собрать все уникальные issue keys
        var allIssueKeys = [];
        usersData.forEach(function(ud) {
            (ud.rawData.issues || []).forEach(function(issue) {
                if (allIssueKeys.indexOf(issue.key) < 0) allIssueKeys.push(issue.key);
            });
        });

        // Загрузить комментарии
        api.fetchIssueComments(allIssueKeys).then(function(commentsMap) {
            usersData.forEach(function(ud) {
                ud.comments = commentsMap;
            });

            var processed = dataProcessor.processMultiUserData(usersData, period.start, period.end);

            // Repo activity
            var allIssues = [];
            usersData.forEach(function(ud) {
                allIssues = allIssues.concat(ud.rawData.issues || []);
            });
            // Deduplicate issues by key
            var seen = {};
            allIssues = allIssues.filter(function(i) {
                if (seen[i.key]) return false;
                seen[i.key] = true;
                return true;
            });

            repoApi.fetchRepoActivityForIssues(allIssues, function(p, c, t) {
                if (onProgress) onProgress("Repo", p, c, t);
            }).then(function(devStatusMap) {
                var repoActivity = repoDataProcessor.processRepoActivity(
                    processed.issueMap, devStatusMap,
                    selectedUsers.map(function(u) { return u.name; }),
                    period.start, period.end
                );

                // Merge repo items into dayMap
                if (repoActivity && repoActivity.dayMap) {
                    Object.keys(repoActivity.dayMap).forEach(function(dateKey) {
                        if (processed.dayMap[dateKey]) {
                            processed.dayMap[dateKey].repoItems = repoActivity.dayMap[dateKey].items || [];
                        }
                    });
                }

                renderDashboard(processed, period.start, period.end, selectedUsers, repoActivity);
            });
        });
    });
}
```

**Step 3: Обновить renderDashboard**

- Заменить вызов `calendarHeatmap.create(...)` + `repoCalendar.create(...)` на `unifiedCalendar.create($container, dayMap, issueMap, repoActivity, selectedUsers, startDate, endDate)`
- Передать `selectedUsers` в `dailyDetail.show()`, `summaryCards.render()` и т.д.

**Step 4: Обновить зависимости модуля**

В `define(...)` заменить `_ujgUA_userPicker` на `_ujgUA_multiUserPicker` и `_ujgUA_calendarHeatmap` + `_ujgUA_repoCalendar` на `_ujgUA_unifiedCalendar`.

**Step 5: Commit**

```bash
git add ujg-user-activity-modules/rendering.js
git commit -m "feat(user-activity): orchestrate multi-user loading and unified calendar"
```

---

### Task 9: Обновить repo-data-processor.js — фильтрация по нескольким пользователям

**Files:**
- Modify: `ujg-user-activity-modules/repo-data-processor.js`

**Step 1: Принимать массив пользователей**

Изменить `processRepoActivity(issueMap, devStatusMap, requestUser, start, end)`:
- `requestUser` может быть строкой или массивом строк
- Фильтрация: если массив — проверять `username in requestUsers` (lowercase)

```javascript
var requestUsers = Array.isArray(requestUser)
    ? requestUser.map(function(u) { return u.toLowerCase(); })
    : [requestUser.toLowerCase()];

// В фильтре:
var isUserMatch = requestUsers.indexOf(authorName.toLowerCase()) >= 0;
```

**Step 2: Commit**

```bash
git add ujg-user-activity-modules/repo-data-processor.js
git commit -m "feat(user-activity): support multiple users in repo data processor"
```

---

### Task 10: Обновить config.js — стили

**Files:**
- Modify: `ujg-user-activity-modules/config.js`

**Step 1: Добавить CSS-стили**

Добавить в CSS-блок (или в `CONFIG.STYLES`) все новые стили:
- `.ujg-ua-multi-picker`, `.ujg-ua-picker-panel` — мультиселект
- `.ujg-ua-day-chips`, `.ujg-ua-user-day-chip`, `.ujg-ua-chip-red` — чипы в ячейках
- `.ujg-ua-jira-block`, `.ujg-ua-repo-block` — блоки в ячейке
- `.ujg-ua-time`, `.ujg-ua-author` — таймстемпы и авторы
- `.ujg-ua-detail-action`, `.ujg-ua-detail-comment` — детализация дня
- `.ujg-ua-stat-warn` — предупреждение в статистике
- `.ujg-ua-day-cell-red-border` — красный бордер ячейки

**Step 2: Commit**

```bash
git add ujg-user-activity-modules/config.js
git commit -m "feat(user-activity): add styles for multi-user features"
```

---

### Task 11: Обновить build-user-activity.js — MODULE_ORDER

**Files:**
- Modify: `build-user-activity.js`

**Step 1: Обновить MODULE_ORDER**

Заменить:
- `user-picker.js` → `multi-user-picker.js`
- `calendar-heatmap.js` + `repo-calendar.js` → `unified-calendar.js`

Новый порядок (сохранить зависимости — config/utils первыми, main последним):
```javascript
var MODULE_ORDER = [
    "config.js",
    "utils.js",
    "api.js",
    "repo-api.js",
    "data-processor.js",
    "repo-data-processor.js",
    "progress-loader.js",
    "multi-user-picker.js",      // было user-picker.js
    "date-range-picker.js",
    "summary-cards.js",
    "unified-calendar.js",       // было calendar-heatmap.js + repo-calendar.js
    "daily-detail.js",
    "project-breakdown.js",
    "issue-list.js",
    "activity-log.js",
    "repo-log.js",
    "rendering.js",
    "main.js"
];
```

**Step 2: Пересобрать**

```bash
node build-user-activity.js
```

**Step 3: Commit**

```bash
git add build-user-activity.js ujg-user-activity.js
git commit -m "build: update MODULE_ORDER for multi-user features"
```

---

### Task 12: Добавить вспомогательные функции в utils.js

**Files:**
- Modify: `ujg-user-activity-modules/utils.js`

**Step 1: Добавить formatTime и isWeekendDay**

```javascript
function formatTime(isoString) {
    if (!isoString) return "";
    var d = new Date(isoString);
    if (isNaN(d.getTime())) return "";
    var h = d.getHours();
    var m = d.getMinutes();
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
}

function isWeekendDay(dateKey) {
    var d = new Date(dateKey);
    var dow = d.getDay();
    return dow === 0 || dow === 6;
}

function truncate(str, maxLen) {
    if (!str || str.length <= maxLen) return str || "";
    return str.substring(0, maxLen) + "…";
}
```

**Step 2: Экспортировать**

Добавить `formatTime`, `isWeekendDay`, `truncate` в возвращаемый объект.

**Step 3: Commit**

```bash
git add ujg-user-activity-modules/utils.js
git commit -m "feat(user-activity): add formatTime, isWeekendDay, truncate utilities"
```

---

### Task 13: Интеграционное тестирование

**Step 1: Пересобрать бандл**

```bash
node build-user-activity.js
```

Проверить что файл `ujg-user-activity.js` создан без ошибок.

**Step 2: Проверить в standalone-сервере**

```bash
cd standalone && node server.js
```

Открыть дашборд, проверить:
1. Мультиселект — поиск пользователей, добавление нескольких
2. Загрузка данных по нескольким пользователям (прогресс)
3. Объединённый календарь — два блока в ячейке
4. Выравнивание границы по строке
5. Чипы пользователей — нормальные и красные
6. Таймстемпы и авторы в ячейках, детализации дня, activity log
7. Summary cards — разбивка по пользователям

**Step 3: Финальный commit**

```bash
git add -A
git commit -m "feat(user-activity): multi-user dashboard — complete integration"
```
