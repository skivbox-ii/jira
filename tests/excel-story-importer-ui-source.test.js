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
  assert.match(source, /ujg-esi-epic-picker/);
  assert.match(source, /ujg-esi-epic-search/);
  assert.match(source, /ujg-esi-epic-options/);
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
  assert.match(source, /ujg-esi-row-ai/);
  assert.match(source, /onRowImproveRemark/);
  assert.match(source, /ujg-esi-remark-ai-overlay/);
  assert.match(source, /ujg-esi-remark-ai-before/);
  assert.match(source, /ujg-esi-remark-ai-after/);
  assert.match(source, /ujg-esi-remark-ai-prompt/);
  assert.match(source, /onRemarkDialogApply/);
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
  assert.match(source, /\.ujg-esi-row-ai/);
});

test("importer CSS renders story and child statuses as one compact block", function () {
  const source = read("ujg-excel-story-importer.css");

  assert.match(source, /\.ujg-esi-status-block/);
  assert.match(source, /\.ujg-esi-story-status/);
  assert.match(source, /\.ujg-esi-story-status-progress \.ujg-esi-story-status/);
  assert.match(source, /\.ujg-esi-story-status-done \.ujg-esi-story-status/);
  assert.match(source, /\.ujg-esi-child-status-list/);
  assert.match(source, /\.ujg-esi-child-status-badge/);
  assert.match(source, /\.ujg-esi-child-status-done,\s*\n\.ujg-esi-child-status-done:visited/);
  assert.match(source, /\.ujg-esi-child-status-progress,\s*\n\.ujg-esi-child-status-progress:visited/);
  assert.match(source, /\.ujg-esi-child-status-blocked,\s*\n\.ujg-esi-child-status-blocked:visited/);
  assert.match(source, /\.ujg-esi-child-status-blocked::after/);
  assert.match(source, /opacity:\s*0\.5/);
  assert.match(source, /content:\s*"\\00a0\\1F512\\FE0E"/);
  assert.doesNotMatch(source, /border:\s*1px solid rgba\(191,\s*38,\s*0/);
  assert.match(source, /\.ujg-esi-child-status-badge,\s*\n\.ujg-esi-child-status-badge:visited/);
  assert.match(source, /grid-template-columns:\s*repeat\(auto-fit, minmax\(13px, 1fr\)\)/);
  assert.match(source, /height:\s*10px/);
  assert.match(source, /background:\s*#0c66e4/);
  assert.match(source, /background:\s*#00875a/);
  assert.match(source, /font-weight:\s*800/);
});

test("cropped child status icon assets are committed", function () {
  [
    "open-se.png",
    "open-be.png",
    "open-fe.png",
    "open-qa.png",
    "open-dev.png",
    "progress-se.png",
    "progress-be.png",
    "progress-fe.png",
    "progress-qa.png",
    "progress-dev.png",
    "closed-se.png",
    "closed-be.png",
    "closed-fe.png",
    "closed-qa.png",
    "closed-dev.png",
    "blocked-qa.png",
  ].forEach(function (fileName) {
    assert.ok(fs.existsSync(path.join(ROOT, "ujg-excel-story-importer-status-icons", fileName)), fileName);
  });
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

test("preview status column prefers Jira sync status and falls back to Excel status", function () {
  const source = read("ujg-excel-story-importer-modules/rendering.js");

  assert.match(source, /function previewStatusText/);
  assert.match(source, /cols\["Статус в Jira"\]/);
  assert.match(source, /cols\["Статус"\]/);
  assert.match(source, /function appendStatusCell/);
  assert.match(source, /row\.childStatuses/);
  assert.match(source, /ujg-esi-status-block/);
  assert.match(source, /storyStatusClass/);
  assert.match(source, /ujg-esi-story-status/);
  assert.match(source, /childStatusRoleClass/);
  assert.match(source, /item && item\.done === true/);
  assert.match(source, /item && item\.statusState/);
  assert.match(source, /item && item\.statusCategory/);
  assert.match(source, /выполн\|принят/);
  assert.match(source, /работ\|разработ\|исполн\|провер/);
  assert.match(source, /previewStatusText\(cols\)/);
  assert.match(source, /ujg-esi-child-status-badge/);
  assert.match(source, /ujg-esi-child-status-blocked/);
  assert.match(source, /issueBrowseUrl\(item\.key, base\)/);
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

test("epic picker searches from input without replacing the field on focus", function () {
  const source = read("ujg-excel-story-importer-modules/rendering.js");
  const start = source.indexOf("function appendEpicPicker");
  const end = source.indexOf("function appendFileInput", start);
  const block = source.slice(start, end);

  assert.match(source, /function scheduleEpicSearch\(query\)/);
  assert.match(block, /var query = \$\(this\)\.val\(\);/);
  assert.match(block, /if \(!disabled\) scheduleEpicSearch\(query\);/);
  assert.doesNotMatch(block, /\.on\("focus click"/);
  assert.doesNotMatch(block, /!disabled && services && services\.onEpicSearch\) services\.onEpicSearch\(""\)/);
});

test("main module wires renderer callbacks for project, epic, file, subtasks, and confirmed row create", function () {
  const source = read("ujg-excel-story-importer-modules/main.js");

  assert.match(source, /onProjectChange/);
  assert.match(source, /onEpicSearch/);
  assert.match(source, /onEpicSelect/);
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
  assert.match(source, /onRowImproveRemark/);
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
  assert.match(source, /ujg-esi-mapping-story-assignee/);
  assert.match(source, /ujg-esi-mapping-role-assignee/);
  assert.match(source, /ujg-esi-mapping-role-type/);
  assert.match(source, /ujg-esi-mapping-priority-select/);
  assert.match(source, /priorityOptionRows/);
  assert.match(source, /ujg-esi-issue-type-picker/);
  assert.match(source, /ujg-esi-issue-type-search/);
  assert.match(source, /ujg-esi-issue-type-options/);
  assert.match(source, /onIssueTypeSearch/);
  assert.match(source, /onIssueTypeSelect/);
});

test("mapping settings layout gives child task editor wider controls", function () {
  const source = read("ujg-excel-story-importer.css");

  assert.match(source, /max-width:\s*1280px/);
  assert.match(source, /\.ujg-esi-mapping-right\s*\{[\s\S]*overflow-x:\s*auto/);
  assert.match(source, /\.ujg-esi-mapping-roles\s*\{[\s\S]*min-width:\s*920px/);
  assert.match(source, /\.ujg-esi-mapping-roles th:nth-child\(3\),/);
  assert.match(source, /\.ujg-esi-mapping-roles th:nth-child\(4\),/);
  assert.match(source, /width:\s*240px/);
  assert.match(source, /\.ujg-esi-mapping-table input\[type="text"\],\s*\n\.ujg-esi-mapping-table select/);
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
  assert.match(source, /ujg-esi-summary-ai/);
  assert.match(source, /ujg-esi-source-ai/);
  assert.match(source, /Улучшить/);
  assert.match(source, /Исправить/);
  assert.match(source, /onDialogImproveSummary/);
  assert.match(source, /onDialogImproveRemark/);
  assert.match(source, /ujg-esi-assignee-picker/);
  assert.match(source, /ujg-esi-assignee-search/);
  assert.match(source, /ujg-esi-assignee-options/);
  assert.match(source, /onDialogAssigneeSearch/);
  assert.match(source, /onDialogAssigneeSelect/);
  assert.match(source, /ujg-esi-issue-type-picker/);
  assert.match(source, /onIssueTypeSearch/);
  assert.match(source, /onIssueTypeSelect/);
  assert.match(source, /ujg-esi-confirm-child-enabled/);
  assert.match(source, /onDialogChildToggle/);
  assert.match(source, /ujg-esi-confirm-epic-warning/);
  assert.match(source, /задача будет создана без Epic/);
  assert.match(source, /captureScrollState/);
  assert.match(source, /restoreScrollState/);
  assert.match(source, /ujg-esi-confirm-scroll/);
});

test("mapping settings exposes editable AI prompts", function () {
  const source = read("ujg-excel-story-importer-modules/rendering.js");
  const css = read("ujg-excel-story-importer.css");

  assert.match(source, /AI промпты/);
  assert.match(source, /Общий prompt проекта/);
  assert.match(source, /Текст замечания/);
  assert.match(source, /ujg-esi-llm-prompt/);
  assert.match(source, /onMappingLlmProjectPromptChange/);
  assert.match(source, /onMappingLlmRemarkPromptChange/);
  assert.match(source, /onMappingLlmPromptChange/);
  assert.match(css, /\.ujg-esi-llm-prompts/);
  assert.match(css, /\.ujg-esi-llm-project-prompt/);
  assert.match(css, /\.ujg-esi-llm-remark-prompt/);
});

test("api module quotes project keys before embedding them in JQL", function () {
  const source = read("ujg-excel-story-importer-modules/api.js");

  assert.match(source, /baseUrl:\s*config\.baseUrl/);
  assert.match(source, /function quoteJqlString/);
  assert.match(source, /function toJqlToken/);
  assert.match(source, /project = " \+ toJqlToken\(projectKey\)/);
  assert.match(source, /createIssueLink/);
  assert.match(source, /\/rest\/api\/2\/issueLink/);
  assert.match(source, /getIssueLinkTypes/);
  assert.match(source, /\/rest\/api\/2\/issueLinkType/);
  assert.match(source, /searchUsers/);
  assert.match(source, /\/rest\/api\/2\/user\/picker/);
  assert.match(source, /getProjectCreateMeta/);
  assert.match(source, /\/rest\/api\/2\/issue\/createmeta/);
  assert.match(source, /getIssuesByKeys/);
  assert.match(source, /issuelinks/);
  assert.match(source, /resolutiondate/);
  assert.match(source, /key in/);
  assert.match(source, /description/);
  assert.match(source, /description ~ /);
});

test("rendering module always renders Jira keys as new-tab browse links", function () {
  const source = read("ujg-excel-story-importer-modules/rendering.js");

  assert.match(source, /function issueBrowseUrl/);
  assert.match(source, /\/browse\//);
  assert.match(source, /target", "_blank"/);
  assert.match(source, /row\.statusTitle/);
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
