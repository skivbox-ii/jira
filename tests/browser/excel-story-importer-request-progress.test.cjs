const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),jquery=require('jquery');
function setup(kind='registry') {
  const dom=new JSDOM('<div id="root"></div>',{runScripts:'outside-only',url:'http://localhost'}),$=jquery(dom.window),modules={jquery:$},calls=[];
  dom.window.define=(name,deps,factory)=>modules[name]=factory(...deps.map(d=>modules[d]));
  for(const file of ['icons','rendering'])dom.window.eval(fs.readFileSync(path.join(__dirname,'../../ujg-excel-story-importer-modules',file+'.js'),'utf8'));
  assert.equal(typeof modules._ujgESI_rendering.createRequestPanel,'function');
  const ui=modules._ujgESI_rendering.createRequestPanel(kind);
  const services={onStopRegistryLoad:()=>calls.push('stop'),onRestartRegistryLoad:()=>calls.push('restart'),onRetryRegistryLoad:()=>calls.push('retry')};
  return {dom,$,ui,services,calls,close:()=>{ui.destroy();dom.window.close();}};
}
test('request panel patches rows and timers without disturbing focus/scroll and exposes Russian accessible controls',t=>{
  const x=setup();t.after(x.close);const start=Date.now()-2400;
  const progress={runId:1,status:'running',rows:[{id:'a',stage:'stories',startAt:25,requested:200,state:'running',startedAt:start}]};
  x.ui.mount(x.$('#root'));x.ui.update(progress,x.services,'2026-10-11T10:00:00Z');
  const row=x.$('[data-request-id="a"]')[0],stop=x.$('[data-request-control="stop"]')[0];stop.focus();x.$('.ujg-esi-request-list').scrollTop(37);
  progress.rows[0]={...progress.rows[0],state:'completed',received:25,total:1000,finishedAt:Date.now()};x.ui.update(progress,x.services,'2026-10-11T10:00:00Z');
  assert.equal(x.$('[data-request-id="a"]')[0],row);assert.equal(x.dom.window.document.activeElement,stop);assert.equal(x.$('.ujg-esi-request-list').scrollTop(),37);
  assert.match(x.$('[data-request-id="a"]').text(),/200.*25.*1000/);assert.match(x.$('.ujg-esi-request-snapshot').text(),/Предыдущий.*11\.10\.2026 13:00:00 МСК/);
  stop.click();assert.deepEqual(x.calls,['stop']);assert.equal(stop.getAttribute('aria-label'),'Остановить загрузку');
  progress.status='error';x.ui.update(progress,x.services);x.$('[data-request-control="retry"]')[0].click();x.$('[data-request-control="restart"]')[0].click();assert.deepEqual(x.calls,['stop','retry','restart']);
  assert.equal(x.$('[aria-live]').length,0,'elapsed time must not announce every second');
});
test('progress controls reuse widget button styling, supported icons and a running-only spinner',t=>{
  const x=setup();t.after(x.close);x.ui.mount(x.$('#root'));const progress={runId:1,status:'running',rows:[]};x.ui.update(progress,x.services);
  assert.equal(x.$('[data-request-control]').filter('.ujg-esi-small-btn').length,3);
  assert.equal(x.$('[data-request-control="stop"] svg circle').length,0,'Stop must not silently use the Info fallback');
  assert.equal(x.$('[data-request-control="restart"] svg circle').length,0,'Restart must not silently use the Info fallback');
  assert.equal(x.$('.ujg-esi-request-spinner').css('visibility'),'visible');
  progress.status='completed';x.ui.update(progress,x.services);assert.equal(x.$('.ujg-esi-request-spinner').css('visibility'),'hidden');
});
test('1000 request rows stay inspectable while timer ticks only patch active elapsed cells and detach clears timers',t=>{
  const x=setup();t.after(x.close);let pending=[],cleared=[];
  x.dom.window.setTimeout=fn=>{pending.push(fn);return pending.length;};x.dom.window.clearTimeout=id=>cleared.push(id);
  const rows=Array.from({length:1000},(_,i)=>({id:'r'+i,stage:'history',key:'P-'+i,state:i<3?'running':'queued',startedAt:i<3?Date.now()-1000:undefined}));
  x.ui.mount(x.$('#root'));x.ui.update({runId:1,status:'running',rows},x.services);
  assert.equal(x.$('[data-request-id]').length,1000);const last=x.$('[data-request-id="r999"]')[0],first=x.$('[data-request-id="r0"]')[0];
  pending.shift()();assert.equal(x.$('[data-request-id="r999"]')[0],last);assert.equal(x.$('[data-request-id="r0"]')[0],first);
  assert.match(x.$('[data-request-id="r0"] .ujg-esi-request-elapsed').text(),/с/);
  x.ui.suspend();assert.ok(cleared.length>0);x.$('#root').empty();const count=pending.length;pending.at(-1)();assert.equal(pending.length,count);
});
test('elapsed ticks remain independent of sustained progress and stop on lifecycle cleanup',t=>{
  const x=setup();t.after(x.close);
  let now=10000, sequence=0;const scheduled=new Map();
  x.dom.window.Date.now=()=>now;
  x.dom.window.setTimeout=(callback,delay)=>{const id=++sequence;scheduled.set(id,{callback,at:now+delay});return id;};
  x.dom.window.clearTimeout=id=>scheduled.delete(id);
  function advance(ms) {
    const end=now+ms;
    while(true) {
      const next=Array.from(scheduled).filter(([,job])=>job.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!next)break;now=next[1].at;scheduled.delete(next[0]);next[1].callback();
    }
    now=end;
  }
  const progress={runId:1,status:'running',rows:[{id:'slow',stage:'history',key:'P-1',state:'running',startedAt:now}]};
  x.ui.mount(x.$('#root'));x.ui.update(progress,x.services);
  const slow=x.$('[data-request-id="slow"]')[0],timer=Array.from(scheduled.keys())[0];
  advance(500);x.ui.update(progress,x.services);
  assert.ok(scheduled.has(timer),'Ordinary updates must not postpone the scheduled tick');
  for(let i=1;i<20;i++) {
    advance(500);
    progress.rows.push({id:'done'+i,stage:'history',key:'P-'+(i+1),state:'completed',startedAt:now-100,finishedAt:now});
    x.ui.update(progress,x.services);
  }
  assert.equal(x.$('[data-request-id="slow"] .ujg-esi-request-elapsed').text(),'10 с');
  assert.equal(x.$('[data-request-id="slow"]')[0],slow);assert.equal(scheduled.size,1);
  advance(1000);assert.equal(x.$('[data-request-id="slow"] .ujg-esi-request-elapsed').text(),'11 с');
  x.ui.update(null,x.services);assert.equal(scheduled.size,0);
  x.ui.update(progress,x.services);assert.equal(scheduled.size,1);x.ui.suspend();assert.equal(scheduled.size,0);
  x.ui.update(progress,x.services);x.ui.detach();assert.equal(scheduled.size,0);
  x.ui.mount(x.$('#root'));x.ui.update(progress,x.services);x.$('#root').empty();advance(1000);assert.equal(scheduled.size,0);
  x.ui.mount(x.$('#root'));x.ui.update(progress,x.services);assert.equal(scheduled.size,1);x.ui.destroy();assert.equal(scheduled.size,0);
});
test('explicit panel reveal scrolls only the controls header to nearest view without moving focus',t=>{
  const x=setup('activity');t.after(x.close);const scrolled=[];
  x.dom.window.HTMLElement.prototype.scrollIntoView=function(options){scrolled.push({element:this,options:{...options}});};
  x.$('#root').append('<input aria-label="Filter draft" value="unchanged">');const draft=x.$('input')[0];draft.focus();draft.setSelectionRange(1,3);
  const progress={runId:1,status:'running',rows:[{id:'slow',stage:'history',state:'running',startedAt:Date.now()}]};
  x.ui.mount(x.$('#root'));x.ui.update(progress,x.services);assert.equal(scrolled.length,0);
  assert.equal(typeof x.ui.reveal,'function');x.ui.reveal();
  assert.equal(scrolled.length,1);assert.equal(scrolled[0].element,x.$('.ujg-esi-request-head')[0]);
  assert.deepEqual(scrolled[0].options,{block:'nearest',inline:'nearest',behavior:'auto'});
  assert.equal(x.dom.window.document.activeElement,draft);assert.deepEqual([draft.value,draft.selectionStart,draft.selectionEnd],['unchanged',1,3]);
  x.ui.update(progress,x.services);assert.equal(scrolled.length,1);x.ui.detach();x.ui.reveal();assert.equal(scrolled.length,1);
});
