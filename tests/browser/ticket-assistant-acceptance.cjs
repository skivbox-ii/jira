/* Generated-runtime acceptance. All Jira/AI boundaries are in-memory fixtures. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const {startPreview} = require('./ticket-assistant-preview-server.cjs');
const root = path.resolve(__dirname, '../..');
const artifacts = '/tmp/ticket-assistant-20261019';
fs.mkdirSync(artifacts, {recursive:true});

// Extend only the test fixture transport, leaving runtime and preview files intact.
function fixtureSource() {
    const original = fs.readFileSync(path.join(__dirname, 'ticket-assistant-preview.cjs'), 'utf8');
    const marker = '    var ai = window.taRequire';
    assert.equal(original.split(marker).length, 2, 'fixture transport seam');
    return original.replace(marker, `
    window.taAcceptance = {user:'acceptance-a', mode:'normal', issuePosts:{}, payloads:[], prompts:[]};
    var acceptance=window.taAcceptance, transport=llm.requestText, createIssue=api.createIssue;
    api.getCurrentUser=function() {return result('identity',{key:acceptance.user,name:acceptance.user});};
    api.createIssue=function(payload) {
        var id=records.instance.controller.getState().draft.id;
        acceptance.issuePosts[id]=(acceptance.issuePosts[id] || 0)+1;
        acceptance.payloads.push(payload);
        return window.taRecordIssue({draftId:id,payload:payload}).then(function() {return createIssue(payload);});
    };
    llm.requestText=function(config,request) {
        var mode=acceptance.mode;
        acceptance.prompts.push({input:JSON.parse(request.userPrompt),systemPrompt:request.systemPrompt});
        if(mode==='fail') return Promise.reject({code:'transport'});
        var response=transport(config,request).then(function(value) {
            if(mode==='long') {
                var parsed=JSON.parse(value.text);
                if(parsed.kind==='draft') parsed.questions[0].text='Укажите версию и условия проверки. '.repeat(35);
                value={text:JSON.stringify(parsed)};
            }
            return value;
        });
        if(mode==='slow') return new Promise(function(resolve,reject) {setTimeout(function(){response.then(resolve,reject);},2600);});
        return response;
    };
` + marker);
}

async function ready(page) {
    await page.waitForSelector('html[data-ta-preview-ready="true"]');
}
async function idle(page) {
    await page.waitForFunction(() => ['idle','error'].includes(window.taPreview.instance.controller.getState().stage));
    const current=await state(page);
    assert.equal(current.stage,'idle',JSON.stringify(current.error));
}
async function pick(page, host, id) {
    const selection = {'[data-ta-project]':'projectKey','[data-ta-type]':'issueTypeId','[data-ta-template]':'templateId'}[host];
    if (selection && (await state(page)).draft?.[selection] === id) return;
    await page.locator(host + ' [data-ta-picker]').click();
    await page.locator(host + ' [data-ta-search]').fill(id);
    await page.locator(host + ' [data-ta-candidate]').filter({hasText:'(' + id + ')'}).click();
}
async function state(page) {
    return page.evaluate(() => window.taPreview.instance.controller.getState());
}
async function check(page) {
    await page.locator('[data-ta-check]').click();
    await page.waitForSelector('[data-ta-checked]:not([hidden])');
}
async function capture(page, name) {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, name + ' overflow');
    await page.screenshot({path:path.join(artifacts, name + '.png'), fullPage:true});
    await page.screenshot({path:path.join(artifacts, name + '-viewport.png')});
}
async function session(width, run) {
    let server, browser, context;
    const externalRequests = [], pageErrors = [], methods = [];
    const issuePosts = new Map();
    const fixture = {issuePostCount:id => issuePosts.get(id) || 0};
    try {
        server = await startPreview({port:0,sourceAssets:false});
        browser = await chromium.launch({channel:'chrome',headless:true});
        context = await browser.newContext({viewport:{width,height:width === 390 ? 844 : 900},reducedMotion:'reduce'});
        await context.exposeBinding('taRecordIssue', (source, event) => {issuePosts.set(event.draftId,fixture.issuePostCount(event.draftId)+1);});
        await context.route('**/*', async route => {
            const request = route.request(), url = new URL(request.url());
            methods.push(request.method());
            if (url.origin !== new URL(server.url).origin) {
                externalRequests.push(request.url());
                return route.abort('blockedbyclient');
            }
            if (url.pathname === '/preview.js') return route.fulfill({contentType:'text/javascript',body:fixtureSource()});
            const assets = {'/acceptance-importer.js':'ujg-excel-story-importer.runtime.js','/acceptance-importer.css':'ujg-excel-story-importer.css'};
            if (assets[url.pathname]) return route.fulfill({contentType:url.pathname.endsWith('.css')?'text/css':'text/javascript',body:fs.readFileSync(path.join(root,assets[url.pathname]))});
            return route.continue();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(8000);
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.goto(server.url); await ready(page);
        await run(page, server.url, fixture);
        assert.deepEqual(externalRequests, [], 'external network is an acceptance failure');
        assert.deepEqual(pageErrors, [], 'browser exceptions');
        assert.ok(methods.every(method => method === 'GET'), 'HTTP writes are forbidden; API writes are fixture memory only');
    } finally {
        if (context) await context.close();
        if (browser) await browser.close();
        if (server) await server.close();
    }
}

