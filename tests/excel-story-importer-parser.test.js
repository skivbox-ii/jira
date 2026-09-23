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

function loadRemarkId() {
  return loadAmdModule(path.join(MODULE_DIR, "remark-id.js"), {});
}

function loadRegistry() {
  return loadAmdModule(path.join(MODULE_DIR, "registry.js"), {"_ujgESI_remarkId":loadRemarkId()});
}

test("default owner mapping accepts exact TNT header with a line break", function () {
  const parser = loadParser(), registry = loadRegistry();
  const result = parser.parseWorkbook({SheetNames:["Лист"],Sheets:{"Лист":{__rows:[
    ["№","Замечание","Ответственный от\nТНТ","Примечание"],
    ["31","Не открывается форма","Анна","сохранить"],
  ]}}});
  assert.equal(result.headerColumns["Ответственный"],3);
  assert.equal(result.rows[0].sourceColumnIndexes["Ответственный"],3);
  assert.equal(result.rows[0].sourceColumns["Ответственный"],"Анна");
  assert.equal(result.rows[0].sourceColumns["Примечание"],"сохранить");
  assert.equal(registry.buildRows(result.rows)[0].owner,"Анна");
  assert.equal(registry.buildRows(result.rows)[0].assignee,"");
});

test("exact default owner header wins and retains alias column value", function () {
  const parser = loadParser(), registry = loadRegistry();
  const result = parser.parseWorkbook({SheetNames:["Лист"],Sheets:{"Лист":{__rows:[
    ["Замечание","Ответственный от ТНТ","Ответственный"],
    ["Падает отчет","Алиса","Борис"],
  ]}}});
  assert.equal(result.headerColumns["Ответственный"],3);
  assert.equal(result.rows[0].sourceColumns["Ответственный"],"Борис");
  assert.equal(result.rows[0].sourceColumns["Ответственный от ТНТ"],"Алиса");
  assert.equal(registry.buildRows(result.rows)[0].owner,"Борис");
});

test("custom owner mapping wins and alias remains an independent source column", function () {
  const parser = loadParser(), registry = loadRegistry();
  const result = parser.parseWorkbook({SheetNames:["Лист"],Sheets:{"Лист":{__rows:[
    ["Замечание","Ответственный от ТНТ","Владелец"],
    ["Падает отчет","Алиса","Борис"],
  ]}}}, {columnMap:{owner:"Владелец"}});
  assert.equal(result.headerColumns["Ответственный"],3);
  assert.equal(result.rows[0].sourceColumns["Ответственный"],"Борис");
  assert.equal(result.rows[0].sourceColumns["Ответственный от ТНТ"],"Алиса");
  assert.equal(registry.buildRows(result.rows)[0].owner,"Борис");
});

test("duplicate TNT alias columns retain both values and first owner index", function () {
  const parser = loadParser();
  const result = parser.parseWorkbook({SheetNames:["Лист"],Sheets:{"Лист":{__rows:[
    ["Замечание","Ответственный от ТНТ","Ответственный от\nТНТ"],
    ["Падает отчет","Алиса","Борис"],
  ]}}});
  assert.equal(result.headerColumns["Ответственный"],2);
  assert.equal(result.rows[0].sourceColumns["Ответственный"],"Алиса");
  assert.equal(result.rows[0].sourceColumns["Ответственный от ТНТ (колонка 3)"],"Борис");
});

test("owner alias does not claim a header explicitly mapped to Jira assignee", function () {
  const parser = loadParser(), registry = loadRegistry();
  const result = parser.parseWorkbook({SheetNames:["Лист"],Sheets:{"Лист":{__rows:[
    ["Замечание","Ответственный от\nТНТ","Jira"],
    ["Падает отчет","Алиса","PR-10"],
  ]}}}, {columnMap:{assigneeInJira:"Ответственный от ТНТ"}});
  assert.equal(result.headerColumns["Исполнитель в Jira"],2);
  assert.equal(result.headerColumns["Ответственный"],undefined);
  assert.equal(result.rows[0].sourceColumns["Исполнитель в Jira"],"Алиса");
  assert.equal(registry.buildRows(result.rows)[0].owner,"");
  assert.equal(registry.buildRows(result.rows)[0].assignee,"Алиса");
});

