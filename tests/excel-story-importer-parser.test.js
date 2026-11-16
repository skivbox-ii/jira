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

test("deadline mapping canonicalizes the chosen header and converts typed Excel serials with workbook epoch", () => {
  const config = loadConfig();
  const calls = [];
  const parser = loadAmdModule(path.join(MODULE_DIR, "parser.js"), {"_ujgESI_config": config}, {
    XLSX: {SSF:{parse_date_code:(value, options) => { calls.push([value, options.date1904]); return {y:2026,m:9,d:25}; }}},
  });
  const result = parser.parseWorkbook({Workbook:{WBProps:{date1904:true}},SheetNames:["Журнал"],Sheets:{Журнал:{__rows:[
    ["Замечание","Плановая дата"], ["Ошибка", 45000],
  ]}}}, {columnMap:{deadline:"Плановая дата"}});
  assert.equal(result.rows[0].sourceColumns["Срок исполнения"], "2026-09-25");
  assert.deepEqual(calls, [[45000,true]]);
});

test("default Срок column takes precedence over an older Срок исполнения column after parsing", () => {
  const config = loadConfig();
  const parser = loadAmdModule(path.join(MODULE_DIR, "parser.js"), {"_ujgESI_config": config}, {
    XLSX:{SSF:{parse_date_code:value => ({y:2026,m:9,d:value === 45000 ? 25 : 20})}},
  });
  const row = parser.parseWorkbook({SheetNames:["Журнал"],Sheets:{Журнал:{__rows:[
    ["Замечание","Срок исполнения","Срок"], ["Ошибка",45001,45000],
  ]}}}).rows[0];
  const resolve = loadAmdModule(path.join(MODULE_DIR, "deadlines.js"), {}).resolve;
  assert.equal(resolve(row,{columnMap:config.COLUMN_MAP}).date,"2026-09-25");
  const description = loadAmdModule(path.join(MODULE_DIR, "description.js"), {}).buildDescription(row);
  assert.equal(resolve({storyDetails:{description}},{columnMap:config.COLUMN_MAP}).date,"2026-09-25");
});

test("typed alias deadlines use raw SheetJS cells and conflicting aliases survive the imported table", () => {
  const config = loadConfig();
  const calls = [];
  const headers = ["Замечание", "Плановый срок устранения", "Срок устранения"];
  const displayRows = [headers, ["Ошибка", "9/25/26", "9/26/26"]];
  const rawRows = [headers, ["Ошибка", 45000, 45001]];
  const parser = loadAmdModule(path.join(MODULE_DIR, "parser.js"), {"_ujgESI_config": config}, {
    XLSX: {
      utils:{sheet_to_json:(_sheet, options) => options.raw ? rawRows : displayRows},
      SSF:{parse_date_code:(value, options) => { calls.push([value, options.date1904]); return {y:2026,m:9,d:value === 45000 ? 25 : 26}; }},
    },
  });
  const row = parser.parseWorkbook({Workbook:{WBProps:{date1904:true}},SheetNames:["Журнал"],Sheets:{Журнал:{}}}).rows[0];
  assert.equal(row.sourceColumns["Плановый срок устранения"], "2026-09-25");
  assert.equal(row.sourceColumns["Срок устранения"], "2026-09-26");
  assert.deepEqual(calls, [[45000,true],[45001,true]]);
  const deadlines = loadAmdModule(path.join(MODULE_DIR, "deadlines.js"), {});
  assert.equal(deadlines.resolve(row).problem, "conflict");
  const description = loadAmdModule(path.join(MODULE_DIR, "description.js"), {}).buildDescription(row);
  assert.equal(deadlines.resolve({jiraKey:"ABC-1",storyDetails:{description}}).problem, "conflict");
});

test("duplicate typed alias headers remain conflicting after parser and description writer", () => {
  const config = loadConfig();
  const headers = ["Замечание", "Срок устранения", "Срок устранения"];
  const parser = loadAmdModule(path.join(MODULE_DIR, "parser.js"), {"_ujgESI_config": config}, {
    XLSX: {
      utils:{sheet_to_json:(_sheet, options) => options.raw
        ? [headers,["Ошибка",45000,45001]] : [headers,["Ошибка","9/25/26","9/26/26"]]},
      SSF:{parse_date_code:value => ({y:2026,m:9,d:value === 45000 ? 25 : 26})},
    },
  });
  const row = parser.parseWorkbook({SheetNames:["Журнал"],Sheets:{Журнал:{}}}).rows[0];
  assert.equal(row.sourceColumns["Срок устранения"], "2026-09-25");
  assert.equal(row.sourceColumns["Срок устранения (колонка 3)"], "2026-09-26");
  const deadlines = loadAmdModule(path.join(MODULE_DIR, "deadlines.js"), {});
  assert.equal(deadlines.resolve(row).problem, "conflict");
  const description = loadAmdModule(path.join(MODULE_DIR, "description.js"), {}).buildDescription(row);
  assert.equal(deadlines.resolve({storyDetails:{description}}).problem, "conflict");
});

