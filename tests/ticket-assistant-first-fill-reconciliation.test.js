const test=require('node:test');
const assert=require('node:assert/strict');
const {loadUnit}=require('./helpers/ticket-assistant-fixture');
const {harness}=require('./helpers/ticket-assistant-chat-fixture');
const live='Обновить виджет Jira в DEV из коммита 5961fa4 в рабочее время. Заменить скрипт и перезагрузить страницу. Постановщик проверит открытие карточки DEVOPS. Оценка: 30 минут. Ссылки: https://example.org/mama-myla-ramu';
const poor='Среда: Обновить виджет Jira в DEV из коммита 5961fa4. Заменить скрипт и перезагрузить страницу. Ссылки: https://example.org/mama-myla-ramu. Оценка: 30 минут. Постановщик проверит открытие карточки DEVOPS.';
async function setup(t,{required=false,priority=true}={}) {
 const h=await harness(),c=h.controller,read=h.api.getCreateMeta;h.posts=[];
 h.api.getProjects=async()=>({values:[{key:'DEVOPS',id:'DEVOPS-project',name:'DEVOPS'}]});
 h.api.getCreateMeta=async key=>{const m=await read(key);for(const type of m.projects[0].issuetypes){
  type.fields.timetracking={name:'Трудозатраты',required,schema:{type:'timetracking',system:'timetracking'}};
  type.fields.priority={name:'Приоритет',schema:{type:'priority',system:'priority'},...(priority?{hasDefaultValue:true,defaultValue:{id:'medium'}}:{}),allowedValues:[{id:'medium',name:'Средний'},{id:'high',name:'Высокий'}]};
 }return m;};
 h.api.checkDevopsIssue=async()=>({fieldErrors:{},warnings:[],link:null});
 h.api.createIssue=async payload=>{h.posts.push(payload);return {id:'123',key:'DEVOPS-123'};};
 await c.init();await c.selectProject('DEVOPS');await c.selectIssueType('12');
 h.canonical=text=>h.validation.formatDevopsDescription(c.getState().meta,'12',text,true);
 t.after(()=>c.destroy());return h;
}
async function send(t,h,text,{sections=false,summary='Среда:',other={}}={}) {
 const runtime=await import('../ujg-ticket-assistant-chat/runtime.mjs');
 const Chat=loadUnit('chat',{_ujgTA_chatTools:loadUnit('chat-tools',{_ujgTA_fields:h.fields}),_ujgTA_draft:h.drafts},{AbortController});
 let calls=0;
 const chat=Chat.create({controller:h.controller,store:h.store,runtime,requestText:async()=>{
  calls++;const fields={...other};if(summary!==null)fields.summary=summary;
  const args=sections?{fields,descriptionSections:{location:poor.slice('Среда: '.length)}}:{fields:{...fields,description:poor}};
  return {text:JSON.stringify({text:'',toolCalls:[{id:'fill-'+calls,name:'update_task',arguments:args}]})};
 }});t.after(()=>chat.destroy());await chat.send(text);return {chat,calls:()=>calls};
}
for(const sections of [false,true])for(const summary of ['Среда:',null])test('one exact live message repairs valid incomplete model '+(sections?'sections':'full')+' / summary='+summary,async t=>{
 const h=await setup(t,{required:true}),c=h.controller;
 const r=await send(t,h,live,{sections,summary,other:{labels:['widget'],priority:{id:'high'}}});
 const s=c.getState();assert.equal(r.chat.getState().error,null);assert.equal(r.calls(),1);
 assert.equal(s.draft.source,live);assert.equal(s.draft.fields.description,h.canonical(live));
 assert.match(s.draft.fields.summary,/^Обновить виджет Jira в DEV из коммита 5961fa4/);assert.notEqual(s.draft.fields.summary,'Среда:');
 assert.deepEqual(s.draft.fields.labels,['widget']);assert.equal(s.draft.fields.priority.id,'high');
 assert.equal(s.draft.fields.timetracking.originalEstimate,'30m');
 assert.equal(s.validation.ok,true,JSON.stringify(s.validation));assert.ok(s.draft.checked);assert.equal(h.posts.length,0);
 await c.submit();assert.equal(h.posts.length,1);assert.match(h.posts[0].fields.description,/\*Среда:\*/);assert.equal(h.posts[0].fields.timetracking.originalEstimate,'30m');
});
test('description reconciliation is independent of missing Jira estimate and priority',async t=>{
 const h=await setup(t,{required:true,priority:false}),c=h.controller,text=live.replace('Оценка: 30 минут. ','');
 await send(t,h,text);const s=c.getState();assert.equal(s.draft.fields.description,h.canonical(text));
 assert.equal(s.draft.source,text);assert.equal(s.draft.checked,null);assert.equal(s.validation.ok,false);
 assert.ok(s.validation.fieldErrors.timetracking);assert.ok(s.validation.fieldErrors.priority);assert.equal(s.validation.fieldErrors.description,undefined);
});
test('a source missing only its link still wins over a strictly less complete model',async t=>{
 const h=await setup(t),c=h.controller,text=live.replace(' Ссылки: https://example.org/mama-myla-ramu','');
 const result=await c.chatUpdate({fields:{description:'Среда: DEV',summary:'Среда:'}},c.chatSnapshot(),text,{appManagedQuestions:true});
 assert.equal(result.ok,true);assert.equal(c.getState().draft.fields.description,h.canonical(text));assert.equal(c.getState().draft.source,text);
 await c.chatValidate(c.chatSnapshot());assert.equal(c.getState().draft.checked,null);
 assert.deepEqual(Array.from(c.getState().validation.questions,q=>q.id),['devops:links']);
});
test('a model-only satisfied required section prevents replacement by an incomplete source',async t=>{
 const h=await setup(t),c=h.controller,text=live.replace(' в рабочее время','');
 const model='Среда: DEV\n\nОкно: рабочее время';
 await c.chatUpdate({fields:{description:model,summary:'Обновить виджет Jira в DEV'}},c.chatSnapshot(),text,{appManagedQuestions:true});
 assert.equal(c.getState().draft.fields.description,h.canonical(model));assert.notEqual(c.getState().draft.fields.description,h.canonical(text));
});
for(const guard of ['existing','source','protected','pending','custom','excluded','verbatim'])test('first fill reconciliation respects '+guard,async t=>{
 const h=await setup(t),c=h.controller;
 if(guard==='existing')await c.chatUpdate({fields:{description:'Ранее сохранённое описание'}},c.chatSnapshot());
 if(guard==='source')await c.updateSource('Предыдущие сведения');
 if(guard==='protected' || guard==='pending')await c.updateField('description','Ручное описание');
 if(guard==='pending')await c.chatUpdate({fields:{description:'Ручное предложение'}},c.chatSnapshot());
 if(guard==='custom'){const settings=c.getState().settings;settings.profiles.find(p=>p.id==='devops').templates.find(t=>t.id==='deployment').instructions+=' Личные правила.';await c.applySettings(settings);}
 if(guard==='excluded')await c.setGenerationFields(c.getState().generationFieldIds.filter(id=>id!=='description'));
 const options={appManagedQuestions:true,...(guard==='verbatim'?{verbatimDescription:true}:{})};
 await c.chatUpdate({fields:{description:poor}},c.chatSnapshot(),live,options);
 assert.notEqual(c.getState().draft.fields.description,h.canonical(live));
 if(guard==='protected' || guard==='pending')assert.equal(c.getState().draft.fields.description,'Ручное описание');
});
test('manual summary and estimate survive original-derived description',async t=>{
 const h=await setup(t),c=h.controller;await c.updateField('summary','Моя тема');await c.updateField('timetracking',{originalEstimate:'2h'});
 await send(t,h,live);const d=c.getState().draft;
 assert.equal(d.fields.description,h.canonical(live));assert.equal(d.fields.summary,'Моя тема');assert.equal(d.fields.timetracking.originalEstimate,'2h');
});
test('later failed chat safely repairs a generated section-only summary on a source-matched card',async t=>{
 const h=await setup(t),c=h.controller;await c.chatUpdate({fields:{description:h.canonical(live),summary:'Среда:'}},c.chatSnapshot());
 await c.updateSource(live);
 const Chat=loadUnit('chat',{_ujgTA_chatTools:loadUnit('chat-tools',{_ujgTA_fields:h.fields}),_ujgTA_draft:h.drafts},{AbortController});
 const chat=Chat.create({controller:c,store:h.store,runtime:null});t.after(()=>chat.destroy());await chat.send(live);
 assert.match(c.getState().draft.fields.summary,/^Обновить виджет Jira/);assert.equal(c.getState().draft.source,live);
});
for(const manual of [false,true])test('retry of the original live message repairs only an automatic heading on the existing poor card; manual='+manual,async t=>{
 const h=await setup(t),c=h.controller;
 await c.chatUpdate({fields:{description:poor,summary:'Среда:'}},c.chatSnapshot());await c.updateSource(live);
 if(manual)await c.updateField('summary','Среда:');
 const before=c.getState().draft.fields.description;
 const Chat=loadUnit('chat',{_ujgTA_chatTools:loadUnit('chat-tools',{_ujgTA_fields:h.fields}),_ujgTA_draft:h.drafts},{AbortController});
 const chat=Chat.create({controller:c,store:h.store,runtime:null});t.after(()=>chat.destroy());await chat.send(live);
 if(manual)assert.equal(c.getState().draft.fields.summary,'Среда:');else assert.match(c.getState().draft.fields.summary,/^Обновить виджет Jira/);
 assert.equal(c.getState().draft.fields.description,before);assert.equal(c.getState().draft.source,live);assert.equal(c.getState().draft.checked,null);
});
