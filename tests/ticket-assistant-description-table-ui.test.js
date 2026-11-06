const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const jquery=require('jquery');
const {loadUnit}=require('./helpers/ticket-assistant-fixture');
test('description rows render a semantic two-column table with empty labels and inert content',t=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://jira.test/'}),window=dom.window,$=jquery(window),globals={window,document:window.document,URL,AbortController};
 const fieldUi=loadUnit('field-ui',{_ujgTA_icons:loadUnit('icons',{},globals),_ujgTA_fields:loadUnit('fields')},globals);let seen;
 const view=fieldUi.create({$,onChange(){},descriptionTableRows:text=>{seen=text;return [{label:'Среда',value:'DEV, после 18:00'}, {label:'Порядок действий',value:'1. Заменить `widget.js`\n2. Перезагрузить страницу'}, {label:'Ссылки',value:''}, {label:'<img onerror=boom>',value:'<script>boom</script> [bad](javascript:boom) [repo](https://jira.test/repo)'}];}});view.mount(window.document.querySelector('#root'));t.after(()=>{view.destroy();window.close();});
 const value='Канонический текст';view.update({field:{id:'description',name:'Описание',kind:'textarea',supported:true,writable:true},value,scopeKey:'DEVOPS/task',descriptionPreview:true});
 const p=window.document.querySelector('[data-ta-description-preview]'),table=p.querySelector('table');assert.ok(table);assert.equal(table.querySelectorAll('thead th[scope=col]').length,2);assert.equal(table.querySelectorAll('tbody tr').length,4);assert.equal(table.querySelectorAll('tbody th[scope=row]').length,4);assert.equal(table.querySelector('tbody tr:nth-child(3) td').textContent,'Не заполнено');assert.equal(table.querySelector('tbody tr:nth-child(2) td').textContent,'1. Заменить `widget.js`\n2. Перезагрузить страницу');assert.equal(p.querySelectorAll('img,script').length,0);assert.equal(p.querySelectorAll('a').length,0);assert.equal(table.querySelector('tbody tr:first-child td').textContent,'DEV, после 18:00');assert.equal(seen,value);assert.equal(window.document.querySelector('textarea').value,value);
 window.document.querySelector('[data-ta-description-edit]').click();assert.equal(window.document.querySelector('textarea').hidden,false);assert.equal(p.hidden,true);
});
const {liveFixture}=require('./helpers/ticket-assistant-live-card-fixture');
test('UI passes authoritative schema and canonical text to row/copy formatters without mutating manual content',async t=>{
 const h=await liveFixture(t);await h.controller.updateField('description','Ручной текст | **точно**');const before=h.controller.getState();let rowCall,copyCall;
 h.validation.descriptionTableRows=(...args)=>{rowCall=args;return [{label:'Цель',value:'Ручной текст | **точно**'},{label:'Ссылки',value:''}];};
 const markdown='| Раздел | Описание |\n| --- | --- |\n| Цель | Ручной текст \\| **точно** |\n| Ссылки | |';
 h.validation.markdownTemplateDescription=(...args)=>{copyCall=args;return markdown;};
 const state={...before,standardDescriptionTemplate:true,settings:{...before.settings,descriptionFormat:'markdown'}};h.ui.update(state);
 assert.equal(h.doc.querySelectorAll('[data-ta-description-preview] tbody tr').length,2);assert.deepEqual(rowCall,[state.meta,state.draft.issueTypeId,'Ручной текст | **точно**']);
 h.doc.querySelector('[data-ta-copy=description]').click();assert.equal(h.doc.querySelector('[data-ta-copy-text]').value,markdown);assert.deepEqual(copyCall,rowCall);assert.equal(h.controller.getState().draft.fields.description,'Ручной текст | **точно**');assert.equal(h.controller.getState().draft.protectedFields.description,true);
 for(const config of [{...state,standardDescriptionTemplate:false},{...state,settings:{...state.settings,descriptionFormat:'plain'}}]) {
  h.ui.update(config);copyCall=null;h.doc.querySelector('[data-ta-copy=description]').click();assert.equal(h.doc.querySelector('[data-ta-copy-text]').value,'Ручной текст | **точно**');assert.equal(copyCall,null);assert.equal(h.doc.querySelector('[data-ta-description-preview]').hidden,true);
 }
});
