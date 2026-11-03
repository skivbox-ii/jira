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
test('chat tools progressively fill one canonical task, preserve source and unlock existing creator',async()=>{
    const h=await setup(async(c,s,text)=>{
        await c.tools.find(t=>t.name==='update_task').execute({fields:{summary:'Investigate failure'},questions:[]},{});
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
    const responses=[{text:'',toolCalls:[{id:'real_1',name:'update_task',arguments:{fields:{summary:'Scripted task'},questions:[]}}]},
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
    await h.controller.updateSource('Task facts');await h.controller.updateField('summary','Ready');await h.controller.chatValidate(h.controller.chatSnapshot());
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
    await h.controller.updateSource('Original task facts');await h.controller.updateField('summary','Ready');await h.controller.chatValidate(h.controller.chatSnapshot());assert.ok(h.controller.getState().draft.checked);
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
    });await h.controller.updateField('summary','Ready');await h.chat.send('Stage');await h.chat.applyTemplateProposal();
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
