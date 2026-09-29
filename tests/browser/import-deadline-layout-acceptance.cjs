const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const XLSX = require("xlsx");
const {chromium} = require("playwright");

const origin = process.env.IMPORT_PREVIEW_URL || "http://127.0.0.1:4317";
assert.ok(["127.0.0.1","localhost","[::1]"].includes(new URL(origin).hostname));
const artifacts = process.env.IMPORT_DEADLINE_LAYOUT_ARTIFACTS || path.join(os.tmpdir(),"import-deadline-layout-acceptance");
const excelDates = {"EVOSCADA-16104":"2026-09-28","EVOSCADA-17906":"2026-09-29",
  "EVOSCADA-20000":"2026-09-30","EVOSCADA-21032":"31.02.2026"};
const jiraDates = {"EVOSCADA-16104":"2026-09-30","EVOSCADA-17906":"2026-09-28",
  "EVOSCADA-20000":null,"EVOSCADA-21032":"2026-02-31","EVOSCADA-18057":"2026-09-27","EVOSCADA-18080":null};
const captureState = `
(function() {
  var render=modules._ujgESI_rendering.render;
  modules._ujgESI_rendering.render=function(state) { window.deadlineLayoutState=state; return render.apply(this,arguments); };
})();`;

async function ready(page) {
  await page.waitForFunction(()=>window.deadlineLayoutState?.rows.length>60 &&
    !deadlineLayoutState.loading && !deadlineLayoutState.syncLoading && !deadlineLayoutState.registryLoading &&
    deadlineLayoutState.rows.some(row=>(row.jiraKey||row.createdKey)==="EVOSCADA-16104" && row.storyDetails),null,{timeout:60000});
}
async function mode(page, name) {
  await page.getByRole("button",{name:"Режим "+name,exact:true}).click();
  if(name==="Jira" && await page.locator(".ujg-esi-parent-row").count()===0) {
    await page.getByRole("button",{name:"Загрузить замечания из Jira",exact:true}).click();
  }
  await ready(page);
}
async function columns(page, names) {
  await page.getByRole("button",{name:"Столбцы",exact:true}).click();
  const menu=page.locator(".ujg-esi-grid-menu"), options=menu.locator(".ujg-esi-filter-option");
  for(const name of names) await options.filter({hasText:new RegExp("^"+name+"$")}).locator("input").check();
  for(let i=0;i<await options.count();i++) {
    const option=options.nth(i);
    if(!names.includes((await option.innerText()).trim())) await option.locator("input").uncheck();
  }
  await menu.locator(".ujg-esi-filter-apply").click();
}
async function layout(page) {
  return page.locator(".ujg-esi-registry-table").evaluate(table=>({
    columns:Array.from(table.querySelectorAll("thead th[data-column]")).map(th=>th.dataset.column),
    widths:Object.fromEntries(Array.from(table.querySelectorAll("col[data-column]")).map(col=>[col.dataset.column,Number(col.getAttribute("width"))]))
  }));
}
async function dateCell(page,key,column,text,late) {
  const cell=page.locator(`tr[data-key='${key}'] .ujg-esi-cell-${column}`).first();
  assert.equal(await cell.count(),1,key+" "+column);
  if(text!=null) assert.equal((await cell.innerText()).trim(),text);
  const style=await cell.evaluate(el=>({color:getComputedStyle(el).color,weight:Number(getComputedStyle(el).fontWeight)}));
  const rgb=style.color.match(/\d+/g).map(Number);
  const red=rgb[0]>rgb[1]*1.4 && rgb[0]>rgb[2]*1.4;
  assert.equal(red && style.weight>=600,late,key+" "+column+" late style "+JSON.stringify(style));
}
async function screenshot(page,name) {
  const bounds=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,
    grid:document.querySelector(".ujg-esi-registry-scroll").getBoundingClientRect().right,width:innerWidth}));
  assert.ok(bounds.overflow<=1 && bounds.grid<=bounds.width);
  await page.screenshot({path:path.join(artifacts,name+".png")});
}
async function noWrites(page) {
  assert.deepEqual(await page.evaluate(()=>({writes:mutationCalls,llm:llmPreviewCalls.length})),{writes:0,llm:0});
}

