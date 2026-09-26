# Excel Column Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking.

**Goal:** Detect and repair mismatched Excel columns before replacing the registry.

**Architecture:** Parser owns header inspection and explicit physical column bindings. A dedicated dialog owns draft UI; main atomically commits parsed data and optionally persists mappings.

**Tech Stack:** Existing AMD JavaScript, jQuery, SheetJS, node:test, jsdom and browser preview.

## Task 1: Parser and Bindings

Files: `ujg-excel-story-importer-modules/parser.js`, `mapping-store.js`,
`tests/excel-story-importer-parser.test.js`, `tests/excel-story-importer-mapping-store.test.js`.

- [x] Add failing tests for `inspectWorkbook(workbook, options)` and explicit `columnBindings`.
  Assert `report.needsReview === true` for absent/ambiguous/empty columns;
  `report.canApply === false` for unresolved fields or missing summary.
- [x] Run `node --test tests/excel-story-importer-parser.test.js` and confirm RED.
- [x] Return `{sheetName,headerRowNumber,sheetNames,columns,fields,counts,needsReview,canApply}`.
  Columns contain `{index,header,letter,occurrence,examples,nonEmptyCount}`;
  fields contain `{key,label,required,selectedIndex,status}`;
  counts contain `{total,visible,hidden}` for rows with a summary.
- [x] Support `columnBindings[key] = {header,occurrence}` and `null` for explicit skip;
  `headerRowNumber` selects an explicit header for the current file. Preserve aliases
  when no explicit binding exists. Do not fill skipped fields via fallback headers.
- [x] Persist validated columnBindings in mapping-store without unrelated settings changes.
- [x] Run parser, mapping-store and registry tests; review resulting data contract.

## Task 2: Transactional Import and Dialog

Files: `main.js`, `rendering.js`, new `column-preflight-ui.js`, importer styles
and `build-excel-story-importer.js`; focused main/browser tests.

- [x] Write RED tests: old workbook/rows survive review, cancel and errors; apply commits
  parsed rows; remember=false leaves localStorage unchanged; stale reads ignored.
- [x] Stage `{fileName,buffer,workbook,settings,report,remember:true}` in pendingImport;
  make `onFileChange` read first without clearing the existing registry.
- [x] Add callbacks for sheet/header/field choice, remember, cancel and apply. Reinspect
  only the draft; call parseWorkbook before committing any state or storage.
- [x] Add dialog using existing modal/focus/scroll conventions. Render all ten fields,
  searchable column popovers, letter/header/examples/status, sheet/header controls,
  visible/hidden counts, explicit skip and confirm/cancel. Disable apply for errors.
- [x] Register module in build/rendering and scoped CSS. Preserve safe text rendering,
  viewport constraints, keyboard access and return focus.
- [x] Run focused main/browser tests including native clicks and persistence.

## Task 3: Acceptance

- [x] Build importer only; verify diff and runtime. Run full suite with existing NODE_PATH.
- [x] Independently review spec compliance and then code quality; fix with regressions.
- [x] Personally inspect desktop/mobile in local browser with synthetic Excel fixtures.
- [x] Commit scoped changes, publish existing importer process, compare CDN bytes.
- [ ] Personally verify Citrix mismatch preview, choices, cancel and local import;
  never create/update Jira. Record evidence, limitations and final backlog status.
