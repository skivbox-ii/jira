# Excel Story Importer Design

## Goal

Build a new Jira dashboard widget that imports an Excel remarks journal, previews each remark row, and creates a Jira Story with optional template subtasks from a selected existing Epic.

## Context

The repository already has dashboard widgets built as AMD modules with three asset layers:

- editable source modules in `ujg-*-modules/`;
- a `build-*.js` script that concatenates those modules into `ujg-*.js`;
- generated `*.bootstrap.js` and `*.runtime.js` files from `build-widget-bootstrap-assets.js`.

`ujg-story-browser-modules/create-story.js` already has working Jira issue creation behavior for Story plus role-based child tasks. The importer should reuse that behavior where practical instead of creating a separate Jira payload style.

The Excel source is a manual acceptance/offline testing remarks journal. It can contain title blocks, counters, hidden or irrelevant columns, and other non-data content before the table. The visible useful table has a header row with `Замечание`; every data row with a non-empty `Замечание` represents one candidate Story.

## Selected Approach

Create a separate dashboard widget named `ujg-excel-story-importer`.

This keeps Excel parsing and import workflow out of Story Browser while preserving the same Jira creation conventions. Story Browser remains a browsing and manual creation widget; the importer handles file loading, row preview, duplicate prevention, and per-row create actions.

## Files

The implementation will add these primary files:

- `ujg-excel-story-importer-modules/config.js`
- `ujg-excel-story-importer-modules/excel-loader.js`
- `ujg-excel-story-importer-modules/parser.js`
- `ujg-excel-story-importer-modules/description.js`
- `ujg-excel-story-importer-modules/api.js`
- `ujg-excel-story-importer-modules/creator.js`
- `ujg-excel-story-importer-modules/rendering.js`
- `ujg-excel-story-importer-modules/main.js`
- `build-excel-story-importer.js`
- `ujg-excel-story-importer.css`
- `ujg-excel-story-importer.js`
- `ujg-excel-story-importer.bootstrap.js`
- `ujg-excel-story-importer.runtime.js`
- `standalone/public/excel-import.html`

The implementation will update:

- `build-widget-bootstrap-assets.js`
- `standalone/server.js`
- shared navigation links in existing standalone HTML pages
- `README.md`
- focused tests under `tests/`

## Runtime Architecture

`config.js` owns constants: storage key, AMD names, known journal column names, Jira issue types, and the role task template copied from the existing Story Browser behavior.

`excel-loader.js` loads SheetJS in the browser and reads `.xlsx` or `.xls` files into a workbook. The loader preserves formatted display values for dates and other user-facing cells. The Excel file stays local in the browser. The widget sends only create requests to Jira after the user clicks a row action.

`parser.js` converts the workbook into normalized import rows. It finds the header row by locating `Замечание`, then maps all cells below that row by header name. Empty rows and rows without `Замечание` are skipped.

`description.js` converts a normalized row into Jira wiki description text. The description contains a compact table of all non-empty source columns, including operational columns such as `Статус`, `Модуль`, `Приоритет`, `Автор`, `Дата`, `Комментарий`, `Тип`, `Скрин`, and `Подтверждено заказчиком`.

`api.js` wraps Jira REST calls: project list, project Epics, and issue creation.

`creator.js` turns a preview row into Jira create payloads. It creates one Story in the selected project and selected existing Epic. If template subtasks are enabled, it creates role subtasks sequentially after the Story is created.

`rendering.js` owns UI rendering: project picker, Epic picker, file upload, parse errors, preview table, row status, and row create buttons.

`main.js` owns widget state and event wiring.

## Excel Parsing Rules

The parser must support journals where the table header is not on the first row. It scans sheets in workbook order and uses the first sheet that contains a cell equal to `Замечание` after trimming whitespace.

Known column names from the current journal:

- `№`
- `Замечание`
- `Статус`
- `Модуль`
- `Приоритет`
- `Автор`
- `Дата`
- `Исполнитель`
- `Спринт`
- `Комментарий`
- `Jira`
- `Пункт НД`
- `Тип`
- `Скрин`
- `Статус в Jira`
- `Исполнитель в Jira`
- `Подтверждено заказчиком`

