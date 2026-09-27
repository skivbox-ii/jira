const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {chromium}=require("playwright");
const origin=process.env.IMPORT_PREVIEW_URL || "http://127.0.0.1:4317";
assert.ok(["localhost","127.0.0.1"].includes(new URL(origin).hostname));
const artifacts=path.join(os.tmpdir(),"import-llm-diagnostics-20260927");
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
        body=body.replace(needle,"window.traceServices=services;");
        return route.fulfill({response,body});
      });
      await context.addInitScript(()=>{
        localStorage.setItem("ujg-shared-llm-config",JSON.stringify({apiBase:location.origin+"/__diagnostic_llm/v1",model:"local-stub-model",apiKey:"test-private-key"}));
        window.traceMode="http";window.traceFetchCount=0;window.traceSent=[];
        const original=window.fetch;
        window.fetch=async function(url,options){
          if(!String(url).includes("/__diagnostic_llm/"))return original.apply(this,arguments);
          window.traceFetchCount++;window.traceSent.push(JSON.parse(options.body));
          await new Promise(resolve=>setTimeout(resolve,40));
          if(window.traceMode==="network")throw new TypeError("Failed to fetch");
          if(window.traceMode==="body")return {ok:true,status:200,headers:new Headers({"content-type":"application/json"}),text:()=>Promise.reject(new TypeError("stream interrupted"))};
          if(window.traceMode==="html")return new Response("<html><script>window.BAD=true</script>Gateway failure</html>",{status:200,headers:{"content-type":"text/html"}});
          if(window.traceMode==="success")return new Response(JSON.stringify({choices:[{message:{content:"## Локальный ответ\nПроверка диагностики завершена. EVOSCADA-50000"},finish_reason:"stop"}],usage:{prompt_tokens:1024,completion_tokens:27,total_tokens:1051}}),{status:200,headers:{"content-type":"application/json","x-request-id":"stub-success"}});
          return new Response(JSON.stringify({error:{message:"Тестовое ограничение. Bearer test-private-key",password:"test-password",detail:"Данные локальной проверки. ".repeat(400)},last:"Конец ответа"}),{status:429,headers:{"content-type":"application/json","retry-after":"60","x-request-id":"stub-failure","set-cookie":"sessionid=test-cookie"}});
        };
      });
      const page=await context.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));
      await page.goto(origin+"/?performance");
      await page.waitForFunction(()=>document.querySelector(".ujg-esi-activity-coverage")?.textContent.includes("1000 из 1000"));
      await page.locator('.ujg-esi-remark-ai-command[data-remark-key="EVOSCADA-50000"]').click();
      const dialog=page.getByRole("dialog",{name:"AI-разбор замечания",exact:true});
      await page.waitForFunction(()=>document.querySelector(".ujg-esi-remark-generate")?.disabled===false);
      assert.equal(await page.evaluate(()=>window.traceFetchCount),0);
      for(const mode of ["http","body","html","network","success"]) {
        await page.evaluate(mode=>{window.traceMode=mode;},mode);
        await dialog.getByRole("button",{name:"Сформировать",exact:true}).click();
        await page.waitForFunction(()=>document.querySelector(".ujg-esi-remark-generate")?.disabled===false);
        await dialog.getByRole("button",{name:"Диагностика LLM",exact:true}).click();
        const panel=page.getByRole("dialog",{name:"Диагностика LLM",exact:true});
        await panel.waitFor();
        const text=await panel.textContent();assert.doesNotMatch(text,/test-private-key|test-password|test-cookie/);
        assert.match(text,/local-stub-model/);assert.match(text,/\/__diagnostic_llm\/v1\/chat\/completions/);
        assert.match(text,mode==="http" ? /HTTP 429/ : mode==="body" ? /прочитать тело/ : mode==="html" ? /разобрать JSON/ : mode==="network" ? /не предоставил HTTP/ : /1024/);
        assert.equal(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
        if(mode==="http") {
          await page.screenshot({path:path.join(artifacts,"error-"+width+".png")});
          await panel.getByText("Отправленное тело",{exact:true}).click();
          const request=await panel.locator("details").filter({has:page.getByText("Отправленное тело",{exact:true})}).locator("pre").textContent();
          assert.equal(JSON.parse(request).model,"local-stub-model");assert.equal(JSON.parse(request).messages.length,2);
          await panel.getByText("Тело ответа",{exact:true}).click();
          const responsePre=panel.locator("details").filter({has:page.getByText("Тело ответа",{exact:true})}).locator("pre");
          await responsePre.evaluate(el=>{el.scrollTop=el.scrollHeight;el.scrollLeft=el.scrollWidth;});
          await panel.locator(".ujg-esi-llm-diagnostic-body").evaluate(el=>{el.scrollTop=el.scrollHeight;});
          await page.screenshot({path:path.join(artifacts,"response-end-"+width+".png")});
          const downloadPromise=page.waitForEvent("download");await panel.getByRole("button",{name:"Скачать JSON",exact:true}).click();
          const download=await downloadPromise;const data=JSON.parse(fs.readFileSync(await download.path(),"utf8"));
          assert.equal(data.traces.length,1);assert.equal(data.traces[0].response.status,429);
          assert.equal(data.traces[0].response.usage.inputTokens,null);assert.doesNotMatch(JSON.stringify(data),/test-private-key|test-password|test-cookie/);
          assert.equal(data.traces[0].request.bodyBytes,Buffer.byteLength(JSON.stringify(await page.evaluate(()=>window.traceSent[0]))));
          assert.equal(await page.evaluate(()=>window.traceFetchCount),1);
        }
        if(mode==="success")await page.screenshot({path:path.join(artifacts,"success-"+width+".png")});
        await page.keyboard.press("Escape");await panel.waitFor({state:"detached"});assert.equal(await dialog.isVisible(),true);
      }
      assert.equal(await page.evaluate(()=>window.traceFetchCount),5);assert.equal(await page.evaluate(()=>window.BAD),undefined);
      assert.equal(await page.evaluate(()=>window.mutationCalls),0);assert.deepEqual(errors,[]);
      await dialog.getByRole("button",{name:"Закрыть разбор",exact:true}).click();
      console.log(JSON.stringify({width,scenarios:5,stubLlmCalls:5,realLlmCalls:0,jiraWrites:0,errors:0,artifacts}));
      await context.close();
    }
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
