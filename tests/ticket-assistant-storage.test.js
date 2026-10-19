const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit, memoryStorage } = require('./helpers/ticket-assistant-fixture');

function fixture(storage = memoryStorage(), globals = {}) {
    const profiles = loadUnit('profiles');
    const unit = loadUnit('storage', { '_ujgTA_profiles': profiles }, globals);
    return { profiles, storage, store: options => unit.createStore({ storage, origin: 'https://jira.example', userKey: 'Alice', ...options }) };
}

test('personal project and origin boundaries use encoded keys and detached snapshots', () => {
    const { store, storage } = fixture();
    const alice = store();
    const value = alice.load('DO');
    assert.equal(value.revision, 0);
    assert.equal(value.draft, null);
    value.settings.profiles[0].name = 'Alice only';
    value.draft = { schemaVersion: 1, source: 'private', fields: { summary: 'text' }, attachments: [{ name: 'secret.txt', content: 'secret' }] };
    assert.equal(alice.save('DO', value, 0).ok, true);
    assert.equal(storage.key(0), 'ujg-ticket-assistant:v1:https%3A%2F%2Fjira.example:Alice:DO');
    assert.equal(store().load('DO').draft.source, 'private');
    assert.notEqual(store({ userKey: 'Bob' }).load('DO').settings.profiles[0].name, 'Alice only');
    assert.equal(alice.load('APP').draft, null);
    assert.equal(store({ origin: 'https://other.example' }).load('DO').draft, null);
    assert.doesNotMatch(storage.getItem(storage.key(0)), /secret.txt|content|secret/);
    const loaded = alice.load('DO');
    loaded.draft.fields.summary = 'mutated';
    assert.equal(alice.load('DO').draft.fields.summary, 'text');
});

test('stale writes and clearDraft conflict without overwriting another tab', () => {
    const { store } = fixture();
    const a = store(), b = store();
    const initial = a.load('DO');
    initial.draft = { source: 'first' };
    assert.equal(a.save('DO', initial, 0).revision, 1);
    assert.equal(b.save('DO', { ...initial, draft: { source: 'second' } }, 1).revision, 2);
    const stale = a.save('DO', initial, 1);
    assert.equal(stale.ok, false);
    assert.equal(stale.reason, 'conflict');
    assert.equal(stale.revision, 2);
    assert.equal(a.clearDraft('DO', 1).reason, 'conflict');
    assert.equal(a.load('DO').draft.source, 'second');
    assert.equal(a.clearDraft('DO', 2).ok, true);
    assert.equal(b.load('DO').draft, null);
    assert.equal(b.load('DO').revision, 3);
});

test('unknown identity stays in memory and never writes an anonymous key', () => {
    const { store, storage } = fixture();
    for (const userKey of [null, undefined, '', '   ']) {
        const a = store({ userKey });
        const value = a.load('DO');
        value.draft = { source: 'unsaved identity' };
        assert.equal(a.save('DO', value, 0).ok, true);
        assert.equal(a.load('DO').draft.source, 'unsaved identity');
        assert.equal(store({ userKey }).load('DO').draft, null);
    }
    assert.equal(storage.length, 0);
});

test('storage events detect external changes without mutating an open snapshot', () => {
    let onStorage;
    const warnings = [];
    const backend = memoryStorage();
    const { store } = fixture(backend, { window: { addEventListener(type, listener) {
        if (type === 'storage') onStorage = listener;
    } } });
    const a = store({ onWarning: warning => warnings.push(warning) });
    const open = a.load('DO');
    const b = store();
    const next = b.load('DO');
    next.draft = { source: 'external edit' };
    b.save('DO', next, 0);
    assert.equal(typeof onStorage, 'function');
    onStorage({ key: backend.key(0), storageArea: backend });
    assert.equal(open.draft, null);
    assert.equal(a.load('DO').draft.source, 'external edit');
    assert.ok(warnings.length > 0);
    assert.equal(a.save('DO', open, 0).reason, 'conflict');
});

test('quota and security exceptions preserve memory and warn', () => {
    for (const failure of ['getItem', 'setItem']) {
        const backend = memoryStorage();
        const { store } = fixture(backend);
        const warnings = [];
        const a = store({ onWarning: warning => warnings.push(warning) });
        const value = a.load('DO');
        backend[failure] = () => { throw new Error(failure === 'getItem' ? 'SecurityError' : 'QuotaExceededError'); };
        value.draft = { source: 'retain me' };
        assert.equal(a.save('DO', value, 0).ok, true);
        assert.equal(a.load('DO').draft.source, 'retain me');
        assert.ok(warnings.length > 0);
    }
});

test('reload marks submitting unknown, retains issue key, rejects corruption and invalid saves', () => {
    const { store, storage } = fixture();
    const a = store();
    const value = a.load('DO');
    value.draft = { creation: { status: 'submitting', issueKey: 'DO-42', attemptId: 'attempt' } };
    a.save('DO', value, 0);
    const reloaded = store().load('DO');
    assert.equal(reloaded.draft.creation.status, 'unknown');
    assert.equal(reloaded.draft.creation.issueKey, 'DO-42');
    value.settings.schemaVersion = 999;
    assert.equal(a.save('DO', value, 1).ok, false);
    const warnings = [];
    storage.setItem(storage.key(0), '{bad');
    assert.equal(store({ onWarning: w => warnings.push(w) }).load('DO').draft, null);
    assert.ok(warnings.length);
});
