const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

module.exports = function loadAmdModule(filePath, deps) {
    var code = fs.readFileSync(filePath, "utf8");
    var exported;
    var sandbox = {
        console: console,
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
    sandbox.define.amd = true;
    vm.runInNewContext(code, sandbox, {
        filename: path.resolve(filePath)
    });
    return exported;
};
