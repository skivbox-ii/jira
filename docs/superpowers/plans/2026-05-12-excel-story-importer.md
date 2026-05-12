# Excel Story Importer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new modular Jira dashboard widget that imports an Excel remarks journal and creates one Jira Story per eligible row under a selected existing Epic.

**Architecture:** Follow the existing Story Browser dashboard pattern: source modules live in `ujg-excel-story-importer-modules/`, `build-excel-story-importer.js` concatenates them into `ujg-excel-story-importer.js`, and `build-widget-bootstrap-assets.js` generates `ujg-excel-story-importer.runtime.js` plus `ujg-excel-story-importer.bootstrap.js`. Keep parser, description formatting, Jira creation, rendering, and state orchestration in separate modules.

**Tech Stack:** Browser JavaScript, AMD modules, jQuery, Jira REST `/rest/api/2`, SheetJS loaded from CDN, Node `node:test` for focused tests.

---

## File Structure

- Create `ujg-excel-story-importer-modules/config.js`: constants, column names, issue types, role template, Jira custom field defaults.
- Create `ujg-excel-story-importer-modules/parser.js`: workbook-to-row normalization with dirty-header scanning.
- Create `ujg-excel-story-importer-modules/description.js`: Jira wiki table description builder.
- Create `ujg-excel-story-importer-modules/creator.js`: row duplicate guard, Story create payload, optional subtask sequence.
- Create `ujg-excel-story-importer-modules/api.js`: Jira REST wrapper for projects, Epics, fields, and issue creation.
- Create `ujg-excel-story-importer-modules/excel-loader.js`: SheetJS script loading and file-to-workbook read.
- Create `ujg-excel-story-importer-modules/rendering.js`: compact UI and row table rendering.
- Create `ujg-excel-story-importer-modules/main.js`: widget state, event wiring, project/Epic/file/create flow.
- Create `build-excel-story-importer.js`: concatenates modules and exposes `_ujgExcelStoryImporter`.
- Create `ujg-excel-story-importer.css`: scoped importer styling.
- Generate `ujg-excel-story-importer.js` from source modules.
- Generate `ujg-excel-story-importer.runtime.js` and `ujg-excel-story-importer.bootstrap.js`.
- Create `standalone/public/excel-import.html`.
- Modify `build-widget-bootstrap-assets.js`, `standalone/server.js`, standalone navigation HTML files, and `README.md`.
- Add tests: `tests/excel-story-importer-parser.test.js`, `tests/excel-story-importer-description.test.js`, `tests/excel-story-importer-creator.test.js`, `tests/excel-story-importer-build.test.js`, and `tests/standalone-excel-import.test.js`.

## Task 1: Parser And Config

**Files:**
- Create: `ujg-excel-story-importer-modules/config.js`
- Create: `ujg-excel-story-importer-modules/parser.js`
- Test: `tests/excel-story-importer-parser.test.js`

- [ ] **Step 1: Write the failing parser tests**

Create `tests/excel-story-importer-parser.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const loadAmdModule = require("./helpers/load-amd-module");

const MODULE_DIR = path.join(__dirname, "..", "ujg-excel-story-importer-modules");

function loadConfig() {
  return loadAmdModule(path.join(MODULE_DIR, "config.js"), {});
}

function loadParser() {
  const config = loadConfig();
  return loadAmdModule(path.join(MODULE_DIR, "parser.js"), {
    "_ujgESI_config": config
  });
}

test("parseWorkbook finds remarks header below non-data rows", function() {
  const parser = loadParser();
  const workbook = {
    SheetNames: ["Журнал"],
    Sheets: {
      "Журнал": {
        __rows: [
          ["", "", ""],
          ["Тестирование", "11", ""],
          ["№", "Замечание", "Jira", "Модуль", "Приоритет"],
          ["3", "Нет настроек полей сообщений", "", "Алармы", "Высокий"],
          ["4", "", "", "Пустая строка", ""],
          ["5", "Экспорт не работает", "EVOSCADA-13495", "PARA", "Средний"]
        ]
      }
    }
  };

  const result = parser.parseWorkbook(workbook);

  assert.equal(result.sheetName, "Журнал");
  assert.equal(result.headerRowNumber, 3);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].summary, "Нет настроек полей сообщений");
  assert.equal(result.rows[0].excelRowNumber, 4);
  assert.equal(result.rows[0].jiraKey, "");
  assert.equal(result.rows[0].alreadyLinked, false);
  assert.equal(result.rows[1].jiraKey, "EVOSCADA-13495");
  assert.equal(result.rows[1].alreadyLinked, true);
  assert.equal(result.rows[1].sourceColumns["Модуль"], "PARA");
});

test("parseWorkbook scans sheets in order and skips sheets without remarks header", function() {
  const parser = loadParser();
  const workbook = {
    SheetNames: ["Сводка", "Журнал"],
    Sheets: {
      "Сводка": { __rows: [["Всего", "207"]] },
      "Журнал": {
        __rows: [
          ["№", "Замечание", "Jira"],
          ["17", "Фиксированная ширина не работает", "EVOSCADA-14447"]
        ]
      }
    }
  };

  const result = parser.parseWorkbook(workbook);

  assert.equal(result.sheetName, "Журнал");
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].jiraKey, "EVOSCADA-14447");
});

test("parseWorkbook reports missing remarks header", function() {
  const parser = loadParser();
  const workbook = {
    SheetNames: ["Лист1"],
    Sheets: { "Лист1": { __rows: [["№", "Комментарий"], ["1", "x"]] } }
  };

  assert.throws(function() {
    parser.parseWorkbook(workbook);
  }, /Колонка "Замечание" не найдена/);
});
```

