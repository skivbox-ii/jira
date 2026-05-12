const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const BUILD_SCRIPT = path.join(ROOT, "build-excel-story-importer.js");
const OUTPUT_FILE = path.join(ROOT, "ujg-excel-story-importer.js");

function extractModuleMarkers(content) {
  const re = /\/\* === Module: ([^ ]+) === \*\//g;
  const names = [];
  let m;
  while ((m = re.exec(content)) !== null) names.push(m[1]);
  return names;
}

test("build-excel-story-importer exports { build }", function () {
  const mod = require(BUILD_SCRIPT);
  assert.equal(typeof mod.build, "function");
  assert.ok(Array.isArray(mod.build.MODULE_ORDER));
});

test("build emits ujg-excel-story-importer.js with public AMD alias", function () {
  const { build } = require(BUILD_SCRIPT);
  build();
  const content = fs.readFileSync(OUTPUT_FILE, "utf8");
  assert.deepEqual(extractModuleMarkers(content), build.MODULE_ORDER);
  assert.match(content, /define\("_ujgExcelStoryImporter", \["_ujgESI_main"\], function\(G\)/);
});

test("CLI build updates output", function () {
  execFileSync(process.execPath, [BUILD_SCRIPT], { cwd: ROOT, stdio: "pipe" });
  assert.ok(fs.existsSync(OUTPUT_FILE));
});
