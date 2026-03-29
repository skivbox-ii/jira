const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

module.exports = function loadAmdModule(filePath, deps, extraGlobals) {
    var code = fs.readFileSync(filePath, "utf8");
    var exported;
    var sandbox = {
        console: console,
        Date: Date,
        Object: Object,
        Array: Array,
        JSON: JSON,
        Math: Math,
        parseInt: parseInt,
        parseFloat: parseFloat,
        isNaN: isNaN,
        isFinite: isFinite,
        encodeURIComponent: encodeURIComponent,
        decodeURIComponent: decodeURIComponent,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        define: function(name, names, factory) {
            if (typeof name !== "string") {
                factory = names;
                names = name;
            }
            exported = factory.apply(null, (names || []).map(function(dep) {
                if (!Object.prototype.hasOwnProperty.call(deps, dep)) {
                    throw new Error("Missing dependency: " + dep);
                }
                return deps[dep];
            }));
        }
    };
    if (extraGlobals && typeof extraGlobals === "object") {
        Object.keys(extraGlobals).forEach(function(k) {
            sandbox[k] = extraGlobals[k];
        });
    }
    sandbox.define.amd = true;
    vm.runInNewContext(code, sandbox, {
        filename: path.resolve(filePath)
    });
    return exported;
};