test("parsed custom deadline keeps priority over an old canonical deadline column", () => {
  const config = loadConfig();
  const parser = loadAmdModule(path.join(MODULE_DIR, "parser.js"), {"_ujgESI_config": config}, {
    XLSX: {SSF:{parse_date_code:value => ({y:2026,m:9,d:value === 45000 ? 25 : 26})}},
  });
  const row = parser.parseWorkbook({SheetNames:["Журнал"],Sheets:{Журнал:{__rows:[
    ["Замечание","Срок исполнения","Мой срок"], ["Ошибка",45001,45000],
  ]}}}, {columnMap:{deadline:"Мой срок"}}).rows[0];
  const resolve = loadAmdModule(path.join(MODULE_DIR, "deadlines.js"), {}).resolve;
  assert.equal(resolve(row,{columnMap:{deadline:"Мой срок"}}).date, "2026-09-25");
  const description = loadAmdModule(path.join(MODULE_DIR, "description.js"), {}).buildDescription(row);
  assert.equal(resolve({storyDetails:{description}},{columnMap:{deadline:"Мой срок"}}).date, "2026-09-25");
  const repeated = parser.parseWorkbook({SheetNames:["Журнал"],Sheets:{Журнал:{__rows:[
    ["Замечание","Мой срок","Мой срок"], ["Ошибка",45000,45001],
  ]}}}, {columnMap:{deadline:"Мой срок"}}).rows[0];
  assert.equal(resolve(repeated,{columnMap:{deadline:"Мой срок"}}).problem, "conflict");
});

function loadRemarkId() {
  return loadAmdModule(path.join(MODULE_DIR, "remark-id.js"), {});
}

function loadRegistry() {
  return loadAmdModule(path.join(MODULE_DIR, "registry.js"), {"_ujgESI_remarkId":loadRemarkId(),"_ujgESI_deadlines":loadAmdModule(path.join(MODULE_DIR,"deadlines.js"),{})});
}

test("owner values survive parsing and registry mapping across 72 Excel rows", function () {
  const rows = [["Замечание", "Ответственный"]];
  for (let i = 1; i <= 72; i += 1) rows.push(["Замечание " + i, "Ответственный " + i]);
  const parsed = loadParser().parseWorkbook({SheetNames:["Лист"],Sheets:{Лист:{__rows:rows}}});
  const entries = loadRegistry().buildRows(parsed.rows);
  assert.equal(parsed.rows.length, 72);
  for (const index of [0, 49, 50, 71]) {
    assert.equal(parsed.rows[index].sourceColumns["Ответственный"], "Ответственный " + (index + 1));
    assert.equal(entries[index].owner, "Ответственный " + (index + 1));
    assert.equal(entries[index].rowIndex, index);
  }
});

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
  assert.equal(remarkId(result.rows[1]), "BAD VALUE");
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

test("inspectWorkbook reports all fields, examples, hidden counts, and unresolved optional fields", () => {
  const parser = loadParser();
  const workbook = {SheetNames:["Журнал"],Sheets:{Журнал:{"!rows":[{},{},{hidden:true},{}],__rows:[
    ["Замечание","Ответственный от ТНТ","Модуль"],
    ["Ошибка","Анна","PARA"],
    ["Скрытая","Борис","ACU"],
    ["Ошибка","Анна","PARA"],
  ]}}};
  const report = parser.inspectWorkbook(workbook);
  assert.equal(report.headerRowNumber, 1);
  assert.equal(report.fields.length, 10);
  assert.equal(report.fields.find(f => f.key === "remarkId").label, "ID замечания");
  assert.equal(report.fields.find(f => f.key === "jira").label, "Ключ Jira");
  assert.deepEqual(Object.assign({}, report.counts), {total:3,visible:2,hidden:1});
  assert.equal(report.fields.find(f => f.key === "owner").status, "matched");
  assert.equal(report.fields.find(f => f.key === "jira").status, "missing");
  assert.equal(report.canApply, true);
  assert.deepEqual(Array.from(report.columns[0].examples), ["Ошибка"]);
  assert.equal(report.columns[0].nonEmptyCount, 2);
});

