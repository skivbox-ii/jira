const test=require('node:test');
const assert=require('node:assert/strict');
const runtime=()=>import('../ujg-ticket-assistant-chat/runtime.mjs');
const clone=value=>JSON.parse(JSON.stringify(value));
const prose='Спасибо, изменения зафиксировал. Окно и проверка сохранены.';
const turn='Окно с 18:00 до 19:00. QA проверит HTTP 200 на /health. Приоритет высокий, срок 20.11.2026.';
const patch={fields:{priority:{id:'2'},duedate:'2026-11-20'},descriptionSections:{window:'С 18:00 до 19:00.',verification:'QA проверит HTTP 200 на /health.'}};
function state(project='DEVOPS') {
    return {draft:{projectKey:project,issueTypeId:'12',templateId:'deployment',fields:{summary:'Ручная тема demo-api',description:'Среда: DEV.\n\nОкно: Рабочие часы.',priority:{id:'3'}},protectedFields:{summary:true},pendingFields:{},questions:[],taskExceptions:[],userFieldsPresent:{reporter:true}},
        issueType:{id:'12',name:'Задача развертывания'},template:{template:{id:'deployment',instructions:'Укажи среду, версию, окно и проверяющего.'},profileInstructions:'Сохрани факты и ручные поля.',revision:4},
        fieldSchema:[{id:'summary',kind:'string',fillable:true,writable:true,maxLength:255},{id:'description',kind:'textarea',fillable:true,writable:true},
            {id:'priority',kind:'option',fillable:true,writable:true,choices:[{id:'2',label:'Высокий'},{id:'3',label:'Обычный'}],choicesComplete:true},
            {id:'duedate',kind:'date',fillable:true,writable:true},{id:'assignee',kind:'user',fillable:false,writable:true}],
        generationFieldIds:['summary','description','priority','duedate'],descriptionSectionDefinitions:[{id:'window',label:'Окно',required:true,question:'Какое окно?'},{id:'verification',label:'Проверка',required:true,question:'Кто проверит?'}],descriptionSectionIds:['window','verification'],
        validation:{ok:false,fieldErrors:{description:['Нужно окно и проверка.']}},
        conversationForTask:[{role:'assistant',text:'OLD_ASSISTANT_SENTINEL'}],privateDirectory:'DIRECTORY_SENTINEL',transportConfig:'SECRET_SENTINEL'};
}
function updateTool(execute) {return {name:'update_task',description:'Apply selected Jira fields and description sections',parameters:{type:'object',properties:{fields:{type:'object'},descriptionSections:{type:'object'},questions:{type:'array'}},additionalProperties:false},execute};}
const readTool=name=>({name,description:'Normal actor capability '+name,parameters:{type:'object',properties:{},additionalProperties:false},execute:()=>({ok:true})});
const envelope=(text='',toolCalls=[])=>({text:JSON.stringify({text,toolCalls})});
const call=(id,name,args={})=>({id,name,arguments:args});
const correctionStep=step=>step.hasTools?{action:'end'}:{action:'continue'};
for(const project of ['DEVOPS','APP'])test('managed '+project+' prose correction sends fresh scoped data prompts instead of repeating the actor dialogue',async()=>{
    const {createSession}=await runtime(),current=state(project),requests=[],updates=[];let reads=0;
    const s=createSession({system:'FULL_ACTOR_INSTRUCTIONS_SENTINEL',appManagedPatch:true,allowPlainTextFinal:true,limits:{modelCalls:2},afterStep:correctionStep,
        messages:[{role:'user',content:'OLD_USER_SENTINEL'},{role:'assistant',content:[{type:'text',text:'OLD_ASSISTANT_SENTINEL'}]}],
        getContext:()=>{reads++;return current;},tools:[readTool('get_task'),readTool('read_template'),readTool('find_options'),updateTool(args=>{updates.push(args);return {ok:true,appliedFields:['priority','duedate'],appliedSections:['window','verification']};})],
        requestText:async request=>{requests.push(request);if(request.system.includes('Available tools (JSON Schema)')){current.draft.fields.priority={id:'2'};return {text:prose};}return {text:JSON.stringify(patch)};}});
    try {
        const result=await s.prompt(turn);assert.equal(result.status,'complete');assert.equal(requests.length,2);assert.equal(reads,2);assert.deepEqual(updates,[patch]);
        assert.equal(result.usage.modelCalls,2);assert.equal(result.usage.toolCalls,1);
        assert.match(requests[0].system,/FULL_ACTOR_INSTRUCTIONS_SENTINEL/);for(const name of ['get_task','read_template','find_options','update_task'])assert.ok(requests[0].system.includes(name));
        const retry=requests[1],data=JSON.parse(retry.user);assert.equal(data.currentTurn,turn);assert.equal(data.scope.project,project);assert.equal(data.scope.type,'12');
        assert.deepEqual(data.fields,current.fieldSchema.filter(f=>f.fillable && f.writable));assert.deepEqual(data.descriptionSections,current.descriptionSectionDefinitions);
        assert.deepEqual(data.current.priority,{id:'2'});assert.deepEqual(data.protected,{summary:true});assert.deepEqual(data.template,current.template);
        assert.match(retry.system,/fields/);assert.match(retry.system,/descriptionSections/);assert.match(retry.system,/only.*changed|changed.*only/i);
        assert.doesNotMatch(retry.system+'\n'+retry.user,/Available tools|FULL_ACTOR_INSTRUCTIONS_SENTINEL|OLD_USER_SENTINEL|OLD_ASSISTANT_SENTINEL|DIRECTORY_SENTINEL|SECRET_SENTINEL|Спасибо, изменения/);
        assert.equal(Object.hasOwn(data,'messages'),false);assert.equal(Object.hasOwn(data,'userAnswers'),false);
    } finally {s.dispose();}
});
for(const reply of [prose,'```json\n{"fields":{"summary":"unsafe"}}\n```',JSON.stringify({fields:{priority:{id:'foreign'}}}),JSON.stringify({fields:{assignee:{name:'invented'}}}),JSON.stringify({fields:{foreign:'unsafe'}}),JSON.stringify({descriptionSections:{foreign:'unsafe'}}),JSON.stringify({fields:{summary:'unsafe'},missing:[]}),JSON.stringify({fields:{summary:'unsafe'},questions:[]}),JSON.stringify({text:'',toolCalls:[call('unsafe','update_task',{fields:{summary:'unsafe'}})]}),'{"fields":{"summary":"unsafe","__proto__":{}}}',JSON.stringify({fields:{},descriptionSections:{}})])test('managed corrective data rejects unsupported output atomically: '+reply,async()=>{
    const {createSession}=await runtime(),requests=[];let executed=0;
    const current=state();current.conversationForExtraction=[{role:'user',text:turn}];
    const s=createSession({appManagedPatch:true,allowPlainTextFinal:true,draftExtractionPrompt:'Legacy extraction must not salvage the corrective answer.',getContext:()=>current,afterStep:correctionStep,
        tools:[updateTool(()=>{executed++;return {ok:true};})],requestText:async request=>{requests.push(request);return {text:requests.length===1?prose:reply};}});
    try {const result=await s.prompt(turn);assert.equal(result.status,'error');assert.equal(result.reason,'Pico draft update missing');assert.equal(requests.length,2);assert.equal(executed,0);assert.equal(result.usage.toolCalls,0);assert.doesNotMatch(requests[1].system,/Available tools/);}finally{s.dispose();}
});
test('normal managed actor keeps lookup and template capabilities before a usable task patch',async()=>{
    const {createSession}=await runtime(),requests=[],executed=[];
    const tools=['get_task','find_options','read_template'].map(name=>({...readTool(name),execute:()=>{executed.push(name);return {ok:true};}}));
    tools.push(updateTool(()=>{executed.push('update_task');return {ok:true,appliedFields:['priority']};}));
    const replies=[...['get_task','find_options','read_template'].map((name,i)=>envelope('',[call('normal_'+i,name)])),{text:JSON.stringify({fields:{priority:{id:'2'}}})}];
    const s=createSession({appManagedPatch:true,allowPlainTextFinal:true,getContext:()=>state(),tools,afterStep:step=>{if(executed.at(-1)==='update_task')return {action:'end'};},requestText:async request=>{requests.push(request);return replies.shift();}});
    try {const result=await s.prompt(turn);assert.equal(result.status,'complete');assert.deepEqual(executed,['get_task','find_options','read_template','update_task']);assert.equal(requests.length,4);assert.ok(requests.every(r=>r.system.includes('Available tools (JSON Schema)')));}finally{s.dispose();}
});
for(const managed of [false,true])test('ordinary prose stays conversational when no managed correction is requested: '+managed,async()=>{
    const {createSession}=await runtime(),requests=[];const s=createSession({appManagedPatch:managed,allowPlainTextFinal:true,getContext:()=>state(),tools:[readTool('read_template')],afterStep:()=>({action:'end'}),requestText:async request=>{requests.push(request);return {text:prose};}});
    try {assert.equal((await s.prompt('Покажи шаблон')).status,'complete');assert.equal(requests.length,1);assert.match(requests[0].system,/Available tools/);}finally{s.dispose();}
});
test('explicit reconciliation retains its existing fields/missing protocol',async()=>{
    const {createSession}=await runtime(),current=state(),requests=[],updates=[];current.conversationForReview=[{role:'user',text:turn}];
    const s=createSession({appManagedPatch:true,draftReviewPrompt:'EXPLICIT_REVIEW_SENTINEL',getContext:()=>current,afterStep:()=>({action:'end'}),tools:[{name:'update_task',parameters:{type:'object',properties:{fields:{type:'object'},questions:{type:'array'}},required:['fields','questions'],additionalProperties:false},execute:args=>{updates.push(args);return {ok:true};}}],requestText:async request=>{requests.push(request);return {text:JSON.stringify({fields:{description:current.draft.fields.description},missing:[]})};}});
    try {assert.equal((await s.prompt(turn)).status,'complete');assert.equal(requests.length,1);assert.match(requests[0].system,/EXPLICIT_REVIEW_SENTINEL/);assert.equal(Object.hasOwn(JSON.parse(requests[0].user),'userAnswers'),true);assert.deepEqual(updates,[{fields:{description:current.draft.fields.description},questions:[]}]);}finally{s.dispose();}
});
test('an unchanged reported update is not a usable patch and receives the scoped correction',async()=>{
    const {createSession}=await runtime(),current=state(),requests=[],updates=[];
    const s=createSession({appManagedPatch:true,allowPlainTextFinal:true,getContext:()=>current,
        tools:[updateTool(args=>{updates.push(args);Object.assign(current.draft.fields,args.fields);return {ok:true,appliedFields:Object.keys(args.fields),appliedSections:[],task:{draft:clone(current.draft)}};})],
        afterStep:()=>updates.length===2?{action:'end'}:{action:'continue'},
        requestText:async request=>{requests.push(request);return {text:JSON.stringify({fields:{priority:{id:requests.length===1?'3':'2'}}})};}});
    try {const result=await s.prompt('Приоритет высокий.');assert.equal(result.status,'complete');assert.equal(requests.length,2);assert.doesNotMatch(requests[1].system,/Available tools/);assert.equal(JSON.parse(requests[1].user).currentTurn,'Приоритет высокий.');assert.equal(current.draft.fields.priority.id,'2');}finally{s.dispose();}
});
test('continuation after a usable patch preserves the actor protocol instead of starting correction',async()=>{
    const {createSession}=await runtime(),requests=[];let steps=0;
    const s=createSession({appManagedPatch:true,allowPlainTextFinal:true,getContext:()=>state(),tools:[updateTool(()=>({ok:true,appliedFields:['priority']}))],afterStep:()=>++steps===1?{action:'continue'}:{action:'end'},requestText:async request=>{requests.push(request);return requests.length===1?{text:JSON.stringify({fields:{priority:{id:'2'}}})}:envelope('Прочитано.');}});
    try {const result=await s.prompt(turn);assert.equal(result.status,'complete');assert.equal(requests.length,2);assert.ok(requests.every(r=>r.system.includes('Available tools (JSON Schema)')));}finally{s.dispose();}
});
for(const mode of ['model','reserve','context','abort','stale'])test('managed correction preserves existing '+mode+' guards with no late write',async()=>{
    const {createSession}=await runtime(),current=state(),requests=[];let reads=0,executed=0,release,started;
    const gate=new Promise(resolve=>{release=resolve;}),reached=new Promise(resolve=>{started=resolve;});
    const s=createSession({appManagedPatch:true,allowPlainTextFinal:true,afterStep:correctionStep,limits:mode==='model'?{modelCalls:1}:{},tokenBudget:{context:16000,reserve:1000},
        getContext:()=>{if(++reads===2){if(mode==='stale')throw Error('stale');if(mode==='context')current.template.instructions='x'.repeat(80000);}return current;},
        tools:[updateTool(()=>{executed++;return {ok:true};})],requestText:async request=>{requests.push(request);if(requests.length===1)return {text:prose};started();if(mode==='abort')await gate;return {text:mode==='reserve'?'я'.repeat(1001):JSON.stringify(patch)};}});
    try {
        const pending=s.prompt(turn);if(mode==='abort'){await reached;s.abort();release();}
        const result=await pending;assert.equal(result.status,mode==='abort'?'aborted':mode==='stale'?'error':'limit');assert.equal(executed,0);
        assert.equal(requests.length,['model','context','stale'].includes(mode)?1:2);assert.equal(result.usage.toolCalls,0);
        if(mode==='model')assert.match(result.reason,/model call limit/);if(mode==='reserve')assert.match(result.reason,/response reserve/);if(mode==='context')assert.match(result.reason,/context limit/);if(mode==='stale')assert.match(result.reason,/stale/);
    } finally {release();s.dispose();}
});
test('a compact correction still consumes the existing total tool-call budget',async()=>{
    const {createSession}=await runtime(),requests=[];let writes=0;
    const s=createSession({appManagedPatch:true,allowPlainTextFinal:true,limits:{toolCalls:1},getContext:()=>state(),afterStep:()=>({action:'continue'}),tools:[readTool('get_task'),updateTool(()=>{writes++;return {ok:true};})],requestText:async request=>{requests.push(request);return requests.length===1?envelope('',[call('read','get_task')]):{text:JSON.stringify(patch)};}});
    try {const result=await s.prompt(turn);assert.equal(result.status,'limit');assert.match(result.reason,/tool call limit/);assert.equal(requests.length,2);assert.equal(writes,0);assert.equal(result.usage.toolCalls,1);}finally{s.dispose();}
});
test('a second unusable patch fails the bounded corrective turn instead of repeating either prompt',async()=>{
    const {createSession}=await runtime(),current=state(),requests=[];
    const s=createSession({appManagedPatch:true,allowPlainTextFinal:true,getContext:()=>current,afterStep:()=>({action:'continue'}),tools:[updateTool(()=>({ok:true,appliedFields:['priority'],task:{draft:clone(current.draft)}}))],requestText:async request=>{requests.push(request);return {text:requests.length===1?prose:JSON.stringify({fields:{priority:{id:'3'}}})};}});
    try {const result=await s.prompt(turn);assert.equal(result.status,'error');assert.match(result.reason,/Pico draft update missing/);assert.equal(requests.length,2);assert.equal(result.usage.toolCalls,1);}finally{s.dispose();}
});
test('repeated unusable real-runtime output reports failure without inventing model-written fields',async t=>{
    const {harness}=require('./helpers/ticket-assistant-chat-fixture'),{loadUnit}=require('./helpers/ticket-assistant-fixture');
    const h=await harness(),c=h.controller,original=h.api.getCreateMeta;const actual=await runtime();
    h.api.getProjects=async()=>({values:[{key:'DEVOPS',id:'DO-project',name:'DEVOPS'}]});
    h.api.getCreateMeta=async key=>{const m=await original(key);m.projects[0].issuetypes.forEach(type=>{type.fields.priority={name:'Приоритет',schema:{type:'priority',system:'priority'},hasDefaultValue:true,defaultValue:{id:'medium'},allowedValues:[{id:'medium',name:'Средний'},{id:'high',name:'Высокий'}]};});return m;};
    h.api.checkDevopsIssue=async()=>({fieldErrors:{},warnings:[],link:null});let posts=0;h.api.createIssue=async()=>{posts++;throw Error('Must not create');};
    await c.init();await c.selectProject('DEVOPS');await c.selectIssueType('12');
    await c.chatUpdate({fields:{summary:'Обновить demo-api в DEV',description:'Среда: DEV, demo-api.\n\nВерсия и состав: demo-api версии 1.0 из тега v1.0.\n\nПорядок: Поменять образ и перезапустить сервис.\n\nОкно: Рабочие часы.\n\nПроверка: Постановщик проверит HTTP 200 на /health.\n\nСсылки: Ссылки на репозиторий нет.',priority:{id:'medium'}},questions:[]},c.chatSnapshot());await c.chatValidate(c.chatSnapshot());
    const Chat=loadUnit('chat',{_ujgTA_chatTools:loadUnit('chat-tools',{_ujgTA_fields:h.fields}),_ujgTA_draft:h.drafts},{AbortController}),requests=[];
    const chat=Chat.create({controller:c,store:h.store,runtime:actual,requestText:async request=>{requests.push(request);return {text:prose};}});t.after(()=>{chat.destroy();c.destroy();});
    const answer='Окно развёртывания с 19:00 до 20:00. Приоритет высокий. Дежурный проверит HTTP 200 на /health.';
    await chat.send(answer);const s=c.getState(),reply=chat.getState().transcript.at(-1).text;
    assert.equal(requests.length,2);assert.doesNotMatch(requests[1].system,/Available tools/);assert.equal(JSON.parse(requests[1].user).currentTurn,answer);
    assert.ok(chat.getState().error);assert.equal(chat.getState().lastTurnUsage.toolCalls,0);assert.equal(s.draft.fields.priority.id,'medium');assert.doesNotMatch(s.draft.fields.description,/19:00 до 20:00/);assert.match(s.draft.fields.description,/Поменять образ и перезапустить сервис/);
    assert.equal(s.draft.checked,null);assert.ok(s.validation.questions.some(q=>q.id==='devops:links'));assert.equal(chat.getState().error.action,'retry');assert.doesNotMatch(reply,/Спасибо, изменения зафиксировал|модель.*заполнила/);assert.equal(posts,0);
});
test('compact correction exposes only selected automatic fields and never invites an excluded description edit',async()=>{
    const {createSession}=await runtime(),current=state(),requests=[];current.generationFieldIds=['priority'];current.fieldSchema.forEach(f=>{f.fillable=f.id==='priority';});
    const s=createSession({appManagedPatch:true,allowPlainTextFinal:true,getContext:()=>current,afterStep:correctionStep,tools:[updateTool(()=>({ok:true,appliedFields:['priority']}))],requestText:async request=>{requests.push(request);return {text:requests.length===1?prose:JSON.stringify({fields:{priority:{id:'2'}}})};}});
    try {assert.equal((await s.prompt('Приоритет высокий.')).status,'complete');const data=JSON.parse(requests[1].user);assert.deepEqual(data.fields.map(f=>f.id),['priority']);assert.deepEqual(data.descriptionSections,[]);assert.deepEqual(data.protected,{summary:true});}finally{s.dispose();}
});
