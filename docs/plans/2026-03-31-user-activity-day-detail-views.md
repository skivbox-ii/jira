# User Activity Day Detail Views Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Добавить в `user-activity` ссылки на задачи, полные названия задач в детализации дня, второй режим day-detail `По команде` и текущий Jira status рядом с repo-событиями.

**Architecture:** Оставить текущую загрузку данных и использовать уже существующий `issueMap` как источник truth для summary/status задач. Все действия дня сначала нормализуются в единый action list, после чего day-detail рендерит либо группировку `По задачам`, либо timeline-grid `По команде`. Repo-события обогащаются `issueSummary` и `issueStatus` до рендера, без новых точечных API-вызовов.

**Tech Stack:** AMD `define()`, jQuery, локальные build-скрипты `build-user-activity.js` и `build-widget-bootstrap-assets.js`, `node:test`.

**Design doc:** `docs/plans/2026-03-31-user-activity-day-detail-views-design.md`

---

### Task 1: Добавить helpers для Jira issue links

**Files:**
- Modify: `ujg-user-activity-modules/utils.js`
- Test: `tests/user-activity-repo.test.js`

**Step 1: Написать падающий тест на Jira issue URL и ссылку**

Добавить в `tests/user-activity-repo.test.js` проверки для новых helpers:

```js
assert.equal(utils.buildIssueUrl("ABC-123"), "https://jira.example.com/browse/ABC-123");
assert.match(utils.renderIssueLink("ABC-123"), /target="_blank"/);
assert.match(utils.renderIssueLink("ABC-123"), />ABC-123</);
```

Для теста подай в sandbox `window.location.origin` или `AJS.params.baseURL`, смотря как модуль уже определяет base URL.

**Step 2: Запустить тест и убедиться, что он красный**

Run: `node --test --test-name-pattern "issue URL|issue link" tests/user-activity-repo.test.js`

Expected: FAIL, потому что helpers ещё не существуют.

**Step 3: Добавить helpers в `utils.js`**

Добавить:
- `getJiraBaseUrl()`
- `buildIssueUrl(issueKey)`
- `renderIssueLink(issueKey, label, extraAttrs)`

Минимальный контракт:

```js
function buildIssueUrl(issueKey) {
    var key = String(issueKey || "").trim();
    if (!key) return "";
    return getJiraBaseUrl().replace(/\/$/, "") + "/browse/" + key;
}

function renderIssueLink(issueKey, label, extraAttrs) {
    var url = buildIssueUrl(issueKey);
    var text = label != null ? String(label) : String(issueKey || "");
    if (!url) return escapeHtml(text);
    return '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer"' +
        (extraAttrs || "") + '>' + escapeHtml(text) + "</a>";
}
```

**Step 4: Экспортировать helpers**

Добавить новые функции в `return` объекта `utils`.

**Step 5: Прогнать тест повторно**

Run: `node --test --test-name-pattern "issue URL|issue link" tests/user-activity-repo.test.js`

Expected: PASS.

**Step 6: Commit**

```bash
git add ujg-user-activity-modules/utils.js tests/user-activity-repo.test.js
git commit -m "feat(user-activity): add Jira issue link helpers"
```

---

### Task 2: Обогатить repo items текущим Jira summary и status

**Files:**
- Modify: `ujg-user-activity-modules/repo-data-processor.js`
- Test: `tests/user-activity-repo.test.js`

**Step 1: Написать падающий тест на enrichment repo items**

Добавить тест, который строит `issueMap` с:

```js
{
  "ABC-123": { key: "ABC-123", summary: "Real summary", status: "In Progress" }
}
```

и проверяет, что `processRepoActivity(...)` возвращает item с:

```js
assert.equal(item.issueSummary, "Real summary");
assert.equal(item.issueStatus, "In Progress");
```

Также проверь, что author у commit остаётся явным и не теряется.

**Step 2: Запустить тест**

Run: `node --test --test-name-pattern "repo items.*status|repo items.*summary" tests/user-activity-repo.test.js`

Expected: FAIL.