test("parseWorkbook keeps headerless rows containing optional ID or owner words", function () {
  const parser = loadParser();
  const remarkId = loadRemarkId();
  const result = parser.parseWorkbook({
    SheetNames: ["Лист"],
    Sheets: { "Лист": { __rows: [
      ["17", "Actual issue", "", "Ответственный"],
      ["18", "Another issue", "", "ID"],
    ] } },
  });

  assert.equal(result.headerRowNumber, 0);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].sourceColumns["№"], "17");
  assert.equal(result.rows[0].sourceColumns["Колонка 4"], "Ответственный");
  assert.equal(result.rows[1].sourceColumns["Колонка 4"], "ID");
  assert.equal(remarkId(result.rows[0]), "17");
});

test("parseWorkbook accepts alphabetic mapped IDs while legacy aliases remain conservative", function () {
  const parser = loadParser();
  const remarkId = loadRemarkId();
  const result = parser.parseWorkbook({
    SheetNames: ["Лист"],
    Sheets: { "Лист": { __rows: [
      ["Код", "Замечание"],
      ["ALPHA", "Actual issue"],
      ["BAD VALUE", "Another issue"],
    ] } },
  }, { columnMap: { remarkId: "Код" } });

  assert.equal(result.rows[0].sourceColumns.ID, "ALPHA");
  assert.equal(remarkId(result.rows[0]), "ALPHA");
  assert.equal(remarkId(result.rows[1]), "");
  assert.equal(remarkId({ sourceColumns: { "№": "ALPHA" } }), "");
  assert.equal(remarkId({ sourceColumns: { ID: "ALPHA" } }), "");
});

test("parseWorkbook maps custom source ID and owner, including zero IDs", function () {
  const parser = loadParser();
  const remarkId = loadRemarkId();
  const workbook = {
    SheetNames: ["Журнал"],
    Sheets: { "Журнал": { __rows: [
      ["Код замечания", "Текст", "Владелец", "Тикет", "Доп. поле"],
      [0, "Нет доступа", "Анна", "ABC-12", "сохранить"],
      ["A-7", "Ошибка формы", "Борис", "", "тоже"],
    ] } },
  };
  const result = parser.parseWorkbook(workbook, {
    columnMap: { remarkId: "Код замечания", summary: "Текст", owner: "Владелец", jira: "Тикет" },
    tableStart: { headerMarker: "Текст" },
  });

  assert.equal(result.headerColumns.ID, 1);
  assert.equal(result.headerColumns["Ответственный"], 3);
  assert.equal(result.rows[0].sourceColumns.ID, "0");
  assert.equal(result.rows[0].sourceColumns["Ответственный"], "Анна");
  assert.equal(result.rows[0].sourceColumns["Доп. поле"], "сохранить");
  assert.equal(result.rows[0].jiraKey, "ABC-12");
  assert.equal(remarkId(result.rows[0]), "0");
  assert.equal(remarkId(result.rows[1]), "A-7");
});

test("parseWorkbook retains legacy ID aliases when mapped ID header is absent", function () {
  const parser = loadParser();
  const remarkId = loadRemarkId();
  for (const header of ["№", "номер", "Номер замечания"]) {
    const result = parser.parseWorkbook({
      SheetNames: ["Лист"],
      Sheets: { "Лист": { __rows: [[header, "Замечание"], ["B-12", "Текст замечания"]] } },
    }, { columnMap: { remarkId: "Код замечания" } });
    assert.equal(result.rows[0].sourceColumns[header], "B-12");
    assert.equal(remarkId(result.rows[0]), "B-12");
  }
});

test("parseWorkbook prefers explicitly mapped ID over a separate raw ID and retains both values", function () {
  const parser = loadParser();
  const remarkId = loadRemarkId();
  const result = parser.parseWorkbook({
    SheetNames: ["Лист"],
    Sheets: { "Лист": { __rows: [
      ["ID", "Код замечания", "Замечание", "Ответственный", "Другое"],
      ["OLD-4", "NEW-9", "Сбой экспорта", "Анна", "данные"],
    ] } },
  }, { columnMap: { remarkId: "Код замечания" } });
  const row = result.rows[0];

  assert.equal(result.headerColumns.ID, 2);
  assert.equal(row.sourceColumns.ID, "NEW-9");
  assert.equal(remarkId(row), "NEW-9");
  assert.equal(row.sourceColumns["ID (колонка 1)"], "OLD-4");
  assert.equal(row.sourceColumns.Другое, "данные");
});

