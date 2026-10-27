const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {chromium}=require("playwright");
const origin=process.env.IMPORT_PREVIEW_URL||"http://127.0.0.1:4318";
const artifacts=process.env.IMPORT_EPIC_FILTER_ARTIFACTS||"/tmp/import-epic-filter-reference-20261027";
assert.ok(["127.0.0.1","localhost","[::1]"].includes(new URL(origin).hostname));
async function scenario(page,width,height) {
  await page.goto(origin+"/?empty&usability&progressive&multiEpics&epicCatalog=long");
  await page.getByRole("button",{name:"Режим Jira",exact:true}).click();
  const picker=page.locator(".ujg-esi-epic-picker");
  const open=()=>picker.getByRole("button",{name:/Эпики/}).first().click();
  await open();
  const popup=picker.getByRole("dialog");
  const search=popup.getByRole("searchbox");
  const all=popup.getByRole("checkbox",{name:"Выделить все найденные эпики"});
  const candidate=key=>popup.locator('input[value="EVOSCADA-'+key+'"]');
  const chips=popup.locator(".ujg-esi-selected-chip");
  await candidate(100).click();
  assert.equal(await chips.count(),1,"Selected epic must become a removable pinned chip");
  assert.equal(await candidate(100).count(),0,"Selected epic must not be duplicated among candidates");
  assert.equal(await popup.locator(".ujg-esi-filter-count").innerText(),"1 / 21");
  assert.equal(await all.evaluate(n=>n.indeterminate),true);
  assert.deepEqual(await page.evaluate(()=>usabilityState.epicKeys),[],"Draft must not apply early");
  await popup.screenshot({path:path.join(artifacts,`reference-${width}x${height}.png`)});
  await search.fill("Север");
  assert.equal(await chips.count(),1);
  await chips.first().click();
  assert.equal(await candidate(100).isVisible(),false,"Nonmatching removed chip must not appear in search results");
  await search.fill("");await candidate(100).click();await search.fill("Север");
  const matchingCount=await popup.locator(".ujg-esi-epic-option:visible").count();
  await all.click();assert.equal(await chips.count(),matchingCount+1);
  assert.equal(await all.isChecked(),true);
  assert.equal(await popup.locator(".ujg-esi-epic-option:visible").count(),0);
  await all.click();assert.equal(await chips.count(),1,"Search select-all must preserve selections outside query");
  await search.fill("нет такого эпика");assert.equal(await all.isDisabled(),true);
  assert.match(await popup.locator(".ujg-esi-filter-empty").innerText(),/Нет значений/);
  await search.fill("");
  await popup.getByRole("button",{name:"Сортировка по убыванию списка эпиков",exact:true}).click();
  const texts=await popup.locator(".ujg-esi-epic-option").allTextContents();
  assert.deepEqual(texts,[...texts].sort((a,b)=>-a.localeCompare(b,"ru",{numeric:true})));
  await popup.getByRole("button",{name:"Сортировка по возрастанию списка эпиков",exact:true}).click();
  await popup.getByRole("button",{name:"Снять фильтр",exact:true}).click();
  assert.equal(await chips.count(),0);assert.match(await popup.innerText(),/Все истории проекта/);
  await all.click();assert.equal(await chips.count(),21);assert.equal(await all.isChecked(),true);
  assert.equal(await popup.locator(".ujg-esi-epic-option").count(),0);
  await popup.screenshot({path:path.join(artifacts,`all-selected-${width}x${height}.png`)});
  await all.click();await candidate(100).click();
  // A representative host form rule must not stack these rows or stretch checkboxes.
  await page.addStyleTag({content:".ujg-esi-field label { display:block; } .ujg-esi-field input { width:100%; }"});
  const geometry=await popup.evaluate(p=>{
    const r=p.getBoundingClientRect(),s=p.querySelector('input[type="search"]').getBoundingClientRect();
    const f=p.querySelector('.ujg-esi-filter-actions').getBoundingClientRect();
    const rows=[...p.querySelectorAll('.ujg-esi-epic-option')].filter(n=>!n.hidden).map(n=>{
      const c=n.querySelector('input').getBoundingClientRect(),t=n.querySelector('span').getBoundingClientRect();
      return {checkbox:c.width,textLeft:t.left,checkboxRight:c.right,firstLineOffset:c.top-t.top,overlap:Math.min(c.bottom,t.bottom)-Math.max(c.top,t.top)};
    });
    return {width:r.width,left:r.left,right:r.right,top:r.top,bottom:r.bottom,searchTop:s.top,footerBottom:f.bottom,
      overflow:p.scrollWidth>p.clientWidth+1,justify:getComputedStyle(p.querySelector('.ujg-esi-filter-actions')).justifyContent,rows};
  });
  assert.equal(geometry.width,282);assert.ok(geometry.left>=0&&geometry.right<=width&&geometry.top>=0&&geometry.bottom<=height);
  assert.ok(geometry.searchTop>=geometry.top&&geometry.footerBottom<=height);
  assert.equal(geometry.overflow,false);assert.equal(geometry.justify,"flex-end");
  assert.ok(geometry.rows.every(r=>r.checkbox===16&&r.textLeft>r.checkboxRight&&r.overlap>0&&Math.abs(r.firstLineOffset)<=2),"Checkbox must align with the first text line under host styles");
  await candidate(200).press("Space");
  assert.equal(await page.evaluate(()=>document.activeElement.getAttribute("data-epic-key")),"EVOSCADA-200");
  await popup.locator('.ujg-esi-selected-chip[data-epic-key="EVOSCADA-200"]').press("Enter");
  assert.equal(await page.evaluate(()=>document.activeElement.value),"EVOSCADA-200");
  const list=popup.locator(".ujg-esi-epic-list");await list.evaluate(n=>{n.scrollTop=n.scrollHeight;});
  assert.ok(await list.evaluate(n=>n.scrollTop>0),"Long catalog must scroll to last rows");
  await candidate(2100).click();
  await popup.getByRole("button",{name:"ОК",exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>usabilityState.epicKeys),["EVOSCADA-100","EVOSCADA-2100"]);
  await open();await search.fill("Север");await popup.getByRole("button",{name:"Снять фильтр",exact:true}).click();
  await popup.getByRole("button",{name:"Отмена",exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>usabilityState.epicKeys),["EVOSCADA-100","EVOSCADA-2100"]);
  await open();await popup.screenshot({path:path.join(artifacts,`final-${width}x${height}.png`)});
  assert.equal(await page.evaluate(()=>mutationCalls),0);assert.equal(await page.evaluate(()=>llmPreviewCalls.length),0);
  console.log(JSON.stringify({width,height,catalog:21,chips:true,noDuplicates:true,searchSelectAll:true,draftCancel:true,geometry,writes:0,llm:0}));
}
(async()=>{
  fs.mkdirSync(artifacts,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined});
  try {for(const [width,height] of [[1440,900],[390,844],[390,500]]) {
    const context=await browser.newContext({viewport:{width,height}});
    await context.addInitScript(()=>{localStorage.setItem("ujg-esi-state",JSON.stringify({projectKey:"EVOSCADA"}));});
    await context.route("**/*",r=>new URL(r.request().url()).origin===new URL(origin).origin?r.continue():r.abort());
    const page=await context.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));
    try {await scenario(page,width,height);assert.deepEqual(errors,[]);} catch(e){await page.screenshot({path:path.join(artifacts,`failure-${width}x${height}.png`)});throw e;}
    await context.close();
  }} finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
