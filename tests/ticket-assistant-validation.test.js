const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit, metadataFixture } = require('./helpers/ticket-assistant-fixture');
const plain = value => JSON.parse(JSON.stringify(value));
function units() {
    const fields = loadUnit('fields');
    return { fields, validation: loadUnit('validation', { _ujgTA_fields: fields }) };
}
const policy = { allowAssignee: false, explicitUserFields: [] };

test('normalization preserves project scope, kinds, completeness and stable signatures', () => {
    const { fields } = units(), meta = metadataFixture();
    assert.equal(meta.projectId, 'DO-project');
    assert.deepEqual(plain(meta.issueTypes.map(t => t.name)), ['Task', 'Bug', 'Deployment']);
    assert.equal(fields.getField(meta, '10', 'customfield_5').kind, 'textarea');
    assert.equal(fields.getField(meta, '10', 'components').optionsComplete, true);
    assert.equal(fields.getField(meta, '20', 'summary'), null);
    assert.equal(meta.signature, metadataFixture().signature);
    assert.notEqual(meta.signature, metadataFixture('APP').signature);
    assert.throws(() => fields.normalizeMeta({ projects: [] }, 'DO', {}));
});

test('all supported codecs build an allowlisted payload with scoped IDs', () => {
    const { validation } = units(), meta = metadataFixture();
    const values = { summary: 'Fix', description: 'a\nb', duedate: '2028-02-29', components: [{ id: 'DO-9', name: 'discard' }], fixVersions: [{ id: 'DO-v1' }], labels: ['one', 'two'], customfield_1: 0, customfield_2: { id: 'DO-1' }, customfield_3: [{ id: 'DO-3' }], customfield_4: '2026-10-19T12:30:00+03:00', customfield_5: 'long\ntext' };
    assert.equal(validation.validateFields(meta, '10', values, policy).ok, true);
    assert.deepEqual(plain(validation.buildCreatePayload(meta, '10', values, policy)), { fields: { ...values, components: [{ id: 'DO-9' }], project: { id: 'DO-project' }, issuetype: { id: '10' } } });
});

test('foreign IDs, arbitrary keys, prototype keys and unsupported custom fields block payloads', () => {
    const { validation } = units(), meta = metadataFixture();
    for (const extra of [{ components: [{ id: 'APP-9' }] }, { customfield_999: 'guess' }, { transition: { id: '31' } }, { project: { id: 'APP-project' } }, { issuetype: { id: '20' } }, JSON.parse('{"__proto__":{}}'), { description: JSON.parse('{"constructor":{}}') }]) {
        const values = Object.assign(Object.create(null), { summary: 'Fix' }, extra);
        assert.equal(validation.validateFields(meta, '10', values, policy).ok, false);
        assert.throws(() => validation.buildCreatePayload(meta, '10', values, policy), e => e.kind === 'validation' && e.validation.ok === false);
    }
    assert.equal(validation.validateFields(meta, '20', { summary: 'Fix' }, policy).ok, false);
    meta.issueTypes[0].subtask = true;
    assert.equal(validation.validateFields(meta, '10', { summary: 'Fix' }, policy).ok, false);
});

test('option labels must be unique, exact known IDs remain usable in partial catalogs', () => {
    const { fields } = units(), meta = metadataFixture();
    const field = fields.getField(meta, '10', 'customfield_2');
    assert.equal(fields.resolveOption(field, 'TEST').ok, false);
    assert.deepEqual(plain(fields.resolveOption(field, { id: 'DO-2' }).value), { id: 'DO-2' });
    field.optionsComplete = false;
    assert.equal(fields.resolveOption(field, { id: 'missing' }).ok, false);
    field.allowedValues = [{ id: 'DO-1', label: 'TEST' }];
    assert.equal(fields.resolveOption(field, 'TEST').ok, false);
    assert.equal(fields.resolveOption(field, { id: 'DO-1' }).ok, true);
});

