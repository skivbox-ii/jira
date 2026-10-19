const test=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {startPreview}=require('./ticket-assistant-preview-server.cjs');
test('offline preview exposes explicit create outcomes and independent attachment retry',async()=>{
    const server=await startPreview({port:0});const browser=await chromium.launch({channel:'chrome',headless:true});
    const requests=[],faults=[];
    try {
        for(const scenario of ['success','rejected','lostresponse','filefail']) {
            const page=await browser.newPage({viewport:{width:scenario==='success'?390:1440,height:900}});
            page.on('pageerror',e=>faults.push(e.message));
            await page.route('**/*',route=>{const req=route.request();requests.push({url:req.url(),method:req.method()});return req.url().startsWith(server.url)?route.continue():route.abort();});
            await page.goto(server.url);await page.waitForSelector('html[data-ta-preview-ready="true"]');
            await page.locator('[data-ta-preview-scenario="'+scenario+'"]').click();
            await page.locator('[data-ta-source]').fill('Create synthetic ticket');
            await page.locator('[data-ta-field="summary"] input').fill('Synthetic title');
            if(scenario==='filefail')await page.locator('[data-ta-files]').setInputFiles([{name:'a.txt',mimeType:'text/plain',buffer:Buffer.from('A')},{name:'b.txt',mimeType:'text/plain',buffer:Buffer.from('B')}]);
            await page.locator('[data-ta-check]').click();await page.waitForSelector('[data-ta-checked]:not([hidden])');
            await page.locator('[data-ta-create]').click();
            const status=scenario==='rejected'?'rejected':scenario==='lostresponse'?'unknown':'created';
            await page.waitForFunction(status=>window.taPreview.instance.controller.getState().draft.creation.status===status,status);
            assert.equal(await page.evaluate(()=>window.taPreview.calls.filter(c=>c==='create').length),1);
            if(status==='created')assert.match(await page.locator('[data-ta-issue-link]').getAttribute('href'),/\/browse\/DEMO-/);
            if(status==='created') {
                for(const selector of ['[data-ta-field="summary"] input','[data-ta-field="assignee"] [data-ta-picker]','[data-ta-type] [data-ta-picker]','[data-ta-template] [data-ta-picker]','[data-ta-open-settings]','[data-ta-source]'])
                    assert.equal(await page.locator(selector).isDisabled(),true,'created lock '+selector);
            }
            if(scenario==='filefail') {
                await page.waitForFunction(()=>window.taPreview.instance.controller.getState().draft.attachments.some(a=>a.status==='failed'));
                await page.locator('[data-ta-file-retry]').click();await page.waitForFunction(()=>window.taPreview.instance.controller.getState().draft.attachments.every(a=>a.status==='uploaded'));
                assert.deepEqual(await page.evaluate(()=>window.taPreview.calls.filter(c=>c.startsWith('upload:'))),['upload:a.txt','upload:b.txt','upload:b.txt']);
            }
            if(status==='unknown') {
                assert.equal(await page.locator('[data-ta-create]').isDisabled(),true);await page.reload();await page.waitForSelector('[data-ta-reconcile]');
                await page.waitForFunction(()=>window.taPreview.instance.controller.getState().stage==='idle');
                assert.equal(await page.locator('[data-ta-create]').isDisabled(),true);
                assert.ok(await page.evaluate(()=>!!window.taPreview.instance.controller.getState().meta),'unknown reload reads metadata');
                assert.equal(await page.locator('[data-ta-field="summary"] input').inputValue(),'Synthetic title');
                assert.equal(await page.locator('[data-ta-field="summary"] input').isDisabled(),true);
                assert.equal(await page.locator('[data-ta-jira-form]').count(),0);
                assert.doesNotMatch(await page.locator('#ticket-assistant').innerText(),/нет в текущих metadata|используйте форму Jira/);
            }
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
            require('node:fs').mkdirSync('/tmp/ujg-ticket-assistant-screenshots',{recursive:true});
            await page.screenshot({path:'/tmp/ujg-ticket-assistant-screenshots/create-'+scenario+'.png',fullPage:true});
            if(scenario==='success') {
                await page.reload();await page.waitForSelector('[data-ta-new-draft]:not([hidden])');
                await page.locator('[data-ta-new-draft]').click();
                await page.locator('[data-ta-type] [data-ta-picker]').click();
                assert.ok(await page.locator('[data-ta-type] [data-ta-candidate]').count()>0,'new draft after reload has fresh type choices');
            }
            await page.close();
        }
        assert.deepEqual(faults,[]);assert.ok(requests.every(r=>r.url.startsWith(server.url)&&r.method==='GET'));
    } finally {await browser.close();await server.close();}
});