- [ ] **Step 2: Run parser tests and verify they fail because modules do not exist**

Run:

```bash
node --test tests/excel-story-importer-parser.test.js
```

Expected: FAIL with `ENOENT` for `ujg-excel-story-importer-modules/config.js`.

- [ ] **Step 3: Implement config and parser**

Create `ujg-excel-story-importer-modules/config.js` with:

```js
define("_ujgESI_config", [], function() {
  "use strict";

  var EPIC_LINK_FIELD = "customfield_10014";
  var STORAGE_KEY = "ujg-esi-state";
  var SUMMARY_COLUMN = "Замечание";
  var JIRA_COLUMN = "Jira";
  var STORY_ISSUE_TYPE = "Story";
  var DEFAULT_SHEETJS_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";

  var KNOWN_COLUMNS = [
    "№",
    "Замечание",
    "Статус",
    "Модуль",
    "Приоритет",
    "Автор",
    "Дата",
    "Исполнитель",
    "Спринт",
    "Комментарий",
    "Jira",
    "Пункт НД",
    "Тип",
    "Скрин",
    "Статус в Jira",
    "Исполнитель в Jira",
    "Подтверждено заказчиком"
  ];

  var CREATE_TEMPLATE_ROLES = [
    { role: "SE", issueType: "System Engineer", summary: "Анализ и описание функционала" },
    { role: "FE", issueType: "Frontend Task", summary: "Вёрстка / UI" },
    { role: "BE", issueType: "Backend Task", summary: "Реализация логики" },
    { role: "QA", issueType: "QA", summary: "Тестирование" },
    { role: "DO", issueType: "DevOps", summary: "Подготовка окружения / деплой" }
  ];

  function trimSlash(s) {
    return String(s || "").replace(/\/+$/, "");
  }

  function resolveJiraBaseUrl() {
    var origin = "";
    if (typeof window !== "undefined" && window.location) {
      origin = trimSlash(window.location.origin || "");
      if (window.AJS && window.AJS.params && window.AJS.params.baseURL != null) {
        return trimSlash(String(window.AJS.params.baseURL));
      }
    }
    return origin;
  }

  return {
    baseUrl: resolveJiraBaseUrl(),
    EPIC_LINK_FIELD: EPIC_LINK_FIELD,
    STORAGE_KEY: STORAGE_KEY,
    SUMMARY_COLUMN: SUMMARY_COLUMN,
    JIRA_COLUMN: JIRA_COLUMN,
    STORY_ISSUE_TYPE: STORY_ISSUE_TYPE,
    DEFAULT_SHEETJS_URL: DEFAULT_SHEETJS_URL,
    KNOWN_COLUMNS: KNOWN_COLUMNS,
    CREATE_TEMPLATE_ROLES: CREATE_TEMPLATE_ROLES
  };
});
```

Create `ujg-excel-story-importer-modules/parser.js` with:

