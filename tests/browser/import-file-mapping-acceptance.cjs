// Run against the loopback import preview with NODE_PATH containing xlsx and playwright.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');
const {chromium} = require('playwright');
const origin = new URL(process.env.IMPORT_PREVIEW_URL || 'http://127.0.0.1:4317').origin;
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const artifacts = process.env.IMPORT_MAPPING_ARTIFACTS;
function file(name, sheets) {
  const book = XLSX.utils.book_new();
  for (const [tab, rows] of sheets) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), tab);
  return {name, mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer:XLSX.write(book, {type:'buffer', bookType:'xlsx'})};
}
const complete = file('Полный.xlsx', [['Обложка', [['Реестр']]], ['Замечания', [
  ['Проект'], [], ['ID','Замечание','Jira','Ответственный','Модуль','Приоритет','Статус в Jira','Исполнитель в Jira','Спринт','Срок'],
  ['112','Контрольное замечание','EVOSCADA-112','Анна','А','Средний','Выдано','Иван','Спринт 1','12.11.2026']
]]]);
const partial = file('Новый.xlsx', [['Титул', [['Ведомость']]], ['Журнал', [
  [], ['Журнал проекта'], [], ['№', 'Владелец по файлу'], ['245','Петров'], ['298','Иванов']
]]]);
async function scenario(page, width) {
  await page.goto(origin + '/?empty');
  const dialog = page.getByRole('dialog',{name:'Соответствие колонок Excel'});
  const apply = dialog.getByRole('button',{name:'Применить и загрузить'});
  const field = key => dialog.locator('[data-preflight-field="'+key+'"]');
  async function open(input) {
    await page.locator('.ujg-esi-file').setInputFiles(input);
    await dialog.waitFor({state:'visible',timeout:5000});
  }
  async function applyAndCount(n) {
    assert.equal(await apply.isEnabled(),true);
    await apply.click(); await dialog.waitFor({state:'hidden'});
    assert.equal(await page.locator('.ujg-esi-parent-row').count(),n);
  }
  // All ten fields match without intervention. Confirmation is still mandatory.
  await open(complete);
  assert.match(await dialog.locator('[data-preflight-sheet]').innerText(),/Замечания/);
  assert.equal(await dialog.locator('[data-preflight-header]').inputValue(),'3');
  assert.equal(await page.locator('.ujg-esi-parent-row').count(),0);
  await field('owner').click();await page.locator('[data-preflight-skip]').click();
  await applyAndCount(1);
  await page.reload();
  await open(complete);
  assert.match(await field('owner').innerText(),/Не импортировать/);
  await field('owner').click();await page.locator('[data-preflight-option="3"]').click();
  await dialog.getByRole('button',{name:'Отмена',exact:true}).click();
  await open(complete);assert.match(await field('owner').innerText(),/Не импортировать/);
  await applyAndCount(1);
  // The remembered sheet is absent; a numbered but untitled workbook must still import.
  await open(partial);
  assert.match(await dialog.locator('[data-preflight-sheet]').innerText(),/Журнал/);
  assert.equal(await dialog.locator('[data-preflight-header]').inputValue(),'4');
  assert.match(await dialog.locator('.ujg-esi-preflight-counts').innerText(),/К импорту: 2/);
  assert.match(await field('summary').innerText(),/Не импортировать/);
  assert.equal(await dialog.locator('[data-preflight-row="summary"] .is-missing').count()>0,true);
  await field('owner').click();await page.locator('[data-preflight-option="1"]').click();
  if (artifacts) await page.screenshot({path:path.join(artifacts,'mapping-'+width+'.png')});
  await applyAndCount(2);
  assert.match(await page.locator('.ujg-esi-parent-row').first().innerText(),/245/);
  await open(partial);
  assert.match(await field('owner').innerText(),/Владелец по файлу/);
  assert.equal(await dialog.locator('[data-preflight-header]').inputValue(),'4');
  await dialog.getByRole('button',{name:'Отмена',exact:true}).click();
  // Repeated headers: if the user picked the second table, don't move back
  // to the first one just because it has the same headings after re-opening.
  const repeated=file('Две таблицы.xlsx',[['Реестр',[
    ['№','Текст из файла'],['110','Первый раздел'],[],['№','Текст из файла'],['Секция 320','Второй раздел']
  ]]]);
  await open(repeated);
  const header=dialog.getByRole('spinbutton',{name:'Строка заголовков'});
  assert.equal(await header.inputValue(),'1');
  await header.fill('4');await header.press('Tab');
  assert.match(await dialog.locator('.ujg-esi-preflight-counts').innerText(),/К импорту: 1/);
  await applyAndCount(1);
  assert.match(await page.locator('.ujg-esi-parent-row').innerText(),/Секция 320/);
  await page.reload();await open(repeated);
  assert.equal(await header.inputValue(),'4');
  await applyAndCount(1);
  assert.equal(await page.evaluate(()=>window.mutationCalls),0);
}
(async()=>{
  if(artifacts) fs.mkdirSync(artifacts,{recursive:true});
  const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined});
  try {
    for(const width of [1440,390]) {
      const context=await browser.newContext({viewport:{width,height:width===390?844:900}});
      const unexpected=[];
      await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():(unexpected.push(r.request().url()),r.abort()));
      const page=await context.newPage();page.on('pageerror',e=>unexpected.push(e.message));
      try {await scenario(page,width);assert.deepEqual(unexpected,[]);console.log('PASS '+width+': always confirm, saved choices, cancel, sheet/header detection and ID-only import');}
      finally {await context.close();}
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
