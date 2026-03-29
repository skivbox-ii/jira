const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("standalone server exposes daily diligence assets and route", function() {
  const serverJs = read("standalone/server.js");

  assert.match(serverJs, /"ujg-daily-diligence\.js"/);
  assert.match(serverJs, /"ujg-daily-diligence\.css"/);
  assert.match(serverJs, /app\.get\("\/daily-diligence"/);
  assert.match(serverJs, /daily-diligence\.html/);
});

test("standalone daily diligence page loads gadget assets and active nav", function() {
  const html = read("standalone/public/daily-diligence.html");

  assert.match(html, /href="\/widgets\/ujg-daily-diligence\.css"/);
  assert.match(html, /src="\/widgets\/_ujgCommon\.js"/);
  assert.match(html, /src="\/widgets\/ujg-daily-diligence\.js"/);
  assert.match(html, /require\(\["_ujgDailyDiligence"\]/);
  assert.match(html, /href="\/daily-diligence"/);
  assert.match(html, /class="nav-active"/);
});

test("standalone widget pages link to daily diligence", function() {
  [
    "standalone/public/sprint.html",
    "standalone/public/analytics.html",
    "standalone/public/timesheet.html",
    "standalone/public/timesheet-v0.html",
    "standalone/public/user-activity.html"
  ].forEach(function(relPath) {
    assert.match(read(relPath), /href="\/daily-diligence"/, relPath);
  });
});

test("touched standalone widget pages safely handle session fetch failures", function() {
  [
    "standalone/public/daily-diligence.html",
    "standalone/public/sprint.html",
    "standalone/public/analytics.html",
    "standalone/public/timesheet.html",
    "standalone/public/timesheet-v0.html",
    "standalone/public/user-activity.html"
  ].forEach(function(relPath) {
    assert.match(
      read(relPath),
      /fetch\("\/api\/session"\)[\s\S]*?\.catch\(/,
      relPath
    );
  });
});
