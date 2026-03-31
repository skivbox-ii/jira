# User Activity Hard-Open Diagnostics Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Убрать downstream-фильтрацию и user-дедупликацию в цепочке User Activity calendar/day detail, чтобы показывать сырой поток действий и полных авторов без скрытия событий.

**Architecture:** Jira scope остаётся прежним: header-selected users по-прежнему ограничивают только Jira fetch. Repo/day-detail слой перестаёт повторно фильтровать и раскладывать события по выбранным пользователям. Календарь и детализация показывают фактических авторов действий, а не сокращённые или повторно сопоставленные ярлыки.

**Tech Stack:** AMD `define()`, jQuery, Node `--test`, конкатенационная сборка `build-user-activity.js`.

---

### Task 1: Зафиксировать hard-open поведение для repo processor тестом

**Files:**
- Modify: `tests/user-activity-repo.test.js`
- Modify: `ujg-user-activity-modules/repo-data-processor.js`
- Test: `tests/user-activity-repo.test.js`

**Step 1: Write the failing test**

Добавить в `tests/user-activity-repo.test.js` тест, который передаёт в `processRepoActivity(...)` одного выбранного пользователя, но ожидает, что события второго автора в том же диапазоне тоже попадут в результат:

```javascript
test("processRepoActivity hard-open keeps repo events from all authors in range", function() {
    var mod = loadRepoDataProcessor();
    var repoActivity = mod.processRepoActivity(
        {
            "CORE-OPEN": { key: "CORE-OPEN", summary: "Hard open task", status: "In Progress" }
        },
        {
            "CORE-OPEN": {
                detail: [{
                    repositories: [{
                        name: "core-open",
                        commits: [{
                            id: "a1",
                            message: "Alice commit",
                            authorTimestamp: "2026-03-18T09:00:00.000Z",
                            author: { name: "alice", displayName: "Alice Dev" }
                        }, {
                            id: "b1",
                            message: "Bob commit",
                            authorTimestamp: "2026-03-18T10:00:00.000Z",
                            author: { name: "bob", displayName: "Bob Dev" }
                        }]
                    }]
                }]
            }
        },
        { name: "alice", displayName: "Alice Dev" },
        "2026-03-18",
        "2026-03-18"
    );

    assert.deepEqual(
        normalize(repoActivity.items.map(function(item) { return item.author; })),
        ["Alice Dev", "Bob Dev"]
    );
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/user-activity-repo.test.js --test-name-pattern="hard-open keeps repo events from all authors"`

Expected: FAIL because current implementation filters out Bob's event.

**Step 3: Write minimal implementation**

В `ujg-user-activity-modules/repo-data-processor.js` убрать влияние `selectedUser` на пропуск repo-событий:

```javascript
function matchesStateUser(_userLike, _state) {
    return true;
}
```

Если нужен более аккуратный diff, оставить сигнатуру и убрать все вызовы `matchesStateUser(...)` из `extractCommitEvents`, `extractPullRequestEvents`, `extractBranchEvents`, `extractRepositoryEvents`, `extractUnknownEvents`, но смысл должен остаться тем же: автор больше не является фильтром.

**Step 4: Run test to verify it passes**

Run: `node --test tests/user-activity-repo.test.js --test-name-pattern="hard-open keeps repo events from all authors"`

Expected: PASS

**Step 5: Commit**

```bash
git add tests/user-activity-repo.test.js ujg-user-activity-modules/repo-data-processor.js
git commit -m "fix(user-activity): open repo activity stream for diagnostics"
```

### Task 2: Зафиксировать полные author labels в unified calendar тестом

**Files:**
- Modify: `tests/user-activity-repo.test.js`
- Modify: `ujg-user-activity-modules/unified-calendar.js`
- Test: `tests/user-activity-repo.test.js`

**Step 1: Write the failing test**

Добавить тест, который проверяет полное имя автора в repo-линии календаря:

```javascript
test("unified calendar hard-open shows full repo author label", function() {
    var mod = loadUnifiedCalendar(createHtmlJqueryStub());
    var out = mod.render({
        "2026-03-18": {
            totalHours: 0,
            allWorklogs: [],
            allChanges: [],
            allComments: [],
            repoItems: [{
                type: "commit",
                timestamp: "2026-03-18T10:00:00.000Z",
                authorName: "Ivanov Ivan Petrovich",
                issueKey: "CORE-OPEN",
                message: "full author visible"
            }]
        }
    }, {}, [{ name: "alice", displayName: "Alice Dev" }], new Date("2026-03-17T00:00:00.000Z"), new Date("2026-03-23T23:59:59.000Z"));

    assert.match(out.$el.html(), /Ivanov Ivan Petrovich/);
    assert.doesNotMatch(out.$el.html(), /class="ujg-ua-author">Ivanov<\/span>/);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/user-activity-repo.test.js --test-name-pattern="shows full repo author label"`

Expected: FAIL because calendar currently uses `surname(...)`.

**Step 3: Write minimal implementation**

В `ujg-user-activity-modules/unified-calendar.js` заменить сокращение автора на полный `authorDisp` в repo-линии:

```javascript
if (authorDisp) {
    parts.push('<span class="ujg-ua-author">' + utils.escapeHtml(authorDisp) + "</span>");
}
```

Если Jira-линии страдают от той же коллизии, применить тот же принцип и к `renderJiraBlock(...)`.

