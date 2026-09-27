const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const origin=process.env.IMPORT_PREVIEW_URL||'http://127.0.0.1:4317';
assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
async function main(){
 const dir='/tmp/import-source-export-20260927';fs.mkdirSync(dir,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
 try{for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];
  await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(origin).origin?r.continue():r.abort());
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.waitForFunction(()=>document.querySelectorAll('.ujg-esi-parent-row').length>10);
  await page.evaluate(()=>{
   window.sourceReads=[];
   jQuery.ajax=function(options){
    window.sourceReads.push({url:options.url,type:options.type,data:options.data});
    if(options.type!=='GET')throw Error('Writes blocked');
    const url=new URL(options.url,location.origin),data=options.data;
    if(url.pathname.endsWith('/search')){
     const all=Object.values(fixtureIssues).filter(i=>i.fields.issuetype.name==='История');
     return Promise.resolve({startAt:data.startAt,total:all.length,issues:all.slice(data.startAt,data.startAt+100).map(i=>({key:i.key}))});
    }
    const key=url.pathname.split('/').pop(),raw=fixtureIssues[key];if(!raw)return Promise.reject({status:404});
    const copy=JSON.parse(JSON.stringify(raw));copy.fields.subtasks=[];
    copy.fields.comment=copy.fields.comment||{startAt:0,total:0,comments:[]};copy.fields.worklog=copy.fields.worklog||{startAt:0,total:0,worklogs:[]};
    for(const w of copy.fields.worklog.worklogs){w.created=w.started;w.updated=w.started;}
    return Promise.resolve(copy);
   };
  });
  await page.getByRole('tab',{name:'Динамика',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.ujg-esi-activity-coverage')?.textContent.includes('Проверена история'));
  await page.locator('.ujg-esi-source-command').click();
  const dialog=page.locator('.ujg-esi-source-dialog');assert.equal(await page.evaluate(()=>sourceReads.length),0);
  await page.screenshot({path:path.join(dir,'plan-'+width+'.png')});
  await dialog.locator('.ujg-esi-source-load').click();
  await page.waitForFunction(()=>document.querySelector('.ujg-esi-source-json')?.disabled===false);
  assert.match(await dialog.locator('.ujg-esi-source-status').textContent(),/Доступные записи прочитаны/);
  const download=await Promise.all([page.waitForEvent('download'),dialog.locator('.ujg-esi-source-json').click()]);
  const jsonPath=path.join(dir,'fixture-'+width+'.json');await download[0].saveAs(jsonPath);
  const data=JSON.parse(fs.readFileSync(jsonPath,'utf8'));assert.equal(data.coverage.complete,true);
  assert.equal(data.issues.length,await page.evaluate(()=>Object.keys(fixtureIssues).length));assert.equal(data.requests.length,await page.evaluate(()=>sourceReads.length));
  assert.ok(data.issues.every(i=>i.raw.fields.description));assert.equal(data.scope.projectKey,'EVOSCADA');
  const plain=await Promise.all([page.waitForEvent('download'),dialog.locator('.ujg-esi-source-day').click()]);
  const textPath=path.join(dir,'day-'+width+'.txt');await plain[0].saveAs(textPath);
  assert.match(fs.readFileSync(textPath,'utf8'),/######## ДЕНЬ/);
  const all=await Promise.all([page.waitForEvent('download'),dialog.locator('.ujg-esi-source-all').click()]);
  const allPath=path.join(dir,'all-'+width+'.txt');await all[0].saveAs(allPath);assert.match(fs.readFileSync(allPath,'utf8'),/ЖУРНАЛ ЗАПРОСОВ/);
  assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  await page.screenshot({path:path.join(dir,'data-'+width+'.png')});
  await dialog.locator('.ujg-esi-ai-content').evaluate(el=>{el.scrollTop=el.scrollHeight;});
  await page.screenshot({path:path.join(dir,'bottom-'+width+'.png')});
  assert.equal(await dialog.locator('.ujg-esi-ai-content').evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight<2),true);
  await dialog.locator('.ujg-esi-source-prev').click();assert.match(await dialog.locator('.ujg-esi-source-text').textContent(),/######## ДЕНЬ/);
  await dialog.locator('.ujg-esi-source-close').click();assert.equal(await page.evaluate(()=>mutationCalls),0);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({width,issues:data.issues.length,parents:data.parentKeys.length,requests:data.requests.length,days:new Set(data.issues.flatMap(i=>i.collections.histories.entries.map(h=>h.created.slice(0,10)))).size}));
  await context.close();
 }}finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
