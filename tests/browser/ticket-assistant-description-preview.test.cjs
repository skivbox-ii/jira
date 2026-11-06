const test=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {startPreview}=require('./ticket-assistant-preview-server.cjs');
const {sourcePreviewResponse}=require('../helpers/ticket-assistant-source-preview.cjs');
async function fixture(t,width=1440) {
 const server=await startPreview({port:0,sourceAssets:false}),browser=await chromium.launch({channel:'chrome',headless:true});t.after(async()=>{await browser.close();await server.close();});
 const page=await browser.newPage({viewport:{width,height:1000}});page.setDefaultTimeout(6000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const r=route.request();if(!r.url().startsWith(server.url)||r.method()!=='GET')return route.abort();const source=sourcePreviewResponse(new URL(r.url()).pathname);return source?route.fulfill(source):route.continue();});
 await page.goto(server.url);await page.waitForFunction(()=>document.documentElement.getAttribute('data-ta-preview-ready')==='true');
 await page.evaluate(async()=>{
  const f=window.taPreview;await f.ready;f.instance.destroy();const api={...f.api};
  api.getProjects=async()=>({values:[{key:'DEVOPS',id:'103',name:'DevOps'},{key:'APP',id:'102',name:'App'}],complete:true});
  api.getCreateMeta=async key=>{const m=await f.api.getCreateMeta(key);if(key==='DEVOPS'){m.projects[0].issuetypes[2].name='Задача развертывания';m.projects[0].issuetypes[2].fields=m.projects[0].issuetypes[0].fields;}return m;};
  const Gadget=window.taRequire('_ujgTicketAssistantRuntime');f.instance=new Gadget({getGadgetContentEl:()=>window.jQuery('#ticket-assistant')},{api,storage:window.localStorage});await f.instance.ready;
  const c=f.instance.controller;await c.selectProject('DEVOPS');await c.selectIssueType('10');await c.selectTemplate('task');
 });return {page,errors};
}
async function chooseFormat(page,id) {
 await page.locator('[data-ta-open-settings]').click();
 await page.locator('[data-ta-description-format] [data-ta-picker]').click();
 await page.locator('[data-ta-description-format] [data-ta-candidate]').filter({hasText:'('+id+')'}).click();
 assert.notEqual(await page.evaluate(()=>window.taPreview.instance.controller.getState().settings.descriptionFormat),id);
 await page.locator('[data-ta-settings-apply]').click();
 await page.locator('[data-ta-settings-dialog]').waitFor({state:'hidden'});
 assert.equal(await page.evaluate(()=>window.taPreview.instance.controller.getState().settings.descriptionFormat),id);
}
for(const width of [1440,390])test('DEVOPS description preview covers three types, manual editing, settings and reset at '+width,async t=>{
 const {page,errors}=await fixture(t,width),preview=page.locator('[data-ta-description-preview]'),textarea=page.locator('[data-ta-field=description] textarea'),toggle=page.locator('[data-ta-description-edit]');
 const descriptions={task:'Цель: Проверить **API**\n\nЧто сделать\n- Обновить `widget.js`\n\nКритерии приёмки: Карточки видны',bug:'## Что происходит\nОшибка API\n\n**Что ожидалось:** Сохранение\n\nШаги воспроизведения:\n1. Открыть страницу',deployment:'Среда: DEV\n\nВерсия и состав: commit abc1234\n\nПорядок:\n1. Заменить скрипт\n2. Обновить страницу\n\nПроверка: Карточки видны\n\nСсылки: [Jira](https://jira.test/browse/DEVOPS-1)'};
 for(const [i,kind] of ['task','bug','deployment'].entries()) {
  const description=descriptions[kind];await page.evaluate(async({id,kind,description})=>{const c=window.taPreview.instance.controller;await c.selectIssueType(id);await c.selectTemplate(kind);await c.updateField('description',description);},{id:String(10+i),kind,description});
  assert.equal(await preview.isVisible(),true);assert.equal(await textarea.isHidden(),true);assert.equal(await textarea.inputValue(),description);assert.ok(await preview.locator('strong').count()>0);assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  await toggle.click();assert.equal(await textarea.isVisible(),true);assert.equal(await preview.isHidden(),true);await textarea.fill(description+'\n\nДополнительно: Ручная правка');await textarea.press('Tab');
  await page.waitForFunction(()=>window.taPreview.instance.controller.getState().draft.fields.description.endsWith('Ручная правка'));
  await toggle.click();assert.match(await preview.innerText(),/Ручная правка/);
 }
 assert.equal(await preview.locator('a').getAttribute('rel'),'noopener noreferrer');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await chooseFormat(page,'plain');assert.equal(await preview.isHidden(),true);assert.equal(await toggle.isHidden(),true);assert.equal(await textarea.isVisible(),true);
 await chooseFormat(page,'markdown');assert.equal(await preview.isVisible(),true);
 await page.screenshot({path:'/tmp/ticket-assistant-description-preview-'+width+'.png',fullPage:true});
 await page.getByRole('button',{name:'Очистить',exact:true}).click();await page.waitForFunction(()=>!window.taPreview.instance.controller.getState().draft.fields.description);assert.equal(await preview.isHidden(),true);assert.equal(await textarea.isVisible(),true);
 await textarea.fill('Ручной ввод с пустой карточки');await page.waitForFunction(()=>window.taPreview.instance.controller.getState().draft.fields.description==='Ручной ввод с пустой карточки');assert.equal(await textarea.isVisible(),true);assert.equal(await preview.isHidden(),true);
 await page.evaluate(async()=>{const c=window.taPreview.instance.controller;await c.selectProject('APP');await c.selectIssueType('20');await c.selectTemplate('task');await c.updateField('description','Цель: Обычный редактор');});assert.equal(await preview.isHidden(),true);assert.equal(await textarea.isVisible(),true);
 assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>window.taPreview.calls.filter(x=>x==='create'||x.startsWith('upload:')).length),0);
});
test('live preview treats HTML and unsafe link destinations as inert text',async t=>{
 const {page,errors}=await fixture(t);await page.evaluate(()=>window.taPreview.instance.controller.updateField('description','## Проверка\n<script>window.previewPwned=true</script>\n<img src=x onerror="window.previewPwned=true">\n[Unsafe](javascript:alert(1))\n[Data](data:text/html,boom)\n![remote](https://evil.test/img)\n[Safe](https://jira.test/help)'));
 const preview=page.locator('[data-ta-description-preview]');assert.equal(await preview.locator('script,img,iframe').count(),0);assert.equal(await preview.locator('a').count(),1);assert.equal(await page.evaluate(()=>window.previewPwned),undefined);assert.match(await preview.innerText(),/<script>/);assert.deepEqual(errors,[]);
});

