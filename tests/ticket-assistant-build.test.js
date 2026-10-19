const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

test('isolated source build validates inputs and keeps the shared client external', () => {
    const {build} = require('../build-ticket-assistant');
    const source = build({write: false});
    assert.deepEqual([...source.matchAll(/Module: ([\w.-]+) /g)].map(m => m[1]), build.MODULE_ORDER);
    assert.match(source, /["']_ujgShared_llmClient["']/);
    assert.doesNotMatch(source, /define\(["']_ujgShared_llmClient/);
    assert.throws(() => build({write: false, modulesDir: __dirname}), /Module not found: profiles.js/);
    assert.ok(build.MODULE_ORDER.includes('draft.js'));
    assert.ok(build.MODULE_ORDER.includes('storage.js'));
});

test('runtime registers all modules before instantiation and embeds one renamed client', () => {
    require('../build-ticket-assistant').build();
    const assets = require('../build-widget-bootstrap-assets').buildAssets({widgets: ['ujg-ticket-assistant'], releaseRef: 'task6'});
    assert.deepEqual(Object.keys(assets).sort(), ['ujg-ticket-assistant.bootstrap.js', 'ujg-ticket-assistant.runtime.js']);
    const runtime = assets['ujg-ticket-assistant.runtime.js'];
    assert.equal([...runtime.matchAll(/define\(["']_ujgTA_llmClient["']/g)].length, 1);
    assert.doesNotMatch(runtime, /_ujgShared_llmClient/);
    const modules = new Map([['jquery', {value: {}}]]);
    vm.runInNewContext(runtime, {define(name, deps, factory) {
        assert.ok(!modules.has(name), 'duplicate AMD ' + name); modules.set(name, {deps, factory});
    }, URL, AbortController, console});
    function resolve(name) {
        assert.ok(modules.has(name), 'missing AMD ' + name);
        const entry = modules.get(name);
        if (!('value' in entry)) entry.value = entry.factory(...entry.deps.map(resolve));
        return entry.value;
    }
    assert.equal(typeof resolve('_ujgTicketAssistantRuntime'), 'function');
    for (const file of require('../build-ticket-assistant').build.MODULE_ORDER) {
        assert.ok(fs.existsSync(path.join(root, 'ujg-ticket-assistant-modules', file)));
    }
});
