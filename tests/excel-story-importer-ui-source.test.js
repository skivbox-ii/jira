const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

test("rendering module exposes import controls and row create action classes", function () {
  const source = read("ujg-excel-story-importer-modules/rendering.js");

  assert.match(source, /ujg-esi-project-select/);
  assert.match(source, /ujg-esi-epic-select/);
  assert.match(source, /ujg-esi-file/);
  assert.match(source, /ujg-esi-subtasks/);
  assert.match(source, /Создавать дочерние задачи/);
  assert.match(source, /ujg-esi-create-row/);
});

test("row create action only requires project selection", function () {
  const source = read("ujg-excel-story-importer-modules/rendering.js");

  assert.match(source, /function rowActionStatusText/);
  assert.match(source, /Без Epic/);
  assert.match(source, /Выберите проект/);
  assert.doesNotMatch(source, /if \(!state\.epicKey\)/);
  assert.doesNotMatch(source, /state\.epicKey &&/);
});

test("main module wires renderer callbacks for project, epic, file, subtasks, and confirmed row create", function () {
  const source = read("ujg-excel-story-importer-modules/main.js");

  assert.match(source, /onProjectChange/);
  assert.match(source, /onEpicChange/);
  assert.match(source, /onFileChange/);
  assert.match(source, /onSubtasksChange/);
  assert.match(source, /onCreateRow/);
  assert.match(source, /onConfirmCreate/);
  assert.match(source, /onCancelCreate/);
});

test("rendering module exposes create confirmation modal", function () {
  const source = read("ujg-excel-story-importer-modules/rendering.js");

  assert.match(source, /ujg-esi-confirm-overlay/);
  assert.match(source, /ujg-esi-confirm-create/);
  assert.match(source, /ujg-esi-confirm-cancel/);
  assert.match(source, /Создать в Jira/);
  assert.match(source, /Дочерние задачи/);
  assert.match(source, /Тип Jira/);
  assert.match(source, /child of Story/);
  assert.match(source, /ujg-esi-confirm-summary/);
  assert.match(source, /ujg-esi-confirm-assignee/);
  assert.match(source, /ujg-esi-confirm-child-enabled/);
  assert.match(source, /onDialogChildToggle/);
});

test("api module quotes project keys before embedding them in JQL", function () {
  const source = read("ujg-excel-story-importer-modules/api.js");

  assert.match(source, /function quoteJqlString/);
  assert.match(source, /function toJqlToken/);
  assert.match(source, /project = " \+ toJqlToken\(projectKey\)/);
  assert.match(source, /createIssueLink/);
  assert.match(source, /\/rest\/api\/2\/issueLink/);
  assert.match(source, /searchUsers/);
  assert.match(source, /\/rest\/api\/2\/user\/picker/);
});

test("importer CSS is scoped to widget root", function () {
  const source = read("ujg-excel-story-importer.css");

  assert.match(source, /\.ujg-excel-story-importer/);
  assert.match(source, /\.ujg-esi-preview-table/);
  assert.match(source, /\.ujg-esi-jira-link/);
  assert.match(source, /\.ujg-esi-row-linked/);
});