**Step 4: Run test to verify it passes**

Run: `node --test tests/user-activity-repo.test.js --test-name-pattern="shows full repo author label"`

Expected: PASS

**Step 5: Commit**

```bash
git add tests/user-activity-repo.test.js ujg-user-activity-modules/unified-calendar.js
git commit -m "fix(user-activity): show full calendar authors in hard-open flow"
```

### Task 3: Убрать downstream user filter из day detail через тест

**Files:**
- Modify: `tests/user-activity-repo.test.js`
- Modify: `ujg-user-activity-modules/daily-detail.js`
- Test: `tests/user-activity-repo.test.js`

**Step 1: Write the failing test**

Добавить тест на то, что day detail больше не режет действия по `selectedUsers` и не показывает user filter UI:

```javascript
test("day detail hard-open renders all actions without selected-user filter UI", function() {
    var stub = createDayDetailInteractiveStub();
    var mod = loadDailyDetail(function(s) { return stub.$(s); });
    var panel = mod.create();

    panel.show("2026-03-18", {
        allWorklogs: [{
            issueKey: "CORE-1",
            timestamp: "2026-03-18T09:00:00.000Z",
            author: { name: "alice", displayName: "Alice Dev" },
            timeSpentHours: 1
        }, {
            issueKey: "CORE-2",
            timestamp: "2026-03-18T10:00:00.000Z",
            author: { name: "bob", displayName: "Bob Dev" },
            timeSpentHours: 1
        }],
        allChanges: [],
        allComments: [],
        repoItems: []
    }, {}, [{ name: "alice", displayName: "Alice Dev" }]);

    var html = stub.getHtml();
    assert.match(html, /Alice Dev/);
    assert.match(html, /Bob Dev/);
    assert.equal(html.indexOf("ujg-ua-detail-user-filter"), -1);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/user-activity-repo.test.js --test-name-pattern="renders all actions without selected-user filter UI"`

Expected: FAIL because current implementation filters by selected users and renders user filter control.

**Step 3: Write minimal implementation**

В `ujg-user-activity-modules/daily-detail.js`:

- убрать рендер `renderUserFilter(...)` из `renderInner(...)`;
- убрать `filterActionsBySelectedUsers(...)` из issue/team views;
- строить team timeline через `buildDerivedColumns(...)` по фактическим авторам действий, а не по `selectedUsers`;
- удалить или не использовать ветку `unmatched`, если она больше не нужна после hard-open.

Минимальный ориентир:

```javascript
var filteredJiraActions = jiraActions;
var filteredRepoActions = repoActions;
var model = buildTimelineModel(normalized, [], date);
```

**Step 4: Run test to verify it passes**

Run: `node --test tests/user-activity-repo.test.js --test-name-pattern="renders all actions without selected-user filter UI"`

Expected: PASS

**Step 5: Commit**

```bash
git add tests/user-activity-repo.test.js ujg-user-activity-modules/daily-detail.js
git commit -m "fix(user-activity): remove day detail user filtering for diagnostics"
```

### Task 4: Обновить существующие hard-match тесты под новый режим

**Files:**
- Modify: `tests/user-activity-repo.test.js`
- Test: `tests/user-activity-repo.test.js`

**Step 1: Rewrite obsolete tests**

Обновить тесты, которые фиксируют старое поведение:

- `day detail user filter narrows issue view to one selected user`
- `day detail user filter narrows team view to one column`
- `day detail team view leaves ambiguous author unmatched instead of mislabeling`
- любые проверки на сокращённый author label в unified calendar

Новые проверки должны подтверждать:

- все действия дня видны без downstream user filter;
- timeline строится по фактическим авторам;
- ambiguous author больше не теряется в `unmatched`.

**Step 2: Run targeted suite to verify failures are gone**

Run: `node --test tests/user-activity-repo.test.js`

Expected: оставшиеся FAIL укажут на ещё не переведённые ожидания старого режима.

**Step 3: Clean up test names**

Переименовать тесты так, чтобы в названии явно было `hard-open`, например:

```javascript
test("day detail hard-open builds team columns from actual authors", function() {
    // ...
});
```

**Step 4: Run full targeted suite**

Run: `node --test tests/user-activity-repo.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add tests/user-activity-repo.test.js
git commit -m "test(user-activity): align repo and day detail tests with hard-open mode"
```

### Task 5: Пересобрать bundle и проверить итоговый артефакт

**Files:**
- Modify: `ujg-user-activity.js`
- Modify: `ujg-user-activity.runtime.js`
- Test: `tests/user-activity-repo.test.js`

**Step 1: Rebuild bundle**

Run: `node build-user-activity.js`

Expected: успешная сборка `ujg-user-activity.js` без ошибок.

**Step 2: Re-run targeted tests after build**

Run: `node --test tests/user-activity-repo.test.js`

Expected: PASS

**Step 3: Verify no unexpected file changes**

Run: `git status --short`

Expected: изменены только ожидаемые source/test/bundle файлы.

**Step 4: Commit**

```bash
git add ujg-user-activity-modules/repo-data-processor.js \
        ujg-user-activity-modules/unified-calendar.js \
        ujg-user-activity-modules/daily-detail.js \
        tests/user-activity-repo.test.js \
        ujg-user-activity.js \
        ujg-user-activity.runtime.js
git commit -m "fix(user-activity): remove downstream filters in hard-open diagnostics"
```
