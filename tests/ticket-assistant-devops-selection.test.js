const test=require('node:test');
const assert=require('node:assert/strict');
const {loadUnit}=require('./helpers/ticket-assistant-fixture');
const {harness}=require('./helpers/ticket-assistant-chat-fixture');
async function setup() {
    const h=await harness(),original=h.api.getCreateMeta;
    h.api.getProjects=async()=>({values:[{key:'DEVOPS',id:'devops-project',name:'DEVOPS'},{key:'APP',id:'app-project',name:'Application'}]});
    h.api.getCreateMeta=async key=>{
        const raw=await original(key);
        if(key==='DEVOPS')raw.projects[0].issuetypes.forEach((type,i)=>{type.name=['Задача','Ошибка','Задача развертывания'][i];});
        return raw;
    };
    await h.controller.init();await h.controller.selectProject('DEVOPS');
    return h;
}
test('DEVOPS selects its profile and the actual Jira type determines each standard template',async()=>{
    const h=await setup(),c=h.controller;
    assert.equal(c.getState().settings.activeProfileId,'devops');
    assert.equal(c.getState().draft.issueTypeId,null);assert.equal(c.getState().draft.templateId,null);
    for(const [id,template] of [['10','task'],['11','bug'],['12','deployment']]) {
        await c.selectIssueType(id);const s=c.getState();
        assert.equal(s.draft.issueTypeId,id);assert.equal(s.draft.templateId,template);
        assert.equal(s.typeTemplateSelection.automatic,true);assert.equal(s.typeTemplateSelection.supported,true);
    }
    await c.selectTemplate('task');assert.equal(c.getState().draft.issueTypeId,'12');assert.equal(c.getState().draft.templateId,'deployment');c.destroy();
});
test('custom explicit mappings override names; ambiguous or unmapped types never get an arbitrary template',async()=>{
    const h=await setup(),c=h.controller;let settings=c.getState().settings;
    const p=settings.profiles.find(p=>p.id==='devops');p.templates.push({...p.templates[0],id:'custom',name:'Локальные правила',issueTypeId:'12'});
    await c.applySettings(settings);await c.selectIssueType('12');assert.equal(c.getState().draft.templateId,'custom');
    settings=c.getState().settings;settings.profiles.find(p=>p.id==='devops').templates.push({...p.templates[0],id:'other',issueTypeId:'12'});
    await c.applySettings(settings);assert.equal(c.getState().draft.issueTypeId,'12');assert.equal(c.getState().draft.templateId,null);
    assert.match(c.getState().typeTemplateSelection.reason,/несколько|неоднознач/i);
    settings=c.getState().settings;const templates=settings.profiles.find(p=>p.id==='devops').templates;templates.splice(templates.findIndex(t=>t.id==='bug'),1);
    await c.applySettings(settings);await c.selectIssueType('11');assert.equal(c.getState().draft.templateId,null);assert.match(c.getState().typeTemplateSelection.reason,/привяз|шаблон/i);c.destroy();
});
test('restored DEVOPS draft resyncs the template and retains source, manual fields and custom rules',async()=>{
    const h=await setup(),c=h.controller;await c.selectIssueType('12');await c.updateSource('Исходные факты');await c.updateField('summary','Ручная тема');
    const settings=c.getState().settings;settings.profiles.find(p=>p.id==='devops').templates.find(t=>t.id==='deployment').instructions='Мои правила';await c.applySettings(settings);
    const saved=h.store.load('DEVOPS');saved.draft.templateId='task';saved.settings.activeProfileId='universal';
    assert.equal(h.store.save('DEVOPS',{draft:saved.draft,settings:saved.settings},saved.revision).ok,true);
    await c.init();await c.selectProject('DEVOPS');const s=c.getState();
    assert.equal(s.settings.activeProfileId,'devops');assert.equal(s.draft.issueTypeId,'12');assert.equal(s.draft.templateId,'deployment');
    assert.equal(s.draft.source,'Исходные факты');assert.equal(s.draft.fields.summary,'Ручная тема');assert.equal(c.chatReadTemplate().template.instructions,'Мои правила');c.destroy();
});
test('saved settings rebind selected type and generic projects retain independent template selection',async()=>{
    const h=await setup(),c=h.controller;await c.selectIssueType('12');
    const saved=h.store.load('DEVOPS');saved.settings.profiles.find(p=>p.id==='devops').templates.push({id:'custom',name:'Custom',whenToUse:'',instructions:'Local',issueTypeId:'12'});saved.settings.revision++;
    assert.equal(h.store.save('DEVOPS',{draft:saved.draft,settings:saved.settings},saved.revision).ok,true);
    await c.loadSavedSettings();assert.equal(c.getState().draft.issueTypeId,'12');assert.equal(c.getState().draft.templateId,'custom');
    await c.selectProject('APP');assert.equal(c.getState().settings.activeProfileId,'universal');await c.selectIssueType('20');await c.selectTemplate('bug');
    assert.equal(c.getState().draft.issueTypeId,'20');assert.equal(c.getState().draft.templateId,'bug');assert.equal(c.getState().typeTemplateSelection.automatic,false);
    await c.selectProject('DEVOPS');assert.equal(c.getState().draft.issueTypeId,'12');assert.equal(c.getState().draft.templateId,'custom');c.destroy();
});
test('project detection uses the DEVOPS identity, never an incidental substring',()=>{
    const p=loadUnit('profiles');
    assert.equal(p.isDevopsProject({key:'DEVOPS',name:'Operations'}),true);assert.equal(p.isDevopsProject({key:'DO',name:'DevOps'}),false);assert.equal(p.isDevopsProject({key:'devops',name:'DEVOPS'}),false);
    assert.equal(p.isDevopsProject({key:'APP',name:'DevOps tools application'}),false);
});


