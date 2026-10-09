const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {chromium} = require("playwright");
const origin = process.env.IMPORT_PREVIEW_URL || "http://127.0.0.1:4317";
const artifacts = process.env.IMPORT_COMMENTS_ARTIFACTS || "/tmp/import-comments-acceptance";
assert.ok(["127.0.0.1","localhost","[::1]"].includes(new URL(origin).hostname));

function injectFixture() {
  const date=window.fixtureDates[1], author={name:"reviewer",displayName:"Автор комментария"};
  const long="Проверено на локальном стенде.\n"+Array.from({length:45},(_,i)=>"Строка "+(i+1)+": полный текст комментария с результатами проверки.").join("\n")+"\n<script>window.commentXss=true</script>\nПОСЛЕДНЯЯ СТРОКА";
  window.commentBodies={short:"Короткий комментарий",long};
  window.commentFixture=[
    {id:"short",created:date+"T09:00:00+03:00",author,body:window.commentBodies.short},
    {id:"long",created:date+"T09:02:00+03:00",author,body:long},
    {id:"paged",created:date+"T09:04:00+03:00",author,body:"Комментарий с последней страницы"}
  ];
  window.fixtureIssues["EVOSCADA-50000"].fields.comment={startAt:0,total:3,comments:window.commentFixture.slice(0,1)};
  window.fixtureIssues["EVOSCADA-50001"].fields.comment={startAt:0,total:1,comments:[
    {id:"child",created:date+"T09:06:00+03:00",author,body:"Дочерняя задача\n"+"ДлиннаяСтрокаБезПробелов".repeat(70)}
  ]};
}
function injectApi() {
  window.commentReadCalls=[];
  window.offlineApi.getIssueComments=function(key,startAt) {
    window.commentReadCalls.push([key,startAt]);
    if(window.failComments&&startAt>0)return Promise.reject(new Error("Synthetic comment page failure"));
    return Promise.resolve({startAt,total:3,comments:window.commentFixture.slice(startAt,startAt+2)});
  };
  const summarize=modules._ujgESI_activity.summarize;
  modules._ujgESI_activity.summarize=function() {
    const report=summarize.apply(this,arguments);window.commentReport=report;return report;
  };
}
async function main() {
  fs.mkdirSync(artifacts,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined});
  try {
    for(const width of (process.env.IMPORT_COMMENTS_WIDTH ? [Number(process.env.IMPORT_COMMENTS_WIDTH)] : [1440,390])) {
      const context=await browser.newContext({viewport:{width,height:900}});
      await context.route("**/*",async route=>{
        const url=new URL(route.request().url());
        if(url.origin!==new URL(origin).origin)return route.abort();
        if(!["/test/performance-fixture.js","/test/performance-bootstrap.js"].includes(url.pathname))return route.continue();
        const response=await route.fetch();let body=await response.text();
        if(url.pathname.endsWith("fixture.js"))body+="\n("+injectFixture.toString()+")();";
        else body="("+injectApi.toString()+")();\n"+body.replace('  callbacks.onProjectChange("EVOSCADA");',
          '  window.commentAcceptance={state:function(){return currentState;},callbacks:function(){return callbacks;}}; callbacks.onProjectChange("EVOSCADA");');
        return route.fulfill({response,body});
      });
      const page=await context.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));
      await page.goto(origin+"/?performance");
      await page.waitForFunction(()=>window.commentAcceptance?.state()?.rows.length===250 && !window.commentAcceptance.state().activityLoading);
      const dates=await page.evaluate(()=>window.fixtureDates);
      const input=page.locator(".ujg-esi-activity-date");
      await input.fill(dates[1]);await input.dispatchEvent("change");
      await page.waitForFunction(date=>window.commentReport?.date===date&&window.commentReport.events.length===1004,dates[1]);
      assert.deepEqual(await page.evaluate(()=>({complete:window.commentReport.commentCoverage.complete,total:window.commentReport.commentCoverage.total,loaded:window.commentReport.commentCoverage.loaded})),{complete:1000,total:1000,loaded:4});
      assert.ok((await page.evaluate(()=>window.commentReadCalls)).some(call=>call[1]===2));
      const short=page.locator('.ujg-esi-activity-comment').filter({hasText:"Короткий комментарий"}).first();
      assert.equal(await short.locator('.ujg-esi-activity-comment-more').count(),0);
      const preview=page.locator('.ujg-esi-activity-comment-preview').filter({hasText:"Проверено на локальном стенде"}).first();
      await preview.scrollIntoViewIfNeeded();
      const geometry=await preview.evaluate(el=>({height:el.clientHeight,scroll:el.scrollHeight,line:parseFloat(getComputedStyle(el).lineHeight)}));
      assert.ok(geometry.height<=geometry.line*3+2,JSON.stringify(geometry));
      assert.ok(geometry.scroll>geometry.height);
      await page.screenshot({path:path.join(artifacts,`preview-${width}.png`)});
      await preview.hover();
      const popup=page.locator(".ujg-esi-activity-comment-popup");
      await popup.waitFor({state:"visible"});
      assert.ok((await popup.textContent()).includes("ПОСЛЕДНЯЯ СТРОКА"));
      assert.ok((await popup.textContent()).includes("<script>window.commentXss=true</script>"));
      await popup.hover();
      await popup.evaluate(el=>{el.scrollTop=el.scrollHeight;const child=el.querySelector(".ujg-esi-activity-comment-full");if(child)child.scrollTop=child.scrollHeight;});
      await page.screenshot({path:path.join(artifacts,`popup-${width}.png`)});
      const rect=await popup.boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=width+1&&rect.y>=0&&rect.y+rect.height<=901,JSON.stringify(rect));
      await page.keyboard.press("Escape");await popup.waitFor({state:"detached"});
      const more=page.locator(".ujg-esi-activity-comment-more").filter({visible:true}).first();
      await more.click();await popup.waitFor({state:"visible"});
      await page.keyboard.press("Escape");await popup.waitFor({state:"detached"});
      await page.evaluate(()=>{
        window.commentFocusTrace=[];
        for(const type of ["focusin","focusout","scroll","keydown","click"])document.addEventListener(type,e=>{
          window.commentFocusTrace.push({type,target:e.target.className||e.target.nodeName,key:e.key,
            focus:document.activeElement?.className,popup:!!document.querySelector('.ujg-esi-activity-comment-popup'),
            x:document.querySelector('.ujg-esi-activity-scroll')?.scrollLeft,y:scrollY});
        },true);
      });
      await more.focus();await page.keyboard.press("Enter");
      try {await popup.waitFor({state:"visible",timeout:3000});}
      catch(error) {console.error(await page.evaluate(()=>window.commentFocusTrace));await page.screenshot({path:path.join(artifacts,`keyboard-failed-${width}.png`)});throw error;}
      assert.equal(await popup.evaluate(el=>el.contains(document.activeElement)),true);
      await page.keyboard.press("Tab");await page.keyboard.press("Tab");
      await popup.waitFor({state:"detached"});
      await more.focus();await page.keyboard.press("Enter");await popup.waitFor({state:"visible"});
      await more.evaluate(el=>el.focus({preventScroll:true}));
      await page.keyboard.press("Shift+Tab");await popup.waitFor({state:"detached"});
      assert.equal(await page.evaluate(()=>window.commentXss),undefined);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      if(width===1440) {
        await page.evaluate(()=>{window.failComments=true;window.commentAcceptance.callbacks().onLoadActivityHistory();});
        await page.waitForFunction(()=>!window.commentAcceptance.state().activityLoading&&!!window.commentAcceptance.state().activityError);
        assert.equal(await page.evaluate(()=>window.commentReport.commentCoverage.isComplete),false);
        assert.equal(await page.evaluate(()=>window.commentReport.commentCoverage.loaded),3);
        assert.match(await page.locator(".ujg-esi-activity-coverage").textContent(),/комментар/i);
        await page.evaluate(()=>{window.failComments=false;window.commentAcceptance.callbacks().onLoadActivityHistory();});
        await page.waitForFunction(()=>!window.commentAcceptance.state().activityLoading&&!window.commentAcceptance.state().activityError);
        assert.equal(await page.evaluate(()=>window.commentReport.commentCoverage.isComplete),true);
        const slow=page.getByLabel("Медленные ответы истории (60 мс)",{exact:true});await slow.check();
        await page.getByRole("button",{name:"Обновить историю",exact:true}).click();
        await input.fill(dates[0]);await input.dispatchEvent("change");
        await page.locator('[data-activity-filter="change"]').click();
        const search=page.getByRole("searchbox",{name:"Поиск значений",exact:true});await search.fill("Статус");
        await page.waitForFunction(()=>!window.commentAcceptance.state().activityLoading,null,{timeout:60000});
        assert.equal(await search.inputValue(),"Статус");
        await page.keyboard.press("Escape");
        assert.equal(await page.evaluate(()=>window.commentReport.events.length),900);
        await slow.uncheck();
        await input.fill(dates[2]);await input.dispatchEvent("change");
        await page.waitForFunction(()=>window.commentReport.events.length===1100);
        await page.locator(".ujg-esi-activity-journal tbody tr").last().scrollIntoViewIfNeeded();
        await page.screenshot({path:path.join(artifacts,"last-row.png")});
      }
      assert.deepEqual(errors,[]);
      assert.deepEqual(await page.evaluate(()=>({writes:window.mutationCalls,llm:window.importPerformance.llmCalls})),{writes:0,llm:0});
      console.log(JSON.stringify({width,events:1004,pages:true,threeLines:true,fullPopup:true,writes:0,llm:0,errors}));
      await context.close();
    }
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
