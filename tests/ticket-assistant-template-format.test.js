const test=require('node:test');
const assert=require('node:assert/strict');
const {loadUnit,metadataFixture}=require('./helpers/ticket-assistant-fixture');
const fields=loadUnit('fields'),validation=loadUnit('validation',{_ujgTA_fields:fields});
function meta(project='DEVOPS') {
    const m=metadataFixture(project);
    for(const type of m.issueTypes)type.fields.push({id:'priority',name:'Приоритет',kind:'option',supported:true,writable:true,optionsComplete:true,allowedValues:[{id:'medium',label:'Средний'}],defaultApplicable:true,defaultValue:{id:'medium'}});
    return m;
}
const url='https://example.org/mama-myla-ramu';
const live='Обновить виджет Jira в DEV из коммита 5961fa4 в рабочее время. Заменить скрипт и перезагрузить страницу. Постановщик проверит открытие карточки DEVOPS. Оценка: 30 минут. Ссылки: '+url;
const examples={
    '10':'Цель: Доступ команды к API. Что сделать: Настроить сервис API. Где: DEV. Критерии приёмки: /ready возвращает HTTP 200. Ссылки: '+url,
    '11':'Что происходит: API возвращает HTTP 500. Что ожидалось: API возвращает HTTP 200. Шаги воспроизведения: Открыть /api. Где: DEV. Логи / скриншоты: https://logs.example/error. Критерии приёмки: /api возвращает HTTP 200. Ссылки: '+url,
    '12':'Среда: DEV. Версия и состав: commit 5961fa4. Порядок: Заменить скрипт. Окно: рабочее время. Проверка: Постановщик проверит открытие карточки DEVOPS. Ссылки: '+url
};
function check(type,description,policy={}) {return validation.validateFields(meta(),type,{summary:'Обновить виджет Jira в DEV',description},policy);}
test('live inline link is canonicalized with all deployment facts and without repeating its URL',()=>{
    const formatted=validation.formatDevopsDescription(meta(),'12',live);
    assert.match(formatted,/^Среда:/);assert.match(formatted,/\n\nВерсия и состав:.*5961fa4/);assert.match(formatted,/\n\nПорядок: Заменить скрипт/);
    assert.match(formatted,/\n\nПроверка: Постановщик/);assert.match(formatted,/\n\nСсылки: https:\/\/example.org/);
    assert.equal(formatted.split(url).length-1,1);assert.ok(formatted.includes('Оценка: 30 минут.'));assert.equal(check('12',formatted,{requireStructuredDescription:true}).ok,true);
    assert.equal(validation.formatDevopsDescription(meta(),'12',formatted),formatted);
});
for(const type of ['10','11','12'])for(const markdown of [false,true])test('all actual types split inline explicit labels, keeping requirements and body: '+type+' '+markdown,()=>{
    const input=markdown?examples[type].replace(/(?:^|(?<=\. ))([^:]+): /g,'**$1:** '):examples[type];
    const formatted=validation.formatDevopsDescription(meta(),type,input);
    assert.equal(check(type,formatted,{requireStructuredDescription:true}).ok,true,JSON.stringify(check(type,formatted,{requireStructuredDescription:true}).questions));
    assert.equal(formatted.split(url).length-1,1);assert.equal(validation.formatDevopsDescription(meta(),type,formatted),formatted);
    const wiki=validation.jiraTemplateDescription(meta(),type,formatted);assert.equal(check(type,wiki,{requireStructuredDescription:true}).ok,true);
    assert.equal(validation.jiraTemplateDescription(meta(),type,wiki),wiki);
});
test('Jira wiki conversion changes recognized headings only, preserving literal body and CRLF',()=>{
    const text='**Среда:**\tDEV **body** _exact_\r\n\r\n## Версия и состав\r\ncommit 5961fa4\r\n\r\n__Ссылки__: '+url+'?a=1&b=2\r\nМой раздел: НеМенять **body**';
    const wiki=validation.jiraTemplateDescription(meta(),'12',text);
    assert.equal(wiki,'*Среда:*\tDEV **body** _exact_\r\n\r\n*Версия и состав:*\r\ncommit 5961fa4\r\n\r\n*Ссылки:* '+url+'?a=1&b=2\r\nМой раздел: НеМенять **body**');
});
test('malformed saved narrative with an inline link repairs once; reference retry does not duplicate URL',()=>{
    const saved=live.replace('Ссылки:','Дополнительно:\nСсылки:');
    const formatted=validation.formatDevopsDescription(meta(),'12',saved),wiki=validation.jiraTemplateDescription(meta(),'12',formatted);
    assert.equal(check('12',wiki,{requireStructuredDescription:true}).ok,true);
    const once=validation.mergeDevopsReference(wiki,url),twice=validation.mergeDevopsReference(once.description,url);
    assert.equal(once.ok,true);assert.equal(twice.description,once.description);assert.equal(twice.description.split(url).length-1,1);
});
test('exact saved live paragraph plus a second link retains other facts and different URLs',()=>{
    const other='https://docs.example/widget?a=1&b=2',saved=live+'\n\nСсылки: '+url+'\nДокументация команды: '+other+'\nКонтекст клиента: Сохранить регистр vRC-2.';
    const formatted=validation.formatDevopsDescription(meta(),'12',saved);
    assert.equal(formatted.split(url).length-1,1);assert.equal(formatted.split(other).length-1,1);
    for(const fact of ['5961fa4','Заменить скрипт и перезагрузить страницу','Постановщик проверит открытие карточки DEVOPS','Оценка: 30 минут.','Контекст клиента: Сохранить регистр vRC-2.'])assert.ok(formatted.includes(fact),fact);
    assert.equal(validation.formatDevopsDescription(meta(),'12',formatted),formatted);
});
test('dedupe removes only confirmed standalone URLs, retaining named Markdown mentions and semantic tails',()=>{
    const mentions='[репозиторий]('+url+') и [инструкция]('+url+')',tail=url+' — ссылка для дежурного';
    const source=validation.formatDevopsDescription(meta(),'12',examples['12'])+'\n'+url+'\n'+mentions+'\n'+tail;
    const formatted=validation.formatDevopsDescription(meta(),'12',source);
    assert.ok(formatted.includes(mentions));assert.ok(formatted.includes(tail));assert.equal(formatted.split(url).length-1,4,formatted);
    assert.equal(validation.formatDevopsDescription(meta(),'12',formatted),formatted);
});
for(const type of ['10','11','12'])test('explicit due date is optional and is preserved as a template section: '+type,()=>{
    const plain=examples[type]+' Срок: 2026-12-01.',formatted=validation.formatDevopsDescription(meta(),type,plain);
    assert.ok(validation.descriptionSectionDefinitions(meta(),type).some(section=>section.id==='due' && section.required===false));
    assert.match(formatted,/\nСрок \(опционально\): 2026-12-01/);
    const wiki=validation.jiraTemplateDescription(meta(),type,formatted);assert.match(wiki,/\*Срок \(опционально\):\*/);
    assert.equal(check(type,wiki,{requireStructuredDescription:true}).ok,true);assert.equal(check(type,validation.formatDevopsDescription(meta(),type,examples[type]),{requireStructuredDescription:true}).ok,true);
});
test('description maxlength uses the actual Jira wiki payload and reports overflow before creation',()=>{
    const m=meta(),plain=validation.formatDevopsDescription(m,'12',examples['12']),wiki=validation.jiraTemplateDescription(m,'12',plain);
    const field=m.issueTypes.find(type=>type.id==='12').fields.find(field=>field.id==='description');assert.ok(wiki.length>plain.length);
    field.maxLength=wiki.length-1;
    const values={summary:'Обновить виджет Jira в DEV',description:plain},policy={descriptionFormat:'markdown',requireStructuredDescription:true};
    const result=validation.validateFields(m,'12',values,policy);assert.equal(result.ok,false);assert.match(result.fieldErrors.description.join(' '),/формате Jira.*лимит/);
    assert.throws(()=>validation.buildCreatePayload(m,'12',values,policy));
    field.maxLength=wiki.length;assert.equal(validation.validateFields(m,'12',values,policy).ok,true);assert.equal(validation.buildCreatePayload(m,'12',values,policy).fields.description,wiki);
    const markdown=wiki.replace(/\*([^*]+:)\*/g,'**$1**');assert.ok(markdown.length>wiki.length);
    assert.equal(validation.validateFields(m,'12',{...values,description:markdown},policy).ok,true);
});
test('structured policy rejects raw standard descriptions and holes without inventing missing body',()=>{
    assert.equal(check('12',live).ok,true);
    assert.equal(check('12',live,{requireStructuredDescription:true}).ok,false);
    const hole=examples['12'].replace('Порядок: Заменить скрипт. ','');
    const result=check('12',hole,{requireStructuredDescription:true});assert.equal(result.ok,false);assert.ok(result.questions.some(q=>q.id==='devops:order'));
    const empty=validation.formatDevopsDescription(meta(),'12','Среда: DEV. Ссылки: '+url);
    assert.equal(check('12',empty,{requireStructuredDescription:true}).ok,false);assert.doesNotMatch(empty,/5961fa4|Заменить скрипт|Постановщик/);
});
test('other projects and custom-template structure policy retain their existing behavior',()=>{
    const generic=metadataFixture('APP');assert.equal(validation.formatDevopsDescription(generic,'20',live),live);assert.equal(validation.jiraTemplateDescription(generic,'20',live),live);
    assert.deepEqual(check('12',live,{requireStructuredDescription:true,templateId:'personal'}),check('12',live,{templateId:'personal'}));
});
test('strict automatic formatting always exposes editable holes and preserves an unrecognized source exactly',()=>{
    const source='Нужна помощь с выкаткой.\n\nСведения\tбудут уточнены позже.';
    for(const type of ['10','11','12']) {
        const formatted=validation.formatDevopsDescription(meta(),type,source,true);
        for(const section of validation.descriptionSectionDefinitions(meta(),type).filter(section=>section.required))assert.ok(formatted.includes(section.label+': '),section.label);
        assert.ok(formatted.endsWith('Дополнительно:\n'+source));assert.equal(check(type,formatted,{requireStructuredDescription:true}).ok,false);
        assert.equal(validation.formatDevopsDescription(meta(),type,source),source);
    }
});
test('strict validation requires line-separated headings and ignores incidental prose labels',()=>{
    for(const type of ['10','11','12'])assert.equal(check(type,examples[type],{requireStructuredDescription:true}).ok,false);
    const incidental='Просьба напечатать слова Среда: DEV. Не считайте их заполненной карточкой.';
    const wiki=validation.jiraTemplateDescription(meta(),'12',incidental);assert.equal(wiki,incidental);
    assert.equal(check('12',incidental,{requireStructuredDescription:true}).ok,false);
});
for(const wrap of [text=>'`'+text+'`',text=>'```yaml\n'+text+'\n```',text=>'~~~yaml\n'+text+'\n~~~',text=>'{code:language=yaml}\n'+text+'\n{code}',text=>'{noformat}\n'+text+'\n{noformat}'])
test('code samples remain literal in parser, sentence grouping and Jira rendering: '+wrap('code').split('\n')[0],()=>{
    const sample=wrap('echo Срок: tomorrow\nlinks: https://code.example/sample\nСреда: PROD\nПорядок: заменить пароль.'),input='Пример команды:\n'+sample;
    assert.equal(validation.jiraTemplateDescription(meta(),'12',input),input);
    const strict=validation.formatDevopsDescription(meta(),'12',input,true);assert.ok(strict.includes(sample));
    const result=check('12',strict,{requireStructuredDescription:true});assert.equal(result.ok,false);assert.ok(result.questions.some(q=>q.id==='devops:links'));assert.ok(result.questions.some(q=>q.id==='devops:location'));
    const mixed=live+'\n\n'+sample,formatted=validation.formatDevopsDescription(meta(),'12',mixed,true);
    assert.ok(formatted.includes(sample),formatted);assert.equal(formatted.split('https://code.example/sample').length-1,1);
});
