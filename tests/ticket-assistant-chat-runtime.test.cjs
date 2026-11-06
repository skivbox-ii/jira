const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const {pathToFileURL} = require('node:url');
const runtime = () => import(pathToFileURL(path.resolve(__dirname, '../ujg-ticket-assistant-chat/runtime.mjs')));
const envelope = (text = '', toolCalls = []) => ({text: JSON.stringify({text, toolCalls})});
const call = (id, name = 'get_task', args = {}) => ({id, name, arguments: args});
const tool = (execute = async () => ({summary: 'Current task'})) => ({name: 'get_task', description: 'Current task', parameters: {type: 'object', properties: {}, additionalProperties: false}, execute});
function deferred() { let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve}; }
const tick = () => new Promise(r => setImmediate(r));

test('scoped correction reformats misplaced update_task questions once before executing',async()=>{
    const {createSession}=await runtime();let requests=0,executed=0;const events=[];
    const parameters={type:'object',properties:{fields:{type:'object'},questions:{type:'array',items:{type:'object'}}},required:['fields'],additionalProperties:false};
    const misplaced={text:'',toolCalls:[{id:'call_6',name:'update_task',arguments:{fields:{summary:'Ошибка',description:'Не запускается'}},questions:[{id:'q1',text:'Когда?',required:true}]}]};
    const fixed={text:'',toolCalls:[{id:'call_6',name:'update_task',arguments:{...misplaced.toolCalls[0].arguments,questions:misplaced.toolCalls[0].questions}}]};
    const s=createSession({repairMisplacedQuestions:true,tools:[{name:'update_task',parameters,execute:args=>{executed++;assert.deepEqual(args,fixed.toolCalls[0].arguments);return {ok:true};}}],onEvent:e=>events.push(e),
        requestText:async r=>{requests++;if(requests===2){assert.equal(executed,0);assert.equal(events.some(e=>e.type==='tool'),false);assert.match(r.system,/questions.*arguments/);assert.match(r.user,/call_6/);}return requests===1?{text:JSON.stringify(misplaced)}:requests===2?{text:JSON.stringify(fixed)}:envelope('Готово');}});
    const result=await s.prompt('Ошибка');assert.equal(result.status,'complete');assert.equal(executed,1);assert.equal(result.usage.modelCalls,3);assert.equal(result.usage.toolCalls,1);s.dispose();
});

for(const limits of [{},{modelCalls:1}]) test('failed scoped correction is bounded and has zero effects '+JSON.stringify(limits),async()=>{
    const {createSession}=await runtime();let requests=0,executed=0;
    const s=createSession({repairMisplacedQuestions:true,limits,tools:[{name:'update_task',parameters:{type:'object',properties:{fields:{type:'object'},questions:{type:'array'}},required:['fields'],additionalProperties:false},execute:()=>{executed++;}}],
        requestText:async()=>{requests++;return {text:JSON.stringify({text:'',toolCalls:[{id:'call_6',name:'update_task',arguments:{fields:{summary:'Ошибка',description:'Не запускается'}},questions:[]}]})};}});
    const result=await s.prompt('Ошибка');assert.equal(result.status,limits.modelCalls?'limit':'error');assert.equal(executed,0);assert.equal(requests,limits.modelCalls?1:2);s.dispose();
});

for(const variant of ['default','extra','conflict','invalid','unknown','duplicate']) test('correction cannot relax strict call validation: '+variant,async()=>{
    const {createSession}=await runtime();let requests=0,executed=0;
    const c={id:'call_6',name:'update_task',arguments:{fields:{summary:'Ошибка'}},questions:[]};
    if(variant==='extra')c.extra=true;
    if(variant==='conflict')c.arguments.questions=[];
    if(variant==='invalid')c.questions='not an array';
    if(variant==='unknown')c.name='unknown';
    const s=createSession({repairMisplacedQuestions:variant!=='default',tools:[{name:'update_task',parameters:{type:'object',properties:{fields:{type:'object'},questions:{type:'array'}},required:['fields'],additionalProperties:false},execute:()=>{executed++;}}],
        requestText:async()=>{requests++;return envelope('',variant==='duplicate'?[c,c]:[c]);}});
    assert.equal((await s.prompt('Ошибка')).status,'error');assert.equal(executed,0);assert.equal(requests,1);s.dispose();
});

