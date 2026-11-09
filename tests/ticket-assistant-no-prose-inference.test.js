const test=require('node:test');
const assert=require('node:assert/strict');
const {loadUnit,metadataFixture}=require('./helpers/ticket-assistant-fixture');
const validation=loadUnit('validation',{_ujgTA_fields:loadUnit('fields')});
const meta=metadataFixture('DEVOPS');
const prose='Обновить API в DEV до версии 1.2 в рабочее время. Перезапустить приложение. Постановщик проверит HTTP 200 на /health.';
test('raw prose does not satisfy sections without a model or manual field mapping',()=>{
    const result=validation.validateFields(meta,'12',{summary:'Обновить API',description:prose},{requireStructuredDescription:true});
    for(const id of ['location','release','order','window','verification'])assert.ok(result.questions.some(q=>q.id==='devops:'+id),id);
});
test('formatting raw prose never distributes its facts into template sections',()=>{
    const formatted=validation.formatDevopsDescription(meta,'12',prose,true);
    const rows=validation.descriptionTableRows(meta,'12',formatted);
    for(const row of rows.filter(row=>row.label!=='Дополнительно'))assert.equal(row.value,'',row.label);
    assert.ok(formatted.includes(prose));
});
test('explicit structured sections remain eligible for display and validation',()=>{
    const source='Среда: DEV\n\nВерсия и состав: API 1.2\n\nПорядок: Перезапустить приложение\n\nОкно: в рабочее время\n\nПроверка: Постановщик проверит HTTP 200 на /health\n\nСсылки: https://example.org/runbook';
    const result=validation.validateFields(meta,'12',{summary:'Обновить API',description:source},{requireStructuredDescription:true});
    assert.equal(result.questions.some(q=>/^devops:(?:location|release|order|window|verification|verifier|links)$/.test(q.id)),false,JSON.stringify(result.questions));
});
for(const summary of ['Среда:','**Версия и состав:**','Порядок','Проверка:'])test('a section label is a validation gap, never an automatically replaced title: '+summary,()=>{
    const m=metadataFixture('DEVOPS');
    for(const type of m.issueTypes)type.fields.push({id:'priority',name:'Приоритет',kind:'option',supported:true,writable:true,optionsComplete:true,allowedValues:[{id:'medium',label:'Средний'}],defaultApplicable:true,defaultValue:{id:'medium'}});
    const values={summary,description:'Среда: DEV\n\nВерсия и состав: API 1.2\n\nПорядок: Перезапустить приложение\n\nОкно: в рабочее время\n\nПроверка: Постановщик проверит HTTP 200\n\nСсылки: https://example.org/runbook'};
    const before=JSON.stringify(values),result=validation.validateFields(m,'12',values,{requireStructuredDescription:true});
    assert.equal(result.ok,false);
    assert.ok(result.questions.some(q=>q.id==='devops:summary'));
    assert.equal(JSON.stringify(values),before);
});