for (const width of [1440,390]) {
    test('generated workflow, four templates, visible answers, protected edits, transfer and identity isolation at ' + width, async () => {
        await session(width, async page => {
            assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
            const source = 'Проверить API: входные данные и воспроизведение описаны пользователем.';
            for (const [template,type] of [['task','10'],['bug','11'],['deployment','10']]) {
                await pick(page,'[data-ta-type]',type);
                await pick(page,'[data-ta-template]',template);
                await page.locator('[data-ta-source]').fill(source + ' ' + template);
                await page.locator('[data-ta-prepare]').click(); await idle(page);
                const draft = (await state(page)).draft;
                assert.equal(draft.templateId, template); assert.equal(draft.issueTypeId,type);
                assert.equal(draft.fields.summary,'Уточнить обработку ошибок API');
                assert.ok(draft.fields.description.includes(source));
                assert.equal(await page.locator('[data-ta-question="release"]').count(),1);
            }
            const manual = 'Ручная тема, которую AI не должен заменять';
            await page.locator('[data-ta-field="summary"] input').fill(manual);
            await page.locator('[data-ta-prepare]').click(); await idle(page);
            assert.equal(await page.locator('[data-ta-field="summary"] input').inputValue(),manual);
            assert.equal((await state(page)).draft.pendingFields.summary,'Уточнить обработку ошибок API');
            await page.locator('[data-ta-question="release"] textarea').fill('2026.11\nПроверить на TEST');
            await page.locator('[data-ta-question="release"] button').click();
            const answered = await page.locator('[data-ta-source]').inputValue();
            assert.match(answered,/2026\.11\nПроверить на TEST/);
            await page.locator('[data-ta-question="release"] button').click();
            assert.equal(await page.locator('[data-ta-source]').inputValue(),answered,'answer deduplication');
            await capture(page,'answers-protected-' + width);
            await check(page);
            assert.ok(await page.evaluate(() => window.taAcceptance.prompts.at(-1).input.source.includes('2026.11\nПроверить на TEST')),'visible answers reach actual check contract');
            assert.equal(await page.locator('[data-ta-field="summary"] input').inputValue(),manual);
            await page.locator('[data-ta-source]').press('End'); await page.locator('[data-ta-source]').press('Space');
            assert.equal(await page.locator('[data-ta-create]').isDisabled(),true,'edit invalidates checked');

            await page.locator('[data-ta-open-settings]').click();
            await page.locator('[data-ta-profile-instructions]').fill('Общие правила. '.repeat(50));
            await page.locator('[data-ta-template-add]').click();
            await page.locator('[data-ta-template-name]').fill('Четвёртый: проверка');
            await page.locator('[data-ta-template-when]').fill('Для контрольной проверки');
            await page.locator('[data-ta-template-instructions]').fill('Частные правила. '.repeat(40));
            await pick(page,'[data-ta-template-mapping]','10');
            await page.locator('.ta-settings-transfer summary').click();
            await page.locator('[data-ta-export]').click();
            const exported = await page.locator('[data-ta-export-json]').inputValue();
            assert.equal(JSON.parse(exported).profiles[0].templates.length,4);
            assert.ok(!exported.includes(source) && !exported.includes(manual) && !exported.includes('offline-fixture-key'));
            await capture(page,'settings-fourth-' + width);
            await page.locator('[data-ta-settings-apply]').click();
            const fourth = (await state(page)).settings.profiles[0].templates[3].id;
            await pick(page,'[data-ta-template]',fourth);
            await page.locator('[data-ta-prepare]').click(); await idle(page);
            assert.equal((await state(page)).draft.templateId,fourth);
            const prompts = await page.evaluate(() => window.taAcceptance.prompts);
            assert.ok(JSON.stringify(prompts.at(-1)).includes('Частные правила.'));
            await page.reload(); await ready(page);
            assert.equal((await state(page)).draft.templateId,fourth);
            assert.equal(await page.locator('[data-ta-field="summary"] input').inputValue(),manual);

            await pick(page,'[data-ta-project]','APP'); await idle(page);
            assert.equal(await page.locator('[data-ta-source]').inputValue(),'');
            await page.locator('[data-ta-source]').fill('Отдельный исходник APP');
            await page.locator('[data-ta-open-settings]').click();
            await page.locator('.ta-settings-transfer summary').click();
            await page.locator('[data-ta-import-json]').fill(exported);
            await page.locator('[data-ta-import-preview]').click(); await page.locator('[data-ta-import-use]').click();
            await page.locator('[data-ta-template-row]').filter({hasText:'Четвёртый:'}).click();
            assert.match(await page.locator('[data-ta-mapping-warning]').textContent(),/10/);
            await pick(page,'[data-ta-template-mapping]','20');
            await page.locator('[data-ta-settings-apply]').click();
            await pick(page,'[data-ta-template]',fourth); await pick(page,'[data-ta-type]','20');
            await page.locator('[data-ta-prepare]').click(); await idle(page);
            assert.equal((await state(page)).draft.projectKey,'APP');
            assert.equal((await state(page)).draft.issueTypeId,'20');
            await pick(page,'[data-ta-project]','DEMO'); await idle(page);
            assert.ok((await page.locator('[data-ta-source]').inputValue()).includes(source));
            assert.equal((await state(page)).settings.profiles[0].templates[3].issueTypeId,'10');
            // Reinitialize the real controller with another fixture identity in the same storage.
            await page.evaluate(async () => {window.taAcceptance.user='acceptance-b'; await window.taPreview.instance.controller.init();});
            await pick(page,'[data-ta-project]','DEMO'); await idle(page);
            assert.equal(await page.locator('[data-ta-source]').inputValue(),'');
            assert.equal((await state(page)).settings.profiles[0].templates.length,3);
            await page.locator('[data-ta-source]').fill('Личный исходник B');
            await page.evaluate(async () => {window.taAcceptance.user='acceptance-a'; await window.taPreview.instance.controller.init();});
            await pick(page,'[data-ta-project]','DEMO'); await idle(page);
            assert.ok((await page.locator('[data-ta-source]').inputValue()).includes(source));
            assert.equal((await state(page)).settings.profiles[0].templates.length,4);
        });
    });

    test('failure retry cancel, timer caret, long scroll and unsupported metadata at ' + width, async () => {
        await session(width, async page => {
            await page.locator('[data-ta-source]').fill('Длинный исходник\n'.repeat(80));
            await page.evaluate(() => {window.taAcceptance.mode='fail';});
            await page.locator('[data-ta-prepare]').click();
            await page.waitForFunction(() => window.taPreview.instance.controller.getState().stage === 'error');
            assert.equal(await page.locator('[data-ta-create]').isDisabled(),true);
            await page.evaluate(() => {window.taAcceptance.mode='normal';});
            await page.locator('[data-ta-retry]').focus(); await page.keyboard.press('Enter'); await idle(page);
            assert.equal(await page.locator('[data-ta-field="summary"] input').inputValue(),'Уточнить обработку ошибок API');
            const before = (await state(page)).draft;
            await page.evaluate(() => {window.taAcceptance.mode='slow';});
            await page.locator('[data-ta-prepare]').click();
            await page.waitForFunction(() => window.taPreview.instance.controller.getState().stage === 'preparing');
            const input = page.locator('[data-ta-source]');
            await input.focus();
            const position = await input.evaluate(el => {el.setSelectionRange(7,12); el.scrollTop=90; return {y:scrollY,top:el.scrollTop};});
            await page.waitForTimeout(1200); // One actual progress timer tick.
            assert.deepEqual(await input.evaluate(el => ({focused:document.activeElement===el,start:el.selectionStart,end:el.selectionEnd,y:scrollY,top:el.scrollTop})),
                {focused:true,start:7,end:12,...position});
            assert.equal(await page.locator('[data-ta-elapsed]').getAttribute('aria-live'),'off');
            await capture(page,'progress-' + width);
            await page.locator('[data-ta-stop]').click();
            await page.waitForTimeout(2800); // Late response must not restore a cancelled proposal.
            assert.equal((await state(page)).stage,'stopped');
            assert.deepEqual((await state(page)).draft.fields,before.fields);
            await page.evaluate(() => {window.taAcceptance.mode='long';});
            await page.locator('[data-ta-retry]').click(); await idle(page);
            const question = page.locator('[data-ta-question="release"] textarea');
            await question.fill('Длинный видимый ответ. '.repeat(30));
            await question.press('Tab'); await page.keyboard.press('Enter');
            assert.match(await input.inputValue(),/Длинный видимый ответ/);
            await page.locator('[data-ta-additional]').evaluate(el=>{el.open=true;});
            const last = page.locator('[data-ta-field]').last(); await last.scrollIntoViewIfNeeded();
            const box = await last.boundingBox();
            assert.ok(box.y>=0 && box.y < (width===390?844:900),'last field reachable');
            await capture(page,'long-last-field-' + width);
            await pick(page,'[data-ta-type]','12');
            await page.locator('[data-ta-check]').click(); await idle(page);
            assert.equal(await page.locator('[data-ta-create]').isDisabled(),true);
            assert.match(await page.locator('[data-ta-fallback]').textContent(),/Согласующий комитет/);
            assert.equal(await page.locator('[data-ta-jira-form]').getAttribute('href'),'/secure/CreateIssue!default.jspa?pid=101&issuetype=12');
            assert.deepEqual(await page.evaluate(() => window.taAcceptance.issuePosts),{});
            await page.locator('[data-ta-copy="summary"]').click();
            assert.equal(await page.locator('[data-ta-copy-text]').inputValue(),'Уточнить обработку ошибок API');
            await capture(page,'unsupported-' + width);
        });
    });
}