**Step 3: Изменить `pushEvent()` и extractors**

В `repo-data-processor.js` убедиться, что все repo items получают:
- `issueKey`
- `issueSummary`
- `issueStatus`
- `authorLabel` или стабильно заполненный `author`

Минимально:

```js
item.issueSummary = item.issueSummary || "";
item.issueStatus = item.issueStatus || "";
```

И в местах вызова `pushEvent(...)` передавать:

```js
issueSummary: issueInfo.summary || "",
issueStatus: issueInfo.status || "",
```

**Step 4: Повторно прогнать тест**

Run: `node --test --test-name-pattern "repo items.*status|repo items.*summary" tests/user-activity-repo.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add ujg-user-activity-modules/repo-data-processor.js tests/user-activity-repo.test.js
git commit -m "feat(user-activity): enrich repo items with Jira summary and status"
```

---

### Task 3: Обновить календарные и логовые рендеры для issue links и repo meta

**Files:**
- Modify: `ujg-user-activity-modules/unified-calendar.js`
- Modify: `ujg-user-activity-modules/activity-log.js`
- Modify: `ujg-user-activity-modules/repo-log.js`
- Modify: `ujg-user-activity-modules/config.js`
- Test: `tests/user-activity-repo.test.js`

**Step 1: Написать падающие тесты на рендер issue links**

Добавить проверки:
- Jira line в `unified-calendar` рендерит `issueKey` как `<a ... target="_blank">`
- repo line в `unified-calendar` тоже рендерит ссылку, если есть `issueKey`
- `repo-log` и `activity-log` используют ссылку, если колонка/детали содержат `issueKey`

**Step 2: Запустить тесты**

Run: `node --test --test-name-pattern "issue link|repo line.*status|activity log.*issue link|repo log.*issue link" tests/user-activity-repo.test.js`

Expected: FAIL.

**Step 3: Обновить `unified-calendar.js`**

Заменить plain `issueKey` на `utils.renderIssueLink(...)` во всех строках, где рисуется задача.

Для repo line добавить:
- автора;
- status badge/текст из `item.issueStatus`;
- message/title;
- summary задачи, если есть и она отличается от message.

Пример:

```js
html += utils.renderIssueLink(item.issueKey, item.issueKey, ' class="text-[10px] font-semibold text-primary"');
if (item.issueStatus) {
    html += ' <span class="ujg-ua-inline-status">' + utils.escapeHtml(item.issueStatus) + "</span>";
}
```

**Step 4: Обновить `activity-log.js` и `repo-log.js`**

Где сейчас печатается `issueKey` как text node, заменить на helper-ссылку.

Убедиться, что HTML не экранируется повторно, если рендер строки уже собирается как HTML string.

**Step 5: Добавить нужные стили в `config.js`**

Минимум:
- `.ujg-ua-inline-status`
- ссылки issue key без underline по умолчанию, с underline on hover
- перенос длинных summary/message строк

**Step 6: Прогнать тесты повторно**

Run: `node --test --test-name-pattern "issue link|repo line.*status|activity log.*issue link|repo log.*issue link" tests/user-activity-repo.test.js`

Expected: PASS.

**Step 7: Commit**

```bash
git add ujg-user-activity-modules/unified-calendar.js ujg-user-activity-modules/activity-log.js ujg-user-activity-modules/repo-log.js ujg-user-activity-modules/config.js tests/user-activity-repo.test.js
git commit -m "feat(user-activity): render issue links and repo status meta"
```

---

### Task 4: Переписать day-detail вокруг единой action-модели

**Files:**
- Modify: `ujg-user-activity-modules/daily-detail.js`
- Modify: `ujg-user-activity-modules/config.js`
- Test: `tests/user-activity-repo.test.js`

**Step 1: Написать падающий тест на нормализацию actions**

Добавить тест для day detail helper-а, который ожидает:
- worklog/change/comment/repo превращаются в единый список;
- каждый action получает `issueKey`, `issueSummary`, `issueStatus`, `author`, `timestamp`;
- repo item без времени уходит в список `undated`.