The importer does not require every known column. `Замечание` is the only required header.

For each data row:

- `summary` is the `Замечание` value;
- `sourceColumns` contains all headers with their raw cell values;
- `excelRowNumber` is the original 1-based Excel row number;
- `sheetName` is the worksheet name used for the row;
- `jiraKey` is extracted from the `Jira` value using an issue-key pattern such as `EVOSCADA-11042`;
- rows with no `Замечание` are ignored;
- rows with a `jiraKey` are marked as already linked and cannot be created again.

## Jira Creation Rules

The user must select a Jira project and an existing Epic before creating rows.

For a row without `jiraKey`, the widget creates:

- issue type: `Story`;
- project: selected project key;
- summary: row `Замечание`;
- Epic Link field: selected Epic key;
- description: generated table from non-empty source columns.

The first version will not automatically map assignee, priority, labels, components, sprint, or fix versions from the journal. Those columns are kept in the description because the source data is manually maintained and can be dirty.

Template subtasks follow the Story Browser role template:

- `System Engineer`: `Анализ и описание функционала`
- `Frontend Task`: `Вёрстка / UI`
- `Backend Task`: `Реализация логики`
- `QA`: `Тестирование`
- `DevOps`: `Подготовка окружения / деплой`

Subtask creation is controlled by a `Создавать подзадачи` checkbox. It is enabled by default.

If Story creation succeeds but a subtask fails, the row status becomes `Частично создано`. The row shows the Story key and the subtask error text. The widget does not roll back the Story.

## Duplicate Handling

If the source row already has a Jira key in the `Jira` column:

- the preview shows the key as a link to Jira;
- the create button is disabled or replaced with `Уже создано`;
- no create request is sent for that row.

The importer does not write back into the Excel file and does not update existing Jira issues in the first version.

## UI Behavior

The widget opens with a compact work surface:

- project selector;
- Epic selector loaded from the selected project;
- file input for Excel;
- `Создавать подзадачи` checkbox;
- summary counters: parsed rows, already linked rows, created rows, failed rows;
- preview table.

Each preview row shows:

- source row number if available;
- remark summary;
- module/status/priority/type when present;
- existing Jira key or created Jira key;
- row action/status.

Rows can be created one by one. Bulk create is out of scope for the first version.

## Error Handling

The widget shows a top-level error when:

- SheetJS cannot be loaded;
- the workbook cannot be read;
- no header row with `Замечание` is found;
- project or Epic loading fails.

Row-level errors are shown in the row when:

- Story creation fails;
- a subtask creation fails;
- Jira returns a response without an issue key.

While a row is being created, its button is disabled. A second click during creation must not send another request.

## Build and Bootstrap

`build-excel-story-importer.js` follows the same pattern as `build-story-browser.js`: ordered modules are concatenated, and the bundle exposes `_ujgExcelStoryImporter`.

`build-widget-bootstrap-assets.js` adds the new widget spec:

- file key: `ujg-excel-story-importer`;
- public AMD: `_ujgExcelStoryImporter`;
- runtime AMD: `_ujgExcelStoryImporterRuntime`.

Standalone mode adds `/excel-import` for local browser verification.

## Test Plan

Add focused tests:

- parser test: finds a header row below non-data rows and extracts rows with `Замечание`;
- parser test: extracts Jira keys from the `Jira` column and marks rows as already linked;
- description test: builds a Jira wiki table from non-empty cells and escapes table-breaking characters;
- creator test: does not call `createIssue` for a row with an existing Jira key;
- creator test: creates one Story and then template subtasks when subtasks are enabled;
- build test: `build-excel-story-importer.js` emits module markers and public AMD alias;
- bootstrap test: `build-widget-bootstrap-assets.js` includes the new widget;
- standalone test: `/excel-import` page loads CSS, JS, and `_ujgExcelStoryImporter`.

## Out of Scope

The first version will not:

- update the source Excel file;
- bulk create all rows at once;
- update existing Jira issues;
- infer assignee, priority, labels, components, sprint, or fix versions;
- create a new Epic from the importer;
- parse screenshots or upload attachments from the `Скрин` column.
