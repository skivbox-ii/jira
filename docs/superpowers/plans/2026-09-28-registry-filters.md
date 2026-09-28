# Shared Registry Filters Implementation Plan

**Goal:** Preserve one user-scoped Excel/Jira filter and allow filtered groups to collapse.
**Architecture:** Keep `gridLayout.filters` as the source of truth. Dataset replacement
must not clear it. Group selection stays in `registry.selectGroups`; disclosure stays
in `grid.js`. Rendering mounts a grid-owned reset button in the toolbar, so its state
always reflects the same filters, including when source rows are empty.
**Tech Stack:** Existing AMD JavaScript, jQuery, jsdom tests, local Playwright/Citrix.
**Approval:** User confirmed "Да, общий фильтр Excel/Jira" on 28.09.2026.

## Execution
- [x] Add failing tests in `tests/browser/excel-story-importer-grid.test.cjs`:
  array replacement and source switches preserve selected Bob; activity round-trip
  and a new browser instance restore it; another user does not inherit it.
  Under Bob, parent P-10 stays as context, P-11 can collapse/reopen, P-12 stays hidden.
  Header and toolbar toggle all filtered groups, including across pages.
  Top reset removes value filters and both completion flags without changing layout/sort.
- [x] Run `NODE_PATH=/tmp/ujg-import-registry-test/node_modules node --test tests/browser/excel-story-importer-grid.test.cjs`; confirm failures for current clearing/disabled controls.
- [x] In `grid.js`, remove the dataset-change filter reset. Open matching groups once
  when a filter is applied or a filtered dataset is loaded; thereafter respect manual
  collapse. Share a toggle based on selected expandable groups between header/toolbar.
  Expose a reset button synchronized with filter state, preserving best-effort storage behavior.
- [x] In `rendering.js`, put the reset icon into the compact toolbar. Make it available
  for persisted filters even with empty source data. Do not reset Dynamics filters.
- [x] Run focused and full tests. Review diff independently on Sol6/medium.
  82/82 focused; full 1601/1602 with the pre-existing component-preview timeout
  reproduced on unchanged HEAD. Repeated independent review has no findings.
- [x] Use `tests/browser/import-filter-acceptance.cjs` on localhost with synthetic data:
  desktop/mobile, filter, collapse, source switches, reload, reset and scroll to end.
  Check screenshots personally. No Jira mutations or LLM calls.
- [ ] Build only importer bundles, publish scoped changes through the existing process,
  verify delivered bytes, and personally repeat read-only filter/disclosure checks in
  Citrix. Record evidence in the backlog; leave prod acceptance open if inaccessible.