test("inspectWorkbook resolves duplicates by occurrence and warns about empty columns", () => {
  const parser = loadParser();
  const workbook = {SheetNames:["S"],Sheets:{S:{__rows:[["Замечание","Код","Код","Jira"],["Issue","A","B",""]]}}};
  const unresolved = parser.inspectWorkbook(workbook, {columnMap:{remarkId:"Код"}});
  assert.equal(unresolved.fields.find(f => f.key === "remarkId").status, "ambiguous");
  const options = {columnMap:{remarkId:"Код"},columnBindings:{remarkId:{header:"Код",occurrence:1},jira:null}};
  const report = parser.inspectWorkbook(workbook, options);
  assert.equal(report.fields.find(f => f.key === "remarkId").selectedIndex, 2);
  assert.equal(report.fields.find(f => f.key === "jira").status, "skipped");
  assert.equal(parser.parseWorkbook(workbook, options).rows[0].sourceColumns.ID, "B");
  const skips = Object.fromEntries(report.fields.filter(f => f.key !== "summary" && f.key !== "remarkId").map(f => [f.key,null]));
  const ready = parser.inspectWorkbook(workbook,{columnMap:{remarkId:"Код"},columnBindings:Object.assign(skips,{remarkId:{header:"Код",occurrence:1}})});
  assert.equal(ready.canApply,true);
  assert.equal(ready.needsReview,false);
  const warning = parser.inspectWorkbook(workbook,{columnBindings:Object.assign(skips,{remarkId:null})});
  assert.equal(warning.canApply,true);
  assert.equal(warning.fields.find(f => f.key === "summary").status,"matched");
});

test("an empty selected column needs review but permits apply after optional skips", () => {
  const parser = loadParser();
  const workbook = {SheetNames:["S"],Sheets:{S:{__rows:[["Замечание","Jira"],["Issue",""]]}}};
  const skips = Object.fromEntries(Object.keys(loadConfig().COLUMN_MAP)
    .filter(key => key !== "summary" && key !== "jira").map(key => [key,null]));
  const report = parser.inspectWorkbook(workbook,{columnBindings:skips});
  assert.equal(report.fields.find(f => f.key === "jira").status,"empty");
  assert.equal(report.canApply,true);
  assert.equal(report.needsReview,true);
  const skippedSummary = parser.inspectWorkbook(workbook,{columnBindings:Object.assign({},skips,{summary:null})});
  assert.equal(skippedSummary.canApply,false);
  assert.throws(() => parser.parseWorkbook(workbook,{columnBindings:{summary:null}}),/Замечание/);
});

test("inspectWorkbook detects conflicts and explicit skip prevents canonical fallback", () => {
  const parser = loadParser();
  const workbook = {SheetNames:["S"],Sheets:{S:{__rows:[["Замечание","ID","Ответственный"],["Issue","A-1","Анна"]]}}};
  const conflict = parser.inspectWorkbook(workbook, {columnBindings:{remarkId:{header:"ID",occurrence:0},owner:{header:"ID",occurrence:0}}});
  assert.equal(conflict.fields.find(f => f.key === "owner").status, "conflict");
  assert.equal(conflict.canApply, true);
  assert.equal(conflict.fields.find(f => f.key === "remarkId").selectedIndex, null);
  assert.equal(conflict.fields.find(f => f.key === "owner").selectedIndex, null);
  const parsed = parser.parseWorkbook(workbook, {columnBindings:{remarkId:null,owner:null}});
  assert.equal(parsed.rows[0].sourceColumns.ID, undefined);
  assert.equal(parsed.rows[0].sourceColumns["Ответственный"], undefined);
  assert.equal(parsed.rows[0].sourceColumns["Исходная колонка B: ID"], "A-1");
});

test("inspectWorkbook falls back on the chosen sheet and supports explicit header selection", () => {
  const parser = loadParser();
  const workbook = {SheetNames:["Other","Data"],Sheets:{Other:{__rows:[["Замечание"],["Wrong"]]},Data:{__rows:[["Title","Code"],["Issue","X"]]}}};
  const missing = parser.inspectWorkbook(workbook, {sheetName:"Data"});
  assert.equal(missing.sheetName, "Data");
  assert.equal(missing.headerRowNumber, 1);
  assert.deepEqual(Array.from(missing.columns, column => column.header), ["Title", "Code"]);
  assert.equal(missing.needsReview, true);
  assert.equal(missing.canApply, false);
  assert.equal(missing.error, undefined);
  const selected = parser.inspectWorkbook(workbook, {sheetName:"Data",headerRowNumber:1,columnMap:{summary:"Title"}});
  assert.equal(selected.fields.find(f => f.key === "summary").selectedIndex, 0);
  assert.equal(parser.parseWorkbook(workbook, {sheetName:"Data",headerRowNumber:1,columnMap:{summary:"Title"}}).rows[0].summary, "Issue");
  assert.equal(parser.inspectWorkbook(workbook, {sheetName:"Absent"}).sheetName, "Absent");
});