**Step 2: Запустить тест**

Run: `node --test --test-name-pattern "daily detail.*normalize|daily detail.*undated" tests/user-activity-repo.test.js`

Expected: FAIL.

**Step 3: Вынести helpers в `daily-detail.js`**

Добавить функции вроде:
- `normalizeDayActions(dayData, issueMap)`
- `groupActionsByIssue(actions)`
- `groupActionsByUser(actions, selectedUsers)`
- `splitTimedAndUntimed(actions)`

Пример контракта:

```js
{
  timed: [...],
  undated: [...]
}
```

**Step 4: Обновить режим `По задачам`**

Текущий render сохранить как основу, но:
- использовать normalized actions;
- `issueKey` рендерить ссылкой;
- `summary` показывать без `truncate`;
- repo actions показывать автора и current status.

**Step 5: Добавить стили для полного summary**

Убрать `truncate`-ориентированные классы в day-detail headers и добавить перенос:

```css
.ujg-ua-detail-issue-header { white-space: normal; word-break: break-word; }
```

**Step 6: Прогнать тест**

Run: `node --test --test-name-pattern "daily detail.*normalize|daily detail.*summary" tests/user-activity-repo.test.js`

Expected: PASS.

**Step 7: Commit**

```bash
git add ujg-user-activity-modules/daily-detail.js ujg-user-activity-modules/config.js tests/user-activity-repo.test.js
git commit -m "refactor(user-activity): normalize day-detail actions"
```

---

### Task 5: Добавить режимы `По задачам / По команде` в day-detail

**Files:**
- Modify: `ujg-user-activity-modules/daily-detail.js`
- Modify: `ujg-user-activity-modules/rendering.js`
- Modify: `ujg-user-activity-modules/config.js`
- Test: `tests/user-activity-repo.test.js`

**Step 1: Написать падающий тест на переключатель режимов**

Добавить проверки:
- day-detail по умолчанию открывается в `По задачам`;
- клик по toggle переключает в `По команде`;
- второй режим строит колонку на каждого пользователя;
- untimed actions уходят в отдельный блок `Без точного времени`.

**Step 2: Запустить тест**

Run: `node --test --test-name-pattern "day detail.*mode|day detail.*team view|day detail.*untimed" tests/user-activity-repo.test.js`

Expected: FAIL.

**Step 3: Добавить state режима в `daily-detail.js`**

Добавить локальное состояние:

```js
var currentMode = "issue";
```

И переключатель:
- `По задачам`
- `По команде`

`show(...)` не должен сбрасывать режим на каждый клик по новому дню, если пользователь уже выбрал другой режим.

**Step 4: Реализовать timeline-grid `По команде`**

Добавить helper:
- `buildTimelineModel(actions, selectedUsers)`
- `renderTeamTimeline(model)`

Модель должна содержать:
- `users`
- `rows/markers` для мягких time guides
- `columns[userId].items`
- `undated`

Вертикальная позиция блока:

```js
var ratio = (itemMs - rangeStartMs) / (rangeEndMs - rangeStartMs || 1);
var topPx = Math.round(ratio * contentHeightPx);
```

Если действий один или два и диапазон очень маленький, добавь минимальный визуальный диапазон, чтобы всё не схлопнулось в одну линию.

**Step 5: Передать selectedUsers из `rendering.js`**

Изменить вызов:

```js
detailInst.show(dateStr, dayData, data.issueMap, selectedUsers);
```

И адаптировать сигнатуру `show(...)` в `daily-detail.js`.

**Step 6: Добавить стили timeline-grid**

Добавить в `config.js`:
- toggle modes
- `.ujg-ua-detail-timeline`
- `.ujg-ua-detail-timeline-scale`
- `.ujg-ua-detail-timeline-grid`
- `.ujg-ua-detail-user-col`
- `.ujg-ua-detail-time-marker`
- `.ujg-ua-detail-timeline-card`
- `.ujg-ua-detail-undated`

**Step 7: Прогнать тест повторно**

Run: `node --test --test-name-pattern "day detail.*mode|day detail.*team view|day detail.*untimed" tests/user-activity-repo.test.js`