test("parseWorkbook keeps duplicate mapped headers as separate source columns", function () {
  const parser = loadParser();
  const result = parser.parseWorkbook({
    SheetNames: ["Лист"],
    Sheets: { "Лист": { __rows: [
      ["Код", "Замечание", "Код"],
      ["A-1", "Сбой экспорта", "B-2"],
    ] } },
  }, { columnMap: { remarkId: "Код" } });

  assert.equal(result.rows[0].sourceColumns.ID, "A-1");
  assert.equal(result.rows[0].sourceColumns["Код (колонка 3)"], "B-2");
});

test("parseWorkbook upgrades old column settings and prefers source ID over legacy number", function () {
  const parser = loadParser();
  const remarkId = loadRemarkId();
  const result = parser.parseWorkbook({
    SheetNames: ["Лист"],
    Sheets: { "Лист": { __rows: [
      ["№", "ID", "Тема", "Тикет", "Ответственный", "Примечание"],
      ["17", "A-17", "Падает отчет", "ABC-17", "Анна", "проверить"],
    ] } },
  }, {
    columnMap: { summary: "Тема", jira: "Тикет" },
    tableStart: { headerMarker: "Тема" },
  });

  assert.equal(result.rows[0].sourceColumns["№"], "17");
  assert.equal(result.rows[0].sourceColumns.ID, "A-17");
  assert.equal(result.rows[0].sourceColumns["Ответственный"], "Анна");
  assert.equal(result.rows[0].sourceColumns["Примечание"], "проверить");
  assert.equal(remarkId(result.rows[0]), "A-17");
});

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

test("parseWorkbook maps configured Jira sync status and sprint columns", function () {
  const parser = loadParser();
  const workbook = {
    SheetNames: ["Импорт"],
    Sheets: {
      "Импорт": {
        __rows: [
          ["Тема", "Тикет", "Статус исполнителя", "Спринт Jira"],
          ["Нет навигатора", "EVOSCADA-14450", "Выдано", "18.05-01.06"],
        ],
      },
    },
  };

  const result = parser.parseWorkbook(workbook, {
    columnMap: {
      summary: "Тема",
      jira: "Тикет",
      statusInJira: "Статус исполнителя",
      sprintInJira: "Спринт Jira",
    },
    tableStart: {
      headerMarker: "Тема",
    },
  });

  assert.equal(result.headerColumns["Статус в Jira"], 3);
  assert.equal(result.headerColumns["Спринт"], 4);
  assert.equal(result.rows[0].sourceColumns["Статус в Jira"], "Выдано");
  assert.equal(result.rows[0].sourceColumns["Спринт"], "18.05-01.06");
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

test("parseWorkbook uses configured sheet name instead of first matching sheet", function () {
  const parser = loadParser();
  const workbook = {
    SheetNames: ["Черновик", "Замечания"],
    Sheets: {
      "Черновик": {
        __rows: [
          ["№", "Замечание", "Jira"],
          ["1", "Не тот лист", ""],
        ],
      },
      "Замечания": {
        __rows: [
          ["№", "Замечание", "Jira"],
          ["2", "Основной журнал замечаний", "EVOSCADA-2"],
        ],
      },
    },
  };

  const result = parser.parseWorkbook(workbook, { sheetName: "Замечания" });

  assert.equal(result.sheetName, "Замечания");
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].summary, "Основной журнал замечаний");
  assert.equal(result.rows[0].jiraKey, "EVOSCADA-2");
});

test("parseWorkbook skips hidden worksheet rows but keeps Excel row numbers", function () {
  const parser = loadParser();
  const workbook = {
    SheetNames: ["Журнал"],
    Sheets: {
      "Журнал": {
        "!rows": [
          {},
          {},
          { hidden: true },
          {},
        ],
        __rows: [
          ["№", "Замечание", "Jira"],
          ["1", "Видимая строка", ""],
          ["2", "Скрытая строка", ""],
          ["3", "Вторая видимая строка", ""],
        ],
      },
    },
  };

  const result = parser.parseWorkbook(workbook);

  assert.deepEqual(Array.from(result.rows, (row) => row.summary), ["Видимая строка", "Вторая видимая строка"]);
  assert.deepEqual(Array.from(result.rows, (row) => row.excelRowNumber), [2, 4]);
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
