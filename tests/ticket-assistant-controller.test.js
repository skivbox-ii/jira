const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit, memoryStorage, metadataFixture } = require('./helpers/ticket-assistant-fixture');

const plain = value => JSON.parse(JSON.stringify(value));

test('oversized response diagnostics retain only trusted metadata limits and numeric lengths',async()=>{
    const h=harness();await h.ready();
    for(const details of [
        {reason:'maxLength',fieldId:'summary',maxLength:255,length:510,raw:'PRIVATE'},
        {reason:'maxLength',fieldId:'summary',maxLength:255,length:'PRIVATE'},
        {reason:'maxLength',fieldId:'summary',maxLength:999,length:1000},
        {reason:'maxLength',fieldId:'foreign',maxLength:255,length:510}
    ]) {
        h.ai.prepare=async()=>{throw {code:'response',details};};await h.c.prepare();
        const error=h.c.getState().error;
        assert.equal(error.details.reason,'maxLength');assert.ok(!JSON.stringify(error).includes('PRIVATE'));
        assert.doesNotMatch(error.message,/каталог|Обновите данные Jira/);
        if(details.fieldId==='summary' && details.length===510) {
            assert.deepEqual(error.details,{reason:'maxLength',fieldId:'summary',maxLength:255,length:510});
            assert.match(error.message,/510.*255/);
        } else {assert.equal(error.details.length,undefined);assert.equal(error.details.maxLength,undefined);}
    }
});
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

function relationHarness(extra={}) {
    return harness({api:{async getCreateMeta(key) {const raw=rawMeta(key);for(const t of raw.projects[0].issuetypes) {
        t.fields.customfield_923={schema:{type:'any',custom:'com.pyxis.greenhopper.jira:gh-epic-link'}};
        t.fields.customfield_847={schema:{type:'array',items:'string',custom:'com.pyxis.greenhopper.jira:gh-sprint'}};
        t.fields.customfield_123={schema:{type:'number',custom:'com.atlassian.jira.plugin.system.customfieldtypes:float'}};
    }return raw;},getBoards:async()=>({values:[{id:'12',label:'A'},{id:'13',label:'B'}],complete:true}),
    getSprints:async(project,board)=>({values:[{id:'73',label:'Sprint',boardId:board}],complete:true}),
    getSprint:async(project,id)=>({id:String(id),label:'Sprint'}),getEpic:async(project,key)=>({id:key,label:'Epic'}),
    searchEpics:async()=>({values:[{id:'DO-42',label:'Epic'}],complete:false}),...extra}});
}
test('relations are searched in selected scope and require an explicit known board',async()=>{
    const h=relationHarness();await h.ready();
    assert.ok(!h.c.getState().generationFieldIds.includes('customfield_123'));
    assert.ok(!h.c.getState().generationFieldIds.includes('customfield_847'));
    let result=await h.c.searchRelation('',{id:'customfield_847'},{});
    assert.equal(result.needsBoard,true);assert.equal(result.boards.length,2);assert.deepEqual(result.values,[]);
    result=await h.c.searchRelation('',{id:'customfield_847'},{boardId:'12'});assert.equal(result.values[0].id,'73');
    await assert.rejects(h.c.searchRelation('',{id:'customfield_847'},{boardId:'99'}));
    await h.c.updateField('customfield_923','DO-42');await h.c.updateField('customfield_847',73);await h.c.updateField('customfield_123',0.5);
    await h.c.updateField('summary','Manual');await h.c.check();assert.ok(h.c.getState().draft.checked);
    assert.equal(h.calls.at(-1)[1].draft.fields.customfield_123,0.5);
    h.api.getSprint=async()=>{throw {kind:'forbidden'};};await h.c.check();assert.equal(h.c.getState().draft.checked,null);
    assert.equal(h.c.getState().draft.fields.customfield_847,73);
});
test('project switch and cancel abort relation lookup and reject its stale result',async()=>{
    for(const change of [c=>c.selectProject('APP'),c=>c.cancel(),c=>c.selectIssueType('11'),c=>c.destroy()]) {
        const wait=deferred();let signal;
        const h=relationHarness({searchEpics:(p,q,o)=>{signal=o.signal;return wait.promise;}});await h.ready();
        const pending=h.c.searchRelation('',{id:'customfield_923'},{});
        await new Promise(r=>setImmediate(r));await change(h.c);assert.equal(signal.aborted,true);
        wait.resolve({values:[{id:'DO-42',label:'Late'}],complete:false});await assert.rejects(pending,e=>e.kind==='abort');
    }
});