for (const scenario of ['success','rejected','lostresponse','filefail']) {
    test('explicit creation ' + scenario + ' preserves one issue write and reload recovery', async () => {
        await session(scenario==='success'?390:1440, async (page,url,fixture) => {
            await page.locator('[data-ta-preview-scenario="'+scenario+'"]').click();
            await page.locator('[data-ta-source]').fill('Создать синтетическую задачу ' + scenario);
            await page.locator('[data-ta-field="summary"] input').fill('Подтверждённая тема');
            if (scenario==='filefail') await page.locator('[data-ta-files]').setInputFiles([
                {name:'a.txt',mimeType:'text/plain',buffer:Buffer.from('AAA')},
                {name:'b.txt',mimeType:'text/plain',buffer:Buffer.from('BBB')}
            ]);
            await check(page);
            const draftId = (await state(page)).draft.id;
            await page.locator('[data-ta-create]').click();
            const status = scenario==='lostresponse'?'unknown':scenario==='rejected'?'rejected':'created';
            await page.waitForFunction(status => window.taPreview.instance.controller.getState().draft.creation.status===status,status);
            assert.equal(await page.evaluate(id => window.taAcceptance.issuePosts[id],draftId),1);
            assert.deepEqual(await page.evaluate(() => window.taAcceptance.payloads[0].fields.project),{id:'101'});
            if (scenario==='rejected') {
                assert.equal(await page.locator('[data-ta-source]').inputValue(),'Создать синтетическую задачу rejected');
                assert.match(await page.locator('[data-ta-field="summary"] [data-ta-errors]').textContent(),/Synthetic field rejection/);
                await page.locator('[data-ta-field="summary"] input').fill('Исправленная тема'); await check(page);
                assert.equal(await page.locator('[data-ta-create]').isDisabled(),false);
                await page.locator('[data-ta-preview-scenario="success"]').click();
                await page.locator('[data-ta-create]').click();
                await page.waitForFunction(() => window.taPreview.instance.controller.getState().draft.creation.status==='created');
                assert.equal(await page.evaluate(id => window.taAcceptance.issuePosts[id],draftId),2,'only explicit corrected retry');
            }
            if (scenario==='filefail') {
                await page.waitForFunction(() => window.taPreview.instance.controller.getState().draft.attachments.some(a=>a.status==='failed'));
                await capture(page,'file-partial');
                const key = (await state(page)).draft.creation.issueKey;
                await page.reload(); await ready(page);
                assert.deepEqual((await state(page)).draft.attachments.map(a=>a.status),['uploaded','failed']);
                assert.equal((await state(page)).draft.creation.issueKey,key);
                await page.locator('[data-ta-files]').setInputFiles({name:'b.txt',mimeType:'text/plain',buffer:Buffer.from('BBB')});
                await page.locator('[data-ta-file-retry]').click();
                await page.waitForFunction(() => window.taPreview.instance.controller.getState().draft.attachments.every(a=>a.status==='uploaded'));
                assert.deepEqual(await page.evaluate(() => window.taPreview.calls.filter(c=>c.startsWith('upload:'))),['upload:b.txt']);
                assert.deepEqual(await page.evaluate(() => window.taAcceptance.issuePosts),{},'reload file retry sends no issue POST');
            } else {
                await page.reload(); await ready(page);
            }
            if (scenario==='lostresponse') {
                assert.equal((await state(page)).draft.creation.status,'unknown');
                assert.equal(await page.locator('[data-ta-create]').isDisabled(),true);
                assert.equal(await page.locator('[data-ta-new-draft]').isVisible(),false);
                assert.equal(await page.locator('[data-ta-field="summary"] input').isDisabled(),true);
                await page.evaluate(async () => {await window.taPreview.instance.controller.submit(); await window.taPreview.instance.controller.newDraft();});
                assert.deepEqual(await page.evaluate(() => window.taAcceptance.issuePosts),{},'unknown reload never retries');
            } else {
                assert.equal((await state(page)).draft.creation.status,'created');
                assert.match(await page.locator('[data-ta-issue-link]').getAttribute('href'),/\/browse\/DEMO-/);
                for (const selector of ['[data-ta-source]','[data-ta-field="summary"] input','[data-ta-open-settings]']) assert.equal(await page.locator(selector).isDisabled(),true);
                assert.equal(await page.locator('[data-ta-new-draft]').isVisible(),true);
            }
            await capture(page,'creation-' + scenario);
            assert.equal(fixture.issuePostCount(draftId),scenario==='rejected'?2:1,'issue writes counted across reload');
        });
    });
}

