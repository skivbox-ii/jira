const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),jquery=require('jquery');
const dir=path.join(__dirname,'../ujg-excel-story-importer-modules');
function setup(){
 const dom=new JSDOM('<div id="app"></div><button id="outside">Outside</button>',{runScripts:'outside-only',url:'http://localhost'}),$=jquery(dom.window),modules={jquery:$};
 dom.window.scrollTo=()=>{};
 dom.window.define=(name,deps,f)=>modules[name]=f(...deps.map(d=>modules[d]));
 // Use the real renderer with its unrelated views absent.
 for(const file of ['epic-scope','remark-id','deadlines','registry','teams','icons','grid','rendering'])dom.window.eval(fs.readFileSync(path.join(dir,file+'.js'),'utf8'));
 const rendering=modules._ujgESI_rendering,state={projectKey:'P',projects:[{key:'P'}],epicKeys:['P-99'],epicKey:'P-99',epics:[{key:'P-1',fields:{summary:'First'}},{key:'P-2',fields:{summary:'Second'}}],epicPicker:{open:false,query:''},rows:[],viewMode:'excel',mappingSettings:{},userPicker:{},issueTypePicker:{}};
 const render=()=>rendering.render(state),calls=[];
 const services={onEpicOpen(){state.epicPicker={open:true,query:'',draft:state.epicKeys.slice()};render();},onEpicDraft(keys){state.epicPicker.draft=Array.from(keys);},onEpicCancel(){state.epicPicker.open=false;render();},onEpicApply(){calls.push(state.epicPicker.draft.slice());state.epicKeys=state.epicPicker.draft.slice();state.epicPicker.open=false;render();}};
 rendering.init($('#app'),services);render();
 return {dom,$,state,calls,render,close:()=>dom.window.close()};
}
test('epic popup applies bubbling checkbox clicks once, retains search selections and missing keys',t=>{
 const x=setup();t.after(x.close);assert.equal(x.$('.ujg-esi-epic-toggle').length,1);x.$('.ujg-esi-epic-toggle')[0].click();
 assert.equal(x.$('.ujg-esi-selected-chip[data-epic-key="P-99"]').length,1);
 assert.equal(x.$('.ujg-esi-epic-option input:checked').length,0);
 x.$('.ujg-esi-epic-option input[value="P-1"]')[0].click();
 assert.deepEqual(x.state.epicPicker.draft,['P-1','P-99']);assert.deepEqual(x.state.epicKeys,['P-99']);
 x.$('.ujg-esi-epic-search').val('Second').trigger('input');
 assert.equal(x.$('.ujg-esi-selected-chip[data-epic-key="P-1"]').length,1);
 assert.equal(x.$('.ujg-esi-epic-option input[value="P-1"]').length,0);
 x.$('.ujg-esi-epic-option input[value="P-2"]')[0].click();
 x.$('.ujg-esi-epic-apply')[0].click();assert.deepEqual(x.calls,[['P-1','P-2','P-99']]);
});
test('Escape and outside click cancel the draft and restore toggle focus',t=>{
 const x=setup();t.after(x.close);assert.equal(x.$('.ujg-esi-epic-toggle').length,1);x.$('.ujg-esi-epic-toggle')[0].click();x.$('.ujg-esi-epic-option input[value="P-1"]')[0].click();
 x.$('.ujg-esi-epic-search').trigger(x.$.Event('keydown',{key:'Escape'}));assert.equal(x.state.epicPicker.open,false);assert.equal(x.calls.length,0);
 assert.equal(x.dom.window.document.activeElement.className.includes('ujg-esi-epic-toggle'),true);
 x.$('.ujg-esi-epic-toggle')[0].click();x.$('#outside')[0].click();assert.equal(x.state.epicPicker.open,false);assert.deepEqual(x.state.epicKeys,['P-99']);
});