test("physical SheetJS range offsets preserve rows, columns, and hidden counts", () => {
  const config = loadConfig();
  const parser = loadAmdModule(path.join(MODULE_DIR,"parser.js"),{"_ujgESI_config":config},{XLSX:{utils:{
    sheet_to_json:() => [["Замечание","ID"],["Visible","X"],["Hidden","Y"]],
    decode_range:() => ({s:{r:4,c:2},e:{r:7,c:3}}),
    encode_col:c => String.fromCharCode(65+c),
  }}});
  const workbook = {SheetNames:["S"],Sheets:{S:{"!ref":"C5:D8","!rows":[{},{},{},{},{},{},{hidden:true}]}}};
  const report = parser.inspectWorkbook(workbook);
  assert.equal(report.headerRowNumber, 5);
  assert.equal(report.columns[0].index, 2);
  assert.equal(report.columns[0].letter, "C");
  assert.deepEqual(Object.assign({},report.counts),{total:2,visible:1,hidden:1});
  const parsed = parser.parseWorkbook(workbook);
  assert.equal(parsed.rows[0].excelRowNumber, 6);
  assert.equal(parsed.rows[0].sourceColumnIndexes.ID, 4);
});

test("skipped owner preserves raw Исполнитель without filling registry owner", () => {
  const workbook = {SheetNames:["S"],Sheets:{S:{__rows:[
    ["Замечание","Исполнитель"], ["Issue","Анна"],
  ]}}};
  const row = loadParser().parseWorkbook(workbook,{columnBindings:{owner:null}}).rows[0];
  assert.equal(loadRegistry().buildRows([row])[0].owner, "");
  assert.equal(Object.values(row.sourceColumns).includes("Анна"), true);
  const description = loadAmdModule(path.join(MODULE_DIR,"description.js"),{}).buildDescription(row);
  assert.match(description,/Анна/);
});

test("skipped ID keeps case-insensitive legacy aliases only as source data", () => {
  const workbook = {SheetNames:["S"],Sheets:{S:{__rows:[
    ["Замечание","НОМЕР","id"], ["Issue","17","A-18"],
  ]}}};
  const row = loadParser().parseWorkbook(workbook,{columnBindings:{remarkId:null}}).rows[0];
  assert.equal(loadRemarkId()(row), "");
  assert.deepEqual(Object.values(row.sourceColumns).filter(value => value === "17" || value === "A-18"), ["17","A-18"]);
});

test("skipped custom semantic names from the current map remain source-only", () => {
  const workbook = {SheetNames:["S"],Sheets:{S:{__rows:[
    ["Замечание","Владелец","Код"], ["Issue","Анна","A-7"],
  ]}}};
  const row = loadParser().parseWorkbook(workbook,{columnMap:{owner:"Владелец",remarkId:"Код"},columnBindings:{owner:null,remarkId:null}}).rows[0];
  assert.equal(loadRegistry().buildRows([row])[0].owner, "");
  assert.equal(loadRemarkId()(row), "");
  assert.equal(row.sourceColumns["Исходная колонка B: Владелец"], "Анна");
  assert.equal(row.sourceColumns["Исходная колонка C: Код"], "A-7");
});

test("saved summary binding rediscovers a moved renamed header", () => {
  const workbook = {SheetNames:["S"],Sheets:{S:{__rows:[
    ["Export metadata"], ["Other","value"], ["Code","Title"], ["A-1","Issue"],
  ]}}};
  const options = {columnMap:{summary:"Title"},columnBindings:{summary:{header:"Title",occurrence:0}}};
  const report = loadParser().inspectWorkbook(workbook,options);
  assert.equal(report.headerRowNumber, 3);
  assert.equal(report.fields.find(field => field.key === "summary").selectedIndex, 1);
  assert.equal(loadParser().parseWorkbook(workbook,options).rows[0].summary,"Issue");
});

test("column examples and empty status use visible imported remark rows", () => {
  const workbook = {SheetNames:["S"],Sheets:{S:{"!rows":[{},{},{hidden:true},{}],__rows:[
    ["Замечание","Ответственный"], ["Visible",""], ["Hidden","Анна"], ["","Борис"],
  ]}}};
  const report = loadParser().inspectWorkbook(workbook);
  const owner = report.fields.find(field => field.key === "owner");
  const ownerColumn = report.columns.find(column => column.header === "Ответственный");
  assert.equal(owner.status,"empty");
  assert.deepEqual(Array.from(ownerColumn.examples),[]);
  assert.equal(ownerColumn.nonEmptyCount,0);
  assert.deepEqual(Object.assign({},report.counts),{total:2,visible:1,hidden:1});
});

