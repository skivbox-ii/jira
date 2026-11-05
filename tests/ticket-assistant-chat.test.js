const test=require('node:test');
const assert=require('node:assert/strict');
const {loadUnit}=require('./helpers/ticket-assistant-fixture');
const {harness}=require('./helpers/ticket-assistant-chat-fixture');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function setup(prompt) {
    const h=await harness(),sessions=[];
    const runtime={createSession(config) {
        const session={config,aborted:false,disposed:false,messages:[...config.messages],
            async prompt(text) {this.messages.push({role:'user',content:text});await prompt?.(config,this,text);},
            abort(){this.aborted=true;},dispose(){this.disposed=true;},getMessages(){return this.messages;}};
        sessions.push(session);return session;
    }};
    const Tools=loadUnit('chat-tools',{_ujgTA_fields:h.fields});
    const Chat=loadUnit('chat',{_ujgTA_chatTools:Tools,_ujgTA_draft:h.drafts},{AbortController});
    const changes=[];
    const chat=Chat.create({controller:h.controller,runtime,store:h.store,requestText:async()=>{throw Error('No live');},onChange:s=>changes.push(s)});
    return {...h,Chat,runtime,sessions,chat,changes};
}

test('primary task chat keeps list_fields, envelope final and later Russian prose without mutating task',async()=>{
    const runtime=await import('../ujg-ticket-assistant-chat/runtime.mjs');
    const h=await setup();h.chat.destroy();
    await h.controller.updateField('summary','Ручное название');
    const before=JSON.stringify(h.controller.getState().draft), requests=[];
    const prose='Известные факты:\n1. Ошибка запуска (DEV, TEST, PREPROD).\nИнструменты: ["update_task"]';
    const answers=[JSON.stringify({text:'Проверяю доступные поля',toolCalls:[{id:'fields',name:'list_fields',arguments:{}}]}),
        JSON.stringify({text:'Как воспроизвести ошибку?',toolCalls:[]}), prose];
    const chat=h.Chat.create({controller:h.controller,runtime,store:h.store,requestText:async r=>{requests.push(r);return {text:answers.shift()};}});
    await chat.send('Покажи поля'); assert.equal(chat.getState().error,null);
    await chat.send('Поясни, какие поля доступны.');
    assert.equal(chat.getState().error,null);assert.equal(chat.getState().status,'idle');
    assert.equal(chat.getState().transcript.at(-1).text,prose);
    assert.equal(JSON.stringify(h.controller.getState().draft),before);assert.equal(requests.length,3);
    assert.equal(chat.getState().lastTurnUsage.toolCalls,0);
    chat.destroy();
    const restored=h.Chat.create({controller:h.controller,runtime,store:h.store});
    assert.equal(restored.getState().transcript.at(-1).text,prose);restored.destroy();
});

test('real task chat applies known fields before final and preserves manual summary on later updates',async()=>{
    const runtime=await import('../ujg-ticket-assistant-chat/runtime.mjs');
    const h=await setup();h.chat.destroy();let n=0;
    const chat=h.Chat.create({controller:h.controller,runtime,store:h.store,requestText:async r=>{
        n++;
        if(n===1 || n===3) return {text:JSON.stringify({text:'',toolCalls:[{id:'write'+n,name:'update_task',arguments:{fields:{summary:'Ошибка запуска',description:n===1?'Приложение не запускается':'Ошибка повторяется'},questions:[]}}]})};
        const state=h.controller.getState();
        assert.equal(state.draft.fields.summary,n===2?'Ошибка запуска':'Ручное название');
        assert.equal(state.draft.fields.description,n===2?'Приложение не запускается':'Ошибка повторяется');
        assert.match(r.user,/toolResult/);return {text:'Когда впервые появилась ошибка?'};
    }});
    await chat.send('Приложение не запускается');assert.equal(chat.getState().error,null);
    await h.controller.updateField('summary','Ручное название');
    await chat.send('Ошибка повторяется');assert.equal(chat.getState().error,null);assert.equal(n,4);chat.destroy();
});

test('real task chat template read plus plain final preserves the canonical draft',async()=>{
    const runtime=await import('../ujg-ticket-assistant-chat/runtime.mjs');
    const h=await setup();h.chat.destroy();let n=0;const before=JSON.stringify(h.controller.getState().draft);
    const chat=h.Chat.create({controller:h.controller,runtime,store:h.store,requestText:async()=>({text:++n===1?
        JSON.stringify({text:'',toolCalls:[{id:'read',name:'read_template',arguments:{}}]}):'Шаблон показан выше.'})});
    await chat.send('Покажи шаблон');assert.equal(chat.getState().error,null);
    assert.ok(chat.getState().transcript.some(m=>m.kind==='template'));
    assert.equal(JSON.stringify(h.controller.getState().draft),before);chat.destroy();
});

