const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {JSDOM}=require('jsdom'),jquery=require('jquery'),load=require('./helpers/load-amd-module');
const dir=path.join(__dirname,'../ujg-excel-story-importer-modules');
function setup(t,filters) {
  const dom=new JSDOM('<main></main>',{url:'http://localhost'}),w=dom.window,$=jquery(w);
  const registry=load(path.join(dir,'registry.js'),{_ujgESI_remarkId:load(path.join(dir,'remark-id.js'),{}),_ujgESI_deadlines:load(path.join(dir,'deadlines.js'),{})});
  const grid=load(path.join(dir,'grid.js'),{jquery:$,_ujgESI_registry:registry,_ujgESI_icons:()=> $('<i/>'),_ujgESI_teams:load(path.join(dir,'teams.js'),{})},{window:w,document:w.document}).create();
  w.localStorage.setItem('test',JSON.stringify({gridLayout:{filters}}));
  const state={preferencesStorageKey:'test',projectKey:'P',viewMode:'jira',rows:[
    {id:'one',jiraKey:'P-1',storyDetails:{key:'P-1',done:true,status:'Done'},childStatuses:[{key:'P-3',done:false,status:'Open'}]},
    {id:'two',jiraKey:'P-2',storyDetails:{key:'P-2',done:false,status:'Reopened',statusCategory:'done'},childStatuses:[{key:'P-4',done:true,status:'Done'},{key:'P-5',done:false,status:'Open'}]}
  ]};
  let changes=0;grid.mount($('main'),state,{appendActions(){},historySelectionChanged(){changes++;}});
  t.after(()=>{grid.suspend();dom.window.close();});
  return {$,grid,state,keys:()=>Array.from(grid.historyKeys(state)),changes:()=>changes};
}
test('grid saved exclusion selection uses registry predicate and ignores other filters, pages and collapse',t=>{
  const a=setup(t,{excludeDoneStories:true,excludeDone:true,summary:['absent']});
  assert.deepEqual(a.keys(),['P-2','P-5']);
  a.grid.toggleAll();assert.deepEqual(a.keys(),['P-2','P-5']);
});
test('grid exclusion drafts and Cancel do not change selection; apply and reset notify',t=>{
  const a=setup(t,{}),{$}=a;
  $('[data-filter="status"]').trigger('click');
  $('input[aria-label="Исключить готовые истории"]').prop('checked',true).trigger('change');
  assert.deepEqual(a.keys(),['P-1','P-3','P-2','P-4','P-5']);assert.equal(a.changes(),0);
  $('.ujg-esi-filter-actions button').filter((_,e)=>$(e).text()==='Отмена').trigger('click');assert.equal(a.changes(),0);
  $('[data-filter="status"]').trigger('click');$('input[aria-label="Исключить готовые истории"]').prop('checked',true).trigger('change');$('.ujg-esi-filter-apply').trigger('click');
  assert.deepEqual(a.keys(),['P-2','P-4','P-5']);assert.equal(a.changes(),1);
  a.grid.resetFiltersButton(a.state).trigger('click');assert.deepEqual(a.keys(),['P-1','P-3','P-2','P-4','P-5']);assert.equal(a.changes(),2);
});
test('children-only exclusion retains parents; manual disclosure loads hidden child until cleared',t=>{
  const a=setup(t,{excludeDone:true}),{$}=a;
  assert.deepEqual(a.keys(),['P-1','P-3','P-2','P-5']);
  const toggle=()=>$('.ujg-esi-parent-row[data-key="P-2"] .ujg-esi-remark-toggle').trigger('click');
  toggle();toggle();assert.deepEqual(a.keys(),['P-1','P-3','P-2','P-4','P-5']);
  toggle();assert.deepEqual(a.keys(),['P-1','P-3','P-2','P-5']);assert.equal(a.changes(),3);
});
