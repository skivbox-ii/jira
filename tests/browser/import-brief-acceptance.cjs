const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {chromium} = require("playwright");

const origin = process.env.IMPORT_PREVIEW_URL || "http://127.0.0.1:4317";
assert.ok(["127.0.0.1","localhost","[::1]"].includes(new URL(origin).hostname));
const artifacts = process.env.IMPORT_BRIEF_ARTIFACTS || path.join(os.tmpdir(),"import-brief-20260927");

async function main() {
  fs.mkdirSync(artifacts,{recursive:true});
  const browser = await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined});
  try {
    for (const width of [1440,390]) {
      const context = await browser.newContext({viewport:{width,height:900}});
      await context.route("**/*",async route=>{
        const url=new URL(route.request().url());
        if (url.origin!==new URL(origin).origin) return route.abort();
        if (url.pathname!=="/test/performance-bootstrap.js") return route.continue();
        const response=await route.fetch(), original=await response.text();
        const needle='services.onActivityLlmRequest=function(){stats.llmCalls++;schedulePanel();return Promise.resolve({text:"Local performance fixture: LLM disabled."});};';
        assert.ok(original.includes(needle));
        const body=original.replace(needle,`window.briefAcceptanceRequests=[];
          services.onActivityLlmRequest=function(request){
            stats.llmCalls++;window.briefAcceptanceRequests.push(request);
            return new Promise(function(resolve,reject){setTimeout(function(){
              if(window.briefAcceptanceFail) reject(new Error("Тестовая ошибка провайдера"));
              else resolve({text:"## Ситуация\\nЭто ответ локальной заглушки.\\n\\n### Вмешательства\\n- [BE] EVOSCADA-50000: проверить возврат.\\n\\n### Ресурсы\\nУчтены только зарегистрированные записи работы.\\n\\n### Неизвестное\\nОтсутствие записей не означает отсутствие работы."});
            },120);});
          };`);
        return route.fulfill({response,body});
      });
      const page=await context.newPage(), errors=[];
      page.on("pageerror",error=>errors.push(error.message));
      await page.goto(origin+"/?performance");
      await page.waitForFunction(()=>document.querySelector(".ujg-esi-activity-coverage")?.textContent.includes("Проверена история 1000 из 1000"));
      const started=Date.now();
      await page.getByRole("button",{name:"LLM-отчёт",exact:true}).click();
      const dialog=page.getByRole("dialog",{name:"LLM-отчёт",exact:true});
      await dialog.locator(".ujg-esi-ai-budget").waitFor();
      const preparationMs=Date.now()-started;
      assert.match(await dialog.locator(".ujg-esi-ai-meta").textContent(),/21\.09\.2026.*27\.09\.2026.*1000 \/ 1000/);
      assert.match(await dialog.locator(".ujg-esi-ai-budget").textContent(),/1 запрос.*250 замечаний/);
      assert.equal(await page.evaluate(()=>window.importPerformance.llmCalls),0);
      assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
      await page.screenshot({path:path.join(artifacts,`prepared-${width}.png`)});
      await dialog.getByRole("button",{name:"Сформировать отчёт",exact:true}).click();
      await page.waitForFunction(()=>document.querySelector(".ujg-esi-ai-report")?.textContent.includes("локальной заглушки"));
      assert.equal(await page.evaluate(()=>window.briefAcceptanceRequests.length),1);
      const first=await page.evaluate(()=>window.briefAcceptanceRequests[0]);
      const facts=JSON.parse(first.userPrompt);
      assert.equal(first.allowProtocolFallback,false);
      assert.equal(facts.context.facts.remarks,250);
      assert.equal(facts.context.facts.daily.reduce((n,day)=>n+day.events,0),3000);
      assert.ok(Buffer.byteLength(first.userPrompt)<=18000);
      assert.ok(Buffer.byteLength(first.systemPrompt)<=4000);
      assert.equal(await dialog.locator('.ujg-esi-ai-report a[href*="EVOSCADA-50000"]').count(),1);
      const question=dialog.getByRole("textbox",{name:"Вопрос по отчёту"});
      await question.fill("Я".repeat(10000));
      assert.equal(await dialog.getByRole("button",{name:"Отправить вопрос"}).isDisabled(),true);
      assert.match(await dialog.locator(".ujg-esi-ai-error").textContent(),/лимит|байт/);
      await question.fill("Какие замечания требуют вмешательства?");
      assert.equal(await dialog.getByRole("button",{name:"Отправить вопрос"}).isDisabled(),false);
      await dialog.getByRole("button",{name:"Отправить вопрос"}).click();
      await page.waitForFunction(()=>document.querySelectorAll(".ujg-esi-ai-exchange").length===1);
      assert.equal(await page.evaluate(()=>window.briefAcceptanceRequests.length),2);
      await page.evaluate(()=>{window.briefAcceptanceFail=true;});
      await question.fill("Что с ресурсами?");
      await dialog.getByRole("button",{name:"Отправить вопрос"}).click();
      await page.waitForFunction(()=>document.querySelector(".ujg-esi-ai-error")?.textContent.includes("Тестовая ошибка"));
      assert.equal(await page.evaluate(()=>window.briefAcceptanceRequests.length),3);
      assert.equal(await question.inputValue(),"Что с ресурсами?");
      assert.match(await dialog.locator(".ujg-esi-ai-report").textContent(),/локальной заглушки/);
      await dialog.locator(".ujg-esi-ai-content").evaluate(el=>{el.scrollTop=el.scrollHeight;});
      await page.screenshot({path:path.join(artifacts,`answer-bottom-${width}.png`)});
      await dialog.getByRole("button",{name:"За день",exact:true}).click();
      assert.equal(await dialog.locator(".ujg-esi-ai-report").textContent(),"");
      assert.equal(await question.isDisabled(),true);
      assert.equal(await page.evaluate(()=>window.briefAcceptanceRequests.length),3);
      await dialog.getByRole("button",{name:"Закрыть LLM-отчёт",exact:true}).click();
      await page.getByRole("button",{name:"Предыдущий день",exact:true}).click();
      await page.getByRole("button",{name:"LLM-отчёт",exact:true}).click();
      assert.match(await page.locator(".ujg-esi-ai-meta").textContent(),/26\.09\.2026/);
      assert.equal(await page.locator(".ujg-esi-ai-report").textContent(),"");
      await page.getByRole("button",{name:"Закрыть LLM-отчёт",exact:true}).click();
      await page.locator(".ujg-esi-activity-journal tbody tr").last().scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(artifacts,`journal-bottom-${width}.png`)});
      await page.getByRole("button",{name:"Компоненты замечаний",exact:true}).click();
      await page.getByRole("checkbox",{name:"Выбрать все найденные компоненты",exact:true}).uncheck();
      await page.locator("[data-component-id]").first().check();
      await page.locator(".ujg-esi-component-filter-apply").click();
      await page.getByRole("button",{name:"LLM-отчёт",exact:true}).click();
      const scoped=JSON.parse((await page.locator(".ujg-esi-ai-context").textContent()).split("\n\n")[1]);
      assert.equal(scoped.context.scope.components.length,1);
      assert.ok(scoped.context.facts.remarks>0 && scoped.context.facts.remarks<250);
      assert.equal(await page.evaluate(()=>window.briefAcceptanceRequests.length),3);
      await page.screenshot({path:path.join(artifacts,`component-scope-${width}.png`)});
      assert.equal(await page.evaluate(()=>window.mutationCalls),0);
      assert.deepEqual(errors,[]);
      console.log(JSON.stringify({width,preparationMs,remarks:250,events:3000,userBytes:Buffer.byteLength(first.userPrompt),systemBytes:Buffer.byteLength(first.systemPrompt),stubCalls:3,realCalls:0,writes:0}));
      await context.close();
    }
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