for(const correction of ['valid','malformed','changed','prose']) test('primary chat safely corrects misplaced call_6 questions: '+correction,async()=>{
    const runtime=await import('../ujg-ticket-assistant-chat/runtime.mjs');
    const h=await setup();h.chat.destroy();let n=0;
    const before=JSON.stringify(h.controller.getState().draft);
    const misplaced={text:'',toolCalls:[{id:'call_6',name:'update_task',arguments:{fields:{summary:'Ошибка запуска',description:'Приложение не запускается'}},questions:[{id:'q1',text:'Когда появилась ошибка?',required:true}]}]};
    const fixed=JSON.parse(JSON.stringify(misplaced));fixed.toolCalls[0].arguments.questions=fixed.toolCalls[0].questions;delete fixed.toolCalls[0].questions;
    if(correction==='changed')fixed.toolCalls[0].arguments.fields.summary='Другое значение';
    const chat=h.Chat.create({controller:h.controller,runtime,store:h.store,requestText:async()=>{
        n++;if(n===2)assert.equal(JSON.stringify(h.controller.getState().draft),before);
        return {text:n===1?JSON.stringify(misplaced):n===2?(correction==='malformed'?JSON.stringify(misplaced):correction==='prose'?'Когда появилась ошибка?':JSON.stringify(fixed)):'Когда появилась ошибка?'};
    }});
    await chat.send('Приложение не запускается');
    if(correction==='valid') {
        assert.equal(chat.getState().error,null);assert.equal(n,3);
        const d=h.controller.getState().draft;assert.equal(d.fields.summary,'Ошибка запуска');assert.equal(d.fields.description,'Приложение не запускается');
        assert.equal(d.questions[0].text,'Когда появилась ошибка?');assert.equal(chat.getState().lastTurnUsage.toolCalls,1);
    } else {
        assert.equal(chat.getState().error.code,'response-repair');assert.equal(chat.getState().error.action,'retry');
        assert.match(chat.getState().error.message,/Повторить/);assert.equal(n,2);
        assert.equal(chat.getState().transcript.length,1);assert.equal(JSON.stringify(h.controller.getState().draft),before);
    }
    chat.destroy();
});

for(const bad of ['Ответ\n{"toolCalls":', 'update_task(summary="Changed")',
    JSON.stringify({text:'Нельзя показывать частичный ответ',toolCalls:[{id:'good',name:'update_task',arguments:{fields:{summary:'Changed'}}},{id:'bad',name:'unknown',arguments:{}}]})]) {
    test('primary task chat rejects malformed output without transcript or task partial effects: '+bad.slice(0,35),async()=>{
        const runtime=await import('../ujg-ticket-assistant-chat/runtime.mjs');
        const h=await setup();h.chat.destroy();let n=0;const before=JSON.stringify(h.controller.getState().draft);
        const chat=h.Chat.create({controller:h.controller,runtime,store:h.store,requestText:async()=>{n++;return {text:bad};}});
        await chat.send('Проверка');assert.equal(chat.getState().status,'error');assert.equal(chat.getState().error.code,'response');
        assert.equal(chat.getState().transcript.length,1);assert.equal(n,1);
        assert.equal(JSON.stringify(h.controller.getState().draft),before);chat.destroy();
    });
}
test('chat tools progressively fill one canonical task, preserve source and unlock existing creator',async()=>{
    const h=await setup(async(c,s,text)=>{
        await c.tools.find(t=>t.name==='update_task').execute({fields:{summary:'Investigate failure',description:'Production service is unavailable; restore access.'},questions:[]},{});
        await c.tools.find(t=>t.name==='validate_task').execute({},{});
        c.onEvent({type:'assistant',text:'Ready'});s.messages.push({role:'assistant',content:[{type:'text',text:'Ready'}]});c.onEvent({type:'done',status:'completed'});
    });
    await h.chat.send('Production failure');
    assert.equal(h.chat.getState().status,'idle');assert.equal(h.chat.getState().transcript.at(-1).text,'Ready');
    assert.equal(h.controller.getState().draft.fields.summary,'Investigate failure');assert.ok(h.controller.getState().draft.checked);
    assert.match(h.controller.getState().draft.source,/Production failure/);assert.equal(h.chat.getState().canUndo,true);
    assert.equal(h.sessions[0].config.requestText instanceof Function,true);
});
test('manual edits, selection changes, stop and destroy make late events and tools inert',async()=>{
    for(const action of [h=>h.controller.updateField('summary','Human'),h=>h.controller.selectProject('APP'),h=>h.controller.selectTemplate('bug'),h=>h.controller.newDraft(),h=>h.chat.stop(),h=>h.chat.destroy()]) {
        const wait=deferred();let config;
        const h=await setup(async c=>{config=c;await wait.promise;});const pending=h.chat.send('Keep input');
        for(let i=0;i<8&&!config;i++) await Promise.resolve();assert.ok(config);
        await action(h);assert.equal(h.sessions[0].aborted,true);
        config.onEvent({type:'assistant',text:'STALE'});
        assert.throws(()=>config.getContext());
        await assert.rejects(config.tools.find(t=>t.name==='update_task').execute({fields:{summary:'STALE'}},{}));
        wait.resolve();await pending;assert.equal(JSON.stringify(h.chat.getState()).includes('STALE'),false);
    }
});
test('restored transcript does not start a runtime and conflicts keep local text',async()=>{
    const h=await setup(async c=>c.onEvent({type:'assistant',text:'Question?'}));await h.chat.send('Facts');h.chat.destroy();
    const sessionsBefore=h.sessions.length;
    const restored=h.Chat.create({controller:h.controller,runtime:h.runtime,store:h.store});
    assert.equal(h.sessions.length,sessionsBefore);assert.equal(restored.getState().transcript[0].text,'Facts');
    const stale=h.Chat.create({controller:h.controller,runtime:h.runtime,store:h.store});
    await restored.send('Second');await stale.send('Local conflict');
    assert.equal(stale.getState().transcript.some(m=>m.text==='Local conflict'),true);assert.ok(stale.getState().storageWarning);
});
test('template reads are exact and proposals require explicit apply, stale proposals remain visible',async()=>{
    const h=await setup(async c=>{
        await c.tools.find(t=>t.name==='read_template').execute({},{});
        await c.tools.find(t=>t.name==='propose_template_change').execute({changes:{instructions:'  Revised\nexact\n'}},{});
    });
    const before=h.controller.chatReadTemplate().template.instructions;await h.chat.send('Change rules');
    assert.equal(h.controller.chatReadTemplate().template.instructions,before);assert.ok(h.chat.getState().transcript.some(m=>m.text.includes(before)));
    assert.equal(h.chat.getState().pendingTemplateProposal.after.instructions,'  Revised\nexact\n');
    await h.chat.applyTemplateProposal();assert.equal(h.controller.chatReadTemplate().template.instructions,'  Revised\nexact\n');
    await h.chat.send('Change again');await h.controller.updateField('summary','Human');await h.chat.applyTemplateProposal();
    assert.ok(h.chat.getState().error);assert.ok(h.chat.getState().pendingTemplateProposal);
    h.chat.rejectTemplateProposal();assert.equal(h.chat.getState().pendingTemplateProposal,null);
});
test('errors, limits and compaction remain visible and sent text survives',async()=>{
    const h=await setup(async c=>{c.onEvent({type:'compaction',removedMessages:4,message:'Older turns compacted'});c.onEvent({type:'limit',reason:'context',message:'Budget reached'});throw Error('PRIVATE transport payload');});
    await h.chat.send('Retry this');const state=h.chat.getState();
    assert.equal(state.status,'error');assert.equal(state.transcript[0].text,'Retry this');assert.ok(state.notices.length);
    assert.equal(JSON.stringify(state).includes('PRIVATE'),false);
});

