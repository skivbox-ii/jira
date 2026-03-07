const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("standalone server exposes timesheet-v0 assets and route", function() {
  const serverJs = read("standalone/server.js");

  assert.match(serverJs, /"ujg-timesheet\.v0\.js"/);
  assert.match(serverJs, /"ujg-timesheet\.v0\.css"/);
  assert.match(serverJs, /app\.get\("\/timesheet-v0"/);
  assert.match(serverJs, /timesheet-v0\.html/);
});

test("standalone timesheet-v0 page loads v0 assets and nav link", function() {
  const html = read("standalone/public/timesheet-v0.html");

  assert.match(html, /href="\/widgets\/ujg-timesheet\.v0\.css"/);
  assert.match(html, /src="\/widgets\/ujg-timesheet\.v0\.js"/);
  assert.match(html, /href="\/timesheet-v0"/);
  assert.match(html, /class="nav-active"/);
});

test("standalone current timesheet page links to timesheet-v0", function() {
  const html = read("standalone/public/timesheet.html");

  assert.match(html, /href="\/timesheet-v0"/);
});
