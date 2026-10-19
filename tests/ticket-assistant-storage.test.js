const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit, memoryStorage } = require('./helpers/ticket-assistant-fixture');

function fixture(storage = memoryStorage(), globals = {}) {
    const profiles = loadUnit('profiles');
    const unit = loadUnit('storage', { '_ujgTA_profiles': profiles, '_ujgTA_draft': loadUnit('draft') }, globals);
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
    assert.doesNotMatch(storage.getItem(storage.key(0)), /"content"|"secret"/);
    assert.equal(store().load('DO').draft.attachments[0].name, 'secret.txt');
    assert.equal(store().load('DO').draft.attachments[0].needsReselect, true);
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

test('draft saves and clear preserve settings revision independently of the CAS counter', () => {
    const { store } = fixture();
    const a = store();
    const value = a.load('DO');
    value.settings.revision = 7;
    value.draft = {
        source: 'checked draft', settingsRevision: 7, sourceRevision: 1, draftRevision: 2, metaSignature: 'meta',
        checked: { sourceRevision: 1, settingsRevision: 7, draftRevision: 2, metaSignature: 'meta' }
    };
    assert.equal(a.save('DO', value, 0).revision, 1);
    for (let revision = 1; revision <= 3; revision++) {
        const loaded = a.load('DO');
        assert.equal(loaded.revision, revision);
        assert.equal(loaded.settings.revision, 7);
        assert.equal(loaded.draft.settingsRevision, 7);
        assert.equal(loaded.draft.checked.settingsRevision, loaded.settings.revision);
        const restored = store().load('DO');
        assert.equal(restored.settings.revision, 7);
        assert.equal(restored.draft.checked, null);
        assert.equal(a.save('DO', loaded, revision).revision, revision + 1);
    }
    assert.equal(a.clearDraft('DO', 4).revision, 5);
    const cleared = store().load('DO');
    assert.equal(cleared.revision, 5);
    assert.equal(cleared.settings.revision, 7);
    assert.equal(cleared.draft, null);
    cleared.settings.revision = 11;
    cleared.settings.profiles[0].instructions = 'Updated rules';
    assert.equal(a.save('DO', cleared, 5).revision, 6);
    const updated = store().load('DO');
    assert.equal(updated.revision, 6);
    assert.equal(updated.settings.revision, 11);
    assert.equal(updated.settings.profiles[0].instructions, 'Updated rules');
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

test('live submitting attempt survives internal loads and saves but fresh stores recover unknown', () => {
    const { store } = fixture();
    const a = store();
    const value = a.load('DO');
    value.draft = { id: 'draft-1', creation: { status: 'submitting', issueKey: 'DO-42', attemptId: 'active-attempt' } };
    assert.equal(a.save('DO', value, 0).ok, true);
    const recovered = store();
    for (let revision = 1; revision <= 3; revision++) {
        const live = a.load('DO');
        assert.equal(live.draft.creation.status, 'submitting');
        assert.equal(a.load('DO').draft.creation.status, 'submitting');
        assert.equal(live.draft.creation.attemptId, 'active-attempt');
        const restored = recovered.load('DO');
        assert.equal(restored.draft.creation.status, 'unknown');
        assert.equal(restored.draft.creation.issueKey, 'DO-42');
        assert.equal(restored.draft.creation.attemptId, 'active-attempt');
        live.settings.profiles[0].instructions = 'Rules saved during submission ' + revision;
        assert.equal(a.save('DO', live, revision).ok, true);
    }
    const done = a.load('DO');
    done.draft.creation.status = 'created';
    assert.equal(a.save('DO', done, 4, {creation:true,draftId:'draft-1',attemptId:'active-attempt'}).ok, true);
    assert.equal(a.load('DO').draft.creation.status, 'created');
    assert.equal(store().load('DO').draft.creation.status, 'created');
});

test('same store recovers an external different attempt or draft as unknown', () => {
    for (const replacement of [
        { id: 'draft-1', attemptId: 'other-attempt' },
        { id: 'draft-2', attemptId: 'active-attempt' }
    ]) {
        const { store, storage } = fixture();
        const a = store();
        const initial = a.load('DO');
        initial.draft = { id: 'draft-1', creation: { status: 'submitting', attemptId: 'active-attempt' } };
        const saved = a.save('DO', initial, initial.revision);
        assert.equal(saved.ok,true);
        const b = store();
        const external = b.load('DO');
        external.draft = { id: replacement.id, creation: { status: 'submitting', attemptId: replacement.attemptId, issueKey: 'DO-43' } };
        assert.equal(b.save('DO', external, saved.revision).ok, false);
        // Simulate a legacy/external writer bypassing this store's new creation guard.
        const key=storage.key(0), envelope=JSON.parse(storage.getItem(key));
        envelope.draft=external.draft;envelope.revision++;
        storage.setItem(key,JSON.stringify(envelope));
        const recovered = a.load('DO');
        assert.equal(recovered.draft.creation.status, 'unknown');
        assert.equal(recovered.draft.creation.issueKey, 'DO-43');
        assert.equal(recovered.draft.creation.attemptId, replacement.attemptId);
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

test('store enforces nested draft whitelist on save and on externally supplied reload data', () => {
    const { store, storage } = fixture();
    const a = store();
    const value = a.load('DO');
    value.draft = {
        id: 'd', projectKey: 'DO', source: 'facts',
        fields: { option: { id: '1', token: 'SECRET' }, invalid: { content: 'SECRET' } },
        pendingFields: { assignee: { name: 'alice', cookie: 'SECRET' } },
        protectedFields: { option: true, cookie: 'SECRET' },
        questions: [{ id: 'q', text: '?', reason: 'why', required: true, apiKey: 'SECRET' }],
        evidence: [{ fieldId: 'summary', kind: 'source', quote: 'facts', apiKey: 'SECRET' }],
        warnings: ['warning', { token: 'SECRET' }],
        creation: { status: 'created', issueKey: 'DO-7', error: { headers: 'SECRET' }, token: 'SECRET' },
        attachments: [{ name: 'log.txt', status: 'failed', error: 'Upload failed', content: 'SECRET', file: { toJSON() { throw new Error('file'); } } }]
    };
    assert.equal(a.save('DO', value, 0).ok, true);
    const key = storage.key(0);
    assert.doesNotMatch(storage.getItem(key), /SECRET|"content"|"cookie"|"token"|"apiKey"|"headers"|"file"/);
    const raw = JSON.parse(storage.getItem(key));
    raw.draft.fields.option.token = 'SECRET';
    raw.draft.creation.response = { token: 'SECRET' };
    raw.draft.checked = { sourceRevision: 0, settingsRevision: 0, draftRevision: 0, metaSignature: null, token: 'SECRET' };
    storage.setItem(key, JSON.stringify(raw));
    const restored = store().load('DO').draft;
    assert.doesNotMatch(JSON.stringify(restored), /SECRET/);
    assert.equal(restored.checked, null);
    assert.equal(restored.creation.issueKey, 'DO-7');
    assert.equal(restored.attachments[0].status, 'failed');
    assert.equal(restored.attachments[0].error, 'Upload failed');
    assert.equal(restored.attachments[0].needsReselect, true);
});