test('double send cannot start overlapping sessions and controller destruction aborts work',async()=>{
    const wait=deferred();const h=await setup(async()=>wait.promise);
    const a=h.chat.send('First'),b=h.chat.send('Second');await Promise.resolve();await Promise.resolve();
    assert.equal(h.sessions.length,1);assert.equal(h.chat.getState().transcript.filter(m=>m.role==='user').length,1);
    await h.controller.destroy();assert.equal(h.sessions[0].aborted,true);wait.resolve();await Promise.all([a,b]);
    await h.chat.send('After controller destruction');assert.equal(h.sessions.length,1);
});
test('project revisits preserve unsaved local conversation after an external conflict',async()=>{
    const h=await setup();await h.chat.send('Original');
    const d=h.controller.getState().draft, external=h.store.loadConversation('DO',d.id);
    h.store.saveConversation('DO',d.id,{transcript:[],messages:[]},external.revision);
    await h.chat.send('Unsaved local');assert.ok(h.chat.getState().storageWarning);
    await h.controller.selectProject('APP');await h.controller.selectProject('DO');
    assert.ok(h.chat.getState().transcript.some(m=>m.text==='Unsaved local'));
});

test('real Pi runtime executes domain tools against scripted text transport and restores without replay',async()=>{
    const {pathToFileURL}=require('node:url');const path=require('node:path');
    const runtime=await import(pathToFileURL(path.resolve(__dirname,'../ujg-ticket-assistant-chat/runtime.mjs')).href);
    const h=await setup();h.chat.destroy();let requests=0;
    const responses=[{text:'',toolCalls:[{id:'real_1',name:'update_task',arguments:{fields:{summary:'Scripted task',description:'Check the service against the supplied task facts.'},questions:[]}}]},
        {text:'',toolCalls:[{id:'real_2',name:'validate_task',arguments:{}}]},{text:'Ready from Pi',toolCalls:[]}];
    const requestText=async request=>{assert.ok(request.signal);assert.match(request.system,/Pico/);requests++;return {text:JSON.stringify(responses.shift())};};
    const chat=h.Chat.create({controller:h.controller,runtime,store:h.store,requestText});await chat.send('Facts for actual Pi');
    assert.equal(chat.getState().error,null);assert.ok(h.controller.getState().draft.checked);assert.equal(chat.getState().transcript.at(-1).text,'Ready from Pi');assert.equal(requests,3);
    chat.destroy();const restored=h.Chat.create({controller:h.controller,runtime,store:h.store,requestText});assert.equal(requests,3);
    assert.equal(restored.getState().transcript.at(-1).text,'Ready from Pi');restored.destroy();
});

