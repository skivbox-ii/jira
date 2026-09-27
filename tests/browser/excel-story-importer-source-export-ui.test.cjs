const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),jquery=require('jquery');
const dir=path.join(__dirname,'../../ujg-excel-story-importer-modules');
function setup() {
 const dom=new JSDOM('<button id="a">Source</button>',{runScripts:'outside-only',url:'http://localhost'}),$=jquery(dom.window),calls=[],pending=[];
 const modules={jquery:$,_ujgESI_sourceExport:{days:()=>['2026-09-26','2026-09-27','unknown'],text:(data,day)=>'RAW '+day,screen:(data,day)=>'ЛИСТИНГ '+day+' <script>danger()</script>'}};
 dom.window.define=(name,deps,f)=>modules[name]=f(...deps.map(d=>modules[d]));
 for(const file of ['icons','source-export-ui'])if(fs.existsSync(path.join(dir,file+'.js')))dom.window.eval(fs.readFileSync(path.join(dir,file+'.js'),'utf8'));
 const ui=modules._ujgESI_sourceExportUi?.create(),state={projectKey:'P',epicKey:'P-99',rows:[]};
 const services={onSourceExportPlan:()=>['GET /search'],onLoadSourceExport:options=>{calls.push(options);return new Promise((resolve,reject)=>pending.push({resolve,reject}));}};
 return {dom,$,ui,state,services,calls,pending,open:()=>ui.open(state,services,$('#a')[0]),flush:()=>new Promise(r=>setImmediate(r))};
}
const result={coverage:{complete:false,loadedIssues:2,expectedIssues:3},errors:[{key:'P-3',message:'HTTP 403'}],requests:[{method:'GET'}]};
test('opening only displays plan; explicit collection is not duplicated; daily text is safe',async t=>{
 const x=setup();assert.ok(x.ui);t.after(()=>{x.ui.destroy();x.dom.window.close();});x.open();await x.flush();
 assert.equal(x.calls.length,0);assert.match(x.$('.ujg-esi-source-plan').text(),/GET \/search/);
 x.$('.ujg-esi-source-load').trigger('click').trigger('click');await x.flush();assert.equal(x.calls.length,1);
 x.pending[0].resolve(result);await x.flush();assert.match(x.$('.ujg-esi-source-status').text(),/НЕПОЛНЫЕ.*2.*3/);
 assert.match(x.$('.ujg-esi-source-text').text(),/ЛИСТИНГ 2026-09-27/);assert.equal(x.$('.ujg-esi-source-text script').length,0);
 x.$('.ujg-esi-source-prev').trigger('click');assert.match(x.$('.ujg-esi-source-text').text(),/ЛИСТИНГ 2026-09-26/);
 x.$('.ujg-esi-source-unknown').trigger('click');assert.match(x.$('.ujg-esi-source-text').text(),/ЛИСТИНГ unknown/);
});
test('screen-first view keeps downloads secondary and request listing readable',async t=>{
 const x=setup();t.after(()=>{x.ui.destroy();x.dom.window.close();});
 x.services.onSourceExportPlan=()=>[{method:'GET',url:'/rest/api/2/search',params:{jql:'project = P',startAt:'0, 100 до total'},when:'Все страницы'}];
 x.open();assert.match(x.$('.ujg-esi-source-plan').text(),/GET \/rest\/api\/2\/search/);
 assert.match(x.$('.ujg-esi-source-plan').text(),/jql: project = P/);assert.doesNotMatch(x.$('.ujg-esi-source-plan').text(),/"method"|\{\n/);
 assert.equal(x.$('.ujg-esi-source-json').closest('details').length,1);
 assert.equal(x.$('.ujg-esi-source-json').closest('details').prop('open'),false);
 x.$('.ujg-esi-source-load').trigger('click');await x.flush();
 x.pending[0].resolve({...result,requests:[{method:'GET',url:'/issue/P-1',status:200,durationMs:37,params:{fields:'*all'}}]});await x.flush();
 assert.match(x.$('.ujg-esi-source-audit').text(),/GET \/issue\/P-1.*HTTP 200.*37 мс/);
 assert.match(x.$('.ujg-esi-source-audit').text(),/P-3.*HTTP 403/);
 assert.doesNotMatch(x.$('.ujg-esi-source-audit').text(),/"requests"|"coverage"/);
});
test('close and scope changes cancel reads and ignore late replies',async t=>{
 const x=setup();assert.ok(x.ui);t.after(()=>{x.ui.destroy();x.dom.window.close();});x.open();x.$('.ujg-esi-source-load').trigger('click');await x.flush();
 x.ui.dismiss();assert.equal(x.calls[0].isCancelled(),true);assert.equal(x.dom.window.document.activeElement.id,'a');
 x.pending[0].resolve(result);await x.flush();assert.equal(x.$('.ujg-esi-source-dialog').length,0);
 x.open();x.ui.updateScope({...x.state,epicKey:'P-100'});assert.equal(x.$('.ujg-esi-source-dialog').length,0);
});
test('errors permit explicit retry, no automatic loop',async t=>{
 const x=setup();assert.ok(x.ui);t.after(()=>{x.ui.destroy();x.dom.window.close();});x.open();x.$('.ujg-esi-source-load').trigger('click');await x.flush();
 x.pending[0].reject(new Error('Unavailable'));await x.flush();assert.match(x.$('.ujg-esi-source-status').text(),/Unavailable/);assert.equal(x.calls.length,1);
 assert.equal(x.$('.ujg-esi-source-json').prop('disabled'),true);
});
test('day arrows remain usable after selecting a date without records',async t=>{
 const x=setup();t.after(()=>{x.ui.destroy();x.dom.window.close();});x.open();x.$('.ujg-esi-source-load').trigger('click');await x.flush();x.pending[0].resolve(result);await x.flush();
 x.$('.ujg-esi-source-date').val('2026-09-25').trigger('change');
 assert.equal(x.$('.ujg-esi-source-next').prop('disabled'),false);
 x.$('.ujg-esi-source-next').trigger('click');assert.equal(x.$('.ujg-esi-source-date').val(),'2026-09-26');
 x.$('.ujg-esi-source-date').val('2026-09-28').trigger('change');
 assert.equal(x.$('.ujg-esi-source-prev').prop('disabled'),false);
 x.$('.ujg-esi-source-prev').trigger('click');assert.equal(x.$('.ujg-esi-source-date').val(),'2026-09-27');
});
test('failed plan cannot launch a read',async t=>{
 const x=setup();t.after(()=>{x.ui.destroy();x.dom.window.close();});x.services.onSourceExportPlan=()=>{throw Error('No project');};x.open();
 assert.equal(x.$('.ujg-esi-source-load').prop('disabled'),true);x.$('.ujg-esi-source-load').trigger('click');await x.flush();assert.equal(x.calls.length,0);
});
test('all download buttons retain complete payloads and correct selected date',async t=>{
 const x=setup();t.after(()=>{x.ui.destroy();x.dom.window.close();});const blobs=[],links=[];
 x.dom.window.Blob=class{constructor(parts,options){this.parts=parts;this.type=options.type;blobs.push(this);}};
 x.dom.window.URL.createObjectURL=()=> 'blob:fixture';x.dom.window.URL.revokeObjectURL=()=>{};
 x.dom.window.HTMLAnchorElement.prototype.click=function(){links.push({name:this.download,href:this.href});};
 x.open();x.$('.ujg-esi-source-load').trigger('click');await x.flush();x.pending[0].resolve({...result,finishedAt:'2026-09-27T12:00:00Z'});await x.flush();
 x.$('.ujg-esi-source-json').trigger('click');x.$('.ujg-esi-source-all').trigger('click');x.$('.ujg-esi-source-day').trigger('click');
 assert.equal(blobs.length,3);assert.equal(JSON.parse(blobs[0].parts[0]).errors[0].key,'P-3');assert.match(blobs[0].type,/application\/json/);
 assert.match(links[0].name,/jira-source-P-/);assert.equal(links[2].name,'jira-source-2026-09-27.txt');assert.match(blobs[2].parts[0],/2026-09-27/);
 x.$('.ujg-esi-source-unknown').trigger('click');x.$('.ujg-esi-source-day').trigger('click');assert.equal(links[3].name,'jira-source-unknown.txt');
});
