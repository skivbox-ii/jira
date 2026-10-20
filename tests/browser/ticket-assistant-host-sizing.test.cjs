/* Real layout regression: generated runtime, jQuery host API, no network. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '../..');
const artifacts = '/tmp/ticket-assistant-host-sizing-20261020';
fs.mkdirSync(artifacts, {recursive:true});

async function setup(t, width, options = {}) {
    const browser = await chromium.launch({channel:'chrome',headless:true});
    t.after(() => browser.close());
    const page = await browser.newPage({viewport:{width,height:1000}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent('<div id="gadget-15253" class="gadget-inline" style="height:0;overflow:hidden"><div id="content"></div></div>');
    await page.addStyleTag({path:path.join(root,'ujg-ticket-assistant.css')});
    await page.addScriptTag({path:require.resolve('jquery/dist/jquery.js')});
    await page.evaluate(options => {
        const modules = new Map([['jquery',{value:window.jQuery}]]);
        window.define = (name,deps,factory) => modules.set(name,{deps,factory});
        window.taRequire = name => {
            const entry = modules.get(name);
            if (!('value' in entry)) entry.value = entry.factory(...entry.deps.map(window.taRequire));
            return entry.value;
        };
        window.hostSizing = {calls:0, observers:[], before:document.querySelector('.gadget-inline').clientHeight};
        for (const name of ['ResizeObserver','MutationObserver']) {
            const Native = window[name];
            window[name] = options.noObservers ? undefined : class extends Native {
                constructor(callback) {super(callback);window.hostSizing.observers.push(this);}
                disconnect() {this.disconnected=true;super.disconnect();}
            };
        }
    }, options);
    await page.addScriptTag({content:require('./ticket-assistant-preview-server.cjs').buildPreviewAssets()['ujg-ticket-assistant.runtime.js']});
    await page.evaluate(options => {
        const $ = window.jQuery, records = window.hostSizing;
        const api = {
            getCurrentUser:() => new Promise(resolve => {records.identify=() => resolve({key:'offline-host-sizing'});}),
            getProjects:async() => ({values:[{id:'1',key:'DO',name:'Delivery'}]}),
            getCreateMeta:async() => ({projects:[{id:'1',key:'DO',issuetypes:[{id:'10',name:'Task',subtask:false,fields:{
                summary:{name:'Summary',required:true,schema:{type:'string',system:'summary'}},
                description:{name:'Description',schema:{type:'string',system:'description'}}
            }}]}]}),
            getComponents:async() => ({values:[],complete:true,projectKey:'DO'}),
            getVersions:async() => ({values:[],complete:true,projectKey:'DO'})
        };
        records.hostApi = {
            getGadgetContentEl:() => $('#content'),
            resize:function() {
                if (this !== records.hostApi) throw new Error('Lost host API receiver');
                records.calls++;
                $('.gadget-inline').height($('#content').outerHeight(true));
            }
        };
        if (options.noResize) delete records.hostApi.resize;
        const Gadget = window.taRequire('_ujgTicketAssistantRuntime');
        records.gadget = new Gadget(records.hostApi,{api,storage:null,baseUrl:'',
            fetchImpl:() => {throw new Error('No provider/network allowed');}});
    }, options);
    return {page, errors};
}

async function resizedAfter(page, action) {
    const before = await page.evaluate(() => window.hostSizing.calls);
    await action();
    await page.waitForFunction(before => window.hostSizing.calls > before, before);
}

for (const width of [1440,390]) {
    test('zero-height clipped UJG host becomes visible and follows layout at '+width, async t => {
        const {page,errors} = await setup(t,width);
        assert.equal(await page.evaluate(() => window.hostSizing.before),0);
        assert.equal(await page.locator('.ta-header').count(),1,'UI mounted even while identity is pending');
        await page.screenshot({path:path.join(artifacts,width+'-initial.png'),fullPage:true});
        await page.waitForFunction(() => document.querySelector('.gadget-inline').clientHeight > 0,{},{timeout:1500});
        assert.equal(await page.locator('.ta-header').evaluate(el => {
            const header=el.getBoundingClientRect(),host=el.closest('.gadget-inline').getBoundingClientRect();
            return header.height>0 && header.top>=host.top && header.bottom<=host.bottom;
        }),true,'header is inside the visible host, not clipped');
        await page.screenshot({path:path.join(artifacts,width+'-mounted.png'),fullPage:true});
        await resizedAfter(page,() => page.evaluate(async() => {
            const s=window.hostSizing;s.identify();await s.gadget.ready;
            await s.gadget.controller.selectProject('DO');
            await s.gadget.controller.selectIssueType('10');
            await s.gadget.controller.selectTemplate('task');
        }));
        await page.waitForFunction(() => document.querySelector('.gadget-inline').clientHeight >= document.querySelector('#content').offsetHeight);
        await resizedAfter(page,() => page.locator('[data-ta-project] [data-ta-picker]').click());
        await page.screenshot({path:path.join(artifacts,width+'-picker.png'),fullPage:true});
        await page.locator('[data-ta-project] [data-ta-picker]').click();
        await resizedAfter(page,() => page.locator('[data-ta-open-settings]').click());
        await page.screenshot({path:path.join(artifacts,width+'-settings.png'),fullPage:true});
        await resizedAfter(page,() => page.locator('[data-ta-settings-cancel]').click());
        await resizedAfter(page,() => page.locator('[data-ta-open-connection]').click());
        await page.screenshot({path:path.join(artifacts,width+'-connection.png'),fullPage:true});
        await resizedAfter(page,() => page.locator('[data-ta-connection-cancel]').click());
        // Native ResizeObserver must also catch layout changes without controller updates.
        await resizedAfter(page,() => page.addStyleTag({content:'.ujg-ticket-assistant textarea[data-ta-source] { height:900px; }'}));
        assert.equal(await page.locator('.ta-source-area').evaluate(el=>getComputedStyle(el).overflowY==='visible' && el.clientHeight>=900),true,'source expands in normal document flow');
        assert.equal(await page.locator('.ta-primary-actions').evaluate(el=>{
            const workspace=el.previousElementSibling;
            return getComputedStyle(el).position==='static' && el.getBoundingClientRect().top>=workspace.getBoundingClientRect().bottom;
        }),true,'actions follow the complete workspace');
        await page.waitForFunction(() => document.querySelector('.gadget-inline').clientHeight >= document.querySelector('#content').offsetHeight);
        await page.screenshot({path:path.join(artifacts,width+'-expanded.png'),fullPage:true});
        await page.waitForTimeout(100);
        const before=await page.evaluate(() => window.hostSizing.calls);
        await page.evaluate(() => {
            const el=document.querySelector('.ujg-ticket-assistant');
            for(let i=0;i<100;i++) el.setAttribute('data-burst',String(i));
        });
        await page.waitForTimeout(100);
        const after=await page.evaluate(() => window.hostSizing.calls);
        assert.ok(after>before && after-before<=2,'mutation burst is coalesced');
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => window.hostSizing.calls),after,'host sizing settles without a feedback loop');
        const destroyed=await page.evaluate(async() => {
            document.querySelector('.ujg-ticket-assistant').setAttribute('data-pending','yes');
            await Promise.resolve(); // Deliver the mutation and queue its resize before teardown.
            const s=window.hostSizing;s.gadget.destroy();s.gadget.destroy();
            document.querySelector('.ujg-ticket-assistant').style.height='1200px';
            return {calls:s.calls,disconnected:s.observers.every(observer => observer.disconnected),count:s.observers.length};
        });
        assert.ok(destroyed.count>=2 && destroyed.disconnected,'both native observers are disconnected');
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => window.hostSizing.calls),destroyed.calls,'queued work cannot resize after destroy');
        assert.deepEqual(errors,[]);
        console.log('host sizing '+width+': visible mount, async state, picker, settings, connection, native layout, coalescing, cleanup; '+after+' calls');
    });
}

test('offline host tolerates missing resize and missing observers; pending init cannot resize after destroy',async t => {
    const {page,errors}=await setup(t,390,{noResize:true,noObservers:true});
    await page.evaluate(async() => {const s=window.hostSizing;s.identify();await s.gadget.ready;s.gadget.destroy();});
    assert.deepEqual(errors,[]);
    const second=await setup(t,390,{noObservers:true});
    await second.page.waitForFunction(() => window.hostSizing.calls>0,{},{timeout:1500});
    await resizedAfter(second.page,() => second.page.evaluate(async() => {const s=window.hostSizing;s.identify();await s.gadget.ready;}));
    await second.page.evaluate(() => {window.hostSizing.gadget.destroy();});
    const calls=await second.page.evaluate(() => window.hostSizing.calls);
    await second.page.waitForTimeout(100);
    assert.equal(await second.page.evaluate(() => window.hostSizing.calls),calls);
    assert.deepEqual(second.errors,[]);
});

test('destroy before first resize also cancels pending initialization sizing',async t => {
    const {page,errors}=await setup(t,390);
    await page.evaluate(() => {
        const s=window.hostSizing;
        s.gadget.destroy();
        const Gadget=window.taRequire('_ujgTicketAssistantRuntime');
        s.calls=0;
        s.gadget=new Gadget(s.hostApi,{baseUrl:'',storage:null,api:{getCurrentUser:() => new Promise(resolve => {s.finish=resolve;})}});
        s.gadget.destroy();s.finish({key:'destroyed-offline-user'});
    });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.hostSizing.calls),0);
    assert.deepEqual(errors,[]);
});