test('corrective response respects reserve and reports both model calls',async()=>{
    const {createSession}=await runtime();let requests=0,executed=0;
    const s=createSession({repairMisplacedQuestions:true,tokenBudget:{context:12000,reserve:512},tools:[{name:'update_task',parameters:{type:'object',properties:{fields:{type:'object'},questions:{type:'array'}},required:['fields'],additionalProperties:false},execute:()=>{executed++;}}],
        requestText:async()=>++requests===1?envelope('',[{id:'call_6',name:'update_task',arguments:{fields:{}},questions:[]}]):{text:'я'.repeat(600)}});
    const result=await s.prompt('Ошибка');assert.equal(result.status,'limit');assert.match(result.reason,/reserve/);assert.equal(result.usage.modelCalls,2);assert.equal(executed,0);s.dispose();
});

test('opted-in prose is an inert final after tools and on subsequent turns', async () => {
    const {createSession} = await runtime(), events = []; let requests = 0, executed = 0;
    const prose = 'Известные сведения сохранены. Когда возникает ошибка?';
    const s = createSession({allowPlainTextFinal:true, tools:[tool(() => {executed++; return {ok:true};})],
        onEvent:e=>events.push(e), requestText:async()=>++requests===1 ? envelope('Проверяю поля', [call('lookup')]) : {text:prose}});
    assert.equal((await s.prompt('Ошибка запуска')).status, 'complete');
    assert.equal((await s.prompt('При каждом запуске')).status, 'complete');
    assert.equal(executed, 1); assert.equal(requests, 3);
    assert.equal(events.filter(e=>e.type==='assistant').at(-1).text, prose);
    assert.deepEqual(s.getMessages().at(-1).content, [{type:'text', text:prose}]); s.dispose();
});

for(const prose of ['Известные факты:\n1. Ошибка запуска (DEV, TEST, PREPROD).\nИнструменты: ["update_task"]',
    'Известные факты: ENV (DEV: тестовая среда). Когда появилась ошибка?',
    '1. Проверить ENV (DEV, TEST, PREPROD).\n2. Известные факты сохранены.',
    'Использован update_task. Проверка ENV (DEV) завершена.']) test('hybrid human prose remains inert: '+prose.slice(0,45),async()=>{
    const {createSession}=await runtime();let executed=0;const events=[];
    const s=createSession({allowPlainTextFinal:true,tools:[{...tool(()=>{executed++;}),name:'update_task'}],onEvent:e=>events.push(e),requestText:async()=>({text:prose})});
    assert.equal((await s.prompt('Факты')).status,'complete');assert.equal(executed,0);
    assert.equal(events.find(e=>e.type==='assistant').text,prose);assert.equal(events.some(e=>e.type==='tool'),false);s.dispose();
});

for (const bad of ['', '  ', '{}', '[]', 'null', '"Ответ"', 'true', '123',
    '{"text":"Ответ","toolCalls":', 'Ответ\n{"toolCalls":[]}', '```json\n{}\n```',
    'toolCalls: nope', 'update_task(summary="Changed")', '<tool_call>get_task</tool_call>',
    'function_call: update_task', '{"text":"Ответ","toolCalls":[{"id":"a","name":"get_task","arguments":{}},{"id":"b","name":"missing","arguments":{}}]}',
    JSON.stringify({text:'Ответ',toolCalls:[call('a'),call('b','get_task',{extra:true})]}),
    '{"text":"Ответ","toolCalls":[],"__proto__":{}}']) {
    test('prose opt-in still rejects structured/tool-like output atomically: '+bad.slice(0,50), async()=>{
        const {createSession} = await runtime(); let executed=0, requests=0; const events=[];
        const s=createSession({allowPlainTextFinal:true,tools:[tool(()=>{executed++;return {};})],onEvent:e=>events.push(e),requestText:async()=>{requests++;return {text:bad};}});
        assert.equal((await s.prompt('Проверка')).status,'error'); assert.equal(executed,0); assert.equal(requests,1);
        assert.equal(events.some(e=>e.type==='assistant'||e.type==='tool'),false);s.dispose();
    });
}

