const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit, memoryStorage, metadataFixture } = require('./helpers/ticket-assistant-fixture');

const plain = value => JSON.parse(JSON.stringify(value));
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function rawMeta(key) {
    const meta = metadataFixture(key);
    const schemas = {
        string: { type: 'string', system: 'summary' },
        textarea: { type: 'string', system: 'description' },
        components: { type: 'array', items: 'component', system: 'components' },
        user: { type: 'user', system: 'assignee' },
        option: { type: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select' }
    };
    return { projects: [{ key, id: meta.projectId, issuetypes: meta.issueTypes.map(type => ({
        id: type.id, name: type.name, subtask: false,
        fields: Object.fromEntries(type.fields.filter(f => ['summary', 'description', 'components', 'assignee', 'customfield_2'].includes(f.id)).map(f => [f.id, {
            name: f.name, required: f.required, schema: schemas[f.kind],
            ...(f.kind === 'option' ? { allowedValues: f.allowedValues.map(v => ({ id: v.id, value: v.label })) } : {})
        }]))
    })) }] };
}
function harness(options = {}) {
    const drafts = loadUnit('draft'), profiles = loadUnit('profiles'), fields = loadUnit('fields');
    const validation = loadUnit('validation', { _ujgTA_fields: fields });
    const storage = loadUnit('storage', { _ujgTA_profiles: profiles, _ujgTA_draft: drafts });
    const localStorage = options.storage || memoryStorage();
    const calls = [], changes = [], identities = [], stores = [];
    let user = { key: 'alice', name: 'alice', token: 'SECRET' };
    const api = {
        async getCurrentUser() { return user; },
        async getProjects() { return { values: [{ key: 'DO', id: 'DO-project', name: 'Devops', token: 'SECRET' }, { key: 'APP', id: 'APP-project', name: 'App' }], complete: true }; },
        async getCreateMeta(key, type, request) { calls.push(['metadata', key, type, request]); return rawMeta(key); },
        async getComponents(key) { return { projectKey: key, values: [{ id: key + '-9', name: 'Backend' }], complete: true }; },
        async getVersions(key) { return { projectKey: key, values: [], complete: true }; },
        ...options.api
    };
    const ai = {
        async route(input, request) { calls.push(['route', input, request]); return { issueTypeId: input.issueTypeId || (input.meta.projectKey === 'APP' ? '20' : '10'), templateId: input.templateId || 'task', candidates: [], questions: [] }; },
        async prepare(input, request) { calls.push(['prepare', input, request]); return { fields: { summary: 'Generated' }, questions: [], warnings: [], evidence: [] }; },
        async check(input, request) { calls.push(['check', input, request]); return { questions: [], warnings: ['Optional warning'], evidence: [] }; },
        ...options.ai
    };
    const creator = loadUnit('creator', {_ujgTA_draft:drafts,_ujgTA_fields:fields,_ujgTA_validation:validation});
    const controller = loadUnit('controller', { _ujgTA_draft: drafts, _ujgTA_profiles: profiles, _ujgTA_fields: fields, _ujgTA_validation: validation, _ujgTA_creator:creator }, { AbortController });
    const c = controller.create({ api, ai, now: () => 1234, onChange: s => changes.push(s), createStore(key) {
        identities.push(key);
        const store = storage.createStore({ userKey: key, origin: 'https://jira.test', storage: localStorage });
        stores.push(store);
        return store;
    } });
    async function ready(manual = true) {
        await c.init(); await c.selectProject('DO');
        if (manual) { await c.selectIssueType('10'); await c.selectTemplate('task'); }
        await c.updateSource('Implement this work'); calls.length = 0;
    }
    return { c, api, ai, calls, changes, identities, stores, localStorage, ready, setUser(value) { user = value; } };
}

test('budget edits cancel in-flight checks and retain budget when revisiting cached projects', async()=>{
    const pending=deferred();let captured,signal;
    const h=harness();await h.ready();await h.c.updateField('summary','Manual');await h.c.check();
    assert.ok(h.c.getState().draft.checked);
    const settings=h.c.getState().settings;settings.tokenBudget={context:65536,reserve:8192};
    await h.c.applySettings(settings);assert.equal(h.c.getState().draft.checked,null);
    h.ai.check=async(i,o)=>{captured=i;signal=o.signal;return pending.promise;};
    const checking=h.c.check();await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(plain(captured.tokenBudget),{context:65536,reserve:8192});
    settings.tokenBudget.reserve=4096;await h.c.applySettings(settings);assert.equal(signal.aborted,true);
    pending.resolve({questions:[],warnings:[],evidence:[]});await checking;assert.equal(h.c.getState().draft.checked,null);
    await h.c.selectProject('APP');await h.c.selectProject('DO');
    assert.equal(h.c.getState().settings.tokenBudget.reserve,4096);assert.equal(h.c.getState().draft.checked,null);
    assert.equal(h.c.getState().draft.fields.summary,'Manual');
});

test('budget configuration invalidates inactive checked projects without changing their rules or text',async()=>{
    for(const mode of ['apply','load']) {
    const h=harness();await h.ready();await h.c.updateField('summary','DO manual');await h.c.check();
    assert.ok(h.c.getState().draft.checked);
    await h.c.selectProject('APP');const settings=h.c.getState().settings;
    settings.tokenBudget={context:65536,reserve:8192};
    if(mode==='apply')await h.c.applySettings(settings);
    else {const saved=h.stores[0].load('APP');settings.revision++;saved.settings=settings;h.stores[0].save('APP',saved,saved.revision);await h.c.loadSavedSettings();}
    await h.c.selectProject('DO');assert.equal(h.c.getState().draft.checked,null);
    assert.equal(h.c.getState().draft.fields.summary,'DO manual');assert.equal(h.c.getState().settings.tokenBudget.context,32768);
    }
});

test('preflight cache avoids repeated catalogs on unchanged status reads and resets provider usage on identity init',async()=>{
    let estimates=0;const h=harness({ai:{preflight(){estimates++;return {input:100};},async check(){return {questions:[],warnings:[],evidence:[],usage:{inputTokens:123,outputTokens:4,totalTokens:127,source:'provider'}};}}});
    await h.ready();const initial=estimates;
    for(let n=0;n<5;n++)h.c.getState();assert.equal(estimates,initial);
    await h.c.updateSource('Changed');assert.ok(estimates>initial);
    await h.c.updateField('summary','Manual');await h.c.check();assert.equal(h.c.getState().providerUsage.inputTokens,123);
    await h.c.init();assert.equal(h.c.getState().providerUsage,null);
});

test('obsolete field exclusion preserves manual text and removes only the explicit blocker', async () => {
    const h=harness({api:{getCreateMeta:async key=>{const raw=rawMeta(key);raw.projects[0].issuetypes[0].fields.customfield_10={name:'Task recovery notes',schema:{type:'string',custom:'com.atlassian.jira.plugin.system.customfieldtypes:textarea'}};return raw;}}});
    await h.ready();await h.c.updateField('summary','Manual title');await h.c.updateField('customfield_10','Keep this\nmanual note');
    await h.c.selectIssueType('11');await h.c.check();assert.ok(h.c.getState().validation.fieldErrors.customfield_10);
    await h.c.discardField('customfield_10');const d=h.c.getState().draft;
    assert.equal(Object.hasOwn(d.fields,'customfield_10'),false);
    assert.match(d.source,/Task recovery notes[\s\S]*Keep this\nmanual note/);
    assert.equal(d.fields.summary,'Manual title');await h.c.check();assert.equal(h.c.getState().validation.ok,true);
    await h.c.init();await h.c.selectProject('DO');assert.match(h.c.getState().draft.source,/Keep this\nmanual note/);
});

test('optional unavailable catalog exclusion keeps its saved value in visible source', async () => {
    const h=harness({api:{getCreateMeta:async key=>{const raw=rawMeta(key);const f=raw.projects[0].issuetypes[0].fields.customfield_2;f.allowedValues=[];f.autoCompleteUrl='https://never-follow.invalid/lookup';return raw;}}});
    await h.ready();await h.c.updateField('customfield_2',{id:'former-known'});await h.c.discardField('customfield_2');
    assert.equal(Object.hasOwn(h.c.getState().draft.fields,'customfield_2'),false);assert.match(h.c.getState().draft.source,/former-known/);
});

test('confirmed draft discard clears saved content and files while retaining personal settings', async () => {
    for(const status of ['idle','rejected']) {
        const h=harness();await h.ready();await h.c.updateField('summary','Delete me');await h.c.selectFiles([new File(['PRIVATE'],'private.txt')]);
        const saved=h.stores[0].load('DO');saved.draft.creation.status=status;h.stores[0].save('DO',saved,saved.revision);
        await h.c.init();await h.c.selectProject('DO');const before=h.c.getState();
        await h.c.discardDraft(false);assert.equal(h.c.getState().draft.source,before.draft.source);
        await h.c.discardDraft(true);const after=h.c.getState();
        assert.notEqual(after.draft.id,before.draft.id);assert.equal(after.draft.source,'');assert.deepEqual(plain(after.draft.fields),{});assert.deepEqual(plain(after.draft.attachments),[]);
        const persisted=h.stores.at(-1).load('DO');assert.equal(persisted.draft,null);assert.deepEqual(plain(persisted.settings),plain(before.settings));
        await h.c.init();await h.c.selectProject('DO');assert.equal(h.c.getState().draft.source,'');
    }
});

test('draft discard refuses preflight unknown submitting and another tab durable guard', async () => {
    for(const status of ['preflight','submitting','unknown']) {
        const h=harness();await h.ready();const store=h.stores[0],saved=store.load('DO');saved.draft.creation={status,attemptId:'guarded',issueKey:null,error:null};
        store.save('DO',saved,saved.revision);await h.c.init();await h.c.selectProject('DO');const before=h.c.getState().draft;
        await h.c.discardDraft(true);assert.equal(h.c.getState().draft.id,before.id);assert.equal(h.c.getState().draft.source,before.source);
    }
    const h=harness();await h.ready();const saved=h.stores[0].load('DO');saved.draft.creation={status:'submitting',attemptId:'other-tab',issueKey:null,error:null};
    h.stores[0].save('DO',saved,saved.revision);await h.c.discardDraft(true);
    assert.equal(h.c.getState().error.code,'conflict');assert.equal(h.stores[0].load('DO').draft.creation.attemptId,'other-tab');
});

test('routes then refreshes raw metadata and prepares; manual selections skip routing and typing does no AI work', async () => {
    const h = harness(); await h.ready(false);
    const settings = h.c.getState().settings;
    settings.profiles[0].templates[0].issueTypeId = '10'; await h.c.applySettings(settings);
    assert.equal(h.calls.length, 0);
    await h.c.prepare();
    assert.deepEqual(h.calls.map(c => c[0]), ['route', 'metadata', 'prepare']);
    const input = h.calls.at(-1)[1];
    assert.equal(input.meta.projectId, 'DO-project');
    assert.equal(input.meta.issueTypes[0].fields.find(f => f.id === 'components').allowedValues[0].id, 'DO-9');
    assert.equal(input.allowFieldIds.includes('assignee'), false);
    assert.equal(h.c.getState().draft.fields.summary, 'Generated');
    assert.equal(h.c.getState().draft.checked, null);
    assert.equal(h.c.getState().stage, 'idle');
    h.calls.length = 0; await h.c.prepare();
    assert.deepEqual(h.calls.map(c => c[0]), ['metadata', 'prepare']);
    assert.ok(h.changes.some(s => s.stage === 'preparing' && s.startedAt === 1234));
});

test('a single unbound model proposal requires visible explicit choice; manual type permits unbound template', async () => {
    const h = harness(); await h.ready(false); await h.c.prepare();
    const state = h.c.getState();
    assert.equal(state.draft.issueTypeId, null);
    assert.equal(state.draft.templateId, null);
    assert.equal(state.routeCandidates.length, 1);
    assert.equal(state.routeCandidates[0].issueTypeId, '10');
    assert.equal(state.routeCandidates[0].templateId, 'task');
    assert.equal(state.draft.questions.some(q => q.required), true);
    assert.equal(h.calls.some(c => c[0] === 'prepare'), false);
    await h.c.selectIssueType('10'); await h.c.prepare();
    assert.equal(h.c.getState().draft.templateId, 'task');
    assert.equal(h.c.getState().draft.fields.summary, 'Generated');
});

test('template binding constrains route generation catalogs to compatible types', async () => {
    const h = harness(); await h.ready(false);
    h.api.getCreateMeta = async key => {
        const raw = rawMeta(key);
        raw.projects[0].issuetypes[1].fields.environment = { name: 'Bug environment', schema: { type: 'string', system: 'environment' } };
        return raw;
    };
    await h.c.selectProject('DO');
    const settings = h.c.getState().settings; settings.profiles[0].templates[0].issueTypeId = '10';
    await h.c.applySettings(settings); await h.c.selectTemplate('task'); await h.c.prepare();
    assert.equal(h.calls.find(c => c[0] === 'route')[1].allowFieldIds.includes('environment'), false);
});

test('metadata failure keeps input, error is safe and explicit prepare retries loading metadata', async () => {
    const h = harness(); await h.c.init();
    h.api.getCreateMeta = async () => { throw new Error('SECRET URL'); };
    await h.c.selectProject('DO');
    assert.equal(h.c.getState().error.code, 'metadata');
    assert.equal(JSON.stringify(h.c.getState()).includes('SECRET'), false);
    await h.c.updateSource('Keep source');
    h.api.getCreateMeta = async key => rawMeta(key);
    await h.c.prepare();
    assert.equal(h.c.getState().meta.projectKey, 'DO');
    assert.equal(h.c.getState().draft.source, 'Keep source');
    assert.equal(JSON.stringify(h.c.getState()).includes('SECRET'), false);
    assert.equal(h.c.getState().routeCandidates.length, 1);
});

test('ambiguous route presents candidates/questions and never prepares or overwrites a manual selection', async () => {
    const h = harness({ ai: { async route() { return { issueTypeId: null, templateId: null, candidates: [{ issueTypeId: '10', templateId: 'task', reason: 'A' }, { issueTypeId: '10', templateId: 'bug', reason: 'B' }], questions: [{ id: 'route', text: 'Which?', reason: '', required: true }] }; } } });
    await h.ready(false); await h.c.selectIssueType('10'); await h.c.prepare();
    assert.equal(h.c.getState().draft.issueTypeId, '10');
    assert.equal(h.c.getState().draft.templateId, null);
    assert.equal(h.c.getState().routeCandidates.length, 2);
    assert.equal(h.calls.some(c => c[0] === 'prepare'), false);
});

test('check retains manual fields, required questions block, answers stay visible, optional warnings do not block', async () => {
    const h = harness(); await h.ready(); await h.c.prepare();
    await h.c.updateField('summary', 'Manual'); await h.c.setGenerationFields(['description']);
    let question = true;
    h.ai.check = async input => {
        h.calls.push(['check', input]);
        return { questions: question ? [{ id: 'q', text: 'Where?', reason: '', required: true }] : [], warnings: ['Optional'], evidence: [] };
    };
    await h.c.check(); assert.equal(h.c.getState().draft.checked, null);
    await h.c.answer({ q: 'Here' }); assert.match(h.c.getState().draft.source, /Ответ: Here/);
    question = false; await h.c.check();
    assert.equal(h.c.getState().draft.fields.summary, 'Manual');
    assert.ok(h.c.getState().draft.checked);
    assert.equal(h.calls.at(-1)[1].draft.fields.summary, 'Manual');
    assert.deepEqual(plain(h.calls.at(-1)[1].allowFieldIds), ['description']);
    assert.deepEqual(plain(h.c.getState().draft.warnings), ['Optional']);
});

test('protected proposal replacements stay pending; checking validates actual fields and accepting is explicit', async () => {
    const h = harness(); await h.ready(); await h.c.updateField('summary', ''); await h.c.prepare();
    assert.equal(h.c.getState().draft.fields.summary, '');
    assert.equal(h.c.getState().draft.pendingFields.summary, 'Generated');
    await h.c.check(); assert.equal(h.c.getState().validation.ok, false); assert.equal(h.c.getState().draft.checked, null);
    await h.c.acceptField('summary'); await h.c.check(); assert.ok(h.c.getState().draft.checked);
});

test('project change makes late AI response inert and restores independent project edits', async () => {
    const wait = deferred(); let started = false, signal;
    const h = harness({ ai: { prepare(input, request) { started = true; signal = request.signal; return wait.promise; } } }); await h.ready();
    await h.c.updateField('summary', 'DO edit');
    const run = h.c.prepare(); for (let n = 0; n < 12 && !started; n++) await Promise.resolve(); assert.ok(started);
    await h.c.selectProject('APP'); await h.c.updateSource('APP input');
    assert.equal(signal.aborted, true);
    wait.resolve({ fields: { summary: 'Late' } }); await run;
    assert.equal(h.c.getState().draft.projectKey, 'APP'); assert.equal(h.c.getState().draft.fields.summary, undefined);
    await h.c.selectProject('DO'); assert.equal(h.c.getState().draft.fields.summary, 'DO edit');
    assert.equal(h.c.getState().draft.source, 'Implement this work');
});

test('double prepare shares one pipeline; cancel aborts and late transport is inert; explicit retry works', async () => {
    const wait = deferred(); let count = 0, signal;
    const h = harness({ ai: { prepare(input, request) { count++; signal = request.signal; return wait.promise; } } }); await h.ready();
    const a = h.c.prepare(), b = h.c.prepare();
    for (let n = 0; n < 12 && !signal; n++) await Promise.resolve();
    assert.equal(count, 1); await h.c.cancel(); assert.equal(signal.aborted, true);
    wait.resolve({ fields: { summary: 'Late' } }); await a; await b;
    assert.equal(h.c.getState().draft.fields.summary, undefined); assert.equal(h.c.getState().stage, 'stopped');
    h.ai.prepare = async () => ({ fields: { summary: 'Retry' } }); await h.c.prepare();
    assert.equal(h.c.getState().draft.fields.summary, 'Retry');
});

test('source, selection, settings, field scope and destroy invalidate in-flight work', async () => {
    for (const change of [c => c.updateSource('New'), c => c.selectTemplate('bug'), c => c.selectIssueType('11'), c => c.applySettings(c.getState().settings), c => c.setGenerationFields(['summary']), c => c.updateField('summary', 'Human'), c => c.destroy()]) {
        const wait = deferred(); let started = false;
        const h = harness({ ai: { prepare() { started = true; return wait.promise; } } }); await h.ready();
        const run = h.c.prepare(); for (let n = 0; n < 12 && !started; n++) await Promise.resolve(); assert.ok(started);
        await change(h.c); wait.resolve({ fields: { summary: 'Late' } }); await run;
        assert.notEqual(h.c.getState().draft.fields.summary, 'Late');
    }
});

test('late metadata and overlapping init identities cannot cross scopes', async () => {
    const h = harness(); await h.ready();
    const old = deferred(); h.api.getCreateMeta = key => key === 'APP' ? old.promise : Promise.resolve(rawMeta(key));
    const switching = h.c.selectProject('APP'); await h.c.selectProject('DO'); old.resolve(rawMeta('APP')); await switching;
    assert.equal(h.c.getState().meta.projectKey, 'DO');
    const identity = deferred(); h.api.getCurrentUser = () => identity.promise;
    const first = h.c.init(); h.api.getCurrentUser = async () => ({ key: 'bob' }); await h.c.init();
    identity.resolve({ key: 'alice' }); await first; await h.c.selectProject('DO');
    assert.deepEqual(h.identities, ['alice', 'bob']); assert.equal(h.c.getState().draft.source, '');
});

test('identity is resolved before store access; no identity uses null memory scope with warning and fresh reload clears checked', async () => {
    const h = harness(); await h.ready(); await h.c.updateField('summary', 'Ready'); await h.c.check(); assert.ok(h.c.getState().draft.checked);
    const other = harness({ storage: h.localStorage }); await other.c.init(); await other.c.selectProject('DO');
    assert.equal(other.c.getState().draft.checked, null); assert.equal(other.c.getState().draft.fields.summary, 'Ready');
    h.setUser(null); await h.c.init(); assert.deepEqual(h.identities, ['alice', null]);
    assert.equal(h.c.getState().error.code, 'identity'); await h.c.selectProject('DO'); assert.equal(h.c.getState().draft.source, '');
});

test('CAS conflicts retain unsaved edits across project switches; semantic settings revision ignores envelope revision', async () => {
    const h = harness(); await h.ready();
    const before = h.c.getState().settings.revision;
    const external = h.stores[0].load('DO');
    assert.ok(external.revision > before);
    h.stores[0].save('DO', external, external.revision);
    await h.c.updateSource('Unsaved human input');
    assert.equal(h.c.getState().error.code, 'conflict'); assert.equal(h.c.getState().draft.source, 'Unsaved human input');
    await h.c.selectProject('APP'); await h.c.selectProject('DO');
    assert.equal(h.c.getState().draft.source, 'Unsaved human input'); assert.equal(h.c.getState().error.code, 'conflict');
    await h.c.applySettings(h.c.getState().settings);
    assert.equal(h.c.getState().settings.revision, before + 1);
    assert.equal(h.c.getState().draft.settingsRevision, before + 1);
    assert.equal(h.c.getState().error.code, 'conflict');
});

test('generation defaults include every supported writable non-user field; narrowing invalidates checked without dropping values', async () => {
    const h = harness(); await h.ready();
    assert.deepEqual(plain(h.c.getState().generationFieldIds).sort(), ['components', 'customfield_2', 'description', 'summary']);
    await h.c.updateField('summary', 'Keep'); await h.c.check(); assert.ok(h.c.getState().draft.checked);
    await h.c.setGenerationFields([]); assert.equal(h.c.getState().draft.checked, null);
    assert.equal(h.c.getState().contextScope.explicit, true); assert.equal(h.c.getState().draft.fields.summary, 'Keep');
    await h.c.prepare(); assert.deepEqual(plain(h.calls.at(-1)[1].allowFieldIds), []);
    await h.c.setGenerationFields(['assignee']); assert.equal(h.c.getState().error.code, 'input');
    assert.deepEqual(plain(h.c.getState().generationFieldIds), []);
});

test('manual user policy survives reload and cannot derive from an AI response', async () => {
    const h = harness(); await h.ready(); const settings = h.c.getState().settings;
    settings.profiles[0].allowAssignee = true; await h.c.applySettings(settings);
    await h.c.updateField('summary', 'Ready'); await h.c.updateField('assignee', { name: 'engineer' }); await h.c.check();
    assert.deepEqual(plain(h.calls.at(-1)[1].explicitUserFields), ['assignee']); assert.ok(h.c.getState().draft.checked);
    const reload = harness({ storage: h.localStorage }); await reload.c.init(); await reload.c.selectProject('DO'); await reload.c.check();
    assert.deepEqual(plain(reload.calls.at(-1)[1].explicitUserFields), ['assignee']);
    const forged = harness({ ai: { async prepare() { return { fields: { summary: 'Ready', assignee: { name: 'AI' } }, explicitUserFields: ['assignee'] }; } } });
    await forged.ready(); await forged.c.prepare(); await forged.c.check();
    assert.deepEqual(plain(forged.calls.at(-1)[1].explicitUserFields), []);
    assert.equal(forged.c.getState().draft.fields.assignee, undefined);
});

test('safe errors preserve only numeric prompt details and edits; returned and notified state is detached', async () => {
    const details = { instructions:2000,source:30000,metadata:1000,input:33000,context:32768,reserve:4096,available:28672 };
    const h = harness({ ai: { async prepare() { throw Object.assign(new Error('SECRET raw body'), { code: 'limit', details: { ...details, body: 'SECRET' }, token: 'SECRET' }); } } });
    await h.ready(); await h.c.updateField('summary', 'Keep'); await h.c.prepare();
    assert.equal(h.c.getState().error.code, 'limit'); assert.deepEqual(plain(h.c.getState().error.details), details);
    assert.equal(h.c.getState().draft.fields.summary, 'Keep'); assert.equal(JSON.stringify(h.c.getState()).includes('SECRET'), false);
    const s = h.c.getState(); s.draft.fields.summary = 'Mutation'; s.settings.profiles[0].instructions = 'Mutation'; s.meta.issueTypes.length = 0;
    h.changes.at(-1).draft.source = 'Mutation'; assert.equal(h.c.getState().draft.fields.summary, 'Keep');
    assert.equal(h.c.getState().meta.issueTypes.length, 3); assert.equal(h.c.getState().draft.source, 'Implement this work');
});

test('fresh check metadata invalidates checked and removed options remain blocking', async () => {
    const h = harness(); await h.ready(); await h.c.updateField('summary', 'Ready'); await h.c.updateField('customfield_2', { id: 'DO-1' }); await h.c.check();
    assert.ok(h.c.getState().draft.checked);
    h.api.getCreateMeta = async key => { const raw = rawMeta(key); raw.projects[0].issuetypes[0].fields.customfield_2.allowedValues = []; return raw; };
    await h.c.check(); assert.equal(h.c.getState().draft.checked, null); assert.equal(h.c.getState().validation.ok, false);
    assert.deepEqual(plain(h.c.getState().draft.fields.customfield_2), { id: 'DO-1' });
});

test('selected-type metadata refresh does not remove the ability to choose another type', async () => {
    const h = harness({ api: { async getCreateMeta(key, typeId) {
        const raw = rawMeta(key);
        if (typeId) raw.projects[0].issuetypes = raw.projects[0].issuetypes.filter(t => t.id === typeId);
        return raw;
    } } });
    await h.ready(); await h.c.prepare(); await h.c.selectIssueType('11');
    assert.equal(h.c.getState().draft.issueTypeId, '11');
    await h.c.selectTemplate('bug'); await h.c.prepare();
    assert.equal(h.c.getState().draft.fields.summary, 'Generated');
});

test('route and metadata late failures are inert; all metadata reads receive the abort signal', async () => {
    const wait = deferred(); let signal;
    const h = harness({ ai: { route(input, request) { signal = request.signal; return wait.promise; } } }); await h.ready(false);
    const run = h.c.prepare(); assert.ok(signal);
    await h.c.selectProject('APP'); wait.reject(new Error('SECRET late error')); await run;
    assert.equal(signal.aborted, true); assert.equal(h.c.getState().draft.projectKey, 'APP'); assert.equal(h.c.getState().stage, 'idle');
    for (const method of ['getCreateMeta', 'getComponents', 'getVersions']) {
        const late = deferred(); let requestSignal;
        h.api[method] = (...args) => { requestSignal = args.at(-1).signal; return late.promise; };
        const loading = h.c.selectProject('DO');
        for (let n = 0; n < 12 && !requestSignal; n++) await Promise.resolve();
        assert.ok(requestSignal); await h.c.cancel(); assert.equal(requestSignal.aborted, true);
        late.reject(new Error('SECRET metadata error')); await loading;
        assert.equal(h.c.getState().stage, 'stopped');
        h.api[method] = method === 'getCreateMeta' ? async key => rawMeta(key) : async key => ({ projectKey: key, values: [], complete: true });
    }
});

test('AI inputs are detached snapshots, user flags ignore AI extras, and File values never enter state', async () => {
    const wait = deferred(); let captured;
    const h = harness({ ai: { prepare(input) { captured = input; input.profile.instructions = 'Changed by adapter'; return wait.promise; } } });
    await h.ready(); const before = h.c.getState().settings.profiles[0].instructions;
    const run = h.c.prepare(); for (let n = 0; n < 12 && !captured; n++) await Promise.resolve(); assert.ok(captured);
    await h.c.updateSource('New source');
    assert.equal(captured.source, 'Implement this work'); assert.equal(h.c.getState().settings.profiles[0].instructions, before);
    wait.resolve({ fields: { summary: 'Late' } }); await run;
    await h.c.updateField('description', new File(['SECRET file content'], 'SECRET file name'));
    assert.equal(h.c.getState().draft.fields.description, undefined);
    assert.equal(JSON.stringify(h.c.getState()).includes('SECRET'), false);
    const emitted = h.changes.length; await h.c.destroy(); await h.c.updateSource('Ignored');
    assert.equal(h.changes.length, emitted); assert.equal(h.c.getState().draft.source, 'New source');
});

test('controller inputs satisfy real AI route/prepare/check contracts and review keeps excluded manual values', async () => {
    const path = require('node:path');
    const load = require('./helpers/load-amd-module');
    const shared = load(path.resolve(__dirname, '../ujg-shared-modules/llm-client.js'), {});
    const validation = loadUnit('validation', { _ujgTA_fields: loadUnit('fields') });
    const adapter = loadUnit('ai', { _ujgShared_llmClient: shared, _ujgTA_validation: validation });
    const prompts = [];
    const h = harness({ ai: Object.fromEntries(['route', 'prepare', 'check'].map(kind => [kind, async input => {
        prompts.push(JSON.parse(adapter.buildRequest(kind, input).userPrompt));
        const body = kind === 'route' ? { schemaVersion: 1, kind, issueTypeId: '10', templateId: 'task', candidates: [], questions: [] } :
            { schemaVersion: 1, kind: kind === 'prepare' ? 'draft' : 'check', questions: [], warnings: [], evidence: [],
                ...(kind === 'prepare' ? { issueTypeId: '10', templateId: 'task', fields: { summary: 'Generated' } } : {}) };
        return adapter.parseResponse(kind, JSON.stringify(body), input);
    }])) });
    await h.ready(false); const settings = h.c.getState().settings;
    settings.profiles[0].templates[0].issueTypeId = '10'; settings.profiles[0].allowAssignee = true;
    await h.c.applySettings(settings); await h.c.prepare();
    assert.equal(h.c.getState().draft.fields.summary, 'Generated');
    await h.c.updateField('description', 'Human description'); await h.c.updateField('customfield_2', { id: 'DO-1' });
    await h.c.updateField('assignee', { name: 'human-only' }); await h.c.setGenerationFields(['summary']);
    await h.c.check();
    const prompt = prompts.at(-1);
    assert.equal(h.c.getState().error, null); assert.ok(h.c.getState().draft.checked);
    assert.equal(prompt.fields.description, 'Human description'); assert.deepEqual(prompt.fields.customfield_2, { id: 'DO-1' });
    assert.equal(prompt.fields.assignee, undefined);
    assert.deepEqual(prompt.currentFieldContext.map(f => f.id), ['customfield_2', 'description']);
    assert.deepEqual(prompt.issueTypes[0].fieldSchema.map(f => f.id), ['summary']);
    assert.deepEqual(prompts.map(p => p.action), ['route', 'prepare', 'check']);
});
