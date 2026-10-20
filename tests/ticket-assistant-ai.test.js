const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./helpers/load-amd-module');
const {loadUnit, metadataFixture, memoryStorage} = require('./helpers/ticket-assistant-fixture');
const shared = load(path.resolve(__dirname, '../ujg-shared-modules/llm-client.js'), {});
const fields = loadUnit('fields');
const validation = loadUnit('validation', {_ujgTA_fields: fields});
function ai() { return loadUnit('ai', {_ujgShared_llmClient: shared, _ujgTA_validation: validation}); }
function input() {
    return {source: 'Нужно исправить запуск.', meta: metadataFixture(),
        profile: {id: 'p', name: 'Profile', instructions: 'Describe facts.', allowAssignee: false,
            templates: [{id: 't', name: 'Fix', whenToUse: 'Failures', instructions: 'Ask for details.', issueTypeId: null}]},
        issueTypeId: '10', templateId: 't', allowFieldIds: ['summary', 'description', 'customfield_2'],
        draft: {fields: {summary: 'Запуск'}, attachments: [{file: new File(['FILE_SECRET'], 'secret.txt')}]}};
}
function response(kind = 'draft', extra = {}) {
    return {schemaVersion: 1, kind, ...(kind === 'check' ? {} : {issueTypeId: '10', templateId: 't'}),
        ...(kind === 'draft' ? {fields: {summary: 'Запуск'}} : {}), questions: [],
        ...(kind === 'route' ? {candidates: []} : {warnings: [], evidence: []}), ...extra};
}
function parse(kind, body, value = input()) { return ai().parseResponse(kind, typeof body === 'string' ? body : JSON.stringify(body), value); }
const config = {apiBase: 'https://stub.invalid', apiKey: 'KEY_SECRET', model: 'stub', basePrompt: 'unchanged'};

test('configured budget admits large prompts and shared transport preserves every character', async () => {
    const i = input(); i.tokenBudget = {context: 100000, reserve: 4096};
    i.source = '  начало\n\n' + 'я x  '.repeat(11000) + '\t конец  ';
    i.profile.instructions = '  rule\n\n'.repeat(1000);
    const request = ai().buildRequest('prepare', i);
    assert.ok(shared.utf8ByteLength(request.userPrompt) > 42000);
    for (const legacy of [false, true]) {
        const body = shared.buildRequestBody({...config, useLegacyCompletionsEndpoint: legacy}, request);
        if (legacy) assert.equal(body.prompt, request.systemPrompt + '\n\n' + request.userPrompt);
        else {assert.equal(body.messages[0].role,'user');assert.equal(body.messages[1].role,'user');assert.equal(body.messages[0].content,request.systemPrompt);assert.equal(body.messages[1].content,request.userPrompt);}
        assert.equal(body.max_tokens, undefined);
    }
    let sent;
    const client = ai().createClient({readConfig: () => config, fetchImpl: async (url, options) => {
        sent = JSON.parse(options.body);
        return {ok:true,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify(response())}}],usage:{prompt_tokens:123,completion_tokens:45,total_tokens:168}})};
    }});
    const result = await client.prepare(i);
    assert.equal(sent.messages[0].content, request.systemPrompt);
    assert.equal(sent.messages[1].content, request.userPrompt);
    assert.deepEqual({...result.usage}, {inputTokens:123,outputTokens:45,totalTokens:168,source:'provider'});
});

test('preflight estimates unicode and empty text, accounts for reserve and blocks before network', async () => {
    const i=input(); i.source='';
    const empty=ai().preflight('prepare', i);
    assert.equal(empty.source, 0);
    assert.ok(empty.instructions > 0 && empty.metadata > 0);
    assert.equal(empty.input, empty.instructions + empty.source + empty.metadata);
    i.source='😀漢я'.repeat(100);
    const unicode=ai().preflight('prepare',i);
    assert.ok(unicode.source >= 300 && unicode.source < shared.utf8ByteLength(JSON.stringify(i.source)));
    i.tokenBudget={context:unicode.input+100,reserve:100};
    assert.equal(ai().preflight('prepare',i).fits,true);
    i.tokenBudget.reserve=101;
    const over=ai().preflight('prepare',i); assert.equal(over.fits,false);
    let calls=0;
    const client=ai().createClient({readConfig:()=>config,fetchImpl:async()=>{calls++;}});
    await assert.rejects(client.prepare(i),e=>e.code==='limit' && e.details.input===over.input && !/UTF-8/.test(e.message));
    assert.equal(calls,0);
    for (const budget of [{context:0,reserve:1},{context:10,reserve:10},{context:20,reserve:NaN},{context:Infinity,reserve:1},{context:20,reserve:1.5}]) {
        i.tokenBudget=budget;
        assert.throws(()=>ai().buildRequest('prepare',i),e=>e.code==='config');
    }
});