test('custom or unrelated templates do not inherit standard preview and settings changes restore eligibility',async t=>{
 const {page,errors}=await fixture(t),preview=page.locator('[data-ta-description-preview]'),toggle=page.locator('[data-ta-description-edit]'),textarea=page.locator('[data-ta-field=description] textarea');
 await page.evaluate(()=>window.taPreview.instance.controller.updateField('description','Цель: Сохранить текст пользователя'));
 assert.equal(await page.evaluate(()=>window.taPreview.instance.controller.getState().standardDescriptionTemplate),true);assert.equal(await preview.isVisible(),true);
 const original=await page.evaluate(()=>window.taPreview.instance.controller.getState().settings);
 for(const property of ['name','whenToUse','instructions']) {
  await page.evaluate(async({original,property})=>{const c=window.taPreview.instance.controller,settings=JSON.parse(JSON.stringify(original)),profile=settings.profiles.find(p=>p.id===settings.activeProfileId);profile.templates.find(t=>t.id==='task')[property]+=' Пользовательское правило';await c.applySettings(settings);},{original,property});
  assert.equal(await page.evaluate(()=>window.taPreview.instance.controller.getState().standardDescriptionTemplate),false);assert.equal(await preview.isHidden(),true);assert.equal(await toggle.isHidden(),true);assert.equal(await textarea.isVisible(),true);assert.equal(await textarea.inputValue(),'Цель: Сохранить текст пользователя');
  await page.evaluate(settings=>window.taPreview.instance.controller.applySettings(settings),original);assert.equal(await preview.isVisible(),true);
 }
 await page.evaluate(async()=>{const c=window.taPreview.instance.controller;await c.selectProject('APP');await c.selectIssueType('20');await c.selectTemplate('task');await c.updateField('description','Цель: Другой проект');});assert.equal(await page.evaluate(()=>window.taPreview.instance.controller.getState().standardDescriptionTemplate),false);assert.equal(await preview.isHidden(),true);assert.equal(await toggle.isHidden(),true);assert.equal(await textarea.isVisible(),true);
 assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>window.taPreview.calls.filter(x=>x==='create'||x.startsWith('upload:')).length),0);
});
