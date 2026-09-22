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
```

The test uses installed Google Chrome, opens `http://127.0.0.1:4317/`, uploads the generated workbook, exercises stub synchronization and header filters, and checks desktop and mobile layouts. Screenshots go to `/tmp/ujg-import-registry-screenshots` (override with `IMPORT_SCREENSHOTS`). In the preview, `/fixture.xlsx` provides the synthetic workbook. Repository tests remain dependency-free: `node --test tests/*.test.js`.