test('response JSON above former byte cap is accepted with a separate bounded safety cap', () => {
    assert.equal(parse('check',response('check',{warnings:['я'.repeat(30000)]})).warnings[0].length,30000);
    assert.throws(()=>parse('check',response('check',{warnings:['x'.repeat(2*1024*1024)]})),e=>e.code==='response');
});

test('missing custom fields ask using current metadata names and keep machine IDs stable', () => {
    const i=input(), field=i.meta.issueTypes[0].fields.find(f=>f.id==='customfield_2');
    field.required=true; field.name='Контур проверки';
    const result=parse('check',response('check'),i);
    const question=result.questions.find(q=>q.id==='required:customfield_2');
    assert.equal(question.text,'Проверьте поле «Контур проверки»');
    const errors=validation.validateFields(i.meta,'10',i.draft.fields);
    assert.match(errors.fieldErrors.customfield_2[0],/^Обязательное поле: Контур проверки/);
});

test('three JSONv1 contracts preserve selections and check cannot replace fields', () => {
    assert.equal(parse('route', response('route')).issueTypeId, '10');
    assert.equal(parse('prepare', response()).fields.summary, 'Запуск');
    assert.equal(parse('check', response('check')).kind, 'check');
    assert.throws(() => parse('check', response('check', {fields: {summary: 'replacement'}})));
});
test('strict JSON, version, kinds, unknown keys and prototype attacks fail safely', () => {
    for (const text of ['', '```json\n{}\n```', '<html>SECRET</html>', '{', JSON.stringify(response('draft', {schemaVersion: 2})),
        JSON.stringify(response('check')), JSON.stringify(response('draft', {execute: 'SECRET'})),
        JSON.stringify(response()).replace('"fields":{', '"fields":{"__proto__":{},')]) {
        assert.throws(() => parse('prepare', text), e => !e.message.includes('SECRET'));
    }
});
test('metadata IDs and template compatibility are authoritative, labels never become IDs', () => {
    for (const extra of [{issueTypeId: 'Task'}, {templateId: 'Fix'}, {issueTypeId: '11'}, {fields: {customfield_2: 'TEST'}},
        {fields: {customfield_2: {id: 'TEST'}}}, {fields: {customfield_2: {id: 'DO-1', command: 'x'}}},
        {fields: {project: {id: 'DO-project'}}}, {fields: {issuetype: {id: '10'}}}, {fields: {assignee: {name: 'admin'}}}]) {
        assert.throws(() => parse('prepare', response('draft', extra)));
    }
    assert.equal(parse('prepare', response('draft', {fields: {customfield_2: {id: 'DO-2'}}})).fields.customfield_2.id, 'DO-2');
    const i = input(); i.profile.templates[0].issueTypeId = '11';
    assert.throws(() => ai().buildRequest('prepare', i));
});
test('ambiguity requires explicit choice and unique candidate pairs', () => {
    const i = input(); i.issueTypeId = null; i.templateId = null;
    const candidates = [{issueTypeId: '10', templateId: 't', reason: 'Task'}, {issueTypeId: '11', templateId: 't', reason: 'Bug'}];
    assert.equal(parse('route', response('route', {issueTypeId: null, templateId: null, candidates}), i).candidates.length, 2);
    assert.throws(() => parse('route', response('route', {candidates}), i));
    assert.throws(() => parse('route', response('route', {issueTypeId: null, templateId: null, candidates: [candidates[0], candidates[0]]}), i));
});
test('source evidence is literal and completeness claims do not bypass local required fields', () => {
    assert.throws(() => parse('prepare', response('draft', {evidence: [{fieldId: 'summary', kind: 'source', quote: 'invented'}]})));
    assert.equal(parse('prepare', response('draft', {evidence: [{fieldId: 'summary', kind: 'source', quote: 'исправить'}]})).evidence.length, 1);
    const missing = input(); missing.draft.fields = {};
    const result = parse('prepare', response('draft', {fields: {}, warnings: ['Everything complete']}), missing);
    assert.ok(result.questions.some(q => q.required && q.id === 'required:summary'));
    const i = input(); i.draft.fields = {};
    assert.ok(parse('check', response('check'), i).questions.some(q => q.id === 'required:summary'));
});
test('explicitly selected human users validate locally but can never be generated', () => {
    const i = input();
    i.meta.issueTypes[0].fields.find(f => f.id === 'assignee').required = true;
    i.profile.allowAssignee = true;
    i.explicitUserFields = ['assignee'];
    i.draft.fields.assignee = {name: 'human-picked'};
    assert.ok(!parse('check', response('check'), i).questions.some(q => q.id === 'required:assignee'));
    assert.ok(!ai().buildRequest('check', i).userPrompt.includes('human-picked'));
    delete i.explicitUserFields;
    assert.ok(parse('check', response('check'), i).questions.some(q => q.id === 'required:assignee'));
    assert.throws(() => parse('prepare', response('draft', {fields: {assignee: {name: 'human-picked'}}}), i));
});
test('malformed normalized metadata and secret-bearing model output have safe failures', () => {
    const i = input(); i.meta.issueTypes[0].fields = [null];
    assert.throws(() => ai().buildRequest('prepare', i), /контекст/i);
    assert.throws(() => parse('check', response('check', {warnings: ['Cookie: COOKIE_SECRET']})), e => !e.message.includes('COOKIE_SECRET'));
});
test('embedded JSON credentials and known connection keys never enter prompts or results', async () => {
    const i = input(); i.source = '{"apiKey":"JSON_SECRET"}';
    assert.throws(() => ai().buildRequest('prepare', i), e => e.code === 'secret');
    const client = ai().createClient({llmClient: {...shared, requestText: async () => ({text: JSON.stringify(response('check', {warnings: ['KEY_SECRET']}))})}, readConfig: () => config, fetchImpl() {}});
    await assert.rejects(client.check(input()), e => e.code === 'secret' && !e.message.includes('KEY_SECRET'));
});
test('default config reader supplies browser storage to unchanged shared reader', async () => {
    const storage = memoryStorage(); shared.writeStoredConfig(storage, config);
    const module = loadUnit('ai', {_ujgShared_llmClient: shared, _ujgTA_validation: validation}, {localStorage: storage});
    const client = module.createClient({llmClient: {...shared, requestText: async () => ({text: JSON.stringify(response('check'))})}, fetchImpl() {}});
    assert.equal((await client.check(input())).kind, 'check');
});
test('prompts whitelist context, preserve editable instructions and disallow fallback', () => {
    const i = input(); i.cookies = 'COOKIE_SECRET'; i.profile.apiKey = 'PROFILE_SECRET'; i.draft.token = 'DRAFT_SECRET';
    const request = ai().buildRequest('prepare', i);
    const text = request.systemPrompt + request.userPrompt;
    for (const secret of ['COOKIE_SECRET', 'PROFILE_SECRET', 'DRAFT_SECRET', 'FILE_SECRET', 'secret.txt', 'autoCompleteUrl']) assert.ok(!text.includes(secret));
    assert.ok(text.includes('Describe facts.') && text.includes('Ask for details.'));
    assert.ok(!text.includes('Deployment'));
    assert.ok(JSON.parse(request.userPrompt).contextScope);
    assert.equal(request.allowProtocolFallback, false);
    i.source = 'Authorization: Bearer TOP_SECRET';
    assert.throws(() => ai().buildRequest('prepare', i), e => !e.message.includes('TOP_SECRET'));
});
test('editable instructions and full JSON input both count against the same local budget', () => {
    for (const edit of [(i)=>{i.profile.instructions+='я';},(i)=>{i.source+='я';}]) {
        const i=input(),estimate=ai().preflight('prepare',i);
        i.tokenBudget={context:estimate.input+100,reserve:100};
        assert.ok(ai().buildRequest('prepare',i));edit(i);
        assert.throws(()=>ai().buildRequest('prepare',i),e=>e.code==='limit' && e.details.input===estimate.input+1);
    }
});
test('over-budget input is rejected before transport', async () => {
    let calls = 0;
    const client = ai().createClient({llmClient: {...shared, requestText() {calls++;}}, fetchImpl() {}, readConfig: () => config});
    await assert.rejects(client.prepare({...input(), source: 'я'.repeat(42001)}, {}), /бюджет/i);
    assert.equal(calls, 0);
});
test('client limit rejection retains only safe budget accounting and no request content', async () => {
    const i = input(); i.profile.instructions = 'я'.repeat(4000); i.source = 'x'.repeat(43000) + 'PRIVATE_BODY';
    i.tokenBudget={context:1000,reserve:100};
    let calls = 0;
    const client = ai().createClient({llmClient: {...shared, requestText() {calls++;}}, readConfig: () => config, fetchImpl() {}});
    await assert.rejects(client.check(i), error => {
        assert.equal(error.code, 'limit');
        assert.ok(error.details.input > error.details.available);
        assert.equal(error.details.context,1000);assert.equal(error.details.reserve,100);
        assert.equal(error.details.input,error.details.instructions+error.details.source+error.details.metadata);
        assert.ok(!JSON.stringify(error).includes('PRIVATE_BODY') && !JSON.stringify(error).includes('KEY_SECRET'));
        return true;
    });
    assert.equal(calls, 0);
});
test('check retains populated excluded fields with minimal context while omitting their large catalogs and all users', () => {
    const i = input();
    i.allowFieldIds = ['summary'];
    i.meta.issueTypes[0].fields.find(f => f.id === 'customfield_2').allowedValues =
        Array.from({length: 2000}, (_, n) => ({id: String(n), label: 'EXCLUDED_CATALOG ' + n}));
    i.draft.fields.customfield_2 = {id: '42'};
    i.draft.fields.description = 'Manual result to check';
    i.draft.protectedFields = {description: true};
    i.draft.fields.assignee = {name: 'human-picked'};
    i.profile.allowAssignee = true; i.explicitUserFields = ['assignee'];
    const request = ai().buildRequest('check', i);
    const prompt = JSON.parse(request.userPrompt);
    assert.deepEqual(prompt.fields, {summary: 'Запуск', customfield_2: {id: '42'}, description: 'Manual result to check'});
    assert.deepEqual(prompt.currentFieldContext, [
        {id: 'customfield_2', name: 'Environment', kind: 'option'},
        {id: 'description', name: 'Description', kind: 'textarea'}
    ]);
    assert.deepEqual(prompt.issueTypes[0].fieldSchema.map(f => f.id), ['summary']);
    assert.ok(!request.userPrompt.includes('EXCLUDED_CATALOG') && !request.userPrompt.includes('human-picked'));
    assert.match(prompt.contextScope, /current.*values/i);
    assert.ok(!parse('check', response('check'), i).questions.some(q => q.id === 'required:customfield_2'));
    assert.equal(parse('check', response('check', {evidence: [{fieldId: 'description', kind: 'source', quote: 'исправить'}]}), i).evidence.length, 1);
    assert.throws(() => parse('prepare', response('draft', {fields: {description: 'replacement'}}), i));
    assert.throws(() => parse('check', response('check', {fields: {description: 'replacement'}}), i));
    i.draft.fields.description = 'Cookie: PRIVATE_COOKIE';
    assert.throws(() => ai().buildRequest('check', i), error => error.code === 'secret' && !JSON.stringify(error).includes('PRIVATE_COOKIE'));
});
test('oversized catalogs require explicit field selection without silent truncation', () => {
    const i = input(); i.meta.issueTypes[0].fields.find(f => f.id === 'customfield_2').allowedValues =
        Array.from({length: 2000}, (_, n) => ({id: String(n), label: 'Каталог ' + n}));
    assert.throws(() => ai().buildRequest('prepare', i), e=>e.code==='limit');
    i.allowFieldIds = ['summary'];
    assert.ok(ai().buildRequest('prepare', i).userPrompt);
});
test('client uses shared config/request only and propagates abort through fetch wrapper', async () => {
    const controller = new AbortController(); let stored = 0, fetchCalls = 0;
    const client = ai().createClient({llmClient: {...shared, readStoredConfig() {stored++; return config;}},
        fetchImpl: async (url, options) => {
            fetchCalls++; assert.equal(options.signal, controller.signal);
            const body = JSON.parse(options.body); assert.ok(!JSON.stringify(body).includes('KEY_SECRET'));
            return {ok: true, text: async () => JSON.stringify({choices: [{message: {content: JSON.stringify(response())}}]})};
        }});
    assert.equal((await client.prepare(input(), {signal: controller.signal})).kind, 'draft');
    assert.equal(stored, 1); assert.equal(fetchCalls, 1); assert.equal(config.basePrompt, 'unchanged');
    controller.abort();
    await assert.rejects(client.prepare(input(), {signal: controller.signal}), e => e.name === 'AbortError');
    assert.equal(fetchCalls, 1);
});
test('config, empty response, transport throws and cancellation expose only safe errors', async () => {
    for (const stub of [() => {throw new Error('https://secret.invalid?apiKey=KEY_SECRET');}, async () => {throw new Error('COOKIE_SECRET');}, async () => ({text: ''})]) {
        const client = ai().createClient({llmClient: {...shared, requestText: stub}, readConfig: () => config, fetchImpl() {}});
        await assert.rejects(client.check(input()), e => !/SECRET|https:/.test(e.message));
    }
    await assert.rejects(ai().createClient({readConfig: () => null}).prepare(input()), /настрой/i);
    const controller = new AbortController();
    const client = ai().createClient({llmClient: {...shared, requestText: async () => {controller.abort(); return {text: JSON.stringify(response())};}}, readConfig: () => config, fetchImpl() {}});
    await assert.rejects(client.prepare(input(), {signal: controller.signal}), e => e.name === 'AbortError');
});