test("skipped deadline cannot leak through a suffixed duplicate header", () => {
  const workbook = {SheetNames:["S"],Sheets:{S:{__rows:[
    ["Замечание","Срок","Срок"], ["Issue","2026-09-25","2026-09-26"],
  ]}}};
  const options = {columnMap:{deadline:"Плановая дата"},columnBindings:{deadline:null}};
  const row = loadParser().parseWorkbook(workbook,options).rows[0];
  assert.equal(row.sourceColumns["Срок"],undefined);
  assert.equal(row.sourceColumns["Срок (колонка 3)"],undefined);
  assert.equal(loadAmdModule(path.join(MODULE_DIR,"deadlines.js"),{}).resolve(row,{columnMap:options.columnMap}).date,null);
  assert.equal(Object.values(row.sourceColumns).includes("2026-09-25"),true);
  assert.equal(Object.values(row.sourceColumns).includes("2026-09-26"),true);
});

test("raw Excel status remains distinct from Jira status in bound rows", () => {
  const workbook = {SheetNames:["S"],Sheets:{S:{__rows:[
    ["Замечание","Статус","Статус в Jira"], ["Issue","Открыто","В работе"],
  ]}}};
  const row = loadParser().parseWorkbook(workbook,{columnBindings:{statusInJira:{header:"Статус в Jira",occurrence:0}}}).rows[0];
  assert.equal(row.sourceColumns["Статус"],"Открыто");
  assert.equal(row.sourceColumns["Статус в Jira"],"В работе");
  assert.equal(loadRegistry().buildRows([row])[0].sourceStatus,"Открыто");
});

test("unresolved duplicate summaries retain visible candidate samples without inventing row counts", () => {
  const workbook = {SheetNames:["S"],Sheets:{S:{"!rows":[{},{},{hidden:true},{}],__rows:[
    ["Замечание","Замечание","Ответственный"],
    ["First","Alternative","Анна"],
    ["Hidden","Hidden alternative","Борис"],
    ["Second","Alternative 2","Мария"],
  ]}}};
  const report = loadParser().inspectWorkbook(workbook);
  assert.equal(report.fields.find(field => field.key === "summary").status,"ambiguous");
  assert.equal(report.fields.find(field => field.key === "owner").status,"matched");
  assert.deepEqual(Array.from(report.columns[0].examples),["First","Second"]);
  assert.deepEqual(Array.from(report.columns[2].examples),["Анна","Мария"]);
  assert.equal(report.columns[2].nonEmptyCount,2);
  assert.deepEqual(Object.assign({},report.counts),{total:0,visible:0,hidden:0});
  assert.equal(report.canApply,false);
});


test("preflight detects configured and alias headers across sheets before text fallback", () => {
  const parser = loadParser();
  const workbook = {SheetNames:["Cover","Data"],Sheets:{
    Cover:{__rows:[["Export title"],[],[123]]},
    Data:{__rows:[["Report title"],[],["  cOdE  ","  Ответственный  от\nТНТ  "],["ALPHA","Анна"]]},
  }};
  const options = {columnMap:{remarkId:"Code"},columnBindings:{summary:null}};
  const report = parser.inspectWorkbook(workbook,options);
  assert.equal(report.sheetName,"Data");
  assert.equal(report.headerRowNumber,3);
  assert.equal(report.fields.find(f => f.key === "owner").selectedIndex,1);
  assert.equal(report.canApply,true);
  const row = parser.parseWorkbook(workbook,options).rows[0];
  assert.equal(row.summary,"");
  assert.equal(loadRemarkId()(row),"ALPHA");
});

test("preflight fallback uses first visible populated text row on the chosen sheet", () => {
  const parser = loadParser();
  const workbook = {SheetNames:["Other","Data"],Sheets:{Other:{__rows:[["Замечание"],["Wrong"]]},Data:{
    "!rows":[{},{},{hidden:true},{},{}],__rows:[[],[123],["Hidden title"],["  Custom title  ","Code"],["Actual issue","X"]],
  }}};
  const report = parser.inspectWorkbook(workbook,{sheetName:"Data"});
  assert.equal(report.sheetName,"Data");
  assert.equal(report.headerRowNumber,4);
  assert.deepEqual(Array.from(report.columns,c => c.header),["Custom title","Code"]);
  const options = {sheetName:"Data",headerRowNumber:4,columnBindings:{summary:{header:"custom  TITLE",occurrence:0}}};
  assert.equal(parser.parseWorkbook(workbook,options).rows[0].summary,"Actual issue");
});

test("explicit header rows reject blank, out of range and malformed choices clearly", () => {
  const parser = loadParser();
  const workbook = {SheetNames:["S"],Sheets:{S:{__rows:[["Замечание"],[],["Actual issue"]]}}};
  for (const headerRowNumber of [2,20,0,-1,1.5,"bad",NaN,""]) {
    const options = {headerRowNumber};
    const report = parser.inspectWorkbook(workbook,options);
    assert.equal(report.canApply,false,String(headerRowNumber));
    assert.match(report.error,/строк/i);
    assert.throws(() => parser.parseWorkbook(workbook,options),/строк/i);
  }
});