test('template-only read and proposal preserve canonical source, fields, checked state and revisions',async()=>{
    const h=await setup(async c=>{
        await c.tools.find(t=>t.name==='read_template').execute({},{});
        await c.tools.find(t=>t.name==='propose_template_change').execute({changes:{instructions:'Explicit proposal'}},{});
    });
    await h.controller.updateSource('Task facts');await h.controller.updateField('summary','Ready');await h.controller.updateField('description','Check the service against the task facts.');await h.controller.chatValidate(h.controller.chatSnapshot());
    const before=JSON.stringify(h.controller.getState().draft);
    await h.chat.send('Покажи шаблон');assert.equal(JSON.stringify(h.controller.getState().draft),before);
    await h.chat.send('Измени шаблон');assert.equal(JSON.stringify(h.controller.getState().draft),before);
    await h.chat.applyTemplateProposal();assert.notEqual(JSON.stringify(h.controller.getState().draft),before);
    assert.equal(h.controller.getState().draft.source,'Task facts');
});
test('task source appends the current task turn once even if several task tools execute',async()=>{
    const h=await setup(async c=>{const update=c.tools.find(t=>t.name==='update_task');
        await update.execute({fields:{summary:'Task'}},{});await update.execute({fields:{description:'More facts'}},{});
    });await h.controller.updateSource('Original');await h.chat.send('New facts');
    assert.equal(h.controller.getState().draft.source,'Original\n\nNew facts');
});

test('exact template transcript entries preserve literal text and template rendering kind after reload',async()=>{
    const h=await setup(async c=>c.tools.find(t=>t.name==='read_template').execute({},{}));
    const instructions='  **literal bold**\n`literal code` [literal link](https://example.test)\n<img src=x onerror="bad()">\n';
    const settings=h.controller.getState().settings;settings.profiles[0].templates[0].instructions=instructions;
    await h.controller.applySettings(settings);await h.chat.send('Покажи шаблон');
    const entry=h.chat.getState().transcript.find(m=>m.role==='assistant');
    assert.equal(entry.kind,'template');assert.equal(entry.text,'Задача\nТип Jira: не привязан\n\n'+instructions);
    assert.equal(h.chat.getState().transcript[0].kind,undefined);
    h.chat.destroy();const restored=h.Chat.create({controller:h.controller,runtime:h.runtime,store:h.store});
    const recovered=restored.getState().transcript.find(m=>m.id===entry.id);
    assert.equal(recovered.kind,'template');assert.equal(recovered.text,entry.text);restored.destroy();
});

