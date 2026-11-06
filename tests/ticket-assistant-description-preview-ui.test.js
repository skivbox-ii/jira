const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const jquery=require('jquery');
const {loadUnit}=require('./helpers/ticket-assistant-fixture');
function fixture(t) {
 const dom=new JSDOM('<div id="root"></div>',{url:'https://jira.test/'}),window=dom.window,$=jquery(window),changes=[];
 const globals={window,document:window.document,URL,AbortController},icons=loadUnit('icons',{},globals),fields=loadUnit('fields');
 const view=loadUnit('field-ui',{_ujgTA_icons:icons,_ujgTA_fields:fields},globals).create({$,onChange:(id,value)=>changes.push([id,value])});view.mount(window.document.querySelector('#root'));t.after(()=>{view.destroy();window.close();});
 const update=(value,extra={})=>view.update({field:{id:'description',name:'Описание',kind:'textarea',supported:true,writable:true},value,scopeKey:'DEVOPS/task',descriptionPreview:true,...extra});
 return {window,doc:window.document,update,changes};
}
test('description preview is compact, accessible, live and preserves the ordinary editor',t=>{
 const h=fixture(t);h.update('Цель: **Проверить** API\n\nЧто сделать\n- Обновить `widget.js`');
 const preview=h.doc.querySelector('[data-ta-description-preview]'),edit=h.doc.querySelector('[data-ta-description-edit]'),textarea=h.doc.querySelector('textarea');
 assert.ok(preview);assert.equal(preview.hidden,false);assert.equal(textarea.hidden,true);assert.match(preview.querySelector('strong').textContent,/Цель/);assert.equal(preview.querySelector('li code').textContent,'widget.js');assert.equal(edit.getAttribute('aria-expanded'),'false');
 edit.click();assert.equal(textarea.hidden,false);assert.equal(preview.hidden,true);assert.equal(h.doc.activeElement,textarea);
 textarea.value='Проверка: Новый результат';textarea.dispatchEvent(new h.window.Event('input',{bubbles:true}));assert.deepEqual(h.changes,[['description',textarea.value]]);h.update(textarea.value);assert.equal(textarea.hidden,false);edit.click();assert.match(preview.textContent,/Новый результат/);
 h.update('Что происходит: Ошибка',{scopeKey:'DEVOPS/bug'});assert.equal(textarea.hidden,true);assert.match(preview.textContent,/Ошибка/);
 h.update('Без просмотра',{descriptionPreview:false});assert.equal(preview.hidden,true);assert.equal(edit.hidden,true);assert.equal(textarea.hidden,false);
 h.update('');assert.equal(textarea.hidden,false);assert.equal(edit.hidden,true);
});
test('preview never interprets HTML or unsafe links and renders Markdown headings',t=>{
 const h=fixture(t);h.update('## Среда\nDEV\n\n**Проверка:** Открыть [Jira](https://jira.test/path)\n<script>window.pwned=1</script>\n[Standalone](https://jira.test/standalone)\n[bad](javascript:alert(1))\n![image](https://evil.test/a)');
 const p=h.doc.querySelector('[data-ta-description-preview]');assert.ok(p);assert.equal(p.querySelector('strong').textContent,'Среда');assert.equal(p.querySelectorAll('script,img,iframe').length,0);assert.equal(p.querySelectorAll('a').length,2);assert.equal(p.querySelector('a').getAttribute('href'),'https://jira.test/path');assert.match(p.textContent,/<script>/);assert.equal(h.window.pwned,undefined);
 h.update('Окно: Сегодня',{disabled:true});assert.equal(h.doc.querySelector('textarea').disabled,true);
});

test('inline unsafe destinations after formatted text never reuse a previous safe element',t=>{
 const h=fixture(t);h.update('**Текст** [Safe](https://jira.test/help) [Unsafe](javascript:boom) ![image](https://evil.test/img)');
 const p=h.doc.querySelector('[data-ta-description-preview]');assert.equal(p.querySelectorAll('a').length,1);assert.match(p.textContent,/\[Unsafe\]\(javascript:boom\)/);assert.match(p.textContent,/!\[image\]/);
 h.doc.querySelector('[data-ta-description-edit]').click();h.update('Окно: Текст');h.doc.querySelector('textarea').dispatchEvent(new h.window.Event('taEditDescription'));assert.equal(h.doc.querySelector('textarea').hidden,false);
});

test('typing into an initially empty description stays in the editor across controller echoes',t=>{
 const h=fixture(t);h.update('');const textarea=h.doc.querySelector('textarea');textarea.value='Ручной ввод';textarea.dispatchEvent(new h.window.Event('input',{bubbles:true}));h.update(textarea.value);assert.equal(textarea.hidden,false);assert.equal(h.doc.querySelector('[data-ta-description-preview]').hidden,true);
});

const {liveFixture}=require('./helpers/ticket-assistant-live-card-fixture');
test('live editor trusts only controller standardDescriptionTemplate eligibility with no project fallback',async t=>{
 const h=await liveFixture(t);await h.controller.updateField('description','Цель: Не менять исходный текст');
 const base=h.controller.getState(),state={...base,meta:{...base.meta,projectKey:'DEVOPS'},draft:{...base.draft,projectKey:'DEVOPS'},settings:{...base.settings,descriptionFormat:'markdown'}};
 const preview=h.doc.querySelector('[data-ta-description-preview]'),toggle=h.doc.querySelector('[data-ta-description-edit]'),textarea=h.doc.querySelector('[data-ta-field=description] textarea');
 h.ui.update({...state,standardDescriptionTemplate:true});assert.equal(preview.hidden,false);assert.equal(textarea.hidden,true);
 for(const eligibility of [false,undefined,null,'true']) {
  h.ui.update({...state,standardDescriptionTemplate:eligibility});assert.equal(preview.hidden,true);assert.equal(toggle.hidden,true);assert.equal(textarea.hidden,false);assert.equal(textarea.value,'Цель: Не менять исходный текст');
 }
 h.ui.update({...state,standardDescriptionTemplate:true,settings:{...state.settings,descriptionFormat:'plain'}});assert.equal(preview.hidden,true);assert.equal(toggle.hidden,true);assert.equal(textarea.hidden,false);
 h.ui.update({...state,standardDescriptionTemplate:true,settings:{...state.settings,descriptionFormat:undefined}});assert.equal(preview.hidden,false);toggle.click();assert.equal(textarea.hidden,false);assert.equal(preview.hidden,true);
});
