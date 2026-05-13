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
    "_ujgESI_config": config,
  });
}

test("parseWorkbook finds remarks header below non-data rows", function () {
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
          ["5", "Экспорт не работает", "EVOSCADA-13495", "PARA", "Средний"],
        ],
      },
    },
  };

  const result = parser.parseWorkbook(workbook);

  assert.equal(result.sheetName, "Журнал");
  assert.equal(result.headerRowNumber, 3);
  assert.deepEqual(result.headerColumns["Jira"], 3);
  assert.deepEqual(result.headerColumns["Статус в Jira"], undefined);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].summary, "Нет настроек полей сообщений");
  assert.equal(result.rows[0].excelRowNumber, 4);
  assert.equal(result.rows[0].jiraKey, "");
  assert.equal(result.rows[0].alreadyLinked, false);
  assert.equal(result.rows[1].jiraKey, "EVOSCADA-13495");
  assert.equal(result.rows[1].alreadyLinked, true);
  assert.equal(result.rows[1].sourceColumns["Модуль"], "PARA");
  assert.equal(result.rows[1].sourceColumnIndexes["Jira"], 3);
});

test("parseWorkbook uses configured table marker and column mappings", function () {
  const parser = loadParser();
  const workbook = {
    SheetNames: ["Импорт"],
    Sheets: {
      "Импорт": {
        __rows: [
          ["meta", "", "", ""],
          ["Тема", "Тикет", "Подсистема", "Важность"],
          ["Нет навигатора", "EVOSCADA-14450", "Алармы", "Высокий"],
        ],
      },
    },
  };

  const result = parser.parseWorkbook(workbook, {
    columnMap: {
      summary: "Тема",
      jira: "Тикет",
      module: "Подсистема",
      priority: "Важность",
    },
    tableStart: {
      headerMarker: "Тема",
    },
  });

  assert.equal(result.headerRowNumber, 2);
  assert.equal(result.headerColumns["Замечание"], 1);
  assert.equal(result.headerColumns["Jira"], 2);
  assert.equal(result.rows[0].summary, "Нет навигатора");
  assert.equal(result.rows[0].jiraKey, "EVOSCADA-14450");
  assert.equal(result.rows[0].sourceColumns["Замечание"], "Нет навигатора");
  assert.equal(result.rows[0].sourceColumns["Jira"], "EVOSCADA-14450");
  assert.equal(result.rows[0].sourceColumns["Модуль"], "Алармы");
  assert.equal(result.rows[0].sourceColumns["Приоритет"], "Высокий");
});

test("parseWorkbook scans sheets in order and skips sheets without remarks header", function () {
  const parser = loadParser();
  const workbook = {
    SheetNames: ["Сводка", "Журнал"],
    Sheets: {
      "Сводка": { __rows: [["Всего", "207"]] },
      "Журнал": {
        __rows: [
          ["№", "Замечание", "Jira"],
          ["17", "Фиксированная ширина не работает", "EVOSCADA-14447"],
        ],
      },
    },
  };

  const result = parser.parseWorkbook(workbook);

  assert.equal(result.sheetName, "Журнал");
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].jiraKey, "EVOSCADA-14447");
});

test("parseWorkbook falls back to two-column story rows without a header", function () {
  const parser = loadParser();
  const workbook = {
    SheetNames: ["Лист1"],
    Sheets: {
      "Лист1": {
        __rows: [
          [],
          [],
          [],
          [],
          [1, "Test jira task"],
        ],
      },
    },
  };

  const result = parser.parseWorkbook(workbook);

  assert.equal(result.sheetName, "Лист1");
  assert.equal(result.headerRowNumber, 0);
  assert.equal(result.headerColumns["Jira"], 3);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].excelRowNumber, 5);
  assert.equal(result.rows[0].summary, "Test jira task");
  assert.equal(result.rows[0].sourceColumns["№"], "1");
  assert.equal(result.rows[0].sourceColumns["Замечание"], "Test jira task");
});

test("parseWorkbook reports missing remarks header", function () {
  const parser = loadParser();
  const workbook = {
    SheetNames: ["Лист1"],
    Sheets: { "Лист1": { __rows: [["№", "Комментарий"], ["1", "x"]] } },
  };

  assert.throws(function () {
    parser.parseWorkbook(workbook);
  }, /Колонка "Замечание" не найдена/);
});
