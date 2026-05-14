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
  assert.match(source, /ujg-esi-upload-excel/);
  assert.match(source, /ujg-esi-file-name/);
  assert.match(source, /ujg-esi-meta-file/);
  assert.match(source, /ujg-esi-icon-button/);
  assert.match(source, /ujg-esi-toolbar-actions/);
  assert.match(source, /ujg-esi-mapping-button/);
  assert.match(source, /ujg-esi-sync-jira/);
  assert.match(source, /ujg-esi-download-excel/);
  assert.match(source, /aria-label", "Настроить мапинг"/);
  assert.match(source, /aria-label", "Загрузить Excel"/);
  assert.match(source, /aria-label", state && state\.syncLoading \? "Синхронизация из Jira" : "Синхронизировать из Jira"/);
  assert.match(source, /aria-label", "Скачать Excel"/);
  assert.doesNotMatch(source, /\.append\(\$\(\"\<span\/\>\"\)\.text\(\"Мапинг\"\)\)/);
  assert.doesNotMatch(source, /\.text\(state && state\.syncLoading \? "Синхронизация\.\.\." : "Синхронизировать из Jira"\)/);
  assert.doesNotMatch(source, /\.text\("Скачать Excel"\)/);
  assert.doesNotMatch(source, /Создавать дочерние задачи/);
  assert.doesNotMatch(source, /appendSubtasksToggle/);
  assert.match(source, /ujg-esi-create-row/);
});

test("importer CSS uses one icon button style for toolbar actions", function () {
  const source = read("ujg-excel-story-importer.css");

  assert.match(source, /\.ujg-esi-icon-button/);
  assert.match(source, /\.ujg-esi-upload-excel/);
  assert.match(source, /\.ujg-esi-actions-field/);
  assert.match(source, /\.ujg-esi-toolbar-actions/);
  assert.match(source, /\.ujg-esi-file-name/);
  assert.match(source, /\.ujg-esi-meta-file/);
  assert.match(source, /\.ujg-esi-file-field input\[type="file"\]/);
});

test("toolbar keeps the four Excel action icons together without subtasks toggle", function () {
  const source = read("ujg-excel-story-importer-modules/rendering.js");
  const fileInputStart = source.indexOf("function appendFileInput($actions)");
  const mappingStart = source.indexOf("function appendMappingButton", fileInputStart);
  const appendFileInputSource = source.slice(fileInputStart, mappingStart);

  assert.match(source, /appendExcelActions/);
  assert.match(source, /ujg-esi-toolbar-actions/);
  assert.match(source, /html\("&#10515;"\)/);
  assert.doesNotMatch(appendFileInputSource, /\$field\.append/);
  assert.doesNotMatch(source, /ujg-esi-subtasks/);
});

test("file name is rendered in parse metadata, not beside upload icon", function () {
  const source = read("ujg-excel-story-importer-modules/rendering.js");

  assert.match(source, /sourceFileName/);
  assert.match(source, /ujg-esi-meta-file/);
  assert.doesNotMatch(source, /\$control\.append\(\$upload,\s*\$\(\"\<span\/\>\"\)\.addClass\(\"ujg-esi-file-name\"\)/);
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
  assert.match(source, /onOpenMappings/);
  assert.match(source, /onMappingBlockSelect/);
  assert.match(source, /onMappingRoleChange/);
  assert.match(source, /onSyncJira/);
  assert.match(source, /onDownloadPatchedExcel/);
});

test("rendering module exposes daily-diligence style mapping settings overlay", function () {
  const source = read("ujg-excel-story-importer-modules/rendering.js");

  assert.match(source, /ujg-esi-mapping-overlay/);
  assert.match(source, /ujg-esi-mapping-close/);
  assert.match(source, /Блоки мапинга/);
  assert.match(source, /Модуль → Component/);
  assert.match(source, /Приоритет → Priority/);
  assert.match(source, /Колонки Excel/);
  assert.match(source, /Начало таблицы/);
  assert.match(source, /Дочерние задачи/);
  assert.match(source, /ujg-esi-mapping-block/);
  assert.match(source, /ujg-esi-mapping-entry-excel/);
  assert.match(source, /ujg-esi-mapping-column-value/);
  assert.match(source, /ujg-esi-mapping-start-marker/);
  assert.match(source, /ujg-esi-mapping-sheet-name/);
  assert.match(source, /ujg-esi-meta-sheet-button/);
  assert.match(source, /ujg-esi-meta-sheet-menu/);
  assert.match(source, /ujg-esi-mapping-role-type/);
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
  assert.match(source, /ujg-esi-assignee-picker/);
  assert.match(source, /ujg-esi-assignee-search/);
  assert.match(source, /ujg-esi-assignee-options/);
  assert.match(source, /onDialogAssigneeSearch/);
  assert.match(source, /onDialogAssigneeSelect/);
  assert.match(source, /ujg-esi-confirm-child-enabled/);
  assert.match(source, /onDialogChildToggle/);
  assert.match(source, /ujg-esi-confirm-epic-warning/);
  assert.match(source, /задача будет создана без Epic/);
  assert.match(source, /captureScrollState/);
  assert.match(source, /restoreScrollState/);
  assert.match(source, /ujg-esi-confirm-scroll/);
});

test("api module quotes project keys before embedding them in JQL", function () {
  const source = read("ujg-excel-story-importer-modules/api.js");

  assert.match(source, /baseUrl:\s*config\.baseUrl/);
  assert.match(source, /function quoteJqlString/);
  assert.match(source, /function toJqlToken/);
  assert.match(source, /project = " \+ toJqlToken\(projectKey\)/);
  assert.match(source, /createIssueLink/);
  assert.match(source, /\/rest\/api\/2\/issueLink/);
  assert.match(source, /searchUsers/);
  assert.match(source, /\/rest\/api\/2\/user\/picker/);
  assert.match(source, /getProjectCreateMeta/);
  assert.match(source, /\/rest\/api\/2\/issue\/createmeta/);
  assert.match(source, /getIssuesByKeys/);
  assert.match(source, /key in/);
});

test("rendering module always renders Jira keys as new-tab browse links", function () {
  const source = read("ujg-excel-story-importer-modules/rendering.js");

  assert.match(source, /function issueBrowseUrl/);
  assert.match(source, /\/browse\//);
  assert.match(source, /target", "_blank"/);
  assert.doesNotMatch(source, /if \(key && base\)/);
});

test("importer CSS is scoped to widget root", function () {
  const source = read("ujg-excel-story-importer.css");

  assert.match(source, /\.ujg-excel-story-importer/);
  assert.match(source, /\.ujg-esi-preview-table/);
  assert.match(source, /\.ujg-esi-jira-link/);
  assert.match(source, /\.ujg-esi-row-linked/);
  assert.match(source, /\.ujg-esi-assignee-picker/);
  assert.match(source, /\.ujg-esi-assignee-options/);
  assert.match(source, /\.ujg-esi-mapping-overlay/);
  assert.match(source, /\.ujg-esi-mapping-block/);
});
