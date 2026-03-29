const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const loadAmdModule = require("./helpers/load-amd-module");

function normalize(value) {
    return JSON.parse(JSON.stringify(value));
}

function createFixedDate(nowIso, offsetMinutes) {
    const RealDate = Date;
    const offsetMs = offsetMinutes * 60 * 1000;
    const nowMs = RealDate.parse(nowIso);

    function shifted(date) {
        return new RealDate(date.getTime() + offsetMs);
    }

    return class FixedDate extends RealDate {
        constructor(value) {
            if (arguments.length === 0) {
                super(nowMs);
                return;
            }
            if (arguments.length === 1) {
                super(value);
                return;
            }
            super(
                RealDate.UTC(
                    arguments[0],
                    arguments[1],
                    arguments.length > 2 ? arguments[2] : 1,
                    arguments.length > 3 ? arguments[3] : 0,
                    arguments.length > 4 ? arguments[4] : 0,
                    arguments.length > 5 ? arguments[5] : 0,
                    arguments.length > 6 ? arguments[6] : 0
                ) - offsetMs
            );
        }

        static now() {
            return nowMs;
        }

        static parse(value) {
            return RealDate.parse(value);
        }

        static UTC() {
            return RealDate.UTC.apply(RealDate, arguments);
        }

        getFullYear() {
            return shifted(this).getUTCFullYear();
        }

        getMonth() {
            return shifted(this).getUTCMonth();
        }

        getDate() {
            return shifted(this).getUTCDate();
        }

        setDate(value) {
            const local = shifted(this);
            local.setUTCDate(value);
            return super.setTime(local.getTime() - offsetMs);
        }
    };
}

function withDate(DateImpl, fn) {
    const RealDate = global.Date;
    global.Date = DateImpl;
    try {
        return fn();
    } finally {
        global.Date = RealDate;
    }
}

function loadUtils(DateImpl) {
    return withDate(DateImpl, function() {
        return loadAmdModule(path.join(__dirname, "..", "ujg-daily-diligence-modules", "utils.js"), {
            _ujgDD_config: {
                ICONS: {},
                debug: false
            }
        });
    });
}

test("fmtReaction follows the design reference literally", function() {
    const utils = loadUtils(Date);

    assert.equal(utils.fmtReaction(-5), "-5м");
    assert.equal(utils.fmtReaction(30), "30м");
    assert.equal(utils.fmtReaction(120), "2ч");
    assert.equal(utils.fmtReaction(135), "2ч15м");
});

test("date helpers match Index.tsx ISO-based behavior", function() {
    const FixedDate = createFixedDate("2026-03-16T12:30:00.000Z", 14 * 60);
    const utils = loadUtils(FixedDate);

    assert.deepEqual(normalize(utils.getDefaultRange()), ["2026-03-09", "2026-03-16"]);
    assert.deepEqual(normalize(utils.getPresets()), [
        { label: "Текущая неделя", from: "2026-03-09", to: "2026-03-16" },
        { label: "Последние 2 недели", from: "2026-03-02", to: "2026-03-16" },
        { label: "Текущий месяц", from: "2026-02-28", to: "2026-03-16" }
    ]);
    assert.deepEqual(normalize(utils.getDatesInRange("2026-03-01", "2026-03-03")), [
        "2026-03-01",
        "2026-03-02",
        "2026-03-03"
    ]);
});
