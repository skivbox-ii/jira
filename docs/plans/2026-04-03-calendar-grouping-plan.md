# Calendar Grouping Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Группировать записи в ячейках календаря по пользователю, затем по задаче, чтобы убрать дублирование имён и ключей задач.

**Architecture:** Только рендеринг в `unified-calendar.js` + стили в `config.js`. Данные не меняются.

**Tech Stack:** AMD/jQuery, Tailwind CSS utilities.

---

### Task 1: Добавить CSS-стили для групп

**Files:**
- Modify: `ujg-user-activity-modules/config.js:90-93`

**Step 1:** Добавить стили после `.ujg-ua-repo-block`:

```css
.ujg-ua-user-group { margin-bottom: 2px; }
.ujg-ua-user-group-header { font-size: 10px; font-weight: 600; color: #0052cc; padding: 2px 4px; background: #deebff; border-radius: 2px; display: flex; justify-content: space-between; align-items: center; }
.ujg-ua-issue-group { border-left: 2px solid #dfe1e6; margin: 2px 0 2px 4px; padding-left: 4px; }
.ujg-ua-issue-group-header { font-size: 10px; padding: 1px 0; display: flex; align-items: baseline; gap: 4px; flex-wrap: wrap; }
.ujg-ua-issue-group-hours { font-size: 9px; font-weight: 700; }
```

**Step 2:** Commit.

---

### Task 2: Добавить функцию `groupDayItems`

**Files:**
- Modify: `ujg-user-activity-modules/unified-calendar.js`

**Step 1:** Добавить функцию `groupDayItems(dayData, issueMap, selectedUsers)` после `renderRepoObjectLink`.

Логика:
1. Собрать все worklogs, changes, comments, repoItems
2. Сгруппировать по author.displayName → по issueKey
3. Для каждой группы пользователя: сортировка задач по убыванию часов
4. Для каждой задачи: записи по timestamp
5. `showHeader = selectedUsers.length > 1`

**Step 2:** Commit.

---

### Task 3: Добавить функцию `renderGroupedBlock`

**Files:**
- Modify: `ujg-user-activity-modules/unified-calendar.js`

**Step 1:** Добавить `renderGroupedBlock(groups, issueMap)` после `groupDayItems`.

Для каждой группы пользователя:
- Если `showHeader` — рендерить заголовок пользователя с суммой часов
- Для каждой задачи:
  - Заголовок: issueRef + суммарные часы
  - Worklogs: время + часы + lag + комментарий (без автора, без issueRef)
  - Changes: время + → статус
  - Comments: время + "Комментарий" + тело
  - RepoItems: время + icon + type + objectLink + msg

**Step 2:** Commit.

---

### Task 4: Заменить вызовы в `buildCalendarInnerHtml`

**Files:**
- Modify: `ujg-user-activity-modules/unified-calendar.js:491-492`

**Step 1:** Заменить:
```javascript
html += renderJiraBlock(dayData, issueMap);
html += renderRepoBlock(dayData, issueMap);
```

На:
```javascript
var groups = groupDayItems(dayData, issueMap, selectedUsers);
html += renderGroupedBlock(groups, issueMap);
```

**Step 2:** Commit и push.

---

### Task 5: Обновить README.md

**Files:**
- Modify: `README.md`

**Step 1:** Обновить структуру проекта если необходимо.

**Step 2:** Commit и push.
