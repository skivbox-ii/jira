const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("standalone server exposes story browser assets and /stories route", function() {
  const serverJs = read("standalone/server.js");

  assert.match(serverJs, /"ujg-story-browser\.js"/);
  assert.match(serverJs, /"ujg-story-browser\.css"/);
  assert.match(serverJs, /app\.get\("\/stories"/);
  assert.match(serverJs, /stories\.html/);
});

test("standalone stories page loads gadget assets and _ujgStoryBrowser", function() {
  const html = read("standalone/public/stories.html");

  assert.match(html, /href="\/widgets\/ujg-story-browser\.css"/);
  assert.match(html, /src="\/widgets\/_ujgCommon\.js"/);
  assert.match(html, /src="\/widgets\/ujg-story-browser\.js"/);
  assert.match(html, /require\(\["_ujgStoryBrowser"\]/);
  assert.match(html, /getGadgetContentEl:/);
  assert.match(html, /resize:/);
});

test("standalone stories page has active nav entry for /stories", function() {
  const html = read("standalone/public/stories.html");

  assert.match(html, /href="\/stories"[^>]*class="nav-active"/);
});

test("standalone stories page safely handles /api/session fetch failure", function() {
  assert.match(
    read("standalone/public/stories.html"),
    /fetch\("\/api\/session"\)[\s\S]*?\.catch\(/,
    "stories.html"
  );
});

test("standalone widget pages link to /stories", function() {
  [
    "standalone/public/sprint.html",
    "standalone/public/analytics.html",
    "standalone/public/timesheet.html",
    "standalone/public/timesheet-v0.html",
    "standalone/public/user-activity.html",
    "standalone/public/daily-diligence.html"
  ].forEach(function(relPath) {
    assert.match(read(relPath), /href="\/stories"/, relPath);
  });
});
