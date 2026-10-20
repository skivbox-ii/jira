const test=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {startPreview}=require('./ticket-assistant-preview-server.cjs');

test('local context preflight and settings shortcut work at 1440 and 390 without live calls',async()=>{
    const server=await startPreview({port:0}),browser=await chromium.launch({channel:'chrome',headless:true});
    const source='На стенде TEST сервис не отвечает. Нужно исправить обработку ошибок.\n'.repeat(700);
    try {
        for(const width of [1440,390]) {
            const context=await browser.newContext({viewport:{width,height:width===390?844:900}}),page=await context.newPage();
            const requests=[],faults=[];
            page.on('pageerror',e=>faults.push(e.message));
            await page.route('**/*',route=>{
                const r=route.request();requests.push([r.method(),r.url()]);
                return r.url().startsWith(server.url) && r.method()==='GET' ? route.continue() : route.abort();
            });
            await page.goto(server.url);await page.waitForSelector('html[data-ta-preview-ready="true"]');
            await page.locator('[data-ta-source]').fill(source);
            await page.locator('[data-ta-tokens]').click();
            const counter=page.locator('[data-ta-token-preflight]');await counter.waitFor({timeout:1500});
            assert.match(await counter.textContent(),/Приблизительно/);
            for(const word of ['Инструкции','Текст','Jira'])assert.match(await counter.textContent(),new RegExp(word));
            assert.match(await counter.textContent(),/превышен/);
            await page.keyboard.press('Escape');
            await page.locator('[data-ta-prepare]').click();
            await page.locator('[data-ta-error-budget]').waitFor();
            assert.equal(await page.evaluate(()=>window.taPreview.calls.filter(c=>c.startsWith('ai:')).length),0);
            assert.doesNotMatch(await page.locator('[data-ta-error]').textContent(),/UTF-8/);
            await page.screenshot({path:'/tmp/ta-budget-over-'+width+'.png'});
            await page.locator('[data-ta-error-budget]').click();
            assert.equal(await page.locator('[data-ta-context-budget]').inputValue(),'32768');
            await page.locator('[data-ta-context-budget]').fill('131072');await page.locator('[data-ta-response-reserve]').fill('8192');
            await page.screenshot({path:'/tmp/ta-budget-settings-'+width+'.png'});
            await page.locator('[data-ta-settings-apply]').click();
            assert.doesNotMatch(await counter.textContent(),/превышен/);
            await page.locator('[data-ta-prepare]').click();
            await page.waitForFunction(()=>window.taPreview.calls.includes('ai:prepare') && window.taPreview.pending===0);
            await page.waitForFunction(()=>document.querySelector('[data-ta-field="description"] textarea').value.length>42000);
            assert.equal(await page.locator('[data-ta-source]').inputValue(),source);
            await page.screenshot({path:'/tmp/ta-budget-ok-'+width+'.png'});
            await page.reload();await page.waitForSelector('html[data-ta-preview-ready="true"]');
            assert.equal(await page.locator('[data-ta-source]').inputValue(),source);
            await page.locator('[data-ta-open-settings]').click();
            assert.equal(await page.locator('[data-ta-context-budget]').inputValue(),'131072');
            assert.equal(await page.locator('[data-ta-response-reserve]').inputValue(),'8192');
            await page.locator('[data-ta-settings-cancel]').click();
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
            assert.deepEqual(faults,[]);assert.ok(requests.every(([method,url])=>method==='GET' && url.startsWith(server.url)));
            await context.close();
        }
    } finally {await browser.close();await server.close();}
});