test('required/default/unsupported distinctions do not invent values', () => {
    const { validation, fields } = units(), meta = metadataFixture();
    assert.equal(validation.validateFields(meta, '10', {}, policy).ok, false);
    const component = fields.getField(meta, '10', 'components');
    component.required = true;
    assert.equal(validation.validateFields(meta, '10', { summary: 'Fix', components: [] }, policy).ok, false);
    component.required = false;
    meta.issueTypes[0].fields.push({ id: 'customfield_99', name: 'Plugin gate', kind: 'unknown', supported: false, writable: true, required: true, hasDefaultValue: true, defaultApplicable: false });
    let result = validation.validateFields(meta, '10', { summary: 'Fix' }, policy);
    assert.deepEqual(plain(result.unsupportedRequired), ['customfield_99']);
    assert.match(result.fieldErrors.customfield_99[0], /Plugin gate.*customfield_99/);
    meta.issueTypes[0].fields.at(-1).defaultApplicable = true;
    assert.equal(validation.validateFields(meta, '10', { summary: 'Fix' }, policy).ok, true);
    assert.equal('customfield_99' in validation.buildCreatePayload(meta, '10', { summary: 'Fix' }, policy).fields, false);
    assert.equal(validation.validateFields(meta, '10', { summary: 'Fix', customfield_99: 'guess' }, policy).ok, false);
});

test('inherited values cannot satisfy required fields or provide payload content', () => {
    const { validation } = units();
    assert.equal(validation.validateFields(metadataFixture(), '10', Object.create({ summary: 'Hidden' }), policy).ok, false);
});

test('dates, numbers, strings, array shapes and summary bounds are strictly validated', () => {
    const { validation, fields } = units(), meta = metadataFixture();
    for (const extra of [{ duedate: '2026-02-31' }, { duedate: '2026-02-29' }, { customfield_4: '2026-02-31T12:00:00Z' }, { customfield_4: '2026-10-19T12:00:00' }, { customfield_4: '2026-10-19T25:00:00Z' }, { customfield_1: Infinity }, { customfield_1: '0' }, { labels: ['ok', 1] }, { customfield_3: 'DO-3' }, { description: {} }, { summary: 'x'.repeat(256) }]) {
        assert.equal(validation.validateFields(meta, '10', { summary: 'Fix', ...extra }, policy).ok, false, JSON.stringify(extra));
    }
    fields.getField(meta, '10', 'summary').maxLength = 3;
    assert.equal(validation.validateFields(meta, '10', { summary: 'four' }, policy).ok, false);
    assert.equal(validation.validateFields(meta, '10', { summary: 'yes', description: null }, policy).ok, true);
});

test('user fields require explicit selection and assignee policy does not imply permission', () => {
    const { validation } = units(), meta = metadataFixture(), values = { summary: 'Fix', assignee: { name: 'alice', displayName: 'discard' } };
    for (const p of [policy, { allowAssignee: true, explicitUserFields: [] }, { allowAssignee: false, explicitUserFields: ['assignee'] }]) assert.equal(validation.validateFields(meta, '10', values, p).ok, false);
    assert.deepEqual(plain(validation.buildCreatePayload(meta, '10', values, { allowAssignee: true, explicitUserFields: ['assignee'] }).fields.assignee), { name: 'alice' });
});

test('clearing a user field still requires explicit selection and assignee policy', () => {
    const { validation } = units(), meta = metadataFixture();
    assert.equal(validation.validateFields(meta, '10', { summary: 'Fix', assignee: null }, policy).ok, false);
    assert.equal(validation.validateFields(meta, '10', { summary: 'Fix', assignee: null }, { allowAssignee: true, explicitUserFields: ['assignee'] }).ok, true);
});