test('Pi handles multi-turn tools, reports every result, and preserves a defensive history', async () => {
    const {createSession} = await runtime(), events = [], requests = [];
    let executed = 0;
    const s = createSession({system: 'Prepare a Jira task', tools: [tool(async () => {executed++; return {summary: 'Keep exact value'};})], onEvent: e => events.push(e), requestText: async r => {
        requests.push(r); return requests.length === 1 ? envelope('', [call('one')]) : envelope('One next question?');
    }});
    assert.equal(executed, 0);
    assert.equal((await s.prompt('Failure on startup')).status, 'complete');
    assert.match(requests[1].user, /Keep exact value/);
    assert.equal(executed, 1);
    assert.ok(requests[0].signal instanceof AbortSignal);
    assert.match(requests[0].system, /toolCalls/);
    assert.deepEqual(events.filter(e => e.type === 'tool').map(e => e.phase), ['start', 'end']);
    assert.equal(events.filter(e => e.type === 'assistant')[0].text, 'One next question?');
    const copy = s.getMessages(); copy.length = 0; assert.ok(s.getMessages().length > 0);
    assert.equal((await s.prompt('During launch')).status, 'complete');
    assert.match(requests[2].user, /Failure on startup/); assert.match(requests[2].user, /During launch/);
    s.dispose();
});

for (const legacy of [false, true]) test('existing shared requestText supports ' + (legacy ? 'legacy completions' : 'chat completions'), async () => {
    const {createSession} = await runtime();
    const shared = require('./helpers/load-amd-module')(path.resolve(__dirname, '../ujg-shared-modules/llm-client.js'), {});
    const seen = [], budget = {context: 32768, reserve: 4096};
    const s = createSession({system: 'Prepare', tokenBudget: budget, tools: [tool()], requestText: ({system, user, signal}) => shared.requestText(
        {apiBase: 'https://mock.invalid/v1', apiKey: 'MOCK', model: 'mock', useLegacyCompletionsEndpoint: legacy},
        {systemPrompt: system, userPrompt: user, tokenBudget: budget, preservePrompt: true, allowProtocolFallback: false},
        async (url, options) => {seen.push({url, body: JSON.parse(options.body), signal}); const text = seen.length === 1 ? envelope('', [call('lookup')]).text : envelope('Done').text;
            return {ok: true, text: async () => JSON.stringify({choices: [legacy ? {text} : {message: {content: text}}]})};})});
    assert.equal((await s.prompt('Initial user text')).status, 'complete');
    assert.equal(seen.length, 2); assert.equal(seen[0].url, 'https://mock.invalid/v1/' + (legacy ? 'completions' : 'chat/completions'));
    assert.match(JSON.stringify(seen[1].body), /Current task/);
    assert.equal('tools' in seen[0].body, false);
    assert.equal(legacy ? typeof seen[0].body.prompt : seen[0].body.messages.length, legacy ? 'string' : 2);
    s.dispose();
});

for (const bad of ['plain prose', JSON.stringify({text:'x',toolCalls:[call('x','create_issue')]}), JSON.stringify({text:'x',toolCalls:[call('same'),call('same')]}), JSON.stringify({text:'x',toolCalls:[call('x','get_task',{extra:true})]}), '{"text":"x","toolCalls":[{"id":"p","name":"get_task","arguments":{"__proto__":{}}}]}']) {
    test('malformed/unauthorized envelope cannot execute any tool: ' + bad.slice(0, 48), async () => {
        const {createSession} = await runtime(); let executions = 0, requests = 0;
        const s = createSession({tools:[tool(async () => {executions++;})], requestText: async () => {requests++; return {text:bad};}});
        assert.equal((await s.prompt('Try')).status, 'error'); assert.equal(executions, 0); assert.equal(requests,1); s.dispose();
    });
}