test('individual helpers stage only the target and require explicit Apply or Reject', async () => {
    const h = harness({ai: {async assist(i) {return {fields: {[i.targetFieldId]: 'Suggested'}, questions: [], warnings: [], evidence: []};}}});
    await h.ready(); await h.c.updateField('summary', 'Manual');
    let s = await h.c.assistField('description', 'generate');
    assert.deepEqual(s.draft.fields, {summary: 'Manual'});
    assert.deepEqual(s.draft.pendingFields, {description: 'Suggested'});
    assert.equal(s.assistance.status, 'ready'); assert.equal(s.assistance.fieldId, 'description');
    s = await h.c.rejectField('description'); assert.deepEqual(s.draft.pendingFields, {});
    await h.c.assistField('description', 'improve'); s = await h.c.acceptField('description');
    assert.equal(s.draft.fields.description, 'Suggested'); assert.equal(s.draft.fields.summary, 'Manual');
    await h.c.setGenerationFields(['summary']); s = await h.c.assistField('description', 'generate');
    assert.equal(s.error.code, 'input'); assert.deepEqual(s.draft.pendingFields, {});
});
test('individual helper stop, edit, settings and connection changes discard late responses', async () => {
    for (const change of [c => c.cancel(), c => c.updateSource('Changed'), c => c.updateField('summary', 'Manual'),
        c => c.selectIssueType('11'), c => c.selectProject('APP'), c => c.setGenerationFields(['summary']),
        c => c.applySettings(c.getState().settings), c => c.connectionChanged(), c => c.destroy()]) {
        const pending = deferred(); let signal;
        const h = harness({ai: {async assist(i, o) {signal = o.signal; return pending.promise;}}});
        await h.ready(); const running = h.c.assistField('description', 'generate');
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(h.c.getState().assistance.status, 'running');
        await change(h.c); assert.equal(signal.aborted, true);
        pending.resolve({fields: {description: 'Late'}, questions: [], warnings: [], evidence: []}); await running;
        assert.deepEqual(h.c.getState().draft.pendingFields, {});
    }
});
test('ready individual proposals cannot be applied after edits, settings or scope changes', async () => {
    for (const change of [c => c.updateSource('Changed'), c => c.updateField('summary', 'Manual'),
        c => c.selectIssueType('11'), c => c.setGenerationFields(['summary']), c => c.applySettings(c.getState().settings), c => c.cancel()]) {
        const h = harness({ai: {async assist() {return {fields: {description: 'Old'}, questions: [], warnings: [], evidence: []};}}});
        await h.ready(); await h.c.assistField('description', 'generate'); await change(h.c);
        const s = await h.c.acceptField('description');
        assert.equal(s.draft.fields.description, undefined); assert.deepEqual(s.draft.pendingFields, {});
        assert.equal(h.stores[0].load('DO').draft.pendingAssistance, null);
    }
});
test('a durable creation lock acquired during assistance prevents staging its response', async () => {
    const pending = deferred();
    const h = harness({ai: {async assist() {return pending.promise;}}}); await h.ready();
    const running = h.c.assistField('description', 'generate');
    await new Promise(resolve => setImmediate(resolve));
    const saved = h.stores[0].load('DO');
    saved.draft.creation = {status: 'unknown', issueKey: null, attemptId: 'other-tab', error: null};
    h.stores[0].save('DO', saved, saved.revision);
    pending.resolve({fields: {description: 'Late'}, questions: [], warnings: [], evidence: []});
    const s = await running;
    assert.deepEqual(s.draft.pendingFields, {}); assert.equal(s.error.code, 'conflict');
    assert.equal(s.assistance.status, 'error');
});
test('individual proposals survive scoped storage reload but expire when refreshed metadata changes', async () => {
    const h = harness({ai: {async assist() {return {fields: {description: 'Saved proposal'}, questions: [], warnings: [], evidence: []};}}});
    await h.ready(); await h.c.assistField('description', 'generate');
    assert.deepEqual(plain(h.stores[0].load('DO').draft.pendingFields), {description: 'Saved proposal'});
    const reloaded = harness({storage: h.localStorage});
    await reloaded.c.init(); let s = await reloaded.c.selectProject('DO');
    assert.equal(s.assistance.status, 'ready'); assert.equal(s.assistance.fieldId, 'description');
    assert.equal(s.draft.fields.description, undefined);
    const changed = harness({storage: h.localStorage, api: {async getCreateMeta(key) {
        const raw = rawMeta(key); raw.projects[0].issuetypes[0].fields.description.name = 'Updated description'; return raw;
    }}});
    await changed.c.init(); s = await changed.c.selectProject('DO');
    assert.deepEqual(s.draft.pendingFields, {}); assert.equal(s.assistance, null);
});
test('Apply during restored metadata refresh cannot write stale fields or abort the refresh', async () => {
    const h = harness({ai: {async assist() {return {fields: {description: 'OLD'}, questions: [], warnings: [], evidence: []};}}});
    await h.ready(); await h.c.assistField('description', 'generate');
    const pending = deferred(); let signal;
    const reloaded = harness({storage: h.localStorage, api: {async getCreateMeta(key, type, request) {
        signal = request.signal; return pending.promise;
    }}});
    await reloaded.c.init(); const selecting = reloaded.c.selectProject('DO');
    await new Promise(resolve => setImmediate(resolve));
    const before = reloaded.c.getState();
    const after = await reloaded.c.acceptField('description');
    const raw = rawMeta('DO'); delete raw.projects[0].issuetypes[0].fields.description;
    pending.resolve(raw); const finished = await selecting;
    assert.notEqual(before.assistance && before.assistance.status, 'ready');
    assert.equal(after.draft.fields.description, undefined);
    assert.equal(after.stage, 'metadata'); assert.equal(signal.aborted, false);
    assert.ok(finished.meta); assert.deepEqual(finished.draft.pendingFields, {});
});
test('Apply after a failed restored metadata refresh preserves pending value and metadata error', async () => {
    const h = harness({ai: {async assist() {return {fields: {description: 'OLD'}, questions: [], warnings: [], evidence: []};}}});
    await h.ready(); await h.c.assistField('description', 'generate');
    const reloaded = harness({storage: h.localStorage, api: {async getCreateMeta() {throw new Error('offline');}}});
    await reloaded.c.init(); await reloaded.c.selectProject('DO');
    const s = await reloaded.c.acceptField('description');
    assert.equal(s.draft.fields.description, undefined); assert.equal(s.draft.pendingFields.description, 'OLD');
    assert.equal(s.error.code, 'metadata'); assert.notEqual(s.assistance && s.assistance.status, 'ready');
});
test('Apply revalidates restored pending values against writable metadata and exact catalog IDs', async () => {
    for (const [id, value] of [['customfield_2', {id: 'APP-1'}], ['description', {id: 'invalid-shape'}]]) {
        const h = harness(); await h.ready();
        const store = h.stores[0], saved = store.load('DO');
        saved.draft.pendingFields = {[id]: value};
        saved.draft.pendingAssistance = {fieldId: id, action: 'generate'};
        store.save('DO', saved, saved.revision);
        const reloaded = harness({storage: h.localStorage}); await reloaded.c.init(); await reloaded.c.selectProject('DO');
        const s = await reloaded.c.acceptField(id);
        assert.equal(s.draft.fields[id], undefined); assert.equal(s.error.code, 'response');
        assert.notEqual(s.assistance && s.assistance.status, 'ready');
    }
    const h = harness(); await h.ready();
    const store = h.stores[0], saved = store.load('DO'); saved.draft.pendingFields = {description: 'OLD'};
    store.save('DO', saved, saved.revision);
    const reloaded = harness({storage: h.localStorage, api: {async getCreateMeta(key) {
        const raw = rawMeta(key); raw.projects[0].issuetypes[0].fields.description.operations = ['add']; return raw;
    }}});
    await reloaded.c.init(); await reloaded.c.selectProject('DO');
    const s = await reloaded.c.acceptField('description');
    assert.equal(s.draft.fields.description, undefined); assert.equal(s.error.code, 'response');
});
test('numeric helpers and restored individual numeric proposals require manual input', async () => {
    let calls = 0;
    const rawWithNumber = key => {
        const raw = rawMeta(key);
        raw.projects[0].issuetypes[0].fields.effort = {name: 'Effort', schema: {type: 'number', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:float'}};
        return raw;
    };
    const h = harness({api: {async getCreateMeta(key) {return rawWithNumber(key);}},
        ai: {async assist() {calls++; return {fields: {effort: 8}, questions: [], warnings: [], evidence: []};}}});
    await h.ready(); await h.c.updateSource('Effort: 8 story points');
    assert.equal(h.c.getState().meta.issueTypes[0].fields.find(f => f.id === 'effort').kind, 'number');
    let s = await h.c.assistField('effort', 'generate');
    assert.equal(s.error.code, 'input'); assert.equal(calls, 0);
    const store = h.stores[0], saved = store.load('DO');
    saved.draft.pendingFields = {effort: 8}; saved.draft.pendingAssistance = {fieldId: 'effort', action: 'generate'};
    store.save('DO', saved, saved.revision);
    const reloaded = harness({storage: h.localStorage, api: {async getCreateMeta(key) {return rawWithNumber(key);}}});
    await reloaded.c.init(); await reloaded.c.selectProject('DO'); s = await reloaded.c.acceptField('effort');
    assert.equal(s.draft.fields.effort, undefined); assert.equal(s.error.code, 'response');
    s = await reloaded.c.updateField('effort', 8); assert.equal(s.draft.fields.effort, 8);
});
test('individual helper failures expose safe field feedback and respect durable creation locks', async () => {
    const h = harness({ai: {async assist() {throw {code: 'transport', message: 'PRIVATE'};}}});
    await h.ready(); let s = await h.c.assistField('description', 'generate');
    assert.equal(s.assistance.status, 'error'); assert.equal(s.assistance.error.code, 'transport');
    assert.ok(!JSON.stringify(s.assistance).includes('PRIVATE'));
    const store = h.stores[0], saved = store.load('DO');
    saved.draft.creation = {status: 'unknown', issueKey: null, attemptId: 'a', error: null};
    store.save('DO', saved, saved.revision);
    s = await h.c.assistField('summary', 'generate'); assert.equal(s.error.code, 'conflict');
    assert.deepEqual(s.draft.fields, {});
});

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

test('response errors retain allowlisted reasons and current metadata field IDs only', async () => {
    const h=harness();await h.ready();await h.c.updateField('summary','Keep');
    for(const details of [{reason:'shape',fieldId:'components',raw:'SECRET'}, {reason:'SECRET',fieldId:'components'},
        {reason:'value',fieldId:'SECRET/path'}, {reason:'constructor',fieldId:'components'},
        {reason:{toString(){return 'shape';},raw:'SECRET'},fieldId:'components'}, {reason:['shape'],fieldId:'components'}]) {
        h.ai.prepare=async()=>{throw Object.assign(new Error('SECRET raw'),{code:'response',details});};
        await h.c.prepare();const state=h.c.getState();
        assert.ok(!JSON.stringify(state.error).includes('SECRET'));
        if(typeof details.reason!=='string') assert.equal(state.error.details,undefined);
        if(details.reason==='shape') {assert.match(state.error.message,/components/);assert.match(state.error.message,/формат/i);}
        assert.equal(state.draft.fields.summary,'Keep');assert.equal(state.draft.checked,null);
    }
});

test('response copy explains failures in plain Russian with fixed labels and no metadata/model text',async()=>{
    const h=harness({api:{async getCreateMeta(key){const raw=rawMeta(key);for(const type of raw.projects[0].issuetypes){
        type.fields.components.name='PRIVATE metadata label';
        type.fields.customfield_2.name='PRIVATE custom label';
        type.fields.fixVersions={name:'PRIVATE version label',schema:{type:'array',items:'version',system:'fixVersions'}};
    }return raw;}}});await h.ready();
    for(const reason of ['json','contract','questions','warnings','evidence','selection','scope','shape','value']) {
        for(const [fieldId,label] of [['components','Компоненты'],['fixVersions','Исправить в версиях'],['customfield_2','customfield_2']]) {
            h.ai.prepare=async()=>{throw Object.assign(new Error('PRIVATE model text'),{code:'response',details:{reason,fieldId}});};
            await h.c.prepare();const error=h.c.getState().error;
            assert.match(error.message,/^Не удалось применить ответ AI:/);
            assert.ok(error.message.includes('Поле: '+label));
            assert.doesNotMatch(error.message,/PRIVATE|контракт|metadata|JSONv1|JSON/);
            if(reason==='value') assert.match(error.message,/данным Jira|списку допустимых значений/);
            assert.equal(error.details.fieldId,fieldId);
        }
    }
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
