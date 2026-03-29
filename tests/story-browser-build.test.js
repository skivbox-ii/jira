const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const BUILD_SCRIPT = path.join(ROOT, "build-story-browser.js");
const OUTPUT_FILE = path.join(ROOT, "ujg-story-browser.js");

function extractModuleMarkers(content) {
    const re = /\/\* === Module: ([^ ]+) === \*\//g;
    const names = [];
    let m;
    while ((m = re.exec(content)) !== null) {
        names.push(m[1]);
    }
    return names;
}

test("build-story-browser exports { build }", () => {
    const mod = require(BUILD_SCRIPT);
    assert.equal(typeof mod.build, "function");
    assert.ok(Array.isArray(mod.build.MODULE_ORDER));
    assert.ok(mod.build.MODULE_ORDER.length > 0);
});

test("build() produces ujg-story-browser.js with markers in MODULE_ORDER", () => {
    const { build } = require(BUILD_SCRIPT);
    build();
    assert.ok(fs.existsSync(OUTPUT_FILE), "output file exists after build");
    const content = fs.readFileSync(OUTPUT_FILE, "utf8");
    assert.ok(
        content.startsWith("// Auto-generated file - DO NOT EDIT MANUALLY"),
        "bundle starts with auto-generated comment"
    );
    assert.deepEqual(extractModuleMarkers(content), build.MODULE_ORDER);
    build.MODULE_ORDER.forEach(function(fileName) {
        var amdName = "_ujgSB_" + fileName.replace(/\.js$/, "");
        assert.match(content, new RegExp('define\\(["\']' + amdName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '["\']'));
    });
});

test("built bundle exposes public AMD alias _ujgStoryBrowser -> _ujgSB_main", () => {
    const { build } = require(BUILD_SCRIPT);
    build();
    const content = fs.readFileSync(OUTPUT_FILE, "utf8");
    assert.match(
        content,
        /define\s*\(\s*["']_ujgStoryBrowser["']\s*,\s*\[\s*["']_ujgSB_main["']\s*\]\s*,\s*function\s*\(\s*G\s*\)\s*\{\s*"use strict";\s*return\s+G;\s*\}\s*\)\s*;/s
    );
});

test("build() fails fast when a required module file is missing", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "story-browser-build-"));
    const tempBuildScript = path.join(tempRoot, "build-story-browser.js");
    const tempModulesDir = path.join(tempRoot, "ujg-story-browser-modules");
    fs.copyFileSync(BUILD_SCRIPT, tempBuildScript);
    fs.cpSync(path.join(ROOT, "ujg-story-browser-modules"), tempModulesDir, { recursive: true });
    fs.unlinkSync(path.join(tempModulesDir, "api.js"));
    const { build } = require(tempBuildScript);
    try {
        assert.throws(() => build(), /Module not found: api\.js/);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("CLI: node build-story-browser.js from worktree root updates output", () => {
    execFileSync(process.execPath, [BUILD_SCRIPT], {
        cwd: ROOT,
        stdio: "pipe"
    });
    assert.ok(fs.existsSync(OUTPUT_FILE));
});
