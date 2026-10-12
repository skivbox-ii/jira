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
  x.$('[data-request-details]').trigger('click');
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
  x.$('[data-request-details]').trigger('click');
  assert.match(x.$('[role="progressbar"]').attr('aria-valuetext'),/История изменений.*Выполняется/);
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
  x.$('[data-request-details]').trigger('click');
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
test('successful, idle and absent progress hide the entire panel and cannot reveal or scroll it again',t=>{
  const x=setup();t.after(x.close);let scrolls=0;
  x.dom.window.HTMLElement.prototype.scrollIntoView=()=>scrolls++;
  x.ui.mount(x.$('#root'));
  const progress={runId:1,status:'running',rows:[{id:'a',stage:'stories',state:'completed',received:1,total:1}]};
  x.ui.update(progress,x.services);assert.notEqual(x.$('section').css('display'),'none');
  for(const status of ['completed','completed','idle']) {
    progress.status=status;x.ui.update(progress,x.services);x.ui.reveal();
    assert.equal(x.$('section').css('display'),'none');
    assert.equal(x.$('section').attr('data-progress-status'),status);
    assert.equal(progress.rows.length,1,'diagnostic evidence stays in state');
  }
  x.ui.update(null,x.services);assert.equal(x.$('section').css('display'),'none');assert.equal(scrolls,0);
});
test('closed details do not tick row cells and opening refreshes them; terminal work cannot imply 100 percent success',t=>{
  const x=setup('activity');t.after(x.close);let now=10000,next;
  x.dom.window.Date.now=()=>now;x.dom.window.setTimeout=fn=>{next=fn;return 1;};x.dom.window.clearTimeout=()=>{};
  x.ui.mount(x.$('#root'));const progress={runId:1,status:'running',total:2,completed:0,failures:[],rows:[{id:'h',stage:'history',state:'running',startedAt:now}]};
  x.ui.update(progress,x.services);const row=x.$('[data-request-id="h"]')[0];
  now=15000;next();assert.equal(x.$('.ujg-esi-request-elapsed').text(),'0 с');
  assert.equal(x.$('.ujg-esi-request-total-elapsed').text(),'00:05');
  x.$('[data-request-details]')[0].click();assert.equal(x.$('.ujg-esi-request-elapsed').text(),'5 с');
  assert.equal(x.$('[data-request-id="h"]')[0],row);
  progress.status='cancelled';progress.completed=2;x.ui.update(progress,x.services);
  assert.equal(x.$('[role="progressbar"]').attr('aria-valuenow'),undefined);
  assert.doesNotMatch(x.$('.ujg-esi-request-percent').text(),/100/);
});
test('details start collapsed per run, keep stable rows and disclosure through progress/failure, and retain retry evidence',t=>{
  const x=setup();t.after(x.close);x.ui.mount(x.$('#root'));
  let progress={runId:1,status:'running',rows:[{id:'old',runId:1,stage:'stories',state:'running',startedAt:Date.now()}]};
  x.ui.update(progress,x.services);
  const button=x.$('[data-request-details]')[0];assert.ok(button,'accessible details button');
  assert.equal(button.tagName,'SUMMARY');assert.equal(button.getAttribute('aria-expanded'),'false');
  assert.equal(x.dom.window.document.getElementById(button.getAttribute('aria-controls')).hidden,true);
  button.focus();button.click();assert.equal(button.getAttribute('aria-expanded'),'true');
  button.dispatchEvent(new x.dom.window.KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}));
  assert.equal(button.getAttribute('aria-expanded'),'false');
  button.dispatchEvent(new x.dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  assert.equal(button.getAttribute('aria-expanded'),'true');
  const row=x.$('[data-request-id="old"]')[0];x.$('.ujg-esi-request-list').scrollTop(45);
  progress.status='error';progress.rows[0].state='error';progress.rows[0].error='<failed>';
  x.ui.update(progress,x.services);assert.equal(button.getAttribute('aria-expanded'),'true');
  assert.equal(x.dom.window.document.activeElement,button);assert.equal(x.$('.ujg-esi-request-list').scrollTop(),45);
  progress={runId:2,status:'running',rows:[progress.rows[0],{id:'new',runId:2,stage:'stories',state:'running'}]};
  x.ui.update(progress,x.services);assert.equal(button.getAttribute('aria-expanded'),'false');
  assert.equal(x.$('[data-request-id="old"]')[0],row);button.click();
  assert.match(x.$('.ujg-esi-request-heading').text(),/Предыдущих ошибок: 1/);
  assert.match(x.$('[data-request-id="old"]').text(),/Предыдущий.*<failed>/);assert.equal(x.$('[data-request-id="old"] failed').length,0);
  assert.doesNotMatch(x.$('.ujg-esi-request-stage-count').text(),/Ошибка|<failed>/);
});
test('a separate registry read reusing batch one cannot inherit counts from earlier reads',t=>{
  const x=setup();t.after(x.close);x.ui.mount(x.$('#root'));
  const progress={runId:1,status:'running',rows:[
    {id:'first',stage:'linked',batch:1,startAt:0,state:'completed',received:100,total:100},
    {id:'second',stage:'linked',batch:1,startAt:0,state:'running',requested:100}
  ]};
  x.ui.update(progress,x.services);
  assert.equal(x.$('[role="progressbar"]').attr('aria-valuenow'),undefined);
  progress.rows[1]={...progress.rows[1],state:'completed',received:25,total:50};
  progress.rows.push({id:'page',stage:'linked',batch:1,startAt:25,state:'running',requested:100});
  x.ui.update(progress,x.services);assert.equal(x.$('[role="progressbar"]').attr('aria-valuenow'),'50');
  assert.match(x.$('.ujg-esi-request-stage-count').text(),/25 из 50/);
  assert.equal(x.$('[data-request-stage="linked"]').attr('data-stage-state'),'running');
});
test('registry stage counts use actual returned pages in the active batch, never requested size or prior runs',t=>{
  const x=setup();t.after(x.close);x.ui.mount(x.$('#root'));
  const progress={runId:2,status:'running',rows:[
    {id:'old',runId:1,stage:'stories',state:'error',received:999,total:999},
    {id:'a',runId:2,stage:'stories',batch:1,state:'completed',received:25,total:100,startAt:0,requested:200},
    {id:'b',runId:2,stage:'stories',batch:1,state:'running',startAt:25,requested:200}
  ]};
  x.ui.update(progress,x.services);
  assert.equal(x.$('[role="progressbar"]').attr('aria-valuenow'),'25');
  assert.match(x.$('.ujg-esi-request-stage-count').text(),/25 из 100/);
  assert.equal(x.$('[data-request-stage="linked"]').attr('data-stage-state'),'queued');
  progress.rows.push({id:'c',runId:2,stage:'linked',batch:1,state:'running',requested:100});
  progress.rows[2].state='completed';progress.rows[2].received=75;progress.rows[2].total=100;
  x.ui.update(progress,x.services);
  assert.equal(x.$('[data-request-stage="stories"]').attr('data-stage-state'),'completed');
  assert.equal(x.$('[role="progressbar"]').attr('aria-valuenow'),undefined);
  progress.rows[3].state='completed';progress.rows[3].received=50;progress.rows[3].total=50;
  progress.rows.push({id:'d',runId:2,stage:'linked',batch:2,state:'running'});x.ui.update(progress,x.services);
  assert.equal(x.$('[role="progressbar"]').attr('aria-valuenow'),undefined,'unknown new batch cannot reuse old denominator');
  progress.localStage='Подготовка Excel';x.ui.update(progress,x.services);
  assert.match(x.$('.ujg-esi-request-head').text(),/Подготовка Excel/);
  assert.equal(x.$('[role="progressbar"]').attr('aria-valuenow'),undefined);
});
test('activity aggregate excludes failures, terminal states stop spinning, and only useful actions are visible',t=>{
  const x=setup('activity');t.after(x.close);x.ui.mount(x.$('#root'));
  const progress={runId:1,status:'running',total:10,completed:6,failures:[{key:'P-1'}],rows:[
    {id:'h',stage:'history',state:'completed',received:1},{id:'c',stage:'comments',state:'running'}]};
  x.ui.update(progress,{});
  assert.equal(x.$('[role="progressbar"]').attr('aria-valuenow'),'50');
  assert.match(x.$('.ujg-esi-request-stage-count').text(),/5 из 10/);
  assert.equal(x.$('[data-request-control="retry"]').css('display'),'none');
  assert.equal(x.$('[data-request-stage="history"]').attr('data-stage-state'),'running','one finished history row cannot prove all ten finished');
  for(const status of ['error','cancelled']) {
    progress.status=status;x.ui.update(progress,{});
    assert.notEqual(x.$('section').css('display'),'none');
    assert.equal(x.$('.ujg-esi-request-spinner').filter(function(){return x.$(this).css('visibility')==='visible';}).length,0);
    assert.equal(x.$('[data-request-control="stop"]').css('display'),'none');
    assert.equal(x.$('[data-request-control="retry"]').css('display'),status==='error'?'inline-block':'none');
  }
});
test('aggregate elapsed ticks while details are closed, local-only work ticks, and terminal updates clear scheduling',t=>{
  const x=setup();t.after(x.close);let now=10000,next;const cleared=[];
  x.dom.window.Date.now=()=>now;x.dom.window.setTimeout=fn=>{next=fn;return 1;};x.dom.window.clearTimeout=id=>cleared.push(id);
  x.ui.mount(x.$('#root'));const progress={runId:1,status:'running',localStage:'Подготовка Excel',rows:[]};
  x.ui.update(progress,x.services);assert.equal(typeof next,'function');
  now=72000;next();assert.equal(x.$('.ujg-esi-request-total-elapsed').text(),'01:02');
  progress.status='error';x.ui.update(progress,x.services);assert.ok(cleared.length);
});
test('compact rail exposes only positive current-run active request counts',t=>{
  const x=setup('activity');t.after(x.close);x.ui.mount(x.$('#root'));
  const progress={runId:2,status:'running',total:10,completed:0,failures:[],rows:[
    {id:'old',runId:1,stage:'history',state:'running'},
    ...Array.from({length:3},(_,i)=>({id:'active'+i,runId:2,stage:'history',state:'running'}))
  ]};
  x.ui.update(progress,x.services);const cue=x.$('.ujg-esi-request-active-count');
  assert.equal(cue.text(),'3 запроса выполняются');assert.notEqual(cue.css('display'),'none');
  assert.equal(x.$('details').prop('open'),false);
  progress.rows[1].state='completed';progress.rows[2].state='completed';x.ui.update(progress,x.services);
  assert.equal(cue.text(),'1 запрос выполняется');
  progress.rows[3].state='completed';x.ui.update(progress,x.services);assert.equal(cue.css('display'),'none');
  progress.rows[3].state='running';progress.status='cancelled';x.ui.update(progress,x.services);
  assert.equal(cue.css('display'),'none','terminal panels must not claim requests still execute');
});
test('summary arriving after an empty snapshot stays first without replacing existing stage nodes',t=>{
  const x=setup();t.after(x.close);x.ui.mount(x.$('#root'));
  const progress={runId:1,status:'running',rows:[]};x.ui.update(progress,x.services);
  const stories=x.$('[data-request-stage="stories"]')[0],linked=x.$('[data-request-stage="linked"]')[0];
  progress.rows.push({id:'summary',stage:'summary',state:'running'});x.ui.update(progress,x.services);
  assert.deepEqual(x.$('[data-request-stage]').toArray().map(node=>node.dataset.requestStage),['summary','stories','linked']);
  assert.equal(x.$('[data-request-stage="stories"]')[0],stories);assert.equal(x.$('[data-request-stage="linked"]')[0],linked);
});
test('failed or cancelled workbook work retains its actual stage when producer clears localStage',t=>{
  const x=setup();t.after(x.close);x.ui.mount(x.$('#root'));
  for(const [runId,status] of [[1,'error'],[2,'cancelled']]) {
    const progress={runId,status:'running',localStage:'Подготовка Excel',rows:[
      {id:'s'+runId,stage:'stories',state:'completed',received:2,total:2},
      {id:'l'+runId,stage:'linked',state:'completed',received:3,total:3}
    ]};x.ui.update(progress,x.services);
    const local=x.$('[data-request-stage="local"]')[0];
    progress.status=status;progress.localStage='';progress.error='Workbook failed';x.ui.update(progress,x.services);
    assert.equal(x.$('[data-request-stage="local"]')[0],local,'terminal state retains the actual workbook stage');
    assert.equal(x.$('[data-request-stage="local"]').attr('data-stage-state'),status);
    assert.equal(x.$('[data-request-stage="stories"]').attr('data-stage-state'),'completed');
    assert.equal(x.$('[data-request-stage="linked"]').attr('data-stage-state'),'completed');
    assert.equal(x.$('[role="progressbar"]').attr('aria-valuenow'),undefined);
  }
  x.ui.update({runId:3,status:'running',rows:[]},x.services);
  assert.equal(x.$('[data-request-stage="local"]').length,0,'local evidence cannot leak to a new run');
});
test('stage states and active progress phase are accessible without color or decorative icons',t=>{
  const x=setup();t.after(x.close);x.ui.mount(x.$('#root'));
  const progress={runId:1,status:'running',rows:[{id:'s',stage:'stories',state:'running'}]};
  x.ui.update(progress,x.services);
  assert.match(x.$('[data-request-stage="stories"]').text(),/Выполняется/);
  assert.match(x.$('[data-request-stage="linked"]').text(),/В очереди/);
  assert.match(x.$('[role="progressbar"]').attr('aria-valuetext'),/Истории.*Выполняется/);
  progress.rows[0].state='completed';progress.rows.push({id:'l',stage:'linked',state:'running'});x.ui.update(progress,x.services);
  assert.match(x.$('[data-request-stage="stories"]').text(),/Завершён/);
  assert.match(x.$('[role="progressbar"]').attr('aria-valuetext'),/Связанные задачи.*Выполняется/);
  progress.rows[1].state='error';progress.status='error';x.ui.update(progress,x.services);
  assert.match(x.$('[data-request-stage="linked"]').text(),/Ошибка/);
  assert.match(x.$('[role="progressbar"]').attr('aria-valuetext'),/Связанные задачи.*Ошибка/);
  assert.equal(x.$('[aria-live]').length,0);
  x.ui.update({runId:2,status:'running',rows:[{id:'other',stage:'custom-stage',state:'running'}]},x.services);
  assert.match(x.$('[role="progressbar"]').attr('aria-valuetext'),/custom-stage.*Выполняется/);
  assert.equal(x.$('[data-request-id="other"]').length,1);
});
test('native details content wrapper is transparent to the full-width disclosure body',t=>{
  const x=setup();t.after(x.close);
  const css=fs.readFileSync(path.join(__dirname,'../../ujg-excel-story-importer.css'),'utf8');
  x.$('<style/>').text(css).appendTo(x.$('head'));
  const rule=Array.from(x.dom.window.document.styleSheets[0].cssRules).find(rule=>rule.selectorText==='.ujg-esi-request-head details::details-content');
  assert.ok(rule,'modern native wrapper must participate transparently in the header flex layout');
  assert.equal(rule.style.getPropertyValue('display'),'contents');
  x.ui.mount(x.$('#root'));x.ui.update({runId:1,status:'running',rows:[]},x.services);
  const body=x.$('details > .ujg-esi-request-details-body')[0];
  assert.ok(body);assert.equal(body.hidden,true);
  x.$('[data-request-details]')[0].click();assert.equal(body.hidden,false);
  assert.equal(x.$(body).css('flex-basis'),'100%');
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