test('strict schema rejects coerced arguments before Pi executes', async () => {
    const {createSession} = await runtime(); let count = 0;
    const t = {...tool(() => {count++;}), parameters:{type:'object',properties:{value:{type:'integer'}},required:['value'],additionalProperties:false}};
    const s = createSession({tools:[t], requestText:async () => envelope('',[call('x','get_task',{value:'7'})])});
    assert.equal((await s.prompt('Try')).status,'error'); assert.equal(count,0); s.dispose();
});

test('tool failure is returned to the model and visible in progress', async () => {
    const {createSession} = await runtime(); const requests=[], events=[];
    const s=createSession({tools:[tool(async()=>{throw Error('Mock lookup failed');})],onEvent:e=>events.push(e),requestText:async r=>{requests.push(r);return requests.length===1?envelope('',[call('x')]):envelope('Please retry');}});
    assert.equal((await s.prompt('Look up')).status,'complete'); assert.match(requests[1].user,/Mock lookup failed/);
    assert.equal(events.find(e=>e.type==='tool'&&e.phase==='end').isError,true);s.dispose();
});

test('restore neither replays prior tools nor leaves incomplete pairs; getters are JSON serializable', async () => {
    const {createSession}=await runtime();let executed=0;
    const source=createSession({tools:[tool(async()=>{executed++;return {ok:true};})],requestText:async()=>envelope('',[call('pending')]),limits:{modelCalls:1}});
    await source.prompt('Do lookup'); const saved=source.getMessages();source.dispose();
    const assistant=saved.find(m=>m.role==='assistant'&&m.content.some(p=>p.type==='toolCall'));
    const restored=createSession({messages:[{role:'user',content:'Original',timestamp:0},assistant],tools:[tool(async()=>{executed++;})],requestText:async r=>{assert.match(r.user,/interrupted/i);return envelope('Restored');}});
    const before=executed;assert.equal((await restored.prompt('Continue')).status,'complete');assert.equal(executed,before);
    assert.ok(restored.getMessages().some(m=>m.role==='toolResult'&&m.toolCallId==='pending'&&m.isError));
    JSON.stringify(restored.getMessages());restored.dispose();
});

test('abort settles uncooperative LLM and ignores late model/tool results', async () => {
    const {createSession}=await runtime(), pending=deferred(), events=[];let executed=0;
    const s=createSession({tools:[tool(()=>{executed++;})],requestText:()=>pending.promise,onEvent:e=>events.push(e)});
    const run=s.prompt('Wait');await tick();s.abort();assert.equal((await run).status,'aborted');
    pending.resolve(envelope('Late',[call('late')]));await tick();assert.equal(executed,0);assert.equal(events.some(e=>e.type==='assistant'),false);
    s.dispose();assert.throws(()=>s.prompt('Disposed'),/disposed/i);
});

test('abort during tool ignores late progress and leaves no effect on subsequent turn', async () => {
    const {createSession}=await runtime(), pending=deferred(), started=deferred(),events=[];let n=0, progress;
    const s=createSession({tools:[tool(async(_args,ctx)=>{progress=ctx.onUpdate;started.resolve(ctx.signal);return pending.promise;})],onEvent:e=>events.push(e),requestText:async()=>++n===1?envelope('',[call('slow')]):envelope('Next turn')});
    const run=s.prompt('Wait');const signal=await started.promise;s.abort();assert.equal((await run).status,'aborted');assert.equal(signal.aborted,true);
    const length=events.length;progress({late:true});pending.resolve({late:true});await tick();assert.equal(events.length,length);
    assert.equal((await s.prompt('Continue')).status,'complete');assert.equal(events.filter(e=>e.type==='assistant').at(-1).text,'Next turn');s.dispose();
});

test('hard model/tool limits and elapsed timeout stop with a useful reason', async () => {
    const {createSession}=await runtime();let n=0,executed=0;
    const model=createSession({tools:[tool(()=>({ok:true}))],requestText:async()=>envelope('',[call('c'+(++n))])});
    const result=await model.prompt('Loop');assert.equal(result.status,'limit');assert.equal(n,8);assert.match(result.reason,/model/i);model.dispose();
    n=0;const tools=createSession({tools:[tool(()=>{executed++;return {};})],requestText:async()=>envelope('',[call('a'+(++n)),call('b'+n)])});
    const bounded=await tools.prompt('Loop');assert.equal(bounded.status,'limit');assert.equal(executed,12);assert.match(bounded.reason,/tool/i);tools.dispose();
    const timeout=createSession({requestText:()=>new Promise(()=>{}),limits:{wallMs:20}});
    assert.equal((await timeout.prompt('Wait')).status,'limit');timeout.dispose();
});