test("optional missing and ambiguous columns are warnings and stay source-only", () => {
  const parser = loadParser();
  const workbook = {SheetNames:["S"],Sheets:{S:{__rows:[
    ["Замечание","Ответственный","Ответственный","Срок","Срок"],
    ["Actual issue","Анна","Борис","2026-09-25","2026-09-26"],
  ]}}};
  const report = parser.inspectWorkbook(workbook);
  assert.equal(report.canApply,true);
  assert.equal(report.needsReview,true);
  assert.equal(report.fields.find(f => f.key === "owner").status,"ambiguous");
  assert.equal(report.fields.find(f => f.key === "jira").status,"missing");
  const row = parser.parseWorkbook(workbook,{headerRowNumber:report.headerRowNumber}).rows[0];
  assert.equal(loadRegistry().buildRows([row])[0].owner,"");
  assert.equal(loadAmdModule(path.join(MODULE_DIR,"deadlines.js"),{}).resolve(row).date,null);
  assert.equal(Object.values(row.sourceColumns).includes("Анна"),true);
});

test("explicit assignments win over automatic optional collisions", () => {
  const parser = loadParser();
  const workbook = {SheetNames:["S"],Sheets:{S:{__rows:[["Замечание","Ответственный"],["Actual issue","ABC-7"]]}}};
  const options = {columnBindings:{jira:{header:"Ответственный",occurrence:0}}};
  const report = parser.inspectWorkbook(workbook,options);
  assert.equal(report.canApply,true);
  assert.equal(report.fields.find(f => f.key === "jira").status,"matched");
  assert.equal(report.fields.find(f => f.key === "owner").selectedIndex,null);
  const row = parser.parseWorkbook(workbook,options).rows[0];
  assert.equal(row.jiraKey,"ABC-7");
  assert.equal(loadRegistry().buildRows([row])[0].owner,"");
});

test("bound identity consumes ID-only and summary-only rows without fabricated summaries", () => {
  const parser = loadParser();
  const workbook = {SheetNames:["S"],Sheets:{S:{"!rows":[{},{},{},{},{},{hidden:true}],__rows:[
    ["ID","Замечание","Ответственный"], [0,"","Анна"], ["ALPHA","","Борис"],
    ["","Real summary",""], ["","","No identity"], ["HIDDEN","",""],
    ["","","Owner only"], ["","123","Numeric summary"],
  ]}}};
  const options = {headerRowNumber:1};
  const report = parser.inspectWorkbook(workbook,options);
  assert.deepEqual(Object.assign({},report.counts),{total:5,visible:4,hidden:1});
  assert.equal(report.canApply,true);
  const rows = parser.parseWorkbook(workbook,options).rows;
  assert.deepEqual(Array.from(rows,r => r.excelRowNumber),[2,3,4,8]);
  assert.deepEqual(Array.from(rows,r => r.summary),["","","Real summary","123"]);
  assert.equal(rows[0].sourceColumns["Замечание"],undefined);
  assert.equal(loadRemarkId()(rows[0]),"0");
  assert.equal(loadRemarkId()(rows[1]),"ALPHA");
});

test("either identity may be skipped while neither usable identity prevents apply", () => {
  const parser = loadParser();
  const workbook = {SheetNames:["S"],Sheets:{S:{__rows:[["ID","Замечание"],["A-1","Actual issue"]]}}};
  for (const key of ["summary","remarkId"]) {
    const options = {columnBindings:{[key]:null}};
    assert.equal(parser.inspectWorkbook(workbook,options).canApply,true);
    const row = parser.parseWorkbook(workbook,options).rows[0];
    assert.equal(key === "summary" ? row.summary : loadRemarkId()(row),"");
  }
  const options = {columnBindings:{summary:null,remarkId:null}};
  assert.equal(parser.inspectWorkbook(workbook,options).canApply,false);
  assert.throws(() => parser.parseWorkbook(workbook,options),/ID|Замечание/);
  const empty = {SheetNames:["S"],Sheets:{S:{__rows:[["ID","Замечание"],["",""]]}}};
  assert.equal(parser.inspectWorkbook(empty).canApply,false);
  assert.match(parser.inspectWorkbook(empty).error,/видимых строк/);
  assert.throws(() => parser.parseWorkbook(empty,{headerRowNumber:1}),/видимых строк/);
});

test("preflight skips a title containing one known field before the actual header row", () => {
  const workbook = {SheetNames:["S"],Sheets:{S:{__rows:[
    ["Jira"], [], [" id "," ЗАМЕЧАНИЕ ","Ответственный"], ["A-1","Actual issue","Анна"],
  ]}}};
  const report = loadParser().inspectWorkbook(workbook);
  assert.equal(report.headerRowNumber,3);
  assert.deepEqual(Object.assign({},report.counts),{total:1,visible:1,hidden:0});
});