async function addManualEpic(h) {
    const base=h.api.getCreateMeta;
    h.api.getCreateMeta=async key=>{const raw=await base(key);for(const t of raw.projects[0].issuetypes)t.fields.customfield_923={name:'Epic',schema:{type:'any',custom:'com.pyxis.greenhopper.jira:gh-epic-link'}};return raw;};
    await h.controller.selectProject('DO');await h.controller.updateField('summary','Ready');await h.controller.updateField('customfield_923','DO-42');
}
test('late template Apply cannot clear another project proposal or append into its transcript',async()=>{
    const wait=deferred();let relationStarted=false;
    const h=await setup(async(c,s,text)=>{
        if(text==='Stage DO' || text==='Stage APP') await c.tools.find(t=>t.name==='propose_template_change').execute({changes:{instructions:text}},{});
        else {
            await c.tools.find(t=>t.name==='update_task').execute({fields:{},questions:[]},{});
            await c.tools.find(t=>t.name==='validate_task').execute({},{});
        }
    });
    await addManualEpic(h);h.api.getEpic=()=>{relationStarted=true;return wait.promise;};
    await h.chat.send('Stage DO');const applying=h.chat.applyTemplateProposal();
    for(let i=0;i<30&&!relationStarted;i++) await Promise.resolve();assert.equal(relationStarted,true);
    await h.controller.selectProject('APP');await h.controller.selectIssueType('20');await h.controller.selectTemplate('task');await h.chat.send('Stage APP');
    const afterSwitch=JSON.stringify(h.chat.getState());wait.resolve({id:'DO-42',label:'Epic'});await applying;
    assert.equal(JSON.stringify(h.chat.getState()),afterSwitch);assert.equal(h.chat.getState().pendingTemplateProposal.after.instructions,'Stage APP');
});
test('late template reassessment after new draft or destruction cannot change replacement conversation',async()=>{
    for(const change of [h=>h.controller.newDraft(),h=>h.chat.destroy()]) {
        const wait=deferred();let reviewConfig;
        const h=await setup(async(c,s,text)=>{if(text==='Stage') await c.tools.find(t=>t.name==='propose_template_change').execute({changes:{instructions:'New rules'}},{});else {reviewConfig=c;await wait.promise;}});
        await h.chat.send('Stage');const applying=h.chat.applyTemplateProposal();
        for(let i=0;i<20&&!reviewConfig;i++) await Promise.resolve();assert.ok(reviewConfig);
        await change(h);const replacement=JSON.stringify(h.chat.getState());reviewConfig.onEvent({type:'assistant',text:'Late old review'});wait.resolve();await applying;
        assert.equal(JSON.stringify(h.chat.getState()),replacement);
    }
});
test('Apply saves new template and starts guarded semantic review before allowing checked readiness',async()=>{
    const wait=deferred();let reviewConfig;const newRules='Require a customer reference; ask a required question when absent.';
    const h=await setup(async(c,s,text)=>{
        if(text==='Stage') return c.tools.find(t=>t.name==='propose_template_change').execute({changes:{instructions:newRules}},{});
        reviewConfig=c;const context=c.getContext();assert.equal(context.template.template.instructions,newRules);
        // A metadata-only validation must leave semantic review blocked.
        await c.tools.find(t=>t.name==='validate_task').execute({},{});await wait.promise;
        await c.tools.find(t=>t.name==='update_task').execute({fields:{},questions:[{id:'customer',text:'Which customer reference?',required:true}]},{});
        c.onEvent({type:'assistant',text:'Which customer reference?'});
    });
    await h.controller.updateSource('Original task facts');await h.controller.updateField('summary','Ready');await h.controller.updateField('description','Check the service against the original task facts.');await h.controller.chatValidate(h.controller.chatSnapshot());assert.ok(h.controller.getState().draft.checked);
    await h.chat.send('Stage');const applying=h.chat.applyTemplateProposal();
    for(let i=0;i<20&&!reviewConfig;i++) await Promise.resolve();assert.ok(reviewConfig);assert.equal(h.chat.getState().status,'running');
    assert.equal(h.controller.getState().draft.templateReviewPending,true);assert.equal(h.controller.getState().draft.checked,null);
    wait.resolve();await applying;const d=h.controller.getState().draft;
    assert.equal(d.templateReviewPending,false);assert.equal(d.checked,null);assert.equal(d.questions[0].id,'customer');
    assert.equal(d.source,'Original task facts');assert.equal(d.fields.summary,'Ready');assert.equal(d.protectedFields.summary,true);
});
test('failed template reassessment remains unchecked and can be retried without saving rules twice',async()=>{
    let attempt=0;const h=await setup(async(c,s,text)=>{
        if(text==='Stage') return c.tools.find(t=>t.name==='propose_template_change').execute({changes:{instructions:'Review new facts'}},{});
        if(++attempt===1) throw Error('mock review failure');
        await c.tools.find(t=>t.name==='update_task').execute({fields:{},questions:[]},{});
    });await h.controller.updateField('summary','Ready');await h.controller.updateField('description','Check service access under the current rules.');await h.chat.send('Stage');await h.chat.applyTemplateProposal();
    const revision=h.controller.getState().settings.revision;assert.equal(h.chat.getState().status,'error');assert.equal(h.controller.getState().draft.templateReviewPending,true);assert.equal(h.controller.getState().draft.checked,null);
    await h.chat.send('Review the current rules again');assert.equal(h.controller.getState().settings.revision,revision);assert.equal(h.controller.getState().draft.templateReviewPending,false);assert.ok(h.controller.getState().draft.checked);
});

test('deferred template-save completion is scoped to its original proposal even before review starts',async()=>{
    const wait=deferred();const h=await setup(async(c,s,text)=>c.tools.find(t=>t.name==='propose_template_change').execute({changes:{instructions:text}},{}));
    await h.chat.send('DO proposal');const apply=h.controller.chatApplyTemplate;
    h.controller.chatApplyTemplate=async(...args)=>{const result=await apply(...args);await wait.promise;return result;};
    const applying=h.chat.applyTemplateProposal();await Promise.resolve();await h.controller.selectProject('APP');await h.controller.selectIssueType('20');await h.controller.selectTemplate('task');await h.chat.send('APP replacement');
    const replacement=JSON.stringify(h.chat.getState());wait.resolve();await applying;
    assert.equal(JSON.stringify(h.chat.getState()),replacement);assert.equal(h.sessions.length,2);
});
test('stopped review and late final relation check keep semantic readiness pending',async()=>{
    const wait=deferred();let reviewing=false,signal;
    const h=await setup(async(c,s,text)=>{
        if(text==='Stage') return c.tools.find(t=>t.name==='propose_template_change').execute({changes:{instructions:'Updated rules'}},{});
        await c.tools.find(t=>t.name==='update_task').execute({fields:{},questions:[]},{});reviewing=true;
    });await addManualEpic(h);h.api.getEpic=(project,key,request)=>{signal=request.signal;return wait.promise;};
    await h.chat.send('Stage');const applying=h.chat.applyTemplateProposal();
    for(let i=0;i<40&&!signal;i++) await Promise.resolve();assert.equal(reviewing,true);assert.ok(signal);
    h.chat.stop();assert.equal(signal.aborted,true);assert.equal(h.controller.getState().draft.templateReviewPending,true);
    wait.resolve({id:'DO-42',label:'Epic'});await applying;
    assert.equal(h.controller.getState().draft.templateReviewPending,true);assert.equal(h.controller.getState().draft.checked,null);
    assert.ok(h.chat.getState().notices.some(n=>n.includes('Проверить')));
});

