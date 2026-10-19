const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit } = require('./helpers/ticket-assistant-fixture');

test('defaults are independent and have three editable templates', () => {
    const profiles = loadUnit('profiles');
    const a = profiles.createDefaults(), b = profiles.createDefaults();
    assert.equal(a.profiles.length, 2);
    for (const profile of a.profiles) {
        assert.equal(profile.templates.length, 3);
        assert.equal(profile.allowAssignee, false);
        assert.ok(profile.templates.every(t => t.issueTypeId === null));
    }
    a.profiles[0].instructions = 'Мои правила';
    a.profiles[0].templates[0].instructions = 'Своя структура';
    const copy = { ...a.profiles[0].templates[0], id: 'custom', name: 'Копия', issueTypeId: '10001' };
    a.profiles[0].templates.push(copy);
    a.activeProfileId = a.profiles[0].id;
    const result = profiles.validateSettings(a);
    assert.equal(result.ok, true);
    assert.equal(result.value.profiles[0].templates[3].issueTypeId, '10001');
    assert.notEqual(b.profiles[0].instructions, a.profiles[0].instructions);
    assert.notEqual(b.profiles[0].templates[0].instructions, 'Своя структура');
    assert.match(a.profiles[1].instructions, /истори/);
    assert.match(a.profiles[1].instructions, /не блокирует/);
    assert.match(a.profiles[1].instructions, /причин.*отсутствия логов/);
});

test('unknown import version, malformed records and prototype keys are rejected throughout the tree', () => {
    const profiles = loadUnit('profiles');
    for (const text of ['{', 'null', '[]', '{"schemaVersion":2}', '{"__proto__":{"admin":true}}']) {
        const result = profiles.parseSettingsImport(text);
        assert.equal(result.ok, false);
        assert.equal(result.value, null);
        assert.ok(result.errors.length);
    }
    for (const key of ['__proto__', 'constructor', 'prototype']) {
        const settings = profiles.createDefaults();
        settings.extra = JSON.parse('{"nested":{"' + key + '":true}}');
        assert.equal(profiles.validateSettings(settings).ok, false);
    }
    for (const mutate of [
        s => { s.profiles[0].templates.push({ ...s.profiles[0].templates[0] }); },
        s => { s.profiles[1].id = s.profiles[0].id; },
        s => { s.activeProfileId = 'missing'; },
        s => { s.profiles[0].allowAssignee = 'false'; },
        s => { s.revision = -1; },
        s => { s.profiles[0].templates[0].issueTypeId = 123; }
    ]) {
        const settings = profiles.createDefaults();
        mutate(settings);
        assert.equal(profiles.validateSettings(settings).ok, false);
    }
});

test('export uses an allowlist at every level and import previews without applying', () => {
    const profiles = loadUnit('profiles');
    const settings = profiles.createDefaults();
    for (const obj of [settings, settings.profiles[0], settings.profiles[0].templates[0]]) {
        Object.assign(obj, { apiKey: 'SECRET', source: 'PRIVATE', draft: {}, attachments: [], diagnostic: 'PRIVATE' });
    }
    const text = profiles.exportSettings(settings);
    assert.doesNotMatch(text, /apiKey|source|draft|attachments|diagnostic|SECRET|PRIVATE/);
    const result = profiles.parseSettingsImport(text);
    assert.equal(result.ok, true);
    assert.ok(result.preview);
    assert.equal(result.value.profiles.length, 2);
    result.value.profiles[0].name = 'Изменено';
    assert.notEqual(settings.profiles[0].name, 'Изменено');
});
