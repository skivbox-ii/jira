# Story Browser Epic Hierarchy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Перевести `ujg-story-browser` на согласованную модель `Epic -> Story -> Child Task`, добавить searchable filters для всех селектов, сделать multi-select по эпикам, рендерить кликабельные ключи Jira и вывести в таблицу `Классификация`, `Метки`, `Компоненты` без отхода от референса `/stories`.

**Architecture:** Источник истины делится на два слоя. Слой каталога фильтров хранит все эпики проекта и UI-state фильтров. Слой display-data строится staged-запросами: сначала эпики проекта, затем только `Story` для выбранных открытых эпиков, затем child issues по extracted `issuelinks` keys. `main.js` управляет загрузкой и state, `api.js` инкапсулирует JQL/пагинацию, `data.js` собирает нормализованное дерево и классификацию, `rendering.js` и `ujg-story-browser.css` дают единый reference-like UI для таблицы, аккордеона и строк.

**Tech Stack:** AMD modules, jQuery, Jira REST API `/rest/api/2/search`, plain CSS, Node `--test`.

---

## Task 1: Закрыть API-контракт под epic-first pipeline

**Files:**
- Modify: `jira/ujg-story-browser-modules/config.js`
- Modify: `jira/ujg-story-browser-modules/api.js`
- Modify: `jira/tests/story-browser-api-data.test.js`
- Modify: `jira/tests/story-browser-core.test.js`

**Steps:**
1. В `jira/tests/story-browser-api-data.test.js` сначала добавить красные тесты на новый контракт:
   - `ISSUE_FIELDS` включает `issuelinks`;
   - `getProjectEpics(projectKey)` шлёт JQL только по эпикам проекта;
   - `getStoriesForEpicKeys(projectKey, epicKeys)` шлёт JQL только по `Story` и конкретным epic keys;
   - `getIssuesByKeys(issueKeys)` умеет грузить задачи пачками и не падает на пустом массиве.
2. В `jira/ujg-story-browser-modules/config.js` расширить `ISSUE_FIELDS` полем `issuelinks`. Если в модуле удобно, вынести `EPIC_ISSUE_TYPE = "Epic"`, `STORY_ISSUE_TYPE = "Story"` и allowlist link names `["child", "is_child"]`.
3. В `jira/ujg-story-browser-modules/api.js` реализовать три явных метода вместо одного общего project-wide fetch:
   - `getProjectEpics(projectKey, onProgress)`
   - `getStoriesForEpicKeys(projectKey, epicKeys, onProgress)`
   - `getIssuesByKeys(issueKeys, onProgress)`
4. JQL строить минимально и предсказуемо:

```js
project = DEMO AND issuetype = Epic ORDER BY key ASC
project = DEMO AND issuetype = Story AND cf[10014] in (DEMO-1, DEMO-2) ORDER BY key ASC
key in (DEMO-10, DEMO-11) ORDER BY key ASC
```

5. Сохранить пагинацию по `maxResults = 100` и existing progress callback contract.
6. Прогнать `node --test jira/tests/story-browser-api-data.test.js jira/tests/story-browser-core.test.js`.

**Checkpoint commit:** `test: lock story browser epic query contract`

## Task 2: Пересобрать нормализацию и дерево под `Epic -> Story -> Child`

**Files:**
- Modify: `jira/ujg-story-browser-modules/data.js`
- Modify: `jira/tests/story-browser-api-data.test.js`
- Modify: `jira/tests/story-browser-core.test.js`

**Steps:**
1. В тестах сначала зафиксировать новую модель:
   - каталог эпиков содержит и открытые, и закрытые эпики;
   - каталог сортируется по числовой части ключа;
   - display roots содержат только открытые эпики;
   - под эпиком остаются только `Story`;
   - child keys берутся только из `child` / `is_child` issue links;
   - child classification определяется по summary prefix и помечает отсутствие префикса.