test('context budget counts complete tool instructions; no silent truncation',async()=>{
    const {createSession}=await runtime();let n=0;const text='я'.repeat(5000);
    const s=createSession({system:text,tokenBudget:{context:2000,reserve:500},requestText:async()=>{n++;return envelope('No');}});
    const result=await s.prompt('Preserve me');assert.equal(result.status,'limit');assert.equal(n,0);assert.match(result.reason,/context/i);
    assert.ok(JSON.stringify(s.getMessages()).includes('Preserve me'));s.dispose();
    const schema=createSession({tools:[{...tool(),description:text}],tokenBudget:{context:2000,reserve:500},requestText:async()=>{n++;return envelope();}});
    assert.equal((await schema.prompt('Small')).status,'limit');assert.equal(n,0);schema.dispose();
});

test('explicit compaction refreshes authoritative state and retains original transcript/pairs',async()=>{
    const {createSession}=await runtime(),events=[],seen=[];let revision=4;
    const messages=[];for(let i=0;i<12;i++){messages.push({role:'user',content:'old '+i+' '+'long '.repeat(500),timestamp:i});messages.push({role:'assistant',content:[{type:'text',text:'answer '+i}],stopReason:'stop',timestamp:i});}
    const s=createSession({messages,tokenBudget:{context:3000,reserve:512},getContext:()=>({revision,manualFields:{summary:'Keep manual'},openQuestions:['When?'],templateRevision:9}),onEvent:e=>events.push(e),requestText:async r=>{seen.push(r);return envelope('When?');}});
    assert.equal((await s.prompt('New turn')).status,'complete');assert.ok(events.some(e=>e.type==='compaction'&&e.removedMessages>0));
    assert.match(seen[0].user,/Keep manual/);assert.match(seen[0].user,/templateRevision/);assert.match(seen[0].user,/When\?/);
    assert.equal(s.getMessages().filter(m=>m.role==='user').length,13);revision=5;await s.prompt('Now');assert.match(seen[1].user,/"revision":5/);s.dispose();
});

test('response reserve is enforced; failures keep text and can retry; observer failures are isolated',async()=>{
    const {createSession}=await runtime();let n=0;
    const s=createSession({tokenBudget:{context:3000,reserve:512},onEvent(){throw Error('observer');},requestText:async()=>++n===1?envelope('я'.repeat(1000)):envelope('Retry works')});
    assert.equal((await s.prompt('Preserve source')).status,'limit');assert.ok(JSON.stringify(s.getMessages()).includes('Preserve source'));
    assert.equal((await s.prompt('Retry')).status,'complete');s.dispose();
});

