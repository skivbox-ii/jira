const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit } = require('./helpers/ticket-assistant-fixture');

test('old settings migrate budget and explicit budgets roundtrip with editable prompts', () => {
    const p=loadUnit('profiles'), old=p.createDefaults(); delete old.tokenBudget;
    const migrated=p.parseSettingsImport(JSON.stringify(old));
    assert.deepEqual(JSON.parse(JSON.stringify(migrated.value.tokenBudget)),{context:32768,reserve:4096});
    migrated.value.tokenBudget={context:65536,reserve:8192};
    migrated.value.profiles[0].instructions='  editable\n\n';
    const imported=p.parseSettingsImport(p.exportSettings(migrated.value));
    assert.deepEqual(JSON.parse(JSON.stringify(imported.value.tokenBudget)),{context:65536,reserve:8192});
    assert.equal(imported.value.profiles[0].instructions,'  editable\n\n');
    for (const budget of [null,{}, {context:0,reserve:1},{context:10,reserve:10},{context:10,reserve:-1},{context:10,reserve:1.1},{context:Infinity,reserve:1},{context:'20',reserve:1}]) {
        const settings=p.createDefaults();settings.tokenBudget=budget;assert.equal(p.validateSettings(settings).ok,false);
    }
});

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

test('description format defaults and legacy settings migrate to markdown without changing templates',()=>{
    const p=loadUnit('profiles'),settings=p.createDefaults();assert.equal(settings.descriptionFormat,'markdown');
    const legacy=JSON.parse(JSON.stringify(settings));delete legacy.descriptionFormat;
    const migrated=p.validateSettings(legacy);assert.equal(migrated.ok,true);assert.equal(migrated.value.descriptionFormat,'markdown');
    assert.deepEqual(JSON.parse(JSON.stringify(migrated.value.profiles)),legacy.profiles);assert.equal(migrated.value.revision,legacy.revision);
});

test('description format survives import export preview and rejects malformed explicit values',()=>{
    const p=loadUnit('profiles');
    for(const format of ['markdown','plain']) {
        const settings=p.createDefaults();settings.descriptionFormat=format;
        const imported=p.parseSettingsImport(p.exportSettings(settings));assert.equal(imported.ok,true);assert.equal(imported.value.descriptionFormat,format);assert.equal(imported.preview.descriptionFormat,format);
        assert.equal(JSON.parse(p.exportSettings(imported.value)).descriptionFormat,format);
    }
    for(const format of [null,'','html','MARKDOWN',false,1,[],{}]) {
        const settings=p.createDefaults();settings.descriptionFormat=format;const checked=p.validateSettings(settings);
        assert.equal(checked.ok,false,JSON.stringify(format));assert.match(checked.errors.join(' '),/формат описания/i);
    }
});

test('standard DEVOPS template predicate matches selected scope and unchanged default template text',()=>{
    const p=loadUnit('profiles'),settings=p.createDefaults();settings.activeProfileId='devops';
    for(const kind of ['task','bug','deployment']) {
        const draft={projectKey:'DEVOPS',templateId:kind};
        assert.equal(p.isStandardDevopsTemplate(settings,draft,kind),true);
        settings.profiles[1].templates.find(t=>t.id===kind).issueTypeId='10001';
        assert.equal(p.isStandardDevopsTemplate(settings,draft,kind),true,'Jira mapping does not change template text');
        for(const key of ['name','instructions','whenToUse']) {
            const changed=JSON.parse(JSON.stringify(settings));changed.profiles[1].templates.find(t=>t.id===kind)[key]+=' custom';
            assert.equal(p.isStandardDevopsTemplate(changed,draft,kind),false,key);
        }
        assert.equal(p.isStandardDevopsTemplate(settings,{...draft,projectKey:'APP'},kind),false);
        assert.equal(p.isStandardDevopsTemplate(settings,draft,kind==='task'?'bug':'task'),false);
    }
    assert.equal(p.isStandardDevopsTemplate({...settings,activeProfileId:'universal'},{projectKey:'DEVOPS',templateId:'task'},'task'),false);
    for(const [s,d,k] of [[null,null,null],[settings,null,'task'],[settings,{projectKey:'DEVOPS',templateId:'custom'},'custom'],[{activeProfileId:'devops',profiles:[]},{projectKey:'DEVOPS',templateId:'task'},'task']]) {
        assert.equal(p.isStandardDevopsTemplate(s,d,k),false);
    }
});
