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
 assert.equal(x.$('.ujg-esi-epic-option input:checked').length,1);
 x.$('.ujg-esi-epic-option input[value="P-1"]')[0].click();
 assert.deepEqual(x.state.epicPicker.draft,['P-1','P-99']);assert.deepEqual(x.state.epicKeys,['P-99']);
 x.$('.ujg-esi-epic-search').val('Second').trigger('input');
 assert.equal(x.$('.ujg-esi-epic-option input[value="P-1"]').prop('checked'),true);
 x.$('.ujg-esi-epic-option input[value="P-2"]')[0].click();
 x.$('.ujg-esi-epic-apply')[0].click();assert.deepEqual(x.calls,[['P-1','P-2','P-99']]);
});
test('Escape and outside click cancel the draft and restore toggle focus',t=>{
 const x=setup();t.after(x.close);assert.equal(x.$('.ujg-esi-epic-toggle').length,1);x.$('.ujg-esi-epic-toggle')[0].click();x.$('.ujg-esi-epic-option input[value="P-1"]')[0].click();
 x.$('.ujg-esi-epic-search').trigger(x.$.Event('keydown',{key:'Escape'}));assert.equal(x.state.epicPicker.open,false);assert.equal(x.calls.length,0);
 assert.equal(x.dom.window.document.activeElement.className.includes('ujg-esi-epic-toggle'),true);
 x.$('.ujg-esi-epic-toggle')[0].click();x.$('#outside')[0].click();assert.equal(x.state.epicPicker.open,false);assert.deepEqual(x.state.epicKeys,['P-99']);
});

test('label clicks toggle once and leave checkbox nodes and focus stable',t=>{
 const x=setup();t.after(x.close);x.$('.ujg-esi-epic-toggle')[0].click();
 const check=x.$('.ujg-esi-epic-option input[value="P-1"]')[0];check.focus();
 x.$(check).siblings('span')[0].click();assert.deepEqual(x.state.epicPicker.draft,['P-1','P-99']);
 assert.equal(x.$('.ujg-esi-epic-option input[value="P-1"]')[0],check);
 check.click();assert.deepEqual(x.state.epicPicker.draft,['P-99']);
 assert.equal(x.dom.window.document.activeElement,check);
});
test('toolbar CSS keeps epic checkboxes compact and labels readable',t=>{
 const x=setup();t.after(x.close);const style=x.dom.window.document.createElement('style');style.textContent=fs.readFileSync(path.join(dir,'../ujg-excel-story-importer.css'),'utf8');x.dom.window.document.head.append(style);
 x.$('.ujg-esi-epic-toggle')[0].click();const checkbox=x.$('.ujg-esi-epic-option input')[0],text=x.$('.ujg-esi-epic-option span')[0];
 const checkStyle=x.dom.window.getComputedStyle(checkbox),textStyle=x.dom.window.getComputedStyle(text);
 assert.equal(checkStyle.width,'16px');assert.equal(checkStyle.height,'16px');assert.equal(checkStyle.minWidth,'16px');assert.match(textStyle.minWidth,/^0(?:px)?$/);assert.equal(textStyle.flexGrow,'1');
 assert.equal(x.dom.window.getComputedStyle(x.$('.ujg-esi-epic-list')[0]).overflowX,'hidden');
 assert.equal(x.dom.window.getComputedStyle(x.$('.ujg-esi-epic-apply')[0]).borderTopStyle,'solid');
});
