const test=require('node:test');
const assert=require('node:assert/strict');
const {loadUnit,metadataFixture}=require('./helpers/ticket-assistant-fixture');
const fields=loadUnit('fields'),v=loadUnit('validation',{_ujgTA_fields:fields});
function meta(project='DEVOPS') {
    const m=metadataFixture(project);
    for(const type of m.issueTypes)type.fields.push({id:'priority',name:'Приоритет',kind:'option',supported:true,writable:true,optionsComplete:true,allowedValues:[{id:'medium',label:'Средний'}],defaultApplicable:true,defaultValue:{id:'medium'}});
    return m;
}
const descriptions={
    '10':'Цель: доступ команды.\n\nЧто сделать: настроить API.\n\nГде: TEST.\n\nКритерии приёмки: HTTP 200 на /ready.\n\nСсылки: https://git.example/api',
    '11':'Что происходит: HTTP 500.\n\nЧто ожидалось: HTTP 200.\n\nШаги воспроизведения: открыть /api.\n\nГде: TEST.\n\nЛоги / скриншоты: https://logs.example/api\n\nКритерии приёмки: HTTP 200.\n\nСсылки: https://git.example/api',
    '12':'Среда: DEV.\n\nВерсия и состав: commit 5961fa4.\n\nПорядок: заменить скрипт.\n\nОкно: рабочее время.\n\nПроверка: постановщик проверит открытие карточки.\n\nСсылки: https://git.example/api'
};
const plain=x=>JSON.parse(JSON.stringify(x));
for(const id of ['10','11','12'])test('canonical rows, Markdown paste, validation and wiki table share a reversible boundary: '+id,()=>{
    const m=meta(),input=descriptions[id],rows=v.descriptionTableRows(m,id,input);
    assert.ok(rows.length>=5);assert.equal(rows[0].label,id==='10'?'Цель':id==='11'?'Что происходит':'Среда');
    assert.equal(rows.some(row=>row.label.startsWith('Срок')),false);
    const markdown=v.markdownTemplateDescription(m,id,input);assert.match(markdown,/^\| Поле \| Описание \|\n\| --- \| --- \|/);
    assert.deepEqual(plain(v.descriptionTableRows(m,id,markdown)),plain(rows));
    assert.equal(v.validateFields(m,id,{summary:'Обновить API в TEST',description:markdown},{requireStructuredDescription:true}).ok,true);
    const canonical=v.formatDevopsDescription(m,id,markdown,true);assert.doesNotMatch(canonical,/^\|/);assert.equal(v.markdownTemplateDescription(m,id,canonical),markdown);
    const wiki=v.jiraTemplateDescription(m,id,input);assert.match(wiki,/^\|\|Поле\|\|Описание\|\|\n\|/);assert.equal(v.jiraTemplateDescription(m,id,markdown),wiki);assert.equal(v.jiraTemplateDescription(m,id,wiki),wiki);
    assert.equal(v.buildCreatePayload(m,id,{summary:'Обновить API в TEST',description:input},{requireStructuredDescription:true,descriptionFormat:'markdown'}).fields.description,wiki);
});
test('rows expose empty required holes, present optional values and custom continuation without invention',()=>{
    const input='Среда: DEV\n\nСрок: 2026-12-01\n\nДополнительно: Моя пометка\nКлиентский раздел: НеМенять';
    const rows=v.descriptionTableRows(meta(),'12',input);
    assert.equal(rows.find(row=>row.label==='Версия и состав').value,'');assert.equal(rows.find(row=>row.label==='Срок (опционально)').value,'2026-12-01');
    assert.equal(rows.find(row=>row.label==='Дополнительно').value,'Моя пометка\nКлиентский раздел: НеМенять');
    assert.equal(v.validateFields(meta(),'12',{summary:'Обновить API',description:v.markdownTemplateDescription(meta(),'12',input)},{requireStructuredDescription:true}).ok,false);
});
test('Markdown cell escaping roundtrips pipes, slash sequences, code, CRLF and literal entities without executing content',()=>{
    const body='echo a|b \\n **bold** `code` <script>x</script> &lt;br&gt; <br>\r\n```sh\r\necho Ссылки: https://sample.example\r\n```\r\n{code}a|b{code}';
    const input=descriptions['12']+'\n\nДополнительно: '+body,rows=v.descriptionTableRows(meta(),'12',input),md=v.markdownTemplateDescription(meta(),'12',input);
    assert.deepEqual(plain(v.descriptionTableRows(meta(),'12',md)),plain(rows));assert.equal(v.descriptionTableRows(meta(),'12',md).at(-1).value,body);
    assert.ok(md.includes('&#124;'));assert.doesNotMatch(md,/<script>|```sh|\{code\}/);
    for(const line of md.split('\n'))assert.equal(line.split('|').length,4,line);
    const wiki=v.jiraTemplateDescription(meta(),'12',md);assert.ok(wiki.includes('a\\|b'));assert.doesNotMatch(wiki,/\{code\}/);assert.ok(wiki.includes('\\\\'));
    assert.equal(v.descriptionTableRows(meta(),'12',wiki).at(-1).value,body.replace(/\r\n/g,'\n'));
});
test('ordinary prose, custom-only descriptions, foreign tables and other projects are preserved',()=>{
    for(const input of ['Обычный текст без каркаса.','Мой раздел: оставить `x|y` без изменений.','| Колонка | Значение |\n| --- | --- |\n| a | b |']) {
        assert.deepEqual(plain(v.descriptionTableRows(meta(),'12',input)),[]);assert.equal(v.markdownTemplateDescription(meta(),'12',input),input);assert.equal(v.jiraTemplateDescription(meta(),'12',input),input);
    }
    assert.equal(v.markdownTemplateDescription(meta('APP'),'20',descriptions['12']),descriptions['12']);assert.equal(v.jiraTemplateDescription(meta('APP'),'20',descriptions['12']),descriptions['12']);
});
test('empty standard descriptions project required holes before chat without replacing unmarked user text',()=>{
    for(const id of ['10','11','12']) {
        const rows=v.descriptionTableRows(meta(),id,'');assert.ok(rows.length>=5);assert.ok(rows.every(row=>row.value===''));
        assert.ok(rows.every(row=>!row.label.startsWith('Срок')));assert.match(v.markdownTemplateDescription(meta(),id,''),/^\| Поле \| Описание \|/);
        const raw='Пользовательский текст без реквизитов.';assert.equal(v.markdownTemplateDescription(meta(),id,raw),raw);assert.equal(v.jiraTemplateDescription(meta(),id,raw),raw);
    }
    assert.deepEqual(plain(v.descriptionTableRows(meta('APP'),'20','')),[]);
});
test('Jira wiki table does not escape repository URL hyphens as text formatting',()=>{
    const url='https://example.org/mama-myla-ramu/feature_widget/v1.0-beta';
    const description=descriptions['12'].replace('https://git.example/api',url),wiki=v.jiraTemplateDescription(meta(),'12',description);
    assert.ok(wiki.includes('|Ссылки|'+url+'|'));assert.doesNotMatch(wiki,/mama\\-myla/);
    assert.equal(v.descriptionTableRows(meta(),'12',wiki).find(row=>row.label==='Ссылки').value,url);
});
test('standard pasted GFM escaped pipe becomes a literal pipe, not a backslash in Jira',()=>{
    const markdown='| Поле | Описание |\n| --- | --- |\n| Среда | DEV \\| TEST |\n| Версия и состав | commit 5961fa4 |\n| Порядок | заменить скрипт |\n| Окно | рабочее время |\n| Проверка | постановщик проверит карточку |\n| Ссылки | https://git.example/mama-myla-ramu |';
    assert.equal(v.descriptionTableRows(meta(),'12',markdown)[0].value,'DEV | TEST');
    const canonical=v.formatDevopsDescription(meta(),'12',markdown,true);assert.ok(canonical.startsWith('Среда: DEV | TEST'));
    const wiki=v.jiraTemplateDescription(meta(),'12',markdown);assert.ok(wiki.includes('|Среда|DEV \\| TEST|'));assert.doesNotMatch(wiki,/&#92;/);
    assert.equal(v.descriptionTableRows(meta(),'12',wiki)[0].value,'DEV | TEST');
    const escaped=markdown.replace('DEV \\| TEST','DEV \\<br> \\&amp; \\*literal\\*');
    assert.equal(v.descriptionTableRows(meta(),'12',escaped)[0].value,'DEV <br> &amp; *literal*');
    const code=markdown.replace('DEV \\| TEST','`echo \\* \\| &amp; <br>`');
    assert.equal(v.descriptionTableRows(meta(),'12',code)[0].value,'`echo \\* | &amp; <br>`');
});
test('a pasted table value cannot inject extra section rows into strict validation',()=>{
    const input='Среда: DEV\n\nДополнительно: ```\nВерсия и состав: fake\nПорядок: fake\n```';
    const md=v.markdownTemplateDescription(meta(),'12',input),result=v.validateFields(meta(),'12',{summary:'Обновить API',description:md},{requireStructuredDescription:true});
    assert.equal(result.ok,false);assert.ok(result.questions.some(q=>q.id==='devops:release'));assert.ok(result.questions.some(q=>q.id==='devops:order'));
    const ambiguous=v.markdownTemplateDescription(meta(),'12','Среда: DEV')+'\n| Дополнительно | Версия и состав: fake<br>Порядок: fake |';
    assert.equal(v.formatDevopsDescription(meta(),'12',ambiguous,true),ambiguous);
    assert.equal(v.validateFields(meta(),'12',{summary:'Обновить API',description:v.formatDevopsDescription(meta(),'12',ambiguous,true)},{requireStructuredDescription:true}).ok,false);
    assert.equal(v.mergeDescriptionSections(meta(),'12',ambiguous,{links:'https://git.example/api'}).applied.length,0);
});