test("normalized duplicate bindings select physical occurrences without leaking other IDs", () => {
  const workbook = {SheetNames:["S"],Sheets:{S:{__rows:[
    [" Code ","cOdE","Замечание"], ["OLD-1","NEW-2","Actual issue"],
  ]}}};
  const options = {columnBindings:{remarkId:{header:"CODE",occurrence:1}}};
  const report = loadParser().inspectWorkbook(workbook,options);
  assert.equal(report.fields.find(f => f.key === "remarkId").selectedIndex,1);
  const row = loadParser().parseWorkbook(workbook,options).rows[0];
  assert.equal(loadRemarkId()(row),"NEW-2");
  assert.equal(Object.values(row.sourceColumns).includes("OLD-1"),true);
});

test("bound ID-only rows preserve physical offsets and hidden counts", () => {
  const parser = loadAmdModule(path.join(MODULE_DIR,"parser.js"),{"_ujgESI_config":loadConfig()},{XLSX:{utils:{
    sheet_to_json:() => [[" id "],[0],["HIDDEN"],["ALPHA"]],
    decode_range:() => ({s:{r:4,c:2},e:{r:7,c:2}}),
  }}});
  const workbook = {SheetNames:["S"],Sheets:{S:{"!ref":"C5:C8","!rows":[{},{},{},{},{},{},{hidden:true}]}}};
  const options = {columnBindings:{summary:null}};
  const report = parser.inspectWorkbook(workbook,options);
  assert.equal(report.headerRowNumber,5);
  assert.deepEqual(Object.assign({},report.counts),{total:3,visible:2,hidden:1});
  const rows = parser.parseWorkbook(workbook,options).rows;
  assert.deepEqual(Array.from(rows,r => r.excelRowNumber),[6,8]);
  assert.equal(rows[0].sourceColumnIndexes.ID,3);
  assert.equal(rows[0].summary,"");
});


test("global preflight ranking prefers complete later headers over known cover titles", () => {
  const workbook = {SheetNames:["Cover","Data"],Sheets:{
    Cover:{__rows:[["Замечание"],["Cover text"],["Приоритет"]]},
    Data:{__rows:[["Замечание"],[],["ID","Замечание","Jira","Ответственный"],["A 1","Actual issue","","Анна"]]},
  }};
  const parser = loadParser();
  const report = parser.inspectWorkbook(workbook);
  assert.equal(report.sheetName,"Data");
  assert.equal(report.headerRowNumber,3);
  assert.equal(parser.inspectWorkbook(workbook,{sheetName:"Cover"}).sheetName,"Cover");
});

test("bound import preserves nonempty identity representations without format restrictions", () => {
  const workbook = {SheetNames:["S"],Sheets:{S:{__rows:[
    ["ID","Замечание"],["ID with spaces",""],["a".repeat(80),""],["","!"],["","123"],
  ]}}};
  const parser = loadParser(), options = {headerRowNumber:1};
  const report = parser.inspectWorkbook(workbook,options);
  assert.deepEqual(Object.assign({},report.counts),{total:4,visible:4,hidden:0});
  const rows = parser.parseWorkbook(workbook,options).rows;
  assert.deepEqual(Array.from(rows,r => r.summary),["","","!","123"]);
  assert.equal(rows[0].sourceColumns.ID,"ID with spaces");
  assert.equal(rows[1].sourceColumns.ID,"a".repeat(80));
});

test("fallback prefers a plausible header over a one-cell cover title", () => {
  const workbook = {SheetNames:["Cover","Data"],Sheets:{
    Cover:{__rows:[["Export title"]]},Data:{__rows:[["Export notes"],[],["Custom title","Custom code"],["Actual issue","A 1"]]},
  }};
  const report = loadParser().inspectWorkbook(workbook);
  assert.equal(report.sheetName,"Data");
  assert.equal(report.headerRowNumber,3);
});

test("preflight prefers visible sheets and candidates with visible identity data below", () => {
  const workbook = {SheetNames:["Hidden","Empty","Data"],Workbook:{Sheets:[{Hidden:1},{Hidden:0},{Hidden:0}]},Sheets:{
    Hidden:{__rows:[["ID","Замечание","Jira","Ответственный"],["A","Hidden issue","","Анна"]]},
    Empty:{__rows:[["ID","Замечание"]]},Data:{__rows:[["ID","Замечание"],["B",""]]},
  }};
  const parser = loadParser();
  assert.equal(parser.inspectWorkbook(workbook).sheetName,"Data");
  assert.equal(parser.inspectWorkbook(workbook,{sheetName:"Hidden"}).sheetName,"Hidden");
});

