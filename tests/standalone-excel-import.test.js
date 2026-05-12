const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("standalone server exposes excel importer assets and route", function () {
  const serverJs = read("standalone/server.js");

  assert.match(serverJs, /"ujg-excel-story-importer\.js"/);
  assert.match(serverJs, /"ujg-excel-story-importer\.css"/);
  assert.match(serverJs, /app\.get\("\/excel-import"/);
  assert.match(serverJs, /excel-import\.html/);
});

test("standalone excel import page loads importer assets and AMD module", function () {
  const html = read("standalone/public/excel-import.html");

  assert.match(html, /href="\/widgets\/ujg-excel-story-importer\.css"/);
  assert.match(html, /src="\/widgets\/_ujgCommon\.js"/);
  assert.match(html, /src="\/widgets\/ujg-excel-story-importer\.js"/);
  assert.match(html, /require\(\["_ujgExcelStoryImporter"\]/);
});

test("standalone widget pages link to excel import", function () {
  [
    "standalone/public/sprint.html",
    "standalone/public/analytics.html",
    "standalone/public/timesheet.html",
    "standalone/public/timesheet-v0.html",
    "standalone/public/user-activity.html",
    "standalone/public/daily-diligence.html",
    "standalone/public/stories.html",
  ].forEach(function (relPath) {
    assert.match(read(relPath), /href="\/excel-import"/, relPath);
  });
});