2. В `jira/ujg-story-browser-modules/data.js` отделить `epicCatalog` от `displayTree`. Не пытаться снова строить дерево из одного массива raw issues.
3. Добавить компактные helpers:
   - `compareIssueKeys(a, b)`
   - `isDoneStatus(node)`
   - `extractChildLinkedKeys(story)`
   - `readClassification(summary)`
   - `buildBrowseUrl(baseUrl, key)`
4. Новый конструктор дерева сделать явным:

```js
buildTree({
  epics: epicIssues,
  stories: storyIssues,
  children: childIssues
})
```

5. На выходе каждого узла держать только то, что реально нужно рендеру: `key`, `summary`, `type`, `status`, `sprint`, `labels`, `components`, `browseUrl`, `classification`, `classificationMissing`, `children`.
6. Обновить `collectFilters()` и `filterTree()` под:
   - `selectedEpicKeys: string[]`
   - пост-фильтрацию по статусу, спринту и поиску
   - сохранение родителя, если матчится потомок.
7. Прогнать `node --test jira/tests/story-browser-api-data.test.js jira/tests/story-browser-core.test.js`.

**Checkpoint commit:** `refactor: reshape story browser tree around epics`

## Task 3: Перевести `main.js` и storage на новый state/load flow

**Files:**
- Modify: `jira/ujg-story-browser-modules/main.js`
- Modify: `jira/ujg-story-browser-modules/storage.js`
- Modify: `jira/tests/story-browser-main.test.js`
- Modify: `jira/tests/story-browser-core.test.js`

**Steps:**
1. В `jira/tests/story-browser-main.test.js` добавить красные сценарии:
   - сохранённый single epic filter мигрирует в массив;
   - смена проекта сначала грузит catalog эпиков;
   - смена selected epics перезапускает stories/children load;
   - смена статуса/спринта/поиска не делает Jira refetch, а фильтрует локально;
   - выбор только закрытых эпиков даёт пустое состояние без ошибки.
2. В `jira/ujg-story-browser-modules/storage.js` перевести epic state на массив `selectedEpicKeys`, сохранив backward compatibility:

```js
if (typeof saved.epic === "string" && !saved.selectedEpicKeys) {
  saved.selectedEpicKeys = saved.epic ? [saved.epic] : [];
}
```

3. В `jira/ujg-story-browser-modules/main.js` разделить загрузку на этапы:
   - `loadProjectCatalog(projectKey)` -> все эпики;
   - `loadDisplayData(projectKey, selectedEpicKeys)` -> открытые эпики -> stories -> children;
   - `rerenderFromLoadedData()` -> применить status/sprint/search filters без refetch.
4. Держать в state отдельно:
   - `epicCatalog`
   - `selectedEpicKeys`
   - `loadedEpics`
   - `loadedStories`
   - `loadedChildren`
   - `tree`
5. Убедиться, что view mode и expand/collapse продолжают работать поверх новой структуры без дублей состояния.
6. Прогнать `node --test jira/tests/story-browser-main.test.js jira/tests/story-browser-core.test.js`.

**Checkpoint commit:** `refactor: orchestrate story browser staged loading`

## Task 4: Собрать reference-like searchable filters и новые колонки

**Files:**
- Modify: `jira/ujg-story-browser-modules/rendering.js`
- Modify: `jira/ujg-story-browser.css`
- Modify: `jira/tests/story-browser-rendering.test.js`
- Modify: `jira/tests/story-browser-css.test.js`
- Modify: `jira/tests/standalone-story-browser.test.js`

**Steps:**
1. В `jira/tests/story-browser-rendering.test.js` сначала зафиксировать UI-контракт:
   - `Проект`, `Статус`, `Эпик`, `Спринт` рендерятся как searchable pickers;
   - `Эпик` поддерживает multi-select и chips;
   - ключи задач рендерятся как ссылки `/browse/KEY`;
   - таблица содержит колонки `Классификация`, `Ключ`, `Название`, `Статус`, `Спринт`, `Метки`, `Компоненты`;
   - child без prefix получает красный indicator.