test('bundled AMD registration is isolated and reproducible without process, window or Node APIs',async()=>{
    const {build}=await import(pathToFileURL(path.resolve(__dirname,'../ujg-ticket-assistant-chat/build.mjs')));
    const asset=await build({write:false}),registered=[];
    vm.runInNewContext(asset,{define:(...args)=>registered.push(args)});
    assert.equal(registered.length,1);assert.equal(registered[0][0],'_ujgTA_picoRuntime');assert.deepEqual(Array.from(registered[0][1]),[]);
    assert.equal(typeof registered[0][2]().createSession,'function');
    assert.equal(asset,fs.readFileSync(path.resolve(__dirname,'../vendor/pico-1.4.0.amd.js'),'utf8'));
    assert.doesNotMatch(asset,/import\(|require\(["'](?:node:|@earendil)/);
    assert.match(fs.readFileSync(path.resolve(__dirname,'../vendor/pico-1.4.0.LICENSE.txt'),'utf8'),/MIT License/);
});

test('wall limit is checked before applying a response even when the event loop timer has not fired',async()=>{
    const {createSession}=await runtime();let executed=0, now=1000;const originalNow=Date.now;
    Date.now=()=>now;
    try {
        const s=createSession({tools:[tool(()=>{executed++;return {};})],limits:{wallMs:100},requestText:async()=>{now+=101;return envelope('',[call('late')]);}});
        const result=await s.prompt('Wait');assert.equal(result.status,'limit');assert.match(result.reason,/wall time/i);assert.equal(executed,0);s.dispose();
    } finally {Date.now=originalNow;}
});

test('restored complete pairs stay intact and duplicate historical IDs cannot execute again',async()=>{
    const {createSession}=await runtime();let requests=0,executed=0;
    const first=createSession({tools:[tool(()=>{executed++;return {precise:'Recorded'};})],requestText:async()=>++requests===1?envelope('',[call('unique')]):envelope('Done')});
    await first.prompt('Original');const history=first.getMessages();first.dispose();
    const second=createSession({messages:history,tools:[tool(()=>{executed++;return {};})],requestText:async()=>envelope('',[call('unique')])});
    assert.deepEqual(second.getMessages(),history);assert.equal(executed,1);
    assert.equal((await second.prompt('Try replay')).status,'error');assert.equal(executed,1);second.dispose();
});

test('entire malformed tool batch is rejected before its valid first sibling executes',async()=>{
    const {createSession}=await runtime();let executed=0;
    const s=createSession({tools:[tool(()=>{executed++;return {};})],requestText:async()=>envelope('',[call('safe'),call('unsafe','create_issue')])});
    assert.equal((await s.prompt('Try')).status,'error');assert.equal(executed,0);s.dispose();
});

test('successful progress has stable name/id and JSON result, while async observers cannot reject a turn',async()=>{
    const {createSession}=await runtime(),events=[];let n=0;
    const s=createSession({tools:[tool(async(_args,{onUpdate,toolCallId})=>{assert.equal(toolCallId,'progress');onUpdate({step:1});return {step:2};})],
        onEvent:async e=>{events.push(e);throw Error('observer');},requestText:async()=>++n===1?envelope('',[call('progress')]):envelope('Done')});
    assert.equal((await s.prompt('Go')).status,'complete');
    assert.deepEqual(events.filter(e=>e.type==='tool').map(e=>[e.phase,e.name,e.toolCallId]),[['start','get_task','progress'],['update','get_task','progress'],['end','get_task','progress']]);
    assert.deepEqual(events.find(e=>e.phase==='update').result,{step:1});assert.deepEqual(events.find(e=>e.phase==='end').result,{step:2});s.dispose();
});

test('current turn evidence cannot be compacted away, and an unavailable context supplier can be cancelled',async()=>{
    const {createSession}=await runtime();let n=0;
    const s=createSession({tokenBudget:{context:2000,reserve:512},getContext:()=>({manual:{summary:'Keep'}}),tools:[tool(()=>({large:'я'.repeat(4000)}))],requestText:async()=>{n++;return envelope('',[call('large')]);}});
    const result=await s.prompt('Lookup');assert.equal(result.status,'limit');assert.equal(n,1);assert.ok(JSON.stringify(result.messages).includes('я'.repeat(4000)));
    assert.ok(result.messages.some(m=>m.role==='toolResult'&&m.toolCallId==='large'));s.dispose();
    const pending=createSession({getContext:()=>new Promise(()=>{}),requestText:async()=>{throw Error('Must not request');}});
    const run=pending.prompt('Wait');await tick();pending.abort();assert.equal((await run).status,'aborted');pending.dispose();
});

test('transport errors retain user history, use no retries, and a subsequent prompt can succeed',async()=>{
    const {createSession}=await runtime();let count=0;const events=[];
    const s=createSession({onEvent:e=>events.push(e),requestText:async()=>{if(++count===1)throw Error('Mock network unavailable');return envelope('Recovered');}});
    assert.equal((await s.prompt('Preserve me')).status,'error');assert.equal(count,1);assert.ok(JSON.stringify(s.getMessages()).includes('Preserve me'));
    assert.match(events.find(e=>e.type==='error').message,/Mock network unavailable/);assert.equal((await s.prompt('Retry')).status,'complete');s.dispose();
});

test('AMD bundle runs real Pi with standard browser globals and creates no outside runtime globals',async()=>{
    const source=fs.readFileSync(path.resolve(__dirname,'../vendor/pico-1.4.0.amd.js'),'utf8');let factory;
    const sandbox={define:(_name,_deps,value)=>{factory=value;},TextEncoder,TextDecoder,performance,AbortController,setTimeout,clearTimeout,structuredClone,crypto:require('node:crypto').webcrypto};
    const keys=Object.keys(sandbox);vm.runInNewContext(source,sandbox);const api=factory();
    const s=api.createSession({requestText:async()=>envelope('Browser done')});assert.equal((await s.prompt('Browser turn')).status,'complete');s.dispose();
    assert.deepEqual(Object.keys(sandbox),keys);
});

test('Citrix HTTP 200 update_001 shape is accepted; only reuse or malformed fields reject it',async()=>{
    const {parseEnvelope}=await import('../ujg-ticket-assistant-chat/transport.mjs');
    const parameters={type:'object',properties:{fields:{type:'object',additionalProperties:true}},required:['fields'],additionalProperties:false};
    const tools=[{name:'update_task',parameters}],args={fields:{summary:'Восстановить RDP',description:'Среда DEV. Проверить вход.'}};
    const raw=JSON.stringify({text:'',toolCalls:[call('update_001','update_task',args)]});
    assert.deepEqual(parseEnvelope(raw,tools,new Set()).toolCalls[0].arguments,args);
    assert.throws(()=>parseEnvelope(raw,tools,new Set(['update_001'])),/Duplicate Pico tool call id/);
    assert.throws(()=>parseEnvelope(JSON.stringify({text:'',toolCalls:[call('update_001','update_task',{fields:[]})]}),tools,new Set()),/Invalid arguments/);
    assert.throws(()=>parseEnvelope(raw.slice(0,-1),tools,new Set()),/must be a JSON/);
});

function extractionContext() {
    return {draft:{projectKey:'DO',issueTypeId:'10',fields:{description:'Среда DEV'},questions:[]},
        fieldSchema:[{id:'description',kind:'textarea',fillable:true,writable:true},{id:'summary',kind:'string',fillable:true,writable:true,maxLength:255},
            {id:'components',kind:'components',fillable:true,writable:true,choices:[{id:'DO-9',label:'Backend'}]},
            {id:'assignee',kind:'user',fillable:false,writable:true}],generationFieldIds:['description','summary','components'],
        conversationForExtraction:[{role:'user',text:'Проверка: вход по RDP.'}]};
}
function extractionTool(execute) {
    return {name:'update_task',parameters:{type:'object',properties:{fields:{type:'object'},questions:{type:'array'}},required:['fields','questions'],additionalProperties:false},execute};
}
for(const bad of [
    {fields:{description:'Итог',foreign:'x'},missing:[]},
    {fields:{description:'Итог',components:[{id:'OTHER-9'}]},missing:[]},
    {fields:{description:'Итог',assignee:{id:'alice'}},missing:[]},
    {fields:{description:'Итог',summary:42},missing:[]},
    {fields:{description:'Итог'},missing:[{text:'Вопрос?',required:'false'}]},
    {fields:{description:'Итог'},missing:[],toolCalls:[]},
    {fields:[],missing:[]},
    {fields:{description:''},missing:[]}
])test('compact extraction rejects the entire invalid proposal before tool execution: '+JSON.stringify(bad),async()=>{
    const {createSession}=await runtime();let calls=0,executed=0;
    const s=createSession({draftExtractionPrompt:'Review draft',getContext:extractionContext,
        tools:[extractionTool(()=>{executed++;return {ok:true};})],requestText:async()=>({text:++calls===1?'```json\n{}\n```':JSON.stringify(bad)})});
    const result=await s.prompt('Проверка: вход по RDP.');
    assert.equal(result.status,'error');assert.equal(result.reason,'Pico response correction failed');
    assert.equal(calls,2);assert.equal(executed,0);assert.equal(result.usage.toolCalls,0);s.dispose();
});
for(const bounds of [{modelCalls:1},{toolCalls:1}])test('compact extraction obeys existing turn limits '+JSON.stringify(bounds),async()=>{
    const {createSession}=await runtime();let calls=0,executed=0;
    const s=createSession({draftExtractionPrompt:'Review draft',getContext:extractionContext,limits:bounds,
        afterStep:()=>({action:'end'}),tools:[extractionTool(()=>{executed++;return {ok:true};})],
        requestText:async()=>({text:++calls===1?'{}':JSON.stringify({fields:{description:'Проверка: вход по RDP.'},missing:[]})})});
    const result=await s.prompt('Проверка: вход по RDP.');assert.equal(result.status,bounds.modelCalls?'limit':'complete');
    assert.equal(calls,bounds.modelCalls?1:2);assert.equal(executed,bounds.modelCalls?0:1);s.dispose();
});

for(const mode of ['reserve','context','abort','stale'])test('compact extraction stops safely on '+mode,async()=>{
    const {createSession}=await runtime();let calls=0,executed=0;const gate=deferred(),reached=deferred();
    const s=createSession({draftExtractionPrompt:'Review draft',tokenBudget:{context:6000,reserve:600},
        getContext:()=>{if(mode==='stale' && calls===1)throw Error('stale');const state=extractionContext();if(mode==='context' && calls===1)state.template='x'.repeat(20000);return state;},
        tools:[extractionTool(()=>{executed++;return {ok:true};})],requestText:async()=>{
            if(++calls===1)return {text:'{}'};
            reached.resolve();if(mode==='abort')await gate.promise;
            return {text:mode==='reserve'?'я'.repeat(650):JSON.stringify({fields:{description:'Вход по RDP.'},missing:[]})};
        }});
    const pending=s.prompt('Вход по RDP.');
    if(mode==='abort'){await reached.promise;s.abort();gate.resolve();}
    const result=await pending;
    assert.equal(result.status,mode==='abort'?'aborted':mode==='stale'?'error':'limit');
    assert.equal(executed,0);assert.equal(result.usage.toolCalls,0);assert.equal(calls,['stale','context'].includes(mode)?1:2);s.dispose();
});

test('compact extraction cannot revive an old effort estimate as a new factual answer',async()=>{
    const {validateDraftFields}=await import('../ujg-ticket-assistant-chat/transport.mjs');
    const state=extractionContext();state.conversationForReview=state.conversationForExtraction;
    state.fieldSchema.push({id:'timetracking',kind:'timetracking',fillable:true,writable:true});state.generationFieldIds.push('timetracking');
    assert.throws(()=>validateDraftFields({description:'Вход по RDP.',timetracking:{originalEstimate:'2h'}},state),/Invalid draft field/);
    state.extractionEstimates={originalEstimate:'2h'};
    assert.doesNotThrow(()=>validateDraftFields({description:'Вход по RDP.',timetracking:{originalEstimate:'2h'}},state));
});

test('recovery labels use token boundaries rather than substrings',async()=>{
    const {validateDraftFields}=await import('../ujg-ticket-assistant-chat/transport.mjs'),state=extractionContext();
    state.conversationForReview=[{role:'user',text:'Use latest release, label test-run.'}];
    state.fieldSchema.push({id:'labels',kind:'labels',fillable:true,writable:true});state.generationFieldIds.push('labels');
    assert.throws(()=>validateDraftFields({description:'Release',labels:['test']},state),/Invalid draft field/);
    assert.doesNotThrow(()=>validateDraftFields({description:'Release',labels:['test-run']},state));
});

test('nested missing normalization refuses metadata fields, conflicting envelopes and command siblings',async()=>{
    const {parseDraftData}=await import('../ujg-ticket-assistant-chat/transport.mjs');
    const nested={fields:{description:'Итог',missing:[]}};
    assert.deepEqual(parseDraftData(JSON.stringify(nested),[]),{fields:{description:'Итог'},missing:[]});
    for(const value of [nested,{...nested,missing:[]},{...nested,toolCalls:[]},{fields:{description:'Итог',missing:'bad'}}]) {
        const schema=value===nested?[{id:'missing'}]:[];
        assert.deepEqual(parseDraftData(JSON.stringify(value),schema),value);
    }
});