test('actual importer registry and assistant coexist with isolated AMD CSS and assistant destruction', async () => {
    await session(1440, async (page,url) => {
        await page.evaluate(() => {
            const host=document.createElement('section'); host.id='importer-neighbor';
            document.querySelector('.ta-preview-scenarios').after(host);
        });
        await page.addScriptTag({url:url+'acceptance-importer.js'});
        assert.equal(await page.evaluate(() => typeof window.taRequire('_ujgExcelStoryImporterRuntime')),'function');
        assert.equal(await page.evaluate(() => typeof window.taRequire('_ujgTicketAssistantRuntime')),'function');
        const assistantButton=page.locator('[data-ta-prepare]');
        const assistantBefore=await assistantButton.evaluate(el=>({color:getComputedStyle(el).color,padding:getComputedStyle(el).padding}));
        await page.addStyleTag({url:url+'acceptance-importer.css'});
        assert.deepEqual(await assistantButton.evaluate(el=>({color:getComputedStyle(el).color,padding:getComputedStyle(el).padding})),assistantBefore,'importer CSS cannot restyle assistant');

        await page.evaluate(() => {
            const api=window.taRequire('_ujgESI_api'),config=window.taRequire('_ujgESI_config');
            const calls=[];window.coexistImporter={calls,writes:0};
            // Same API boundary as import-preview.html: real main/rendering/grid,
            // in-memory Jira reads, and no possible provider or write transport.
            Object.keys(api).forEach(key=>{
                if(typeof api[key]==='function') api[key]=()=>{window.coexistImporter.writes++;throw new Error('Unexpected importer API: '+key);};
            });
            const read=(name,value)=>{calls.push(name);return Promise.resolve(value);};
            function issue(key,summary,status) {
                return {key,fields:{summary,description:'Fixture description for '+key.replace('-',' '),
                    project:{id:'101',key:'DEMO'},issuetype:{name:'Story'},
                    status:{id:status==='Done'?'3':'1',name:status,statusCategory:{key:status==='Done'?'done':'new'}},
                    assignee:{name:'fixture-reader',displayName:'Fixture Reader'},creator:{name:'fixture-reader',displayName:'Fixture Reader'},
                    priority:{name:'Medium'},components:[],created:'2026-10-19T09:00:00Z',updated:'2026-10-19T10:00:00Z',issuelinks:[]},
                    changelog:{startAt:0,total:0,histories:[]}};
            }
            const issues=[issue('DEMO-201','API read-only registry','Open'),issue('DEMO-202','UI read-only registry','Done')];
            Object.assign(api,{
                baseUrl:location.origin,
                getProjects:()=>read('projects',[{key:'DEMO',name:'Fixture project'}]),
                getProjectEpics:()=>read('epics',{issues:[]}),
                getProjectCreateMeta:()=>read('metadata',{projects:[]}),
                getProjectComponents:()=>read('components',[]),
                searchUsers:()=>read('users',{users:[]}),
                getProjectIssues:()=>read('stories',{issues}),
                getIssuesByKeys:keys=>read('linked',{issues:issues.filter(issue=>keys.includes(issue.key))})
            });
            config.STORAGE_KEY='ujg-acceptance-importer-coexist';
            localStorage.setItem(config.STORAGE_KEY,JSON.stringify({projectKey:'DEMO'}));
            // A stray ajax/fetch from either gadget must fail, even before CSP.
            window.jQuery.ajax=()=>{throw new Error('Unexpected HTTP API transport in coexistence');};
            window.fetch=()=>{throw new Error('Unexpected fetch transport in coexistence');};
            const Importer=window.taRequire('_ujgExcelStoryImporterRuntime');
            window.coexistImporter.instance=new Importer({getGadgetContentEl:()=>window.jQuery('#importer-neighbor')});
            window.coexistImporter.shared=window.taRequire('_ujgShared_llmClient');
        });
        const importer=page.locator('#importer-neighbor');
        await importer.locator('[aria-label="Режим Jira"]').click();
        await importer.locator('[aria-label="Загрузить замечания из Jira"]').click();
        await page.waitForFunction(()=>document.querySelectorAll('#importer-neighbor .ujg-esi-parent-row').length===2);
        assert.match(await importer.textContent(),/API read-only registry/);
        assert.match(await importer.textContent(),/UI read-only registry/);
        await importer.locator('[data-sort="summary"]').click();
        assert.equal(await importer.locator('th[data-column="summary"]').getAttribute('aria-sort'),'ascending');
        assert.match(await importer.locator('.ujg-esi-parent-row').first().textContent(),/API read-only registry/);
        await importer.locator('tr[data-key="DEMO-201"] .ujg-esi-issue-summary-text').focus();
        assert.match(await importer.locator('.ujg-esi-description-popover').textContent(),/Fixture description for DEMO 201/);
        await page.keyboard.press('Escape');

        const styles=()=>importer.locator('[data-sort="summary"]').evaluate(el=>{
            const s=getComputedStyle(el);return {color:s.color,background:s.backgroundColor,font:s.font,border:s.border,padding:s.padding};
        });
        const assistantStyle=await page.$('link[href="/ujg-ticket-assistant.css"]');
        await page.mouse.move(0,0);
        await assistantStyle.evaluate(el=>{el.disabled=true;});
        const withImporter = await styles();
        await assistantStyle.evaluate(el=>{el.disabled=false;});
        await page.addStyleTag({url:url+'ujg-ticket-assistant.css'});
        assert.deepEqual(await styles(),withImporter,'assistant CSS cannot restyle importer');
        assert.deepEqual(await assistantButton.evaluate(el=>({color:getComputedStyle(el).color,padding:getComputedStyle(el).padding})),assistantBefore);
        await page.evaluate(()=>{window.coexistImporter.table=document.querySelector('#importer-neighbor .ujg-esi-registry-table');});
        await page.locator('[data-ta-source]').fill('AMD coexistence');
        await page.locator('[data-ta-prepare]').click(); await idle(page);
        assert.equal(await page.locator('[data-ta-field="summary"] input').inputValue(),'Уточнить обработку ошибок API');
        assert.equal(await page.evaluate(()=>window.coexistImporter.table===document.querySelector('#importer-neighbor .ujg-esi-registry-table')),true,'assistant render preserves importer table');
        assert.equal(await importer.locator('.ujg-esi-parent-row').count(),2);
        await page.evaluate(()=>window.scrollTo(0,0));
        await capture(page,'coexistence-1440');
        await page.evaluate(()=>{window.taAcceptance.mode='slow';});
        await page.locator('[data-ta-prepare]').click();
        await page.waitForFunction(()=>window.taPreview.instance.controller.getState().stage==='preparing');
        await page.evaluate(()=>{window.taPreview.instance.destroy();window.taPreview.instance.destroy();});
        assert.equal(await page.locator('[data-ta-source]').count(),0,'real assistant destruction clears its UI');
        await importer.locator('[data-sort="summary"]').click();
        assert.equal(await importer.locator('th[data-column="summary"]').getAttribute('aria-sort'),'descending');
        assert.match(await importer.locator('.ujg-esi-parent-row').first().textContent(),/UI read-only registry/);
        await page.waitForTimeout(2800);
        assert.equal(await page.locator('[data-ta-source]').count(),0,'late assistant completion stays destroyed');
        assert.equal(await importer.locator('.ujg-esi-parent-row').count(),2,'importer remains mounted after assistant destroy');
        assert.equal(await page.evaluate(()=>window.coexistImporter.shared===window.taRequire('_ujgShared_llmClient')),true);
        assert.equal(await page.evaluate(()=>window.coexistImporter.shared===window.taRequire('_ujgTA_llmClient')),false,'independent shared-client AMD identities');
        assert.deepEqual(await page.evaluate(()=>window.coexistImporter.calls.filter(call=>call==='stories')),['stories']);
        assert.equal(await page.evaluate(()=>window.coexistImporter.writes),0);
        await page.evaluate(()=>window.scrollTo(0,0));
        await capture(page,'coexistence-destroy-1440');
    });
});