2. В `jira/ujg-story-browser-modules/rendering.js` не тащить стороннюю библиотеку. Сделать один переиспользуемый custom picker:
   - single-select mode для проекта/статуса/спринта;
   - multi-select mode для эпиков;
   - локальный search input внутри dropdown;
   - compact chips strip для выбранных эпиков.
3. Заменить plain-text key cell на ссылку:

```js
$("<a/>")
  .addClass("ujg-sb-key-link")
  .attr("href", node.browseUrl)
  .attr("target", "_blank")
  .attr("rel", "noreferrer noopener")
  .text(node.key);
```

4. Пересобрать table/accordion/rows на общем node contract:
   - `classification` badge;
   - compact `labels` and `components`;
   - визуально отличимые `Epic`, `Story`, `Child`;
   - красный class для `classificationMissing`.
5. В `jira/ujg-story-browser.css` добавить только необходимые semantic selectors, например:
   - `.ujg-sb-picker`
   - `.ujg-sb-picker-popover`
   - `.ujg-sb-picker-chip`
   - `.ujg-sb-key-link`
   - `.ujg-sb-classification-missing`
6. Обновить smoke/test expectations для standalone stories page.
7. Прогнать `node --test jira/tests/story-browser-rendering.test.js jira/tests/story-browser-css.test.js jira/tests/standalone-story-browser.test.js`.

**Checkpoint commit:** `feat: align story browser ui with epic workflow`

## Task 5: Пересборка generated assets, README и финальная верификация

**Files:**
- Modify: `jira/README.md`
- Generate: `jira/ujg-story-browser.js`
- Generate: `jira/ujg-story-browser.runtime.js`
- Generate: `jira/ujg-story-browser.bootstrap.js`
- Verify: `jira/docs/plans/2026-03-10-story-browser-epic-hierarchy-design.md`
- Verify: `jira/docs/plans/2026-03-10-story-browser-epic-hierarchy.md`

**Steps:**
1. Пересобрать bundle и bootstrap assets:
   - `node jira/build-story-browser.js`
   - `node jira/build-widget-bootstrap-assets.js`
2. Обновить `jira/README.md`:
   - добавить Story Browser в список виджетов;
   - синхронизировать структуру с `story-browser` файлами и новыми `docs/plans`;
   - при необходимости добавить секцию stable URL для Story Browser.
3. Прогнать focused regression suite:

```bash
node --test \
  jira/tests/story-browser-build.test.js \
  jira/tests/story-browser-core.test.js \
  jira/tests/story-browser-api-data.test.js \
  jira/tests/story-browser-main.test.js \
  jira/tests/story-browser-rendering.test.js \
  jira/tests/story-browser-css.test.js \
  jira/tests/standalone-story-browser.test.js \
  jira/tests/widget-bootstrap.test.js
```

4. Если focused suite зелёный, прогнать полный `node --test jira/tests/*.test.js`.
5. Проверить `git diff -- jira/README.md jira/docs/plans jira/ujg-story-browser* jira/ujg-story-browser-modules jira/tests/story-browser*`.

**Checkpoint commit:** `feat: rebuild story browser around epic hierarchy`

## Definition of Done

- Фильтр эпиков показывает все эпики, ищется по `KEY - summary`, поддерживает multi-select.
- В display-tree корнями остаются только открытые эпики.
- Под эпиком рендерятся только `Story`.
- Под `Story` рендерятся только child issues из `child` / `is_child` links.
- Ключ каждой задачи кликабелен и ведёт в Jira.
- Таблица, аккордеон и строки разделяют одну и ту же иерархию и новый набор полей.
- `README.md` отражает фактическую структуру после добавления design/plan docs и story-browser assets.