test('unsupported types preserve manual fields and never invoke model routing',async()=>{
    const h=await setup(),c=h.controller,read=h.api.getCreateMeta;
    h.api.getCreateMeta=async key=>{const raw=await read(key);if(key==='DEVOPS')raw.projects[0].issuetypes.push({...raw.projects[0].issuetypes[0],id:'99',name:'Другой тип'});return raw;};
    await c.selectProject('DEVOPS');await c.selectIssueType('99');await c.updateField('summary','Сохранить тему');await c.updateSource('Сохранить факты');
    await c.prepare();
    assert.equal(c.getState().draft.issueTypeId,'99');assert.equal(c.getState().draft.templateId,null);assert.equal(c.getState().draft.fields.summary,'Сохранить тему');
    assert.equal(c.getState().typeTemplateSelection.supported,false);assert.equal(c.getState().error.code,'input');c.destroy();
});
test('metadata rename or removal does not guess a standard template; an explicit mapping remains authoritative',()=>{
    const p=loadUnit('profiles'),settings=p.createDefaults(),project={key:'DEVOPS',name:'DEVOPS'},meta={issueTypes:[{id:'123',name:'Нестандартная работа',subtask:false}]};
    assert.equal(p.typeTemplateSelection(settings,project,meta,'123').templateId,null);
    settings.profiles.find(p=>p.id==='devops').templates.find(t=>t.id==='task').issueTypeId='123';
    assert.equal(p.typeTemplateSelection(settings,project,meta,'123').templateId,'task');
    assert.equal(p.typeTemplateSelection(settings,project,{issueTypes:[]},'123').templateId,null);
    meta.issueTypes[0].subtask=true;assert.equal(p.typeTemplateSelection(settings,project,meta,'123').templateId,null);
});
test('a missing DEVOPS profile leaves custom settings intact and explains the required setup',async()=>{
    const h=await setup(),c=h.controller;await c.selectIssueType('10');const settings=c.getState().settings;
    settings.profiles=settings.profiles.filter(p=>p.id!=='devops');settings.activeProfileId='universal';
    await c.applySettings(settings);assert.equal(c.getState().draft.issueTypeId,'10');assert.equal(c.getState().draft.templateId,null);
    assert.match(c.getState().typeTemplateSelection.reason,/профиль DEVOPS/);assert.equal(c.getState().settings.profiles.length,1);c.destroy();
});


test('arbitrary unbound custom template IDs cannot collide with inherited lookup properties',()=>{
    const p=loadUnit('profiles'),settings=p.createDefaults();
    settings.profiles.find(p=>p.id==='devops').templates.push({id:'constructor',name:'Custom',whenToUse:'',instructions:'',issueTypeId:null});
    assert.equal(p.validateSettings(settings).ok,true);
    const selected=p.typeTemplateSelection(settings,{key:'DEVOPS'},{issueTypes:[{id:'10',name:'Задача',subtask:false}]},'10');
    assert.equal(selected.templateId,'task');
});
test('a removed saved Jira type clears the stale selection while preserving draft content',async()=>{
    const h=await setup(),c=h.controller;await c.selectIssueType('12');await c.updateField('summary','Сохранённое название');
    const read=h.api.getCreateMeta;h.api.getCreateMeta=async key=>{const raw=await read(key);raw.projects[0].issuetypes=raw.projects[0].issuetypes.filter(t=>t.id!=='12');return raw;};
    await c.selectProject('DEVOPS');const s=c.getState();assert.equal(s.draft.issueTypeId,null);assert.equal(s.draft.templateId,null);
    assert.equal(s.draft.fields.summary,'Сохранённое название');assert.match(s.typeTemplateSelection.reason,/Выберите доступный тип/);c.destroy();
});
