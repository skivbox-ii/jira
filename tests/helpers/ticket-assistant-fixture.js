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

function metadataFixture(projectKey = 'DO') {
    const fields = loadUnit('fields');
    const prefix = projectKey === 'APP' ? 'APP' : 'DO';
    const rawFields = {
        summary: { name: 'Summary', required: true, schema: { type: 'string', system: 'summary' } },
        description: { name: 'Description', schema: { type: 'string', system: 'description' } },
        duedate: { name: 'Due date', schema: { type: 'date', system: 'duedate' } },
        components: { name: 'Components', schema: { type: 'array', items: 'component', system: 'components' } },
        fixVersions: { name: 'Fix versions', schema: { type: 'array', items: 'version', system: 'fixVersions' } },
        labels: { name: 'Labels', schema: { type: 'array', items: 'string', system: 'labels' } },
        assignee: { name: 'Assignee', schema: { type: 'user', system: 'assignee' } },
        customfield_1: { name: 'Effort', schema: { type: 'number', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:float' } },
        customfield_2: { name: 'Environment', schema: { type: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select' }, allowedValues: [{ id: prefix + '-1', value: 'TEST' }, { id: prefix + '-2', value: 'TEST' }] },
        customfield_3: { name: 'Targets', schema: { type: 'array', items: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:multiselect' }, allowedValues: [{ id: prefix + '-3', value: 'Web' }] },
        customfield_4: { name: 'Window', schema: { type: 'datetime', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:datetime' } },
        customfield_5: { name: 'Notes', schema: { type: 'string', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textarea' } }
    };
    return fields.normalizeMeta({ projects: [{ key: projectKey, id: prefix + '-project', issuetypes: [
        { id: prefix === 'DO' ? '10' : '20', name: 'Task', subtask: false, fields: rawFields },
        { id: prefix === 'DO' ? '11' : '21', name: 'Bug', subtask: false, fields: rawFields },
        { id: prefix === 'DO' ? '12' : '22', name: 'Deployment', subtask: false, fields: rawFields }
    ] }] }, projectKey, {
        components: { projectKey, values: [{ id: prefix + '-9', name: 'Backend' }], complete: true },
        versions: { projectKey, values: [{ id: prefix + '-v1', name: '1.0' }], complete: true }
    });
}

module.exports.metadataFixture = metadataFixture;