(async()=>{
  fs.mkdirSync(artifacts,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined});
  try {
    for(const width of [1440,390]) {
      const context=await browser.newContext({viewport:{width,height:900}});
      await context.addInitScript(()=>{
        if(sessionStorage.getItem("deadline-layout-seeded")) return;
        sessionStorage.setItem("deadline-layout-seeded","yes");
        localStorage.setItem("ujg-esi-state",JSON.stringify({projectKey:"EVOSCADA",gridLayout:{
          order:["deadline","summary","status","jiraComponent","remarkId"],
          visible:["deadline","summary","status"],widths:{deadline:128,summary:240},filters:{},sort:null
        }}));
      });
      await context.route("**/*",async route=>{
        const url=new URL(route.request().url());
        if(url.origin!==new URL(origin).origin) return route.abort();
        if(url.pathname==="/fixture.xlsx") {
          const response=await route.fetch(),book=XLSX.read(await response.body(),{type:"buffer"});
          const sheet=book.Sheets[book.SheetNames[0]], data=XLSX.utils.sheet_to_json(sheet,{header:1});
          const keyIndex=data[0].indexOf("Jira"), dueIndex=data[0].indexOf("Срок");
          assert.ok(keyIndex>=0 && dueIndex>=0);
          data.forEach((row,index)=>{
            if(Object.hasOwn(excelDates,row[keyIndex])) sheet[XLSX.utils.encode_cell({r:index,c:dueIndex})]={t:"s",v:excelDates[row[keyIndex]]};
          });
          return route.fulfill({response,body:XLSX.write(book,{type:"buffer",bookType:"xlsx"})});
        }
        if(["/test/fixture.js","/test/preview-bootstrap.js"].includes(url.pathname)) {
          const response=await route.fetch(),body=await response.text();
          const dates=Object.entries(jiraDates).map(([key,date])=>`fixtureIssues[${JSON.stringify(key)}].fields.duedate=${JSON.stringify(date)};`).join("\n");
          return route.fulfill({response,body:url.pathname==="/test/fixture.js" ? body+"\n"+dates : captureState+body});
        }
        return route.continue();
      });
      const page=await context.newPage(),errors=[];
      page.on("pageerror",error=>errors.push(error.message));
      await page.clock.install({time:new Date("2026-09-29T20:50:00Z")});
      await page.goto(origin); await ready(page);
      const legacy=await layout(page);
      assert.equal(legacy.widths.deadline,128);
      assert.equal(legacy.widths.summary,240);
      await columns(page,["Срок Excel","Срок Jira","Тема задачи"]);
      await dateCell(page,"EVOSCADA-16104","deadline","28.09.2026",true);
      await dateCell(page,"EVOSCADA-16104","jiraDueDate","30.09.2026",false);
      await dateCell(page,"EVOSCADA-17906","deadline","29.09.2026",false);
      await dateCell(page,"EVOSCADA-17906","jiraDueDate","28.09.2026",true);
      await dateCell(page,"EVOSCADA-20000","deadline","30.09.2026",false);
      await dateCell(page,"EVOSCADA-20000","jiraDueDate",null,false);
      await dateCell(page,"EVOSCADA-21032","deadline",null,false);
      await dateCell(page,"EVOSCADA-21032","jiraDueDate",null,false);
      await dateCell(page,"EVOSCADA-18057","jiraDueDate","27.09.2026",true);
      await dateCell(page,"EVOSCADA-18080","jiraDueDate",null,false);
      await page.getByRole("separator",{name:"Ширина: Срок Excel",exact:true}).press("ArrowRight");
      await page.getByRole("separator",{name:"Ширина: Срок Excel",exact:true}).press("ArrowRight");
      const excel=await layout(page); assert.equal(excel.widths.deadline,148);
      await screenshot(page,"excel-dates-"+width);
      await page.locator(".ujg-esi-team-filter-button").click();
      await page.locator(".ujg-esi-team-filter-only[data-team-id='qa']").click();
      await page.locator(".ujg-esi-team-filter-menu .ujg-esi-filter-apply").click();
      await mode(page,"Jira");
      assert.match(await page.locator(".ujg-esi-team-filter-button").innerText(),/QA/);
      const initialJira=await layout(page);
      assert.ok(initialJira.columns.includes("jiraDueDate"),"Jira date visible on migration");
      assert.equal(initialJira.widths.summary,240,"Unvisited Jira profile retains legacy width");
      assert.ok(initialJira.columns.includes("status"),"Excel visibility change must not overwrite unvisited Jira profile");
      await columns(page,["Срок Jira","Статус Jira"]);
      await page.getByRole("separator",{name:"Ширина: Срок Jira",exact:true}).press("ArrowRight");
      if(width>700) await page.locator("[data-sort='jiraDueDate']").dragTo(page.locator("[data-sort='status']"));
      const jira=await layout(page);
      await dateCell(page,"EVOSCADA-17906","jiraDueDate","28.09.2026",true);
      await screenshot(page,"jira-layout-"+width);
      await mode(page,"Excel"); assert.deepEqual(await layout(page),excel);
      await mode(page,"Jira"); assert.deepEqual(await layout(page),jira);
      await noWrites(page);
      await page.reload(); await ready(page);
      await mode(page,"Excel"); assert.deepEqual(await layout(page),excel);
      await mode(page,"Jira"); assert.deepEqual(await layout(page),jira);
      assert.match(await page.locator(".ujg-esi-team-filter-button").innerText(),/QA/);
      await page.getByRole("button",{name:"Столбцы",exact:true}).click();
      await page.getByRole("button",{name:"Сбросить расположение столбцов",exact:true}).click();
      assert.match(await page.locator(".ujg-esi-team-filter-button").innerText(),/QA/);
      await mode(page,"Excel"); assert.deepEqual(await layout(page),excel,"Reset only affects active Jira profile");
      await page.clock.pauseAt(new Date("2026-09-29T20:59:00Z"));
      await page.locator("[data-filter='deadline']").click();
      const search=page.getByRole("searchbox",{name:"Поиск значений",exact:true});
      await search.fill("2026-09-29");
      await page.locator(".ujg-esi-filter-values .ujg-esi-filter-option input").uncheck();
      await search.focus();
      const beforeMidnight=await page.evaluate(()=>{
        window.midnightTable=document.querySelector(".ujg-esi-registry-table");
        window.midnightSearch=document.querySelector(".ujg-esi-filter-search");
        const viewport=document.querySelector(".ujg-esi-registry-scroll");
        return {top:viewport.scrollTop,left:viewport.scrollLeft};
      });
      await page.clock.runFor(120000);
      await dateCell(page,"EVOSCADA-17906","deadline","29.09.2026",true);
      await dateCell(page,"EVOSCADA-20000","deadline","30.09.2026",false);
      assert.equal(await search.inputValue(),"2026-09-29");
      assert.equal(await page.locator(".ujg-esi-filter-values .ujg-esi-filter-option input").isChecked(),false);
      const afterMidnight=await page.evaluate(()=>{
        const viewport=document.querySelector(".ujg-esi-registry-scroll");
        return {top:viewport.scrollTop,left:viewport.scrollLeft,
          table:window.midnightTable===document.querySelector(".ujg-esi-registry-table"),
          focus:document.activeElement===window.midnightSearch};
      });
      assert.deepEqual(afterMidnight,{...beforeMidnight,table:true,focus:true});
      await search.press("Escape");
      await screenshot(page,"moscow-next-day-"+width);
      await noWrites(page); assert.deepEqual(errors,[]);
      console.log(JSON.stringify({width,excel,jira,midnight:true,writes:0,llm:0,errors,artifacts}));
      await context.close();
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