test('one reply per turn, with server readiness claims grounded in the actual draft',async()=>{
    const h=await setup(async c=>{
        const update=c.tools.find(t=>t.name==='update_task');
        c.onEvent({type:'assistant',text:'Записал сведения. Кто проверяет?'});
        await update.execute({fields:{summary:'Доступ',description:'Нет подключения'},questions:[{id:'who',text:'Кто проверяет?',required:true}]},{});
        c.onEvent({type:'assistant',text:'Задача готова к созданию. Подтвердите, что все данные корректны, и нажмите кнопку «Создать задачу» в интерфейсе.'});
    });
    await h.chat.send('Нет подключения');
    const replies=h.chat.getState().transcript.filter(m=>m.role==='assistant');
    assert.equal(replies.length,1);assert.doesNotMatch(replies[0].text,/готова к созданию|нажмите кнопку «Создать/i);
    assert.match(replies[0].text,/Кто проверяет/);assert.equal(h.controller.getState().draft.checked,null);h.chat.destroy();
});

test('explicit chat reconciliation reviews saved turns, checks an evaluated draft and never appends its own command to source',async()=>{
    let turns=0;
    const h=await setup(async c=>{
        if(!turns++){c.onEvent({type:'assistant',text:'Когда проверить?'});return;}
        assert.deepEqual(Array.from(c.getContext().conversationForReview,m=>m.text),['Сервис на DEV.','Когда проверить?','Завтра утром.','Ответ записан.']);
        assert.ok(!c.tools.some(t=>t.name==='propose_template_change'));
        await c.tools.find(t=>t.name==='update_task').execute({fields:{summary:'Проверить сервис',description:'DEV, завтра утром.'},questions:[]},{});
        c.onEvent({type:'assistant',text:'Задача готова к созданию.'});
    });
    await h.chat.send('Сервис на DEV.');
    const sess=h.runtime.createSession;
    h.runtime.createSession=c=>{const session=sess(c);session.prompt=async()=>c.onEvent({type:'assistant',text:'Ответ записан.'});return session;};
    await h.chat.send('Завтра утром.');h.runtime.createSession=sess;
    const source=h.controller.getState().draft.source;
    await h.chat.reconcile();
    assert.equal(h.controller.getState().draft.source,source);assert.ok(h.controller.getState().draft.checked);
    assert.equal(h.chat.getState().transcript.filter(m=>m.role==='user').length,2);h.chat.destroy();
});

test('completed task update and explicit create invitation run the real check without creating',async()=>{
    const h=await setup(async c=>{
        await c.tools.find(t=>t.name==='update_task').execute({fields:{summary:'Доступ',description:'Восстановить доступ к сервису.'},questions:[]},{});
        c.onEvent({type:'assistant',text:'Задача готова к созданию.'});
    });
    await h.chat.send('Восстановить доступ');
    assert.equal(h.controller.getState().validation.ok,true);assert.ok(h.controller.getState().draft.checked);
    assert.equal(h.controller.getState().draft.creation.issueKey,null);
    assert.match(h.chat.getState().transcript.at(-1).text,/Проверка пройдена/);h.chat.destroy();
});

test('reconcile cannot make a prose-only claim ready by validating before it reviews outstanding questions',async()=>{
    let validations=0;
    const h=await setup(async c=>{
        const result=await c.tools.find(t=>t.name==='validate_task').execute({},{});
        assert.equal(result.ok,false);validations++;
        c.onEvent({type:'assistant',text:'Задача готова к созданию.'});
    });
    await h.controller.updateField('summary','Заполненная тема');
    await h.chat.reconcile();
    assert.equal(validations,1);assert.equal(h.controller.getState().draft.checked,null);
    assert.match(h.chat.getState().transcript.at(-1).text,/не сверил/);h.chat.destroy();
});

for(const fail of [false,true]) test('reconciliation invalidates a previously checked draft even without an update, transport failure='+fail,async()=>{
    const h=await setup(async c=>{if(fail)throw Error('transport');c.onEvent({type:'assistant',text:'Задача готова к созданию.'});});
    await h.controller.updateField('summary','Тема');await h.controller.updateField('description','Проверить доступ к сервису.');await h.controller.chatValidate(h.controller.chatSnapshot());
    assert.ok(h.controller.getState().draft.checked);await h.chat.reconcile();
    assert.equal(h.controller.getState().draft.checked,null);
    assert.equal(h.store.load('DO').draft.checked,null);h.chat.destroy();
});

test('alternative readiness phrasing cannot invite creating an unchecked draft',async()=>{
    const h=await setup(async c=>c.onEvent({type:'assistant',text:'Все данные проверены, можно создавать задачу.'}));
    await h.chat.send('Проверь');assert.equal(h.controller.getState().draft.checked,null);
    assert.doesNotMatch(h.chat.getState().transcript.at(-1).text,/можно создавать/);h.chat.destroy();
});
test('an answered and removed canonical question is not asked again after applying its answer',async()=>{
    let n=0;const question='На какой среде проверять?';
    const h=await setup(async c=>{
        const first=++n===1;
        await c.tools.find(t=>t.name==='update_task').execute({fields:first?{summary:'Сервис'}:{description:'Проверить на DEV'},questions:first?[{id:'env',text:question,required:true}]:[]},{});
        c.onEvent({type:'assistant',text:question});
    });
    await h.chat.send('Проверить сервис');await h.chat.send('На DEV.');
    assert.doesNotMatch(h.chat.getState().transcript.at(-1).text,/На какой среде/);
    assert.match(h.controller.getState().draft.fields.description,/DEV/);h.chat.destroy();
});