test('native label selection moves the row to one removable chip and retains useful focus',t=>{
 const x=setup();t.after(x.close);x.$('.ujg-esi-epic-toggle')[0].click();
 const check=x.$('.ujg-esi-epic-option input[value="P-1"]')[0];check.focus();
 x.$(check).siblings('span')[0].click();assert.deepEqual(x.state.epicPicker.draft,['P-1','P-99']);
 assert.equal(x.$('.ujg-esi-epic-option input[value="P-1"]').length,0);
 const chip=x.$('.ujg-esi-selected-chip[data-epic-key="P-1"]')[0];
 assert.equal(x.dom.window.document.activeElement,chip);
 x.$(chip).find('svg')[0].dispatchEvent(new x.dom.window.MouseEvent('click',{bubbles:true}));
 assert.deepEqual(x.state.epicPicker.draft,['P-99']);
 assert.equal(x.dom.window.document.activeElement,x.$('.ujg-esi-epic-option input[value="P-1"]')[0]);
 assert.equal(x.state.epicPicker.open,true);assert.equal(x.calls.length,0);
});
test('search keeps chips pinned and removing a nonmatching chip does not reveal its candidate',t=>{
 const x=setup();t.after(x.close);x.$('.ujg-esi-epic-toggle')[0].click();
 x.$('.ujg-esi-epic-search').val('Second').trigger('input');
 const search=x.$('.ujg-esi-epic-search')[0];search.focus();search.setSelectionRange(2,2);
 x.$('.ujg-esi-selected-chip[data-epic-key="P-99"] span')[0].click();
 assert.equal(x.$('.ujg-esi-epic-option input[value="P-99"]').closest('label')[0].hidden,true);
 assert.equal(x.dom.window.document.activeElement,search);assert.equal(search.value,'Second');assert.equal(search.selectionStart,2);
 assert.equal(x.$('.ujg-esi-epic-option input[value="P-2"]').closest('label')[0].hidden,false);
 x.$(search).val('').trigger('input');
 assert.equal(x.$('.ujg-esi-epic-option input[value="P-99"]').closest('label')[0].hidden,false);
});
test('select all includes matching selected keys, preserves nonmatches and always shows selected chips',t=>{
 const x=setup();t.after(x.close);x.$('.ujg-esi-epic-toggle')[0].click();
 const all=x.$('.ujg-esi-filter-all input')[0];assert.ok(all,'matching select-all exists');
 assert.equal(all.indeterminate,true);assert.equal(x.$('.ujg-esi-filter-count').text(),'1 / 3');
 x.$('.ujg-esi-epic-search').val('First').trigger('input');assert.equal(all.indeterminate,false);
 all.click();assert.deepEqual(x.state.epicPicker.draft,['P-1','P-99']);assert.equal(all.checked,true);
 all.click();assert.deepEqual(x.state.epicPicker.draft,['P-99']);
 x.$('.ujg-esi-epic-search').val('').trigger('input');all.click();
 assert.equal(x.$('.ujg-esi-selected-chip').length,3);assert.equal(x.$('.ujg-esi-epic-option').length,0);
 assert.equal(all.checked,true);assert.equal(all.indeterminate,false);assert.equal(x.$('.ujg-esi-filter-count').text(),'3 / 3');
 x.$('.ujg-esi-epic-search').val('no results').trigger('input');
 assert.equal(all.checked,false);assert.equal(all.indeterminate,false);assert.equal(all.disabled,true);
 assert.equal(x.$('.ujg-esi-selected-chip').length,3);assert.deepEqual(x.state.epicKeys,['P-99']);
});
test('top sort commands reorder only choices and reset stays a draft until OK',t=>{
 const x=setup();t.after(x.close);x.$('.ujg-esi-epic-toggle')[0].click();
 const commands=x.$('.ujg-esi-epic-options > .ujg-esi-menu-command');assert.equal(commands.length,3);
 assert.match(commands[0].title,/эпиков/);assert.match(commands[1].title,/эпиков/);
 const catalog=x.state.epics.map(e=>e.key),search=x.$('.ujg-esi-epic-search')[0];
 x.$(search).val('P-').trigger('input');
 commands[1].click();assert.deepEqual(x.$('.ujg-esi-epic-option input').map((i,e)=>e.value).get(),['P-2','P-1']);
 commands[0].click();assert.deepEqual(x.$('.ujg-esi-epic-option input').map((i,e)=>e.value).get(),['P-1','P-2']);
 assert.deepEqual(x.state.epics.map(e=>e.key),catalog);assert.equal(search.value,'P-');
 commands[2].click();assert.deepEqual(x.state.epicPicker.draft,[]);assert.deepEqual(x.state.epicKeys,['P-99']);
 assert.match(x.$('.ujg-esi-epic-hint').text(),/Все истории проекта/);
 x.$('.ujg-esi-epic-cancel')[0].click();assert.equal(x.calls.length,0);
 x.$('.ujg-esi-epic-toggle')[0].click();x.$('.ujg-esi-menu-command')[2].click();x.$('.ujg-esi-epic-apply')[0].click();
 assert.deepEqual(x.calls,[[]]);
});
test('toolbar CSS protects row display and sizing from host forms and search hide/show',t=>{
 const x=setup();t.after(x.close);
 x.state.epics[0].fields.summary='VeryLongEpicName'.repeat(30);x.render();
 const style=x.dom.window.document.createElement('style');
 style.textContent='label { display:block; flex-direction:column; } input { width:100%; min-height:30px; }'+fs.readFileSync(path.join(dir,'../ujg-excel-story-importer.css'),'utf8');x.dom.window.document.head.append(style);
 x.$('.ujg-esi-epic-toggle')[0].click();
 const checkbox=x.$('.ujg-esi-epic-option input')[0],row=checkbox.parentElement,text=x.$(checkbox).siblings('span')[0],computed=e=>x.dom.window.getComputedStyle(e);
 assert.equal(computed(row).display,'flex');assert.equal(computed(row).flexDirection,'row');
 // A wrapped candidate aligns its checkbox with the first 18px text line; select-all stays centered.
 assert.equal(computed(row).alignItems,'flex-start');assert.equal(computed(checkbox).marginTop,'1px');
 const all=x.$('.ujg-esi-filter-all')[0];assert.equal(computed(all).alignItems,'center');assert.equal(computed(all.querySelector('input')).marginTop,'0px');
 assert.equal(computed(checkbox).width,'16px');assert.equal(computed(checkbox).height,'16px');assert.equal(computed(checkbox).minWidth,'16px');
 assert.match(computed(text).minWidth,/^0(?:px)?$/);assert.equal(computed(text).flexGrow,'1');assert.equal(computed(text).overflowWrap,'anywhere');
 x.$('.ujg-esi-epic-search').val('Second').trigger('input');assert.equal(computed(row).display,'none');
 x.$('.ujg-esi-epic-search').val('').trigger('input');assert.equal(computed(row).display,'flex');assert.equal(computed(row).alignItems,'flex-start');
 assert.equal(computed(x.$('.ujg-esi-epic-list')[0]).overflowX,'hidden');
 assert.equal(computed(x.$('.ujg-esi-epic-actions')[0]).borderTopStyle,'solid');
 assert.equal(computed(x.$('.ujg-esi-epic-actions')[0]).justifyContent,'flex-end');
 assert.equal(x.$('.ujg-esi-epic-options').hasClass('ujg-esi-grid-menu'),true);
});
test('popup reclamps after chips change its height near the viewport bottom',t=>{
 const x=setup();t.after(x.close);x.dom.window.innerHeight=500;x.dom.window.innerWidth=390;
 // JSDOM has no layout; supply only the two layout measurements consumed by placement.
 const originalRect=x.dom.window.HTMLElement.prototype.getBoundingClientRect,originalHeight=x.$.fn.outerHeight;
 x.dom.window.HTMLElement.prototype.getBoundingClientRect=function(){
  return this.classList.contains('ujg-esi-epic-toggle') ? {left:360,bottom:460} : originalRect.call(this);
 };
 x.$.fn.outerHeight=function(){
  return this.hasClass('ujg-esi-epic-options') ? (x.$('.ujg-esi-selected-chip').length>1 ? 400 : 340) : originalHeight.apply(this,arguments);
 };
 x.$('.ujg-esi-epic-toggle')[0].click();
 const popup=x.$('.ujg-esi-epic-options')[0];assert.equal(popup.style.width,'282px');assert.equal(popup.style.left,'96px');assert.equal(popup.style.top,'148px');
 x.$('.ujg-esi-epic-option input[value="P-1"]')[0].click();
 assert.equal(popup.style.top,'88px');assert.equal(popup.style.maxHeight,'476px');
});
