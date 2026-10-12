const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const jquery=require('jquery');
const dir=path.join(__dirname,'../../ujg-excel-story-importer-modules');
function setup() {
  const dom=new JSDOM('<button id="origin">Open</button><div id="host"></div>',{runScripts:'outside-only',url:'http://localhost'});
  const $=jquery(dom.window),modules={jquery:$},calls=[];
  dom.window.define=(name,deps,factory)=>modules[name]=factory(...deps.map(d=>modules[d]));
  const file=path.join(dir,'status-transition-ui.js');
  if(fs.existsSync(file)) {dom.window.eval(fs.readFileSync(path.join(dir,'icons.js'),'utf8'));dom.window.eval(fs.readFileSync(file,'utf8'));}
  assert.equal(typeof modules._ujgESI_statusTransitionUi?.create,'function','status UI must exist');
  const ui=modules._ujgESI_statusTransitionUi.create();
  const state={baseUrl:'https://jira.test/base',statusTransition:{open:true,key:'TEST-1',transitions:[{id:'21',name:'Start',target:'In Progress',simple:true,fields:[],hint:'Без дополнительных полей'},{id:'41',name:'Resolve',target:'Done',simple:false,fields:[{name:'Resolution',required:true}],hint:'Требует поля'}],selectedId:null}};
  const services={onCloseStatusTransition:()=>calls.push('close'),onSelectStatusTransition:id=>calls.push(id),onApplyStatusTransition:()=>calls.push('apply'),onRetryStatusTransition:()=>calls.push('retry'),onRefreshStatusTransition:()=>calls.push('refresh')};
  dom.window.document.getElementById('origin').focus();
  const render=()=>ui.render($('#host'),state,services);render();
  return {dom,$,ui,state,calls,render,close:()=>{ui.destroy();dom.window.close();}};
}
test('choices carry IDs, remain read-only and extra fields link to exact Jira issue',t=>{
  const a=setup();t.after(a.close); assert.equal(a.$('.ujg-esi-status-dialog').attr('role'),'dialog');
  a.$('[data-transition-id="21"]').trigger('click');assert.deepEqual(a.calls,['21']);
  assert.equal(a.$('.ujg-esi-status-apply').prop('disabled'),true);
  a.state.statusTransition.selectedId='21';a.render();a.$('.ujg-esi-status-apply').trigger('click');assert.deepEqual(a.calls,['21','apply']);
  a.state.statusTransition.selectedId='41';a.render();assert.equal(a.$('.ujg-esi-status-apply').prop('disabled'),true);
  assert.match(a.$('.ujg-esi-status-fields').text(),/Resolution.*обязатель/i);
  assert.equal(a.$('.ujg-esi-status-jira').attr('href'),'https://jira.test/base/browse/TEST-1');
});
test('dialog traps focus, blocks closing during write, restores origin and escapes metadata',t=>{
  const a=setup();t.after(a.close);a.state.statusTransition.running=true;a.render();
  a.dom.window.document.dispatchEvent(new a.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(a.calls.length,0);
  a.state.statusTransition.running=false;a.state.statusTransition.transitions[0].name='<img src=x onerror=alert(1)>';a.render();
  assert.equal(a.$('.ujg-esi-status-dialog img').length,0);
  const last=a.$('.ujg-esi-status-dialog button:not(:disabled),.ujg-esi-status-dialog a[href]').last()[0];last.focus();
  a.dom.window.document.dispatchEvent(new a.dom.window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
  assert.equal(a.dom.window.document.activeElement,a.$('.ujg-esi-status-close')[0]);
  a.dom.window.document.dispatchEvent(new a.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.deepEqual(a.calls,['close']);
  a.state.statusTransition.open=false;a.render();assert.equal(a.dom.window.document.activeElement.id,'origin');
});
test('failed refresh and uncertain outcome expose read-only recovery without Apply',t=>{
  const a=setup();t.after(a.close);
  for(const outcome of ['refresh-failed','unconfirmed']) {
    a.state.statusTransition.outcome=outcome;a.state.statusTransition.selectedId='21';a.render();
    assert.equal(a.$('.ujg-esi-status-apply').prop('disabled'),true);
    a.$('.ujg-esi-status-refresh').trigger('click');
  }
  assert.deepEqual(a.calls,['refresh','refresh']);
});
test('closing after readback replaces the original badge restores focus to the exact issue',t=>{
  const a=setup();t.after(a.close);
  a.dom.window.document.getElementById('origin').remove();
  a.$('body').prepend('<button class="ujg-esi-status-trigger" data-issue-key="TEST-1">Actual</button>');
  a.state.statusTransition.open=false;a.render();
  assert.equal(a.dom.window.document.activeElement,a.$('.ujg-esi-status-trigger')[0]);
});
test('registry status buttons identify Story and child without changing compact column widths',t=>{
  const dom=new JSDOM('<div id="grid"></div>',{runScripts:'outside-only',url:'http://localhost'});t.after(()=>dom.window.close());
  const $=jquery(dom.window),modules={jquery:$},calls=[];
  dom.window.define=(name,deps,factory)=>modules[name]=factory(...deps.map(d=>modules[d]));
  for(const file of ['remark-id','deadlines','registry','icons','teams','grid']) dom.window.eval(fs.readFileSync(path.join(dir,file+'.js'),'utf8'));
  const grid=modules._ujgESI_grid.create(),state={viewMode:'jira',baseUrl:'https://jira.test',rows:[{id:'1',jiraKey:'TEST-1',storyDetails:{key:'TEST-1',status:'A very long custom status'},childStatuses:[{key:'TEST-2',status:'Testing'},{key:'../TEST-3',status:'Invalid'}]}]};
  const mount=()=>{ $('#grid').empty();grid.mount($('#grid'),state,{openStatus:entry=>calls.push([entry.key,entry.isChild]),appendActions(){}});};mount();
  const width=$('col[data-column="status"]').attr('width');
  const story=$('.ujg-esi-status-trigger[data-issue-key="TEST-1"]')[0];story.click();
  $('.ujg-esi-status-trigger[data-issue-key="TEST-2"]')[0].click();
  assert.deepEqual(calls,[['TEST-1',false],['TEST-2',true]]);
  assert.equal(story.tagName,'BUTTON');assert.equal(story.getAttribute('aria-haspopup'),'dialog');
  assert.equal($('.ujg-esi-status-trigger[data-issue-key="../TEST-3"]').prop('disabled'),true);
  state.registryLoading=true;mount();assert.equal($('.ujg-esi-status-trigger[data-issue-key="TEST-1"]').prop('disabled'),true);
  assert.equal($('col[data-column="status"]').attr('width'),width);grid.suspend();
});
