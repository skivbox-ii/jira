const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const origin=process.env.IMPORT_PREVIEW_URL||'http://127.0.0.1:4319';
const artifacts=process.env.IMPORT_FILTERED_HISTORY_ARTIFACTS||'/tmp/import-filtered-history-20261027';
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname));
const band=page=>page.locator('.ujg-esi-request-progress[data-progress-kind="registry"]');
const load=page=>page.getByRole('button',{name:'Загрузить замечания из Jira',exact:true}).click();
async function settled(page) {await page.waitForFunction(()=>!usabilityState.registryLoading&&!usabilityState.syncLoading&&usabilityState.registryProgress?.status!=='running',null,{timeout:60000});}
const reads=page=>page.evaluate(()=>progressiveFixture.requests.filter(r=>r.heavy).map(r=>r.url.split('/').pop()));
async function exclusions(page,value,apply=true) {
  const filter=page.locator('th[data-column="status"] .ujg-esi-header-filter');
  // Expose the offscreen column first: table scrolling intentionally dismisses menus.
  await filter.evaluate(n=>n.scrollIntoView({block:'nearest',inline:'center'}));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await filter.click();
  await page.getByRole('checkbox',{name:'Исключить готовые',exact:true}).setChecked(value);
  await page.getByRole('checkbox',{name:'Исключить готовые истории',exact:true}).setChecked(value);
  await page.locator('.ujg-esi-column-filter-menu').getByRole('button',{name:apply?'ОК':'Отмена',exact:true}).click();
}
async function shot(page,name) {
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.screenshot({path:path.join(artifacts,name+'.png')});
}
async function scenario(page,width) {
  await page.goto(origin+'/?empty&usability&progressive&filteredHistory');
  await page.getByRole('button',{name:'Режим Jira',exact:true}).click();
  await load(page);await settled(page);
  const expected=await page.evaluate(()=>filteredHistoryFixture.visible.slice().sort());
  const first=await reads(page);
  assert.deepEqual([...first].sort(),expected,'Applied saved exclusions must avoid hidden completed histories');
  assert.equal(await page.evaluate(()=>usabilityState.rows.length),4,'Base rows must remain available');
  assert.equal(first.filter(k=>k==='EVOSCADA-202').length,1,'Shared visible child must be fetched once');
  assert.equal(await page.evaluate(()=>usabilityState.rows.find(r=>r.jiraKey==='EVOSCADA-103').storyDetails.done),false,'Reopened wins over stale resolution');
  assert.equal(await band(page).isVisible(),false);
  await shot(page,'excluded-'+width);
  await exclusions(page,false,false);assert.deepEqual(await reads(page),first,'Cancelled draft must not load');
  await exclusions(page,false);await settled(page);
  const all=await page.evaluate(()=>filteredHistoryFixture.all.slice().sort());
  assert.deepEqual((await reads(page)).sort(),all,'Removing exclusions loads only missing histories');
  await exclusions(page,true);await settled(page);assert.equal((await reads(page)).length,8,'Re-exclusion keeps completed evidence');

  // Collapse/reveal overrides the child-ready filter only inside this remark.
  await page.locator('tr[data-row-uid]').filter({has:page.locator('a[href$="/EVOSCADA-102"]')}).first().getByRole('button',{name:/Свернуть замечание/}).click();
  await page.locator('tr[data-row-uid]').filter({has:page.locator('a[href$="/EVOSCADA-102"]')}).first().getByRole('button',{name:/Развернуть замечание/}).click();
  assert.equal(await page.locator('a[href$="/EVOSCADA-203"]').count(),1);
  await exclusions(page,true);await settled(page);

  // Apply exclusions while an obsolete, unabortable ready Story is in flight.
  await exclusions(page,false);await settled(page);
  await page.evaluate(()=>{progressiveFixture.requests=[];progressiveFixture.historyDelay=500;progressiveFixture.ignoreAbort=true;});
  await load(page);await page.waitForFunction(()=>progressiveFixture.requests.some(r=>r.heavy));
  await exclusions(page,true);await settled(page);await page.waitForTimeout(600);
  const during=await reads(page);
  assert.ok(during.includes('EVOSCADA-101'),'Fixture first read must already be in flight');
  assert.ok(!during.includes('EVOSCADA-201')&&!during.includes('EVOSCADA-104')&&!during.includes('EVOSCADA-203')&&!during.includes('EVOSCADA-204'),'Newly hidden queued requests must not start');
  assert.equal(await page.evaluate(()=>usabilityState.rows.find(r=>r.jiraKey==='EVOSCADA-101').storyDetails.statusSince||''),'','Late hidden history must not be accepted');
  await shot(page,'changed-during-load-'+width);

  await page.evaluate(()=>{progressiveFixture.requests=[];progressiveFixture.historyDelay=1;progressiveFixture.ignoreAbort=false;});
  await page.getByRole('tab',{name:'Динамика',exact:true}).click();
  await page.waitForFunction(()=>!usabilityState.activityLoading&&!usabilityState.registryLoading&&usabilityState.reportView==='activity',null,{timeout:60000});
  const activity=await page.evaluate(()=>progressiveFixture.requests.filter(r=>r.heavy&&String(r.payload.fields).includes('comment')).map(r=>r.url.split('/').pop()).sort());
  assert.deepEqual(activity,all,'Dynamics must include history and comments of currently hidden ready stories');
  assert.ok(await page.evaluate(()=>usabilityState.rows.find(r=>r.jiraKey==='EVOSCADA-101').storyDetails.activity.comments.complete));
  assert.match(await page.locator('#root').innerText(),/Комментарий к готовому замечанию/);
  await shot(page,'dynamics-complete-'+width);

  // All parents ready: zero registry histories and no perpetual spinner.
  await page.goto(origin+'/?empty&usability&progressive&filteredHistory');
  await page.evaluate(()=>Object.values(fixtureIssues).filter(i=>i.fields.issuetype.name==='История').forEach(i=>{
    i.fields.status={id:'3',name:'Готово',statusCategory:{key:'done'}};
    Object.assign(i.changelog.histories[0].items[0],{to:'3',toString:'Готово'});
  }));
  await page.getByRole('button',{name:'Режим Jira',exact:true}).click();await load(page);await settled(page);
  assert.deepEqual(await reads(page),[]);assert.equal(await band(page).isVisible(),false);
  assert.equal(await page.evaluate(()=>usabilityState.rows.some(r=>r.storyDetails.historyState==='pending')),false);
  await shot(page,'all-hidden-'+width);
  await page.evaluate(()=>{progressiveFixture.historyDelay=1000;progressiveFixture.ignoreAbort=true;});
  await exclusions(page,false);await page.waitForFunction(()=>progressiveFixture.requests.some(r=>r.heavy));
  await band(page).locator('[data-request-control="stop"]').click();
  const stopped=(await reads(page)).length;
  await exclusions(page,true);await exclusions(page,false);await page.waitForTimeout(1100);
  assert.equal((await reads(page)).length,stopped,'Filter changes must not undo explicit Stop');
  await page.evaluate(()=>{progressiveFixture.historyDelay=1;progressiveFixture.ignoreAbort=false;});
  await band(page).locator('[data-request-control="restart"]').click();await settled(page);
  assert.equal(await band(page).isVisible(),false);

  await page.evaluate(()=>{progressiveFixture.requests=[];progressiveFixture.failKeys['EVOSCADA-101']=true;});
  await load(page);await settled(page);
  assert.equal(await band(page).isVisible(),true);
  const errorReads=(await reads(page)).length;
  await page.evaluate(()=>{delete progressiveFixture.failKeys['EVOSCADA-101'];});
  await band(page).locator('[data-request-control="retry"]').click();await settled(page);
  assert.deepEqual((await reads(page)).slice(errorReads),['EVOSCADA-101'],'Retry loads only failed missing history');
  assert.equal(await page.evaluate(()=>mutationCalls),0);assert.equal(await page.evaluate(()=>llmPreviewCalls.length),0);
  console.log(JSON.stringify({width,totalIssues:8,registryHistoryRequests:3,savedRequests:5,sharedChildOnce:true,reopened:true,draftCancel:true,resumeMissing:true,lateHiddenIgnored:true,dynamicsFull:8,allHiddenZero:true,stopPreserved:true,retryMissingOnly:true,writes:0,llm:0}));
}
(async()=>{
  fs.mkdirSync(artifacts,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined});
  try {for(const width of [1440,390]) {
    const context=await browser.newContext({viewport:{width,height:width===1440?900:844}});
    await context.addInitScript(()=>localStorage.setItem('ujg-esi-state',JSON.stringify({projectKey:'EVOSCADA',gridLayout:{filters:{excludeDone:true,excludeDoneStories:true}}})));
    await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(origin).origin?r.continue():r.abort());
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    try {await scenario(page,width);assert.deepEqual(errors,[]);}catch(e){await page.screenshot({path:path.join(artifacts,'failure-'+width+'.png')});throw e;}
    await context.close();
  }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