Expected: PASS.

**Step 8: Commit**

```bash
git add ujg-user-activity-modules/daily-detail.js ujg-user-activity-modules/rendering.js ujg-user-activity-modules/config.js tests/user-activity-repo.test.js
git commit -m "feat(user-activity): add team timeline mode to day detail"
```

---

### Task 6: Проверить auxiliary views и довести presentation consistency

**Files:**
- Modify: `ujg-user-activity-modules/unified-calendar.js`
- Modify: `ujg-user-activity-modules/daily-detail.js`
- Modify: `ujg-user-activity-modules/repo-log.js`
- Modify: `ujg-user-activity-modules/activity-log.js`
- Test: `tests/user-activity-repo.test.js`

**Step 1: Написать падающий интеграционный тест на consistency**

Добавить тест, который ожидает:
- repo action в календаре и в day-detail показывает одинакового автора;
- `issueStatus` виден у repo action в day-detail;
- summary задачи не режется в detail header;
- link на issue есть и в календаре, и в day-detail.

**Step 2: Запустить тест**

Run: `node --test --test-name-pattern "presentation consistency|repo author|issue status" tests/user-activity-repo.test.js`

Expected: FAIL.

**Step 3: Довести presentation до единого правила**

Проверь и поправь:
- одинаковые подписи типа repo action;
- одинаковое место автора;
- одинаковый fallback, если нет issue/status/author;
- отсутствие `truncate` там, где по дизайну нужен перенос строк.

**Step 4: Прогнать тест повторно**

Run: `node --test --test-name-pattern "presentation consistency|repo author|issue status" tests/user-activity-repo.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add ujg-user-activity-modules/unified-calendar.js ujg-user-activity-modules/daily-detail.js ujg-user-activity-modules/repo-log.js ujg-user-activity-modules/activity-log.js tests/user-activity-repo.test.js
git commit -m "fix(user-activity): align issue and repo presentation across views"
```

---

### Task 7: Пересборка, runtime/bootstrap и финальная проверка

**Files:**
- Modify: `ujg-user-activity.js`
- Modify: `ujg-user-activity.runtime.js`
- Modify: `ujg-user-activity.bootstrap.js`
- Modify: `ujg-project-analytics.bootstrap.js`
- Modify: `ujg-sprint-health.bootstrap.js`
- Modify: `ujg-story-browser.bootstrap.js`
- Modify: `ujg-timesheet.bootstrap.js`
- Modify: `ujg-timesheet.v0.bootstrap.js`

**Step 1: Пересобрать user-activity bundle**

Run:
- `node build-user-activity.js`

Expected: `ujg-user-activity.js` пересобран без ошибок.

**Step 2: Прогнать релевантные тесты**

Run:
- `node tests/user-activity-repo.test.js`

Expected: PASS.

**Step 3: Проверить синтаксис артефактов**

Run:
- `node --check ujg-user-activity.js`

Expected: PASS.

**Step 4: Commit артефакта**

```bash
git add ujg-user-activity.js
git commit -m "build(user-activity): rebuild bundle for day-detail views"
```

**Step 5: Синхронизировать runtime/bootstrap**

Run:
- `node build-widget-bootstrap-assets.js`

Expected:
- обновляется `ujg-user-activity.runtime.js`;
- обновляется `ujg-user-activity.bootstrap.js`;
- если генератор трогает другие `*.bootstrap.js`, их тоже включить в commit.

**Step 6: Прогнать bootstrap verification**

Run:
- `node tests/widget-bootstrap.test.js`

Expected: PASS.

**Step 7: Commit bootstrap/runtime**

```bash
git add ujg-user-activity.runtime.js ujg-user-activity.bootstrap.js ujg-project-analytics.bootstrap.js ujg-sprint-health.bootstrap.js ujg-story-browser.bootstrap.js ujg-timesheet.bootstrap.js ujg-timesheet.v0.bootstrap.js
git commit -m "build(bootstrap): sync releaseRef for day-detail views"
```
