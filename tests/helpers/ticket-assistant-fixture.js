const path = require('node:path');
const loadAmdModule = require('./load-amd-module');

function memoryStorage() {
    const values = new Map();
    return {
        get length() { return values.size; },
        key(index) { return [...values.keys()][index] ?? null; },
        getItem(key) { return values.get(String(key)) ?? null; },
        setItem(key, value) { values.set(String(key), String(value)); },
        removeItem(key) { values.delete(String(key)); },
        clear() { values.clear(); }
    };
}

function loadUnit(name, deps = {}, globals = {}) {
    return loadAmdModule(path.resolve(__dirname, '../../ujg-ticket-assistant-modules', name + '.js'), deps, globals);
}

module.exports = { memoryStorage, loadUnit };