test("fallback still exposes a populated row when header labels contain no letters", () => {
  const workbook = {SheetNames:["S"],Sheets:{S:{__rows:[[],[123,456],[789,101]]}}};
  const report = loadParser().inspectWorkbook(workbook);
  assert.equal(report.headerRowNumber,2);
  assert.deepEqual(Array.from(report.columns,c => c.header),["123","456"]);
  assert.equal(report.canApply,false);
});

test("zero visible identity rows give an actionable error and block bound import", () => {
  const workbook = {SheetNames:["S"],Sheets:{S:{"!rows":[{},{hidden:true},{}],__rows:[
    ["ID","Замечание","Ответственный"],["A-1","Hidden issue",""],["","","Owner only"],
  ]}}};
  const parser = loadParser(), report = parser.inspectWorkbook(workbook);
  assert.deepEqual(Object.assign({},report.counts),{total:1,visible:0,hidden:1});
  assert.equal(report.canApply,false);
  assert.match(report.error,/Проверьте лист/);
  assert.throws(() => parser.parseWorkbook(workbook,{headerRowNumber:1}),/видимых строк/);
});


test("two explicit optional bindings in conflict are skipped while an independent ID imports", () => {
  const workbook = {SheetNames:["S"],Sheets:{S:{__rows:[
    ["ID","Ответственный"],["A 1","ABC-7"],
  ]}}};
  const options = {columnBindings:{summary:null,owner:{header:"Ответственный",occurrence:0},jira:{header:"Ответственный",occurrence:0}}};
  const parser = loadParser(), report = parser.inspectWorkbook(workbook,options);
  assert.equal(report.canApply,true);
  assert.equal(report.needsReview,true);
  for (const key of ["owner","jira"]) {
    assert.equal(report.fields.find(f => f.key === key).status,"conflict");
    assert.equal(report.fields.find(f => f.key === key).selectedIndex,null);
  }
  const row = parser.parseWorkbook(workbook,options).rows[0];
  assert.equal(row.sourceColumns.ID,"A 1");
  assert.equal(row.summary,"");
  assert.equal(row.jiraKey,"");
  assert.equal(loadRegistry().buildRows([row])[0].owner,"");
  assert.equal(Object.values(row.sourceColumns).includes("ABC-7"),true);
});

test("a conflict consuming the only identity prevents import with a clear explanation", () => {
  const workbook = {SheetNames:["S"],Sheets:{S:{__rows:[["Замечание"],["Actual issue"]]}}};
  const options = {columnBindings:{summary:{header:"Замечание",occurrence:0},owner:{header:"Замечание",occurrence:0}}};
  const parser = loadParser(), report = parser.inspectWorkbook(workbook,options);
  assert.equal(report.canApply,false);
  assert.equal(report.fields.find(f => f.key === "summary").status,"conflict");
  assert.equal(report.fields.find(f => f.key === "summary").selectedIndex,null);
  assert.match(report.error,/ID.*Замечание/);
  assert.throws(() => parser.parseWorkbook(workbook,options),/ID.*Замечание/);
});


test("registry keeps bound ID-only identifiers including spaces, long values and standalone prefixes", () => {
  const cases = [
    ["ID with spaces","ID with spaces"], ["A".repeat(80),"A".repeat(80)],
    ["ALPHA","ALPHA"], ["特殊識別子","特殊識別子"], ["#","#"], ["№","№"],
    ["# 17","17"], ["№ A-7","A-7"], ["# ALPHA","ALPHA"],
    ["# ID with spaces","# ID with spaces"], ["№ специальный код","№ специальный код"],
    [0,"0"],
  ];
  const workbook = {SheetNames:["S"],Sheets:{S:{__rows:[
    ["Source code"], ...cases.map(([value]) => [value]),
  ]}}};
  const options = {columnBindings:{summary:null,remarkId:{header:"Source code",occurrence:0}}};
  const parsed = loadParser().parseWorkbook(workbook,options);
  const rows = loadRegistry().buildRows(parsed.rows);
  assert.deepEqual(Array.from(rows,row => row.remarkId),cases.map(([,expected]) => expected));
  assert.deepEqual(Array.from(rows,row => row.remark),cases.map(() => ""));
});

test("registry does not treat unmapped raw columns or Jira summary text as arbitrary source IDs", () => {
  const registry = loadRegistry();
  for (const value of ["ID with spaces","A".repeat(80),"ALPHA","#","№"]) {
    const rows = registry.buildRows([
      {summary:"Issue",sourceColumns:{ID:value}},
      {summary:"Issue",sourceColumns:{"№":value}},
      {summary:"Issue",sourceColumns:{"Source code":value},sourceColumnIndexes:{"Source code":1}},
      {jiraKey:"ABC-7",summary:"Issue",sourceColumns:{Jira:value},sourceColumnIndexes:{Jira:1},storyDetails:{summary:value}},
    ]);
    assert.deepEqual(Array.from(rows,row => row.remarkId),["","","",""],value);
  }
});