```js
define("_ujgESI_parser", ["_ujgESI_config"], function(config) {
  "use strict";

  function cellText(value) {
    if (value == null) return "";
    if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    return String(value).replace(/\s+/g, " ").trim();
  }

  function sheetRows(sheet) {
    if (!sheet) return [];
    if (Array.isArray(sheet.__rows)) return sheet.__rows;
    if (typeof XLSX !== "undefined" && XLSX.utils && XLSX.utils.sheet_to_json) {
      return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
    }
    return [];
  }

  function extractJiraKey(value) {
    var match = /([A-Z][A-Z0-9]+-\d+)/.exec(String(value || "").toUpperCase());
    return match ? match[1] : "";
  }

  function findHeader(rows) {
    var i;
    var j;
    for (i = 0; i < rows.length; i += 1) {
      for (j = 0; j < (rows[i] || []).length; j += 1) {
        if (cellText(rows[i][j]) === config.SUMMARY_COLUMN) {
          return { rowIndex: i, summaryIndex: j };
        }
      }
    }
    return null;
  }

  function headerNames(row) {
    return (row || []).map(function(value, index) {
      var text = cellText(value);
      return text || "Колонка " + String(index + 1);
    });
  }

  function parseRows(sheetName, rows, header) {
    var headers = headerNames(rows[header.rowIndex]);
    var out = [];
    var i;
    var j;
    for (i = header.rowIndex + 1; i < rows.length; i += 1) {
      var row = rows[i] || [];
      var summary = cellText(row[header.summaryIndex]);
      if (!summary) continue;
      var sourceColumns = {};
      for (j = 0; j < headers.length; j += 1) {
        var name = headers[j];
        var value = cellText(row[j]);
        if (name && value) sourceColumns[name] = value;
      }
      var jiraKey = extractJiraKey(sourceColumns[config.JIRA_COLUMN]);
      out.push({
        id: sheetName + ":" + String(i + 1),
        sheetName: sheetName,
        excelRowNumber: i + 1,
        summary: summary,
        sourceColumns: sourceColumns,
        jiraKey: jiraKey,
        alreadyLinked: !!jiraKey,
        status: jiraKey ? "linked" : "ready",
        createdKey: "",
        errors: []
      });
    }
    return out;
  }

  function parseWorkbook(workbook) {
    var sheetNames = workbook && Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
    var i;
    for (i = 0; i < sheetNames.length; i += 1) {
      var sheetName = String(sheetNames[i]);
      var rows = sheetRows(workbook.Sheets && workbook.Sheets[sheetName]);
      var header = findHeader(rows);
      if (header) {
        return {
          sheetName: sheetName,
          headerRowNumber: header.rowIndex + 1,
          rows: parseRows(sheetName, rows, header)
        };
      }
    }
    throw new Error('Колонка "Замечание" не найдена');
  }

  return {
    parseWorkbook: parseWorkbook,
    extractJiraKey: extractJiraKey,
    cellText: cellText
  };
});
```

- [ ] **Step 4: Run parser tests and verify they pass**

Run:

```bash
node --test tests/excel-story-importer-parser.test.js
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit parser work**

Run:

```bash
git add tests/excel-story-importer-parser.test.js ujg-excel-story-importer-modules/config.js ujg-excel-story-importer-modules/parser.js
git commit -m "feat(excel-import): parse remarks workbook rows"
```

## Task 2: Description Builder

**Files:**
- Create: `ujg-excel-story-importer-modules/description.js`
- Test: `tests/excel-story-importer-description.test.js`

- [ ] **Step 1: Write the failing description tests**

Create `tests/excel-story-importer-description.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const loadAmdModule = require("./helpers/load-amd-module");

const MODULE_DIR = path.join(__dirname, "..", "ujg-excel-story-importer-modules");

function loadDescription() {
  return loadAmdModule(path.join(MODULE_DIR, "description.js"), {});
}

test("buildDescription creates Jira wiki table from non-empty source columns", function() {
  const description = loadDescription();
  const text = description.buildDescription({
    sheetName: "Журнал",
    excelRowNumber: 12,
    sourceColumns: {
      "№": "3",
      "Замечание": "В сообщениях предусмотрена только одна группа",
      "Модуль": "Алармы",
      "Комментарий": "",
      "Jira": ""
    }
  });

  assert.match(text, /\|\|Поле\|\|Значение\|\|/);
  assert.match(text, /\|Лист\|Журнал\|/);
  assert.match(text, /\|Строка Excel\|12\|/);
  assert.match(text, /\|Модуль\|Алармы\|/);
  assert.doesNotMatch(text, /Комментарий/);
});