test('schema decides plugin support, metadata defaults and set operations are explicit', () => {
    const { fields, validation } = units();
    const raw = { projects: [{ key: 'DO', id: '1', issuetypes: [{ id: '10', fields: {
        customfield_8: { name: 'summary', required: true, hasDefaultValue: true, schema: { type: 'string', custom: 'foreign:plugin' } },
        customfield_9: { name: 'Known', required: true, hasDefaultValue: true, defaultValue: { id: 'a' }, schema: { type: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select' }, allowedValues: [{ id: 'a', value: 'A' }], operations: ['add'] }
    } }] }] };
    let meta = fields.normalizeMeta(raw, 'DO', {});
    assert.equal(fields.getField(meta, '10', 'customfield_8').supported, false);
    assert.equal(fields.getField(meta, '10', 'customfield_8').defaultApplicable, false);
    assert.equal(fields.getField(meta, '10', 'customfield_9').writable, false);
    assert.equal(validation.validateFields(meta, '10', {}, policy).ok, false);
    raw.projects[0].issuetypes[0].fields.customfield_8.defaultValue = 'server';
    meta = fields.normalizeMeta(raw, 'DO', {});
    assert.equal(fields.getField(meta, '10', 'customfield_8').defaultApplicable, true);
    assert.equal(validation.validateFields(meta, '10', {}, policy).ok, true);
});

test('catalogs preserve field restrictions, project scope and per-type choices', () => {
    const { fields } = units();
    const raw = { projects: [{ key: 'DO', id: '1', issuetypes: ['10', '11'].map(id => ({ id, fields: {
        components: { schema: { type: 'array', items: 'component', system: 'components' }, allowedValues: [{ id: 'restricted', name: 'Allowed' }] },
        fixVersions: { schema: { type: 'array', items: 'version', system: 'fixVersions' } },
        customfield_2: { schema: { type: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select' } }
    } })) }] };
    const catalogs = {
        components: { projectKey: 'DO', values: [{ id: 'other', name: 'Other' }], complete: true },
        versions: { projectKey: 'APP', values: [{ id: 'APP-v1' }], complete: true },
        fields: { '10': { customfield_2: { values: [{ id: 'type-10', label: 'Choice' }], complete: true } } }
    };
    const meta = fields.normalizeMeta(raw, 'DO', catalogs);
    assert.equal(fields.resolveOption(fields.getField(meta, '10', 'components'), { id: 'other' }).ok, false);
    assert.equal(fields.resolveOption(fields.getField(meta, '10', 'components'), { id: 'restricted' }).ok, true);
    assert.equal(fields.getField(meta, '10', 'fixVersions').optionsComplete, false);
    assert.equal(fields.resolveOption(fields.getField(meta, '10', 'fixVersions'), { id: 'APP-v1' }).ok, false);
    assert.equal(fields.resolveOption(fields.getField(meta, '10', 'customfield_2'), { id: 'type-10' }).ok, true);
    assert.equal(fields.resolveOption(fields.getField(meta, '11', 'customfield_2'), { id: 'type-10' }).ok, false);
});

test('partial metadata, removed options, priority and explicit custom user are handled without guessing', () => {
    const { fields, validation } = units();
    const raw = { projects: [{ key: 'DO', id: '1', issuetypes: [{ id: '10', fields: {
        priority: { schema: { system: 'priority', type: 'priority' }, allowedValues: [{ id: 'p1', name: 'High' }] },
        customfield_7: { schema: { custom: 'com.atlassian.jira.plugin.system.customfieldtypes:userpicker', type: 'user' }, autoCompleteUrl: 'https://evil.example/users' },
        customfield_8: { schema: { custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select', type: 'option' }, allowedValues: [{ id: 'o1', value: 'One' }], autoCompleteUrl: 'https://evil.example/options' }
    } }] }] };
    const meta = fields.normalizeMeta(raw, 'DO', {});
    assert.equal(fields.getField(meta, '10', 'customfield_8').optionsComplete, false);
    const values = { priority: { id: 'p1' }, customfield_7: { name: 'alice' }, customfield_8: { id: 'o1' } };
    assert.equal(validation.validateFields(meta, '10', values, policy).ok, false);
    assert.equal(validation.validateFields(meta, '10', values, { explicitUserFields: ['customfield_7'] }).ok, true);
    const changed = JSON.parse(JSON.stringify(raw));
    changed.projects[0].issuetypes[0].fields.priority.allowedValues = [];
    const newer = fields.normalizeMeta(changed, 'DO', {});
    assert.notEqual(newer.signature, meta.signature);
    assert.equal(validation.validateFields(newer, '10', values, { explicitUserFields: ['customfield_7'] }).ok, false);
});