test('a conversation claiming the description was filled must actually apply it through Jira field validation',async()=>{
    const runtime=await import('../ujg-ticket-assistant-chat/runtime.mjs'),h=await setup();h.chat.destroy();
    let n=0;
    const chat=h.Chat.create({controller:h.controller,runtime,store:h.store,requestText:async req=>{
        n++;
        if(n===1)return {text:'Описание заполнено. Задача готова к созданию.'};
        if(n===2){
            assert.match(req.user,/requiredDraftUpdate/);
            return {text:JSON.stringify({text:'',toolCalls:[{id:'fill',name:'update_task',arguments:{fields:{summary:'Восстановить доступ',description:'На стенде DEV отсутствует доступ по RDP.'},questions:[]}}]})};
        }
        return {text:'Задача готова к созданию.'};
    }});
    await chat.send('На стенде DEV отсутствует доступ по RDP.');
    assert.equal(h.controller.getState().draft.fields.description,'На стенде DEV отсутствует доступ по RDP.');
    assert.ok(h.controller.getState().draft.checked);chat.destroy();
});

test('reconcile projects saved user evidence once, then checks the accepted fields without a second LLM round-trip',async()=>{
    const runtime=await import('../ujg-ticket-assistant-chat/runtime.mjs'),h=await setup();h.chat.destroy();
    let calls=0,reviewCalls=0;
    const chat=h.Chat.create({controller:h.controller,runtime,store:h.store,requestText:async r=>{
        calls++;const data=JSON.parse(r.user),review=data.userAnswers;
        if(review) {
            reviewCalls++;assert.equal(data.previousToolResults.length,0);
            assert.ok(review.some(m=>m.text==='Версия неизвестна; среда DEV'));
            assert.ok(data.fields.some(f=>f.id==='description' && f.fillable));
            assert.equal(data.openQuestions[0].id,'version');
            assert.ok(data.fields.find(f=>f.id==='components').choices.some(v=>v.id==='DO-9' && v.label==='Backend'));
            return {text:JSON.stringify({fields:{description:'В среде DEV отсутствует доступ. Версия неизвестна.'},missing:[]})};
        }
        return {text:calls===1 ? JSON.stringify({text:'',toolCalls:[{id:'begin',name:'update_task',arguments:{fields:{summary:'Проверить доступ',description:'Среда DEV'},questions:[{id:'version',text:'Какая версия?',required:true}]}}]}) : 'Какая версия?'};
    }});
    await chat.send('Версия неизвестна; среда DEV');await chat.reconcile();
    assert.equal(reviewCalls,1);assert.equal(chat.getState().error,null);
    assert.match(h.controller.getState().draft.fields.description,/Версия неизвестна/);assert.ok(h.controller.getState().draft.checked);
    assert.equal(h.store.loadConversation('DO',h.controller.getState().draft.id).value.messages.filter(m=>m.role==='user').length,2);
    chat.destroy();
});

test('the next question sees the saved description, several new facts and the stated reason for skipping a value',async()=>{
    const runtime=await import('../ujg-ticket-assistant-chat/runtime.mjs'),h=await setup();h.chat.destroy();
    const initial='Окружение: DEV. Нужно восстановить доступ.';
    await h.controller.chatUpdate({fields:{summary:'Восстановить доступ',description:initial},questions:[]},h.controller.chatSnapshot());
    let n=0;
    const chat=h.Chat.create({controller:h.controller,runtime,store:h.store,requestText:async r=>{
        const ctx=JSON.parse(r.user).authoritativeContext;
        if(++n===1){assert.equal(ctx.draft.fields.description,initial);return {text:'Какая версия ПО?'};}
        if(n===2){
            assert.ok(ctx.requiredDraftUpdate);
            return {text:JSON.stringify({text:'',toolCalls:[{id:'answers',name:'update_task',arguments:{
                fields:{description:initial+' Проверка: вход по RDP. Дата: 6 ноября.'},
                questions:[{id:'effort',required:true,text:'На сколько оценить работу?',reason:'В описании есть дата, но нет трудозатрат.'}]
            }}]})};
        }
        assert.match(ctx.draft.fields.description,/Версия не нужна. Причина: восстанавливаем доступ/);
        return {text:'Какая версия ПО?'};
    }});
    await chat.send('Версия не нужна. Причина: восстанавливаем доступ. Проверка: вход по RDP. Дата: 6 ноября.');
    assert.equal(chat.getState().error,null);assert.equal(chat.getState().transcript.at(-1).text,'На сколько оценить работу?');
    const saved=h.store.load('DO').draft.fields.description;assert.match(saved,/DEV/);assert.match(saved,/RDP/);assert.match(saved,/6 ноября/);assert.match(saved,/Причина: восстанавливаем доступ/);chat.destroy();
});

