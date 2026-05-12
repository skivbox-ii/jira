const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const loadAmdModule = require("./helpers/load-amd-module");

const MODULE_DIR = path.join(__dirname, "..", "ujg-excel-story-importer-modules");

function loadDescription() {
  return loadAmdModule(path.join(MODULE_DIR, "description.js"), {});
}

test("buildDescription creates Jira wiki table from non-empty source columns", function () {
  const description = loadDescription();
  const text = description.buildDescription({
    sheetName: "Журнал",
    excelRowNumber: 12,
    sourceColumns: {
      "№": "3",
      "Замечание": "В сообщениях предусмотрена только одна группа",
      "Модуль": "Алармы",
      "Комментарий": "",
      "Jira": "",
    },
  });

  assert.match(text, /\|\|Поле\|\|Значение\|\|/);
  assert.match(text, /\|Лист\|Журнал\|/);
  assert.match(text, /\|Строка Excel\|12\|/);
  assert.match(text, /\|Модуль\|Алармы\|/);
  assert.doesNotMatch(text, /Комментарий/);
});

test("buildDescription escapes Jira wiki table separators", function () {
  const description = loadDescription();
  const text = description.buildDescription({
    sourceColumns: {
      "Замечание": "A | B",
      "Скрин": "\\\\server\\path",
    },
  });

  assert.match(text, /A \\&#124; B/);
  assert.match(text, /\\\\server\\\\path/);
});
