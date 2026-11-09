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
function modelTools(h,source) {
 const Tools=loadUnit('chat-tools',{_ujgTA_fields:h.fields});
 return Tools.create({controller:h.controller,getSourceText:()=>source,getTurnText:()=>source,appManagedQuestions:true});
}
for(const sections of [false,true])for(const summary of ['Среда:',null])test('first fill keeps incomplete model '+(sections?'sections':'description')+' despite more complete source / summary='+summary,async t=>{
 const h=await setup(t,{required:true}),c=h.controller,tools=modelTools(h,live);
 const fields={labels:['widget'],priority:{id:'high'}};if(summary!==null)fields.summary=summary;
 const proposal=sections?{fields,descriptionSections:{location:poor.slice('Среда: '.length)}}:{fields:{...fields,description:poor}};
 const result=await tools.find(t=>t.name==='update_task').execute(proposal,{});
 const s=c.getState();assert.equal(result.ok,true);assert.equal(result.originalDescriptionPreferred,false);
 assert.equal(s.draft.source,live);assert.equal(s.draft.fields.description,h.canonical(poor));
 assert.equal(s.draft.fields.summary,summary===null?undefined:summary);
 assert.deepEqual(s.draft.fields.labels,['widget']);assert.equal(s.draft.fields.priority.id,'high');
 assert.equal(s.draft.fields.timetracking,undefined);assert.equal(s.draft.checked,null);
 assert.ok(s.validation.fieldErrors.timetracking);assert.ok(s.validation.fieldErrors.description);
 const task=await tools.find(t=>t.name==='get_task').execute({},{});
 assert.equal(task.draft.fields.description,s.draft.fields.description);assert.equal(h.posts.length,0);
});
test('incomplete model retains local Jira estimate and priority validation',async t=>{
 const h=await setup(t,{required:true,priority:false}),c=h.controller,text=live.replace('Оценка: 30 минут. ','');
 await c.chatUpdate({fields:{description:poor,summary:'Среда:'}},c.chatSnapshot(),text,{appManagedQuestions:true});
 const s=c.getState();assert.equal(s.draft.fields.description,h.canonical(poor));
 assert.equal(s.draft.source,text);assert.equal(s.draft.checked,null);assert.equal(s.validation.ok,false);
 assert.ok(s.validation.fieldErrors.timetracking);assert.ok(s.validation.fieldErrors.priority);assert.ok(s.validation.fieldErrors.description);
});
test('more complete source never replaces model-only location or repairs a heading title',async t=>{
 const h=await setup(t),c=h.controller,text=live.replace(' Ссылки: https://example.org/mama-myla-ramu','');
 const result=await c.chatUpdate({fields:{description:'Среда: DEV',summary:'Среда:'}},c.chatSnapshot(),text,{appManagedQuestions:true});
 assert.equal(result.ok,true);assert.equal(result.originalDescriptionPreferred,false);
 assert.equal(c.getState().draft.fields.description,h.canonical('Среда: DEV'));
 assert.equal(c.getState().draft.fields.summary,'Среда:');assert.equal(c.getState().draft.source,text);
 assert.equal(c.chatSourceSummary(),null);await c.chatValidate(c.chatSnapshot());assert.equal(c.getState().draft.checked,null);
 assert.ok(c.getState().validation.fieldErrors.description);
});
test('actual model section values are formatted without source inference',async t=>{
 const h=await setup(t),c=h.controller,model='Среда: TEST\n\nОкно: 22:00–23:00';
 await c.chatUpdate({fields:{description:model,summary:'Выбранная моделью тема'}},c.chatSnapshot(),live,{appManagedQuestions:true});
 assert.equal(c.getState().draft.fields.description,h.canonical(model));
 assert.match(c.getState().draft.fields.description,/TEST/);assert.match(c.getState().draft.fields.description,/22:00–23:00/);
 assert.doesNotMatch(c.getState().draft.fields.description,/5961fa4|mama-myla|рабочее время/);
});
for(const guard of ['existing','source','protected','pending','custom','excluded','verbatim'])test('model first fill respects '+guard,async t=>{
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
 if(guard==='verbatim')assert.equal(c.getState().draft.fields.description,poor);
});
test('manual summary and estimate remain protected while model description is formatted',async t=>{
 const h=await setup(t),c=h.controller;await c.updateField('summary','Моя тема');await c.updateField('timetracking',{originalEstimate:'2h'});
 await c.chatUpdate({fields:{description:poor,summary:'Среда:'}},c.chatSnapshot(),live,{appManagedQuestions:true});
 const d=c.getState().draft;assert.equal(d.fields.description,h.canonical(poor));
 assert.equal(d.fields.summary,'Моя тема');assert.equal(d.pendingFields.summary,'Среда:');assert.equal(d.fields.timetracking.originalEstimate,'2h');
});