test('reading options cannot substitute for a claimed write to the Jira description',async()=>{
    const runtime=await import('../ujg-ticket-assistant-chat/runtime.mjs'),h=await setup();h.chat.destroy();
    let n=0;
    const chat=h.Chat.create({controller:h.controller,runtime,store:h.store,requestText:async r=>{
        n++;
        if(n===1)return {text:JSON.stringify({text:'',toolCalls:[{id:'lookup',name:'find_options',arguments:{fieldId:'components',query:'Backend'}}]})};
        if(n===2)return {text:'Описание заполнено.'};
        if(n===3){assert.ok(JSON.parse(r.user).authoritativeContext.requiredDraftUpdate);return {text:JSON.stringify({text:'',toolCalls:[{id:'write',name:'update_task',arguments:{fields:{summary:'Исправить API',description:'Компонент Backend не отвечает.'},questions:[]}}]})};}
        return {text:'Задача готова к созданию.'};
    }});
    await chat.send('Компонент Backend не отвечает.');assert.equal(chat.getState().error,null);
    assert.equal(h.controller.getState().draft.fields.description,'Компонент Backend не отвечает.');chat.destroy();
});

for(const validRetry of [true,false])test('flat draft review retries malformed output once and applies only checked field data: '+validRetry,async()=>{
    const runtime=await import('../ujg-ticket-assistant-chat/runtime.mjs'),h=await setup();h.chat.destroy();
    await h.controller.updateField('summary','Ручная тема');
    let calls=0;
    const chat=h.Chat.create({controller:h.controller,runtime,store:h.store,requestText:async r=>{
        calls++;
        assert.match(r.system,/полный итоговый текст/);assert.ok(Array.isArray(JSON.parse(r.user).userAnswers));
        assert.equal(h.controller.getState().draft.fields.description,undefined);
        return {text:calls===1 ? '{"text":"готово","toolCalls":[}]' : validRetry ? '{"fields":{"description":"Среда DEV. Критерий: доступ по RDP."},"missing":[]}' : '{"fields":{"foreign":"x"},"missing":[]}'};
    }});
    await chat.reconcile();assert.equal(calls,2);assert.equal(h.controller.getState().draft.fields.summary,'Ручная тема');
    if(validRetry){assert.match(h.controller.getState().draft.fields.description,/RDP/);assert.ok(h.controller.getState().draft.checked);}
    else {assert.equal(chat.getState().error.code,'draft-update');assert.equal(h.controller.getState().draft.fields.description,undefined);assert.equal(h.controller.getState().draft.checked,null);}
    chat.destroy();
});

test('a complete description supplied in chat is durable before the provider answers and cannot be overwritten in that turn',async()=>{
    const runtime=await import('../ujg-ticket-assistant-chat/runtime.mjs'),h=await setup();h.chat.destroy();
    const exact='Среда DEV. Вход по RDP. Исполнитель не требуется.';
    const gate=deferred();let n=0;
    const chat=h.Chat.create({controller:h.controller,runtime,store:h.store,requestText:async()=>{
        assert.equal(h.store.load('DO').draft.fields.description,exact);
        if(++n===1){await gate.promise;return {text:JSON.stringify({text:'',toolCalls:[{id:'write',name:'update_task',arguments:{fields:{summary:'Восстановить доступ',description:'Сокращено'},questions:[]}}]})};}
        return {text:'Задача готова к созданию.'};
    }});
    const sending=chat.send('Описание: '+exact);
    await new Promise(r=>setImmediate(r));assert.equal(h.controller.getState().draft.fields.description,exact);
    gate.resolve();await sending;
    assert.equal(chat.getState().error,null);assert.equal(h.store.load('DO').draft.fields.description,exact);chat.destroy();
});

test('live-style review saves verified description despite invalid optional fields and an obsolete assignee question',async()=>{
    const runtime=await import('../ujg-ticket-assistant-chat/runtime.mjs'),h=await setup();
    await h.controller.chatUpdate({fields:{summary:'Доступ',description:'Стенд DEV'},questions:[]},h.controller.chatSnapshot());
    await h.chat.send('Исполнителя назначать не нужно. Проверка восстановления — вход по RDP.');
    h.chat.destroy();let calls=0;
    const chat=h.Chat.create({controller:h.controller,runtime,store:h.store,requestText:async r=>{
        calls++;const request=JSON.parse(r.user);
        assert.ok(request.userAnswers.some(m=>m.text.includes('вход по RDP')));
        return {text:JSON.stringify({fields:{summary:'Доступ',description:'Стенд DEV. Проверка — вход по RDP.',timetracking:{enabled:true},priority:'invented'},
            missing:[{id:'required:assignee',text:'Кто исполнитель?',reason:'Выберите исполнителя.'}]})};
    }});
    await chat.reconcile();assert.equal(calls,1);assert.equal(chat.getState().error,null);
    const saved=h.store.load('DO').draft;
    assert.match(saved.fields.description,/вход по RDP/);assert.match(saved.fields.description,/назначать не нужно/);
    assert.equal(saved.fields.timetracking,undefined);assert.equal(saved.fields.priority,undefined);assert.equal(saved.questions.length,0);
    assert.ok(saved.warnings.length>0);chat.destroy();
});