test("buildDescription escapes Jira wiki table separators", function() {
  const description = loadDescription();
  const text = description.buildDescription({
    sourceColumns: {
      "Замечание": "A | B",
      "Скрин": "\\\\server\\path"
    }
  });

  assert.match(text, /A \\&#124; B/);
  assert.match(text, /\\\\server\\\\path/);
});
```

- [ ] **Step 2: Run description tests and verify they fail because module does not exist**

Run:

```bash
node --test tests/excel-story-importer-description.test.js
```

Expected: FAIL with `ENOENT` for `description.js`.

- [ ] **Step 3: Implement description module**

Create `ujg-excel-story-importer-modules/description.js` with:

```js
define("_ujgESI_description", [], function() {
  "use strict";

  function text(value) {
    return value == null ? "" : String(value);
  }

  function escapeCell(value) {
    return text(value)
      .replace(/\\/g, "\\\\")
      .replace(/\r?\n/g, "\\\\")
      .replace(/\|/g, "\\&#124;")
      .trim();
  }

  function appendRow(lines, name, value) {
    var v = escapeCell(value);
    if (!v) return;
    lines.push("|" + escapeCell(name) + "|" + v + "|");
  }

  function buildDescription(row) {
    var lines = [
      "Импортировано из журнала замечаний.",
      "",
      "||Поле||Значение||"
    ];
    if (row && row.sheetName) appendRow(lines, "Лист", row.sheetName);
    if (row && row.excelRowNumber != null) appendRow(lines, "Строка Excel", row.excelRowNumber);
    var cols = row && row.sourceColumns ? row.sourceColumns : {};
    Object.keys(cols).forEach(function(name) {
      appendRow(lines, name, cols[name]);
    });
    return lines.join("\n");
  }

  return {
    buildDescription: buildDescription,
    escapeCell: escapeCell
  };
});
```

- [ ] **Step 4: Run description tests and verify they pass**

Run:

```bash
node --test tests/excel-story-importer-description.test.js
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit description work**

Run:

```bash
git add tests/excel-story-importer-description.test.js ujg-excel-story-importer-modules/description.js
git commit -m "feat(excel-import): build Jira descriptions from rows"
```

## Task 3: Creator

**Files:**
- Create: `ujg-excel-story-importer-modules/creator.js`
- Test: `tests/excel-story-importer-creator.test.js`

- [ ] **Step 1: Write the failing creator tests**

Create `tests/excel-story-importer-creator.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const loadAmdModule = require("./helpers/load-amd-module");

const MODULE_DIR = path.join(__dirname, "..", "ujg-excel-story-importer-modules");

function loadConfig() {
  return loadAmdModule(path.join(MODULE_DIR, "config.js"), {});
}

function loadCreator() {
  const config = loadConfig();
  const description = loadAmdModule(path.join(MODULE_DIR, "description.js"), {});
  return loadAmdModule(path.join(MODULE_DIR, "creator.js"), {
    "_ujgESI_config": config,
    "_ujgESI_description": description
  });
}

test("createRow skips rows that already have a Jira key", async function() {
  const creator = loadCreator();
  const calls = [];
  const api = { createIssue: function(payload) { calls.push(payload); return Promise.resolve({ key: "NEW-1" }); } };

  const result = await creator.createRow(api, {
    summary: "Already linked",
    jiraKey: "EVOSCADA-1",
    alreadyLinked: true,
    sourceColumns: { "Замечание": "Already linked", "Jira": "EVOSCADA-1" }
  }, { projectKey: "EVOSCADA", epicKey: "EVOSCADA-10", createSubtasks: true });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(calls.length, 0);
});

test("createRow creates Story under selected Epic and then template subtasks", async function() {
  const creator = loadCreator();
  const calls = [];
  const keys = ["EVOSCADA-2000", "EVOSCADA-2001", "EVOSCADA-2002", "EVOSCADA-2003", "EVOSCADA-2004", "EVOSCADA-2005"];
  const api = {
    createIssue: function(payload) {
      calls.push(payload);
      return Promise.resolve({ key: keys[calls.length - 1] });
    }
  };

  const result = await creator.createRow(api, {
    summary: "Нет настроек полей сообщений",
    sourceColumns: { "Замечание": "Нет настроек полей сообщений", "Модуль": "Алармы" },
    alreadyLinked: false
  }, { projectKey: "EVOSCADA", epicKey: "EVOSCADA-100", createSubtasks: true });

  assert.equal(result.ok, true);
  assert.equal(result.createdKey, "EVOSCADA-2000");
  assert.equal(calls.length, 6);
  assert.equal(calls[0].fields.project.key, "EVOSCADA");
  assert.equal(calls[0].fields.summary, "Нет настроек полей сообщений");
  assert.deepEqual(calls[0].fields.customfield_10014, { key: "EVOSCADA-100" });
  assert.equal(calls[1].fields.parent.key, "EVOSCADA-2000");
  assert.equal(calls[1].fields.issuetype.name, "System Engineer");
});
```

- [ ] **Step 2: Run creator tests and verify they fail because module does not exist**

Run:

```bash
node --test tests/excel-story-importer-creator.test.js
```

Expected: FAIL with `ENOENT` for `creator.js`.

- [ ] **Step 3: Implement creator module**

Create `ujg-excel-story-importer-modules/creator.js` with:

```js
define("_ujgESI_creator", ["_ujgESI_config", "_ujgESI_description"], function(config, description) {
  "use strict";

  function ajaxErrorText(err) {
    if (!err) return "Request failed";
    if (err.responseJSON && err.responseJSON.errorMessages && err.responseJSON.errorMessages.length) {
      return err.responseJSON.errorMessages.join(" ");
    }
    if (err.statusText) return String(err.statusText);
    if (err.message) return String(err.message);
    return "Request failed";
  }

  function createdKey(res) {
    return res && res.key != null ? String(res.key).trim() : "";
  }

  function storyFields(row, options) {
    var fields = {
      project: { key: String(options.projectKey || "") },
      summary: String(row.summary || "").trim(),
      issuetype: { name: config.STORY_ISSUE_TYPE },
      description: description.buildDescription(row)
    };
    if (options.epicKey && config.EPIC_LINK_FIELD) {
      fields[config.EPIC_LINK_FIELD] = { key: String(options.epicKey) };
    }
    return fields;
  }

  function subtaskFields(projectKey, parentKey, role) {
    return {
      project: { key: String(projectKey || "") },
      parent: { key: String(parentKey || "") },
      summary: String(role.summary || ""),
      issuetype: { name: String(role.issueType || "") },
      description: "Создано автоматически из журнала замечаний."
    };
  }

  function createSubtasksSequential(api, projectKey, parentKey, index, errors) {
    var roles = config.CREATE_TEMPLATE_ROLES || [];
    if (index >= roles.length) {
      return Promise.resolve({ ok: errors.length === 0, errors: errors });
    }
    return Promise.resolve(api.createIssue({ fields: subtaskFields(projectKey, parentKey, roles[index]) })).then(
      function(res) {
        if (!createdKey(res)) errors.push("Subtask response missing issue key: " + roles[index].role);
        return createSubtasksSequential(api, projectKey, parentKey, index + 1, errors);
      },
      function(err) {
        errors.push(roles[index].role + ": " + ajaxErrorText(err));
        return createSubtasksSequential(api, projectKey, parentKey, index + 1, errors);
      }
    );
  }

  function createRow(api, row, options) {
    var opts = options || {};
    if (row && (row.alreadyLinked || row.jiraKey)) {
      return Promise.resolve({ ok: true, skipped: true, createdKey: row.jiraKey || "" });
    }
    if (!api || typeof api.createIssue !== "function") {
      return Promise.resolve({ ok: false, errors: ["Jira API is not available"] });
    }
    return Promise.resolve(api.createIssue({ fields: storyFields(row, opts) })).then(
      function(res) {
        var key = createdKey(res);
        if (!key) return { ok: false, errors: ["Story response missing issue key"] };
        if (!opts.createSubtasks) return { ok: true, createdKey: key, errors: [] };
        return createSubtasksSequential(api, opts.projectKey, key, 0, []).then(function(sub) {
          return {
            ok: sub.errors.length === 0,
            partial: sub.errors.length > 0,
            createdKey: key,
            errors: sub.errors
          };
        });
      },
      function(err) {
        return { ok: false, errors: [ajaxErrorText(err)] };
      }
    );
  }

  return {
    createRow: createRow,
    storyFields: storyFields,
    subtaskFields: subtaskFields
  };
});
```

- [ ] **Step 4: Run creator tests and verify they pass**

Run:

```bash
node --test tests/excel-story-importer-creator.test.js
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit creator work**

Run:

```bash
git add tests/excel-story-importer-creator.test.js ujg-excel-story-importer-modules/creator.js
git commit -m "feat(excel-import): create Jira stories from rows"
```

## Task 4: Build Script And Bundle

**Files:**
- Create: `build-excel-story-importer.js`
- Create during build: `ujg-excel-story-importer.js`
- Test: `tests/excel-story-importer-build.test.js`

- [ ] **Step 1: Write the failing build tests**

Create `tests/excel-story-importer-build.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const BUILD_SCRIPT = path.join(ROOT, "build-excel-story-importer.js");
const OUTPUT_FILE = path.join(ROOT, "ujg-excel-story-importer.js");

function extractModuleMarkers(content) {
  const re = /\/\* === Module: ([^ ]+) === \*\//g;
  const names = [];
  let m;
  while ((m = re.exec(content)) !== null) names.push(m[1]);
  return names;
}

test("build-excel-story-importer exports { build }", function() {
  const mod = require(BUILD_SCRIPT);
  assert.equal(typeof mod.build, "function");
  assert.ok(Array.isArray(mod.build.MODULE_ORDER));
});

test("build emits ujg-excel-story-importer.js with public AMD alias", function() {
  const { build } = require(BUILD_SCRIPT);
  build();
  const content = fs.readFileSync(OUTPUT_FILE, "utf8");
  assert.deepEqual(extractModuleMarkers(content), build.MODULE_ORDER);
  assert.match(content, /define\("_ujgExcelStoryImporter", \["_ujgESI_main"\], function\(G\)/);
});

test("CLI build updates output", function() {
  execFileSync(process.execPath, [BUILD_SCRIPT], { cwd: ROOT, stdio: "pipe" });
  assert.ok(fs.existsSync(OUTPUT_FILE));
});
```

- [ ] **Step 2: Run build tests and verify they fail because build script does not exist**

Run:

```bash
node --test tests/excel-story-importer-build.test.js
```

Expected: FAIL with `MODULE_NOT_FOUND` for `build-excel-story-importer.js`.

- [ ] **Step 3: Add the remaining AMD modules required by the build**

Create `ujg-excel-story-importer-modules/api.js`, `excel-loader.js`, `rendering.js`, and `main.js` with minimal exports so the build can concatenate a complete widget. `main.js` must return a constructor.

`api.js`:

```js
define("_ujgESI_api", ["jquery", "_ujgESI_config"], function($, config) {
  "use strict";

  return {
    getProjects: function() {
      return $.ajax({ url: config.baseUrl + "/rest/api/2/project", type: "GET" });
    },
    getProjectEpics: function(projectKey) {
      return $.ajax({
        url: config.baseUrl + "/rest/api/2/search",
        type: "POST",
        contentType: "application/json",
        dataType: "json",
        data: JSON.stringify({
          jql: "project = " + String(projectKey || "") + " AND issuetype = Epic ORDER BY key DESC",
          fields: ["summary", "status"],
          maxResults: 100
        })
      });
    },
    createIssue: function(payload) {
      return $.ajax({
        url: config.baseUrl + "/rest/api/2/issue",
        type: "POST",
        contentType: "application/json",
        dataType: "json",
        data: JSON.stringify(payload)
      });
    }
  };
});
```

`excel-loader.js`:

```js
define("_ujgESI_excel-loader", ["_ujgESI_config"], function(config) {
  "use strict";

  var loadPromise = null;

  function loadScript(url) {
    return new Promise(function(resolve, reject) {
      var s = document.createElement("script");
      s.src = url;
      s.onload = function() { resolve(); };
      s.onerror = function() { reject(new Error("SheetJS load failed")); };
      document.head.appendChild(s);
    });
  }

  function ensureXlsx() {
    if (typeof XLSX !== "undefined") return Promise.resolve(XLSX);
    if (!loadPromise) {
      loadPromise = loadScript(config.DEFAULT_SHEETJS_URL).then(function() {
        if (typeof XLSX === "undefined") throw new Error("SheetJS is unavailable");
        return XLSX;
      });
    }
    return loadPromise;
  }

  function readWorkbook(file) {
    return ensureXlsx().then(function(xlsx) {
      return file.arrayBuffer().then(function(buffer) {
        return xlsx.read(buffer, { type: "array", cellDates: true });
      });
    });
  }

  return {
    ensureXlsx: ensureXlsx,
    readWorkbook: readWorkbook
  };
});
```

`rendering.js`:

```js
define("_ujgESI_rendering", ["jquery"], function($) {
  "use strict";

  var $root;
  var services;

  function init(container, svc) {
    $root = container;
    services = svc || {};
  }

  function render(state) {
    if (!$root || !$root.length) return;
    $root.empty();
    var s = state || {};
    var $wrap = $("<div/>").addClass("ujg-excel-story-importer");
    $wrap.append($("<h2/>").text("Импорт замечаний из Excel"));
    if (s.error) $wrap.append($("<div/>").addClass("ujg-esi-error").text(s.error));
    $wrap.append($("<div/>").addClass("ujg-esi-toolbar"));
    $root.append($wrap);
  }

  return {
    init: init,
    render: render
  };
});
```

`main.js`:

```js
define("_ujgESI_main", [
  "jquery",
  "_ujgESI_api",
  "_ujgESI_excel-loader",
  "_ujgESI_parser",
  "_ujgESI_creator",
  "_ujgESI_rendering"
], function($, api, excelLoader, parser, creator, rendering) {
  "use strict";

  function ExcelStoryImporterGadget(API) {
    var $content = API && API.getGadgetContentEl ? API.getGadgetContentEl() : $();
    var state = { rows: [], error: "" };
    rendering.init($content, { api: api, excelLoader: excelLoader, parser: parser, creator: creator });
    rendering.render(state);
  }

  return ExcelStoryImporterGadget;
});
```

- [ ] **Step 4: Implement build script**

Create `build-excel-story-importer.js` with:

```js
#!/usr/bin/env node

var fs = require("fs");
var path = require("path");

var MODULES_DIR = path.join(__dirname, "ujg-excel-story-importer-modules");
var OUTPUT_FILE = path.join(__dirname, "ujg-excel-story-importer.js");

var MODULE_ORDER = [
  "config.js",
  "description.js",
  "parser.js",
  "creator.js",
  "api.js",
  "excel-loader.js",
  "rendering.js",
  "main.js"
];

function readModule(fileName) {
  var filePath = path.join(MODULES_DIR, fileName);
  if (!fs.existsSync(filePath)) throw new Error("Module not found: " + fileName);
  return fs.readFileSync(filePath, "utf8");
}

function build() {
  console.log("Building ujg-excel-story-importer.js from modules...");
  var parts = [
    "// Auto-generated file - DO NOT EDIT MANUALLY",
    "// Generated by build-excel-story-importer.js",
    "// To modify, edit files in ujg-excel-story-importer-modules/ and rebuild",
    ""
  ];
  MODULE_ORDER.forEach(function(fileName) {
    parts.push("/* === Module: " + fileName + " === */");
    parts.push(readModule(fileName).trim());
    parts.push("");
  });
  parts.push('define("_ujgExcelStoryImporter", ["_ujgESI_main"], function(G) {');
  parts.push('  "use strict";');
  parts.push("  return G;");
  parts.push("});");
  parts.push("");
  fs.writeFileSync(OUTPUT_FILE, parts.join("\n"), "utf8");
}

build.MODULE_ORDER = MODULE_ORDER.slice();

if (require.main === module) build();

module.exports = { build: build };
```

- [ ] **Step 5: Run build tests and verify they pass**

Run:

```bash
node --test tests/excel-story-importer-build.test.js
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Commit build work**

Run:

```bash
git add build-excel-story-importer.js ujg-excel-story-importer-modules/api.js ujg-excel-story-importer-modules/excel-loader.js ujg-excel-story-importer-modules/rendering.js ujg-excel-story-importer-modules/main.js ujg-excel-story-importer.js tests/excel-story-importer-build.test.js
git commit -m "feat(excel-import): add modular widget build"
```

## Task 5: Full UI Flow

**Files:**
- Modify: `ujg-excel-story-importer-modules/rendering.js`
- Modify: `ujg-excel-story-importer-modules/main.js`
- Modify: `ujg-excel-story-importer-modules/api.js`
- Create: `ujg-excel-story-importer.css`

- [ ] **Step 1: Expand rendering module**

Replace the minimal renderer with a renderer that emits:

- project `<select class="ujg-esi-project-select">`;
- Epic `<select class="ujg-esi-epic-select">`;
- file `<input class="ujg-esi-file" type="file" accept=".xlsx,.xls">`;
- checkbox `<input class="ujg-esi-subtasks" type="checkbox">`;
- row table with `.ujg-esi-create-row` buttons.

Event callbacks must call `services.onProjectChange`, `services.onEpicChange`, `services.onFileChange`, `services.onSubtasksChange`, and `services.onCreateRow`.

- [ ] **Step 2: Expand main module**

Update state to include:

```js
{
  projects: [],
  projectKey: "",
  epics: [],
  epicKey: "",
  rows: [],
  createSubtasks: true,
  loading: false,
  error: ""
}
```

On startup, load projects with `api.getProjects()`. On project change, load Epics. On file change, read workbook with `excelLoader.readWorkbook(file)` and parse it with `parser.parseWorkbook(workbook)`. On row create, call `creator.createRow(api, row, { projectKey, epicKey, createSubtasks })`, update row status, and re-render.

- [ ] **Step 3: Harden API JQL quoting**

Add a local `toJqlToken(value)` helper in `api.js` matching Story Browser behavior: allow `[A-Za-z0-9_-]+` unquoted, otherwise quote and escape. Use it in Epic search JQL.

- [ ] **Step 4: Add scoped CSS**

Create `ujg-excel-story-importer.css` with scoped classes under `.ujg-excel-story-importer`. Use a dense dashboard layout: toolbar, counters, and table. Keep border radius at 8px or less.

- [ ] **Step 5: Rebuild bundle**

Run:

```bash
node build-excel-story-importer.js
```

Expected: `ujg-excel-story-importer.js` regenerated.

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --test tests/excel-story-importer-parser.test.js tests/excel-story-importer-description.test.js tests/excel-story-importer-creator.test.js tests/excel-story-importer-build.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit UI flow**

Run:

```bash
git add ujg-excel-story-importer-modules/rendering.js ujg-excel-story-importer-modules/main.js ujg-excel-story-importer-modules/api.js ujg-excel-story-importer.css ujg-excel-story-importer.js
git commit -m "feat(excel-import): add import preview workflow"
```

## Task 6: Bootstrap, Runtime, And Standalone

**Files:**
- Modify: `build-widget-bootstrap-assets.js`
- Generated: `ujg-excel-story-importer.bootstrap.js`
- Generated: `ujg-excel-story-importer.runtime.js`
- Modify: `standalone/server.js`
- Create: `standalone/public/excel-import.html`
- Modify: `standalone/public/sprint.html`
- Modify: `standalone/public/analytics.html`
- Modify: `standalone/public/timesheet.html`
- Modify: `standalone/public/timesheet-v0.html`
- Modify: `standalone/public/user-activity.html`
- Modify: `standalone/public/daily-diligence.html`
- Modify: `standalone/public/stories.html`
- Test: `tests/standalone-excel-import.test.js`
- Test: `tests/widget-bootstrap.test.js`

- [ ] **Step 1: Write standalone smoke tests**

Create `tests/standalone-excel-import.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("standalone server exposes excel importer assets and route", function() {
  const serverJs = read("standalone/server.js");
  assert.match(serverJs, /"ujg-excel-story-importer\.js"/);
  assert.match(serverJs, /"ujg-excel-story-importer\.css"/);
  assert.match(serverJs, /app\.get\("\/excel-import"/);
  assert.match(serverJs, /excel-import\.html/);
});

test("standalone excel import page loads importer assets and AMD module", function() {
  const html = read("standalone/public/excel-import.html");
  assert.match(html, /href="\/widgets\/ujg-excel-story-importer\.css"/);
  assert.match(html, /src="\/widgets\/_ujgCommon\.js"/);
  assert.match(html, /src="\/widgets\/ujg-excel-story-importer\.js"/);
  assert.match(html, /require\(\["_ujgExcelStoryImporter"\]/);
});

test("standalone widget pages link to excel import", function() {
  [
    "standalone/public/sprint.html",
    "standalone/public/analytics.html",
    "standalone/public/timesheet.html",
    "standalone/public/timesheet-v0.html",
    "standalone/public/user-activity.html",
    "standalone/public/daily-diligence.html",
    "standalone/public/stories.html"
  ].forEach(function(relPath) {
    assert.match(read(relPath), /href="\/excel-import"/, relPath);
  });
});
```

- [ ] **Step 2: Run standalone test and verify it fails**

Run:

```bash
node --test tests/standalone-excel-import.test.js
```

Expected: FAIL because route and page do not exist.

- [ ] **Step 3: Add widget to bootstrap generator**

In `build-widget-bootstrap-assets.js`, add:

```js
excelStoryImporter: "ujg-excel-story-importer"
```

to `WIDGETS`, and add:

```js
"ujg-excel-story-importer": {
  fileKey: "ujg-excel-story-importer",
  publicAmd: "_ujgExcelStoryImporter",
  runtimeAmd: "_ujgExcelStoryImporterRuntime"
}
```

to `WIDGET_SPECS`.

- [ ] **Step 4: Generate bootstrap and runtime files**

Run:

```bash
node build-widget-bootstrap-assets.js
```

Expected: output includes `ujg-excel-story-importer.bootstrap.js` and `ujg-excel-story-importer.runtime.js`.

- [ ] **Step 5: Add standalone route and page**

Update `standalone/server.js`:

- add `"ujg-excel-story-importer.js", "ujg-excel-story-importer.css"` to `WIDGET_FILES`;
- add `app.get("/excel-import", ...)` serving `standalone/public/excel-import.html`.

Create `standalone/public/excel-import.html` mirroring `stories.html`, with:

- title `Excel Import — UJG`;
- active nav link `/excel-import`;
- CSS `/widgets/ujg-excel-story-importer.css`;
- JS `/widgets/ujg-excel-story-importer.js`;
- `require(["_ujgExcelStoryImporter"], ...)`;
- `getGadgetContentEl` returning `jQuery("#widget-container")`.

- [ ] **Step 6: Add nav link to existing standalone pages**

Add `<li><a href="/excel-import">Excel Import</a></li>` to each existing standalone page nav. Mark it `class="nav-active"` only in `excel-import.html`.

- [ ] **Step 7: Run bootstrap and standalone tests**

Run:

```bash
node --test tests/widget-bootstrap.test.js tests/standalone-excel-import.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit bootstrap and standalone work**

Run:

```bash
git add build-widget-bootstrap-assets.js ujg-excel-story-importer.bootstrap.js ujg-excel-story-importer.runtime.js standalone/server.js standalone/public/*.html tests/standalone-excel-import.test.js
git commit -m "feat(excel-import): expose importer in bootstrap and standalone"
```

## Task 7: README And Final Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README widget list and Jira settings**

Add `Excel Story Importer` to the widget list and document Jira gadget settings:

```text
JavaScript URLs
https://cdn.jsdelivr.net/gh/skivbox-ii/jira@main/ujg-excel-story-importer.bootstrap.js

CSS URLs

AMD module
_ujgExcelStoryImporter

HTML to append
<div class="ujg-excel-story-importer" style="height: 5000px;"></div>
```

- [ ] **Step 2: Rebuild generated files**

Run:

```bash
node build-excel-story-importer.js
node build-widget-bootstrap-assets.js
```

Expected: generated importer bundle, runtime, and bootstrap are current.

- [ ] **Step 3: Run full focused verification**

Run:

```bash
node --test tests/excel-story-importer-parser.test.js tests/excel-story-importer-description.test.js tests/excel-story-importer-creator.test.js tests/excel-story-importer-build.test.js tests/widget-bootstrap.test.js tests/standalone-excel-import.test.js
```

Expected: PASS.

- [ ] **Step 4: Run existing Story Browser regression tests**

Run:

```bash
node --test tests/story-browser-build.test.js tests/story-browser-create-story.test.js tests/standalone-story-browser.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit docs and final generated state**

Run:

```bash
git add README.md ujg-excel-story-importer.js ujg-excel-story-importer.bootstrap.js ujg-excel-story-importer.runtime.js
git commit -m "docs(excel-import): document Jira gadget settings"
```

- [ ] **Step 6: Final status check**

Run:

```bash
git status --short
```

Expected: only pre-existing unrelated local changes remain, currently `ujg-project-analytics.js`.

## Execution Notes

The Jira gadget settings for the new widget after implementation will be:

```text
Gadget title
Импорт замечаний из Excel

JavaScript URLs
https://cdn.jsdelivr.net/gh/skivbox-ii/jira@main/ujg-excel-story-importer.bootstrap.js

CSS URLs

AMD module
_ujgExcelStoryImporter

HTML to append
<div class="ujg-excel-story-importer" style="height: 5000px;"></div>
```

Do not fill the CSS URL field. The bootstrap file loads CSS and runtime using the dashboard `releaseRef` mechanism.
