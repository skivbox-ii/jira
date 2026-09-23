# Offline Import Registry Tests

These fixtures use synthetic remarks and an in-memory Jira API substitute. They do not connect to Jira. The browser test blocks all non-local requests and verifies that no creation call is made, including when opening and cancelling the create dialog.

Install test-only dependencies outside the repository:

```sh
npm install --prefix /tmp/ujg-import-registry-test --no-save jquery@3.7.1 jsdom@26.1.0 xlsx@0.18.5 jszip@3.10.1 playwright@1.62.1
export NODE_PATH=/tmp/ujg-import-registry-test/node_modules
node --test tests/browser/excel-story-importer-grid.test.cjs
node tests/browser/import-preview-server.cjs
```

With the local server running, use another terminal with the same `NODE_PATH`:

```sh
node tests/browser/verify-import-registry.cjs
node --test tests/browser/import-preview-startup.test.cjs
```

The default preview at `http://127.0.0.1:4317/` automatically imports and synchronizes its synthetic workbook against the in-memory API. It includes new, failed and partially created remarks, a 23-child tree, and compact expandable groups. No production startup behavior is changed. Use `/?empty=1` for the original manual-upload workflow; `/fixture.xlsx` provides the synthetic workbook.

Descriptions, user search and the explicit Jira-only view also use local fixtures. Hovering or focusing a task opens its already-loaded description without another issue request. The page's Content Security Policy blocks external connections; creation APIs still throw instead of sending writes. Owner edits in this preview modify source data only, not Jira assignees.

Column titles toggle sorting; the adjacent Excel-style dropdown filters values. Priority sorting uses severity for standard Russian/English names, with custom names and empty values after known priorities. Sorting and filtering retain parent/child groups. The status filter can exclude completed tasks while keeping a context parent for matching children. The plus action opens new-Story confirmation for uncreated remarks or child-only confirmation for an existing Story; no final creation is allowed by the preview API.

The browser test uses installed Google Chrome, verifies automatic startup, tree expansion, header filters and manual upload, and checks desktop and mobile layouts. Screenshots go to `/tmp/ujg-import-registry-screenshots` (override with `IMPORT_SCREENSHOTS`). Repository tests remain dependency-free: `node --test tests/*.test.js`.
