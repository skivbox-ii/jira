const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "ujg-timesheet.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "ujg-timesheet.css"), "utf8");

test("timesheet identity controls share one adaptive row", function() {
    assert.match(source, /var \$controlsRow = \$\('<div class="ujg-controls-row"><\/div>'\)/);
    assert.match(
        source,
        /\$controlsRow\.append\(\$userFilter, \$groupFilter, \$modeControls, \$debugBox, \$fsBtn\)/
    );
    assert.doesNotMatch(source, /var \$row3 =/);
    assert.match(css, /\.ujg-controls-row\{[^}]*flex-wrap:wrap/);
    assert.match(css, /\.ujg-debug-box\{[^}]*flex:/);
});
