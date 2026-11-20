const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Exercise the shipped UMD files through their AMD branches, with no window,
// CommonJS require or library globals supplied by the harness.
function loadVendorAmd(filename) {
  let exported;
  function define(name, dependencies, factory) {
    if (typeof name !== "string") {
      factory = dependencies;
      dependencies = name;
    }
    if (typeof dependencies === "function") {
      factory = dependencies;
      dependencies = [];
    }
    if (dependencies.length) throw new Error("Unexpected vendor AMD dependencies: " + dependencies);
    exported = factory();
  }
  define.amd = true;
  const file = path.join(__dirname, "../../vendor", filename);
  vm.runInNewContext(fs.readFileSync(file, "utf8"), {
    define, console, Date, ArrayBuffer, Uint8Array, Uint16Array, Uint32Array,
    Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, DataView,
    Promise, setTimeout, clearTimeout, setImmediate, clearImmediate,
  }, { filename: file });
  if (!exported) throw new Error("Vendor did not define an AMD export: " + filename);
  return exported;
}

module.exports = {
  sheetjs: loadVendorAmd("xlsx-0.18.5.full.min.js"),
  jszip: loadVendorAmd("jszip-3.10.1.min.js"),
};
