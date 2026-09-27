const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {chromium}=require("playwright");
const origin=process.env.IMPORT_PREVIEW_URL || "http://127.0.0.1:4317";
assert.ok(["localhost","127.0.0.1"].includes(new URL(origin).hostname));
const artifacts=path.join(os.tmpdir(),"import-remark-20260927");
async function main() {
  fs.mkdirSync(artifacts,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
  try {
    for(const width of [1440,390]) {
      const context=await browser.newContext({viewport:{width,height:900}});
      await context.route("**/*",async route=>{
        const url=new URL(route.request().url());
        if(url.origin!==new URL(origin).origin)return route.abort();
        if(url.pathname!=="/test/performance-bootstrap.js")return route.continue();
        const response=await route.fetch();let body=await response.text();
        const needle='services.onActivityLlmRequest=function(){stats.llmCalls++;schedulePanel();return Promise.resolve({text:"Local performance fixture: LLM disabled."});};';
        assert.ok(body.includes(needle));
        body=body.replace(needle,`window.remarkRequests=[];
          services.onActivityLlmRequest=function(request){
            stats.llmCalls++;window.remarkRequests.push(request);
            if(window.remarkProviderFail)return Promise.reject(new Error("Ошибка локального провайдера"));
            return new Promise(function(resolve){setTimeout(function(){resolve({text:
              "## Замечание: результат проверки\\nЛокальная заглушка, не производственный ответ. [QA] EVOSCADA-50002: результат проверки передан на внедрение.\\n\\n"+
              Array.from({length:32},function(_,i){return "### Этап "+(i+1)+"\\n25.09.2026 19:25 МСК: тестовая запись последовательности действий. [BE] EVOSCADA-50001.\\n";}).join("\\n")+
              "\\nПоследняя строка отчёта. <script>window.bad=true</script>"
            });},100);});
          };`);
        body=body.replace("var readHistory=window.offlineApi.getIssueWithHistory;",`var baseRead=window.offlineApi.getIssueWithHistory;
          window.remarkReadKeys=[];window.remarkCommentReads=[];
          window.offlineApi.getIssueWithHistory=function(key){
            window.remarkReadKeys.push(key);
            return Promise.resolve(baseRead(key)).then(function(issue){
              issue=JSON.parse(JSON.stringify(issue));
              if(key==="EVOSCADA-50001")issue.fields.description=null;
              issue.fields.comment={startAt:0,total:2,comments:[remarkComment(key,0)]};
              return issue;
            });
          };
          function remarkComment(key,start){
            var text=start===0 ? "25 сентября замечание передано на проверку. Требуется проверить результат исправления." : "Проверка выполнена. Результат принят, требуется подтверждение по исходному замечанию.";
            if(window.remarkCommentMode==="large")text="Длинный комментарий ".repeat(2000);
            return {id:key+"-c"+start,
              created:"2026-09-26T"+(start?"12":"09")+":15:00+03:00",
              author:{name:start?"orlova":"ivanov",displayName:start?"Орлова Н.":"Иванов И."},body:text};
          }
          window.offlineApi.getIssueComments=function(key,start){
            window.remarkCommentReads.push([key,start]);
            if(window.remarkCommentMode==="missing")return Promise.resolve({startAt:start,total:2,comments:[]});
            return Promise.resolve({startAt:start,total:2,comments:[remarkComment(key,start)]});
          };
          var readHistory=window.offlineApi.getIssueWithHistory;`);
        return route.fulfill({response,body});
      });
      const page=await context.newPage(),errors=[];
      page.on("pageerror",error=>errors.push(error.message));
      await page.goto(origin+"/?performance");
      await page.waitForFunction(()=>document.querySelector(".ujg-esi-activity-coverage")?.textContent.includes("1000 из 1000"));
      await page.evaluate(()=>{window.remarkReadKeys=[];});
      const action=page.locator('.ujg-esi-remark-ai-command[data-remark-key="EVOSCADA-50000"]');
      await action.scrollIntoViewIfNeeded();
      assert.equal((await action.textContent()).trim(),"");
      const appearance=await action.evaluate(el=>{
        const style=getComputedStyle(el),box=el.getBoundingClientRect(),head=el.closest("th").getBoundingClientRect();
        return {border:style.borderTopWidth,background:style.backgroundColor,rightGap:head.right-box.right,bottomGap:head.bottom-box.bottom};
      });
      assert.equal(appearance.border,"0px");
      assert.equal(appearance.background,"rgba(0, 0, 0, 0)");
      assert.ok(appearance.rightGap>=0 && appearance.rightGap<16,JSON.stringify(appearance));
      assert.ok(appearance.bottomGap>=0,JSON.stringify(appearance));
      await page.screenshot({path:path.join(artifacts,"wand-"+width+".png")});
      const started=Date.now();await action.click();
      const dialog=page.getByRole("dialog",{name:"AI-разбор замечания",exact:true});
      await page.waitForFunction(()=>document.querySelector(".ujg-esi-remark-coverage")?.textContent.includes("4 / 4"));
      const preparationMs=Date.now()-started;
      const errorText=await dialog.locator(".ujg-esi-remark-errors").textContent();
      assert.equal(errorText,"");
      assert.match(await dialog.locator(".ujg-esi-remark-coverage").textContent(),/8 \/ 8/);
      assert.equal(await page.evaluate(()=>window.remarkRequests.length),0);
      assert.equal(await page.evaluate(()=>window.remarkCommentReads.length),8);
      assert.deepEqual(await page.evaluate(()=>window.remarkReadKeys),["EVOSCADA-50000","EVOSCADA-50001","EVOSCADA-50002","EVOSCADA-50003","EVOSCADA-50001","EVOSCADA-50002","EVOSCADA-50003","EVOSCADA-50000"]);
      assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
      await page.screenshot({path:path.join(artifacts,"preview-"+width+".png")});
      await dialog.locator("summary").click();
      await dialog.locator(".ujg-esi-remark-context").evaluate(el=>{el.scrollTop=el.scrollHeight;});
      await page.screenshot({path:path.join(artifacts,"context-bottom-"+width+".png")});
      await dialog.getByRole("button",{name:"Сформировать",exact:true}).click();
      await page.waitForFunction(()=>document.querySelector(".ujg-esi-remark-answer")?.textContent.includes("Последняя строка"));
      assert.equal(await page.evaluate(()=>window.remarkRequests.length),1);
      const sent=await page.evaluate(()=>window.remarkRequests[0]);
      assert.ok(Buffer.byteLength(sent.userPrompt)<=18000);assert.equal(sent.allowProtocolFallback,false);
      const evidence=JSON.parse(sent.userPrompt),emptyTask=evidence.tasks.find(task=>task.key==="EVOSCADA-50001");
      assert.equal(evidence.descriptions[emptyTask.descriptionRef],"");
      assert.equal(await dialog.locator(".ujg-esi-remark-answer script").count(),0);
      assert.ok(await dialog.locator('.ujg-esi-remark-answer a[href*="EVOSCADA-50002"]').count());
      await page.screenshot({path:path.join(artifacts,"answer-"+width+".png")});
      await dialog.locator(".ujg-esi-ai-content").evaluate(el=>{el.scrollTop=el.scrollHeight;});
      await page.screenshot({path:path.join(artifacts,"answer-bottom-"+width+".png")});
      await dialog.getByRole("button",{name:"Закрыть разбор",exact:true}).click();
      await page.evaluate(()=>{window.remarkCommentMode="large";});
      await action.click();
      await page.waitForFunction(()=>document.querySelector(".ujg-esi-remark-errors")?.textContent.includes("лимит"));
      assert.equal(await dialog.getByRole("button",{name:"Сформировать",exact:true}).isDisabled(),true);
      assert.equal(await page.evaluate(()=>window.remarkRequests.length),1);
      await page.screenshot({path:path.join(artifacts,"oversize-"+width+".png")});
      await dialog.getByRole("button",{name:"Закрыть разбор",exact:true}).click();
      await page.evaluate(()=>{window.remarkCommentMode="missing";});
      await action.click();
      await page.waitForFunction(()=>document.querySelector(".ujg-esi-remark-errors")?.textContent.includes("комментар"));
      assert.equal(await dialog.getByRole("button",{name:"Сформировать",exact:true}).isDisabled(),true);
      await page.evaluate(()=>{window.remarkCommentMode="";window.remarkProviderFail=true;});
      await dialog.getByRole("button",{name:"Обновить данные",exact:true}).click();
      await page.waitForFunction(()=>document.querySelector(".ujg-esi-remark-generate")?.disabled===false);
      await dialog.getByRole("button",{name:"Сформировать",exact:true}).click();
      await page.waitForFunction(()=>document.querySelector(".ujg-esi-remark-errors")?.textContent.includes("Ошибка локального"));
      assert.equal(await page.evaluate(()=>window.remarkRequests.length),2);
      await dialog.getByRole("button",{name:"Закрыть разбор",exact:true}).click();
      await page.getByRole("button",{name:"Предыдущий день",exact:true}).click();
      await action.click();
      await page.waitForFunction(()=>document.querySelector(".ujg-esi-remark-coverage")?.textContent.includes("4 / 4"));
      assert.match(await dialog.locator(".ujg-esi-remark-context").textContent(),/2026-09-27/);
      await dialog.getByRole("button",{name:"Закрыть разбор",exact:true}).click();
      await page.locator(".ujg-esi-activity-journal tbody tr").last().scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(artifacts,"journal-bottom-"+width+".png")});
      assert.equal(await page.evaluate(()=>window.mutationCalls),0);assert.deepEqual(errors,[]);
      console.log(JSON.stringify({width,preparationMs,userBytes:Buffer.byteLength(sent.userPrompt),tasks:4,comments:8,stubCalls:2,realLlmCalls:0,writes:0,artifacts}));
      await context.close();
    }
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
