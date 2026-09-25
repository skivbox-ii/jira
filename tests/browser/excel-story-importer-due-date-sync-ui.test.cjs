const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {JSDOM} = require("jsdom");
const jquery = require("jquery");
const dir = path.join(__dirname, "../../ujg-excel-story-importer-modules");

function row(id, changes = {}) {
  return {id, key:"P-"+id, remarkId:String(id), summary:"Remark "+id,
    sourceRaw:"25.09.2026", newDate:"2026-09-25", oldDate:"2026-09-20",
    eligible:true, selected:true, status:"ready", message:"", ...changes};
}
function setup() {
  const dom = new JSDOM('<button id="origin">Open</button><div id="host"></div>', {runScripts:"outside-only", url:"http://localhost"});
  const $ = jquery(dom.window), modules = {jquery:$};
  dom.window.define = (name,deps,factory) => modules[name] = factory(...deps.map(dep => modules[dep]));
  for (const file of ["icons","due-date-sync-ui"]) dom.window.eval(fs.readFileSync(path.join(dir,file+".js"),"utf8"));
  dom.window.__dueModule = modules._ujgESI_dueDateSyncUi;
  const calls = {close:0,rows:[],all:[],confirm:0};
  const services = {onCloseDueDateSync(){calls.close++;}, onSelectDueDateSyncRow(id,value){calls.rows.push([id,value]);},
    onSelectAllDueDateSync(value){calls.all.push(value);}, onConfirmDueDateSync(){calls.confirm++;}};
  const state = {baseUrl:"https://jira.example.test/base", preferencesStorageKey:"user-17",
    dueDateSync:{open:true,loading:false,running:false,rows:[row("1"),row("2"),row("3",{eligible:false,selected:false,status:"skipped",message:"Без срока"})],error:"",completed:0,total:0}};
  let ui = modules._ujgESI_dueDateSyncUi.create();
  dom.window.document.querySelector("#origin").focus();
  const render = () => ui.render($("#host"),state,services);
  render();
  return {dom,$,state,calls,render,recreate:()=>{ui.destroy();ui=modules._ujgESI_dueDateSyncUi.create();render();},destroy:()=>ui.destroy(),close:()=>{ui.destroy();dom.window.close();}};
}

test("selection applies to all eligible rows including filtered rows", t => {
  const x=setup(); t.after(x.close);
  x.$('[data-due-filter="remark"]').trigger("click");
  x.$('.ujg-esi-due-filter-only[data-value="1 Remark 1"]').trigger("click");
  x.$(".ujg-esi-due-filter-apply").trigger("click");
  assert.match(x.$(".ujg-esi-due-count").text(),/1 из 3/);
  x.$(".ujg-esi-due-select-all").prop("checked",false).trigger("change");
  assert.deepEqual(x.calls.all,[false]);
  x.state.dueDateSync.rows[0].selected=false; x.state.dueDateSync.rows[1].selected=false; x.render();
  assert.equal(x.$(".ujg-esi-due-confirm").prop("disabled"),true);
  x.$(".ujg-esi-due-select-all").prop("checked",true).trigger("change");
  assert.deepEqual(x.calls.all,[false,true]);
});

test("row selection keeps identity through sort and rerender", t => {
  const x=setup(); t.after(x.close);
  x.$('[data-due-sort="key"]').trigger("click");
  x.$('.ujg-esi-due-row-select[data-row-id="2"]').prop("checked",false).trigger("change");
  assert.deepEqual(x.calls.rows,[["2",false]]);
  x.state.dueDateSync.rows[1].selected=false; x.render();
  assert.equal(x.$(".ujg-esi-due-select-all").prop("indeterminate"),true);
  assert.match(x.$(".ujg-esi-due-confirm").text(),/\(1\)/);
});

test("running blocks dismissal and edits, then restores focus when closed", t => {
  const x=setup(); t.after(x.close);
  x.state.dueDateSync.running=true; x.state.dueDateSync.total=2; x.state.dueDateSync.completed=1; x.render();
  assert.equal(x.$(".ujg-esi-due-close").prop("disabled"),true);
  assert.equal(x.$(".ujg-esi-due-confirm").prop("disabled"),true);
  x.dom.window.document.dispatchEvent(new x.dom.window.KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
  assert.equal(x.calls.close,0);
  x.state.dueDateSync.running=false; x.render();
  x.$(".ujg-esi-due-close").trigger("click");
  assert.equal(x.calls.close,1);
  x.state.dueDateSync.open=false; x.render();
  assert.equal(x.dom.window.document.activeElement.id,"origin");
});

test("unsafe values are text and only valid Jira keys become HTTP links", t => {
  const x=setup(); t.after(x.close);
  x.state.dueDateSync.rows=[row("evil",{key:"javascript:alert(1)",summary:'<img src=x onerror=alert(1)>',sourceRaw:'<script>alert(1)</script>',message:'<b>bad</b>',status:"error"}),row("safe",{key:"P-42",status:"updated"})];
  x.render();
  assert.equal(x.$(".ujg-esi-due-dialog img,.ujg-esi-due-dialog script,.ujg-esi-due-dialog b").length,0);
  assert.equal(x.$('.ujg-esi-due-row[data-row-id="evil"] a').length,0);
  assert.equal(x.$('.ujg-esi-due-row[data-row-id="safe"] a').attr("href"),"https://jira.example.test/base/browse/P-42");
  assert.equal(x.$('.ujg-esi-due-row[data-row-id="evil"] .ujg-esi-due-result svg').length,0);
  assert.equal(x.$('.ujg-esi-due-row[data-row-id="safe"] .ujg-esi-due-result svg').length,1);
});

test("column layout and filters persist per user and view", t => {
  const x=setup(); t.after(x.close);
  x.$(".ujg-esi-due-columns-button").trigger("click");
  x.$('[data-due-visible="oldDate"]').prop("checked",false).trigger("change");
  x.$('[data-due-sort="remark"]').trigger("click");
  x.recreate();
  assert.equal(x.$('th[data-column="oldDate"]').length,0);
  assert.ok(x.dom.window.localStorage.getItem("user-17:due-date-sync-ui"));
});

test("outside click cancels a draft filter without changing applied values", t => {
  const x=setup(); t.after(x.close);
  x.$('[data-due-filter="key"]').trigger("click");
  x.$('.ujg-esi-due-filter-only[data-value="P-1"]').trigger("click");
  x.dom.window.document.querySelector("#origin").dispatchEvent(new x.dom.window.MouseEvent("mousedown",{bubbles:true}));
  assert.equal(x.$(".ujg-esi-due-filter-menu").length,0);
  assert.match(x.$(".ujg-esi-due-count").text(),/3 из 3/);
});

test("saved filter values remain removable after rows change", t => {
  const x=setup(); t.after(x.close);
  x.$('[data-due-filter="key"]').trigger("click");
  x.$('.ujg-esi-due-filter-only[data-value="P-1"]').trigger("click");
  x.$(".ujg-esi-due-filter-apply").trigger("click");
  x.state.dueDateSync.rows=[row("4")];x.render();
  x.$('[data-due-filter="key"]').trigger("click");
  assert.match(x.$(".ujg-esi-due-filter-values").text(),/P-1/);
  x.$(".ujg-esi-due-filter-reset").trigger("click");
  assert.match(x.$(".ujg-esi-due-count").text(),/1 из 1/);
});

test("keyboard resize and drag reorder save layout without losing selected rows", t => {
  const x=setup(); t.after(x.close);
  const resize=x.$('[data-column="remark"] .ujg-esi-due-column-resize');
  resize[0].focus();
  resize[0].dispatchEvent(new x.dom.window.KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}));
  assert.equal(x.$('th[data-column="remark"]').css("width"),"330px");
  const target=x.$('th[data-column="result"]')[0];
  const event=x.$.Event("drop");event.originalEvent={preventDefault(){},dataTransfer:{getData:()=>"remark"}};
  x.$(target).trigger(event);
  assert.equal(x.$(".ujg-esi-due-table thead th[data-column]").last().attr("data-column"),"remark");
  assert.match(x.$(".ujg-esi-due-confirm").text(),/\(2\)/);
});

test("only this value and global reset leave sorting and column layout intact", t => {
  const x=setup(); t.after(x.close);
  x.$('[data-due-sort="key"]').trigger("click");
  x.$('[data-due-filter="key"]').trigger("click");
  x.$('.ujg-esi-due-filter-only[data-value="P-2"]').trigger("click");
  x.$(".ujg-esi-due-filter-apply").trigger("click");
  assert.match(x.$(".ujg-esi-due-count").text(),/1 из 3/);
  x.$(".ujg-esi-due-reset-filters").trigger("click");
  assert.match(x.$(".ujg-esi-due-count").text(),/3 из 3/);
  assert.match(x.$('[data-due-sort="key"]').text(),/↑/);
});

test("controller rerender preserves table scroll and focused row control", t => {
  const x=setup(); t.after(x.close);
  const scroll=x.$(".ujg-esi-due-scroll")[0];scroll.scrollTop=37;scroll.scrollLeft=52;
  x.$('.ujg-esi-due-row-select[data-row-id="2"]')[0].focus();
  x.state.dueDateSync.rows[0].status="updated";x.render();
  assert.equal(x.$(".ujg-esi-due-scroll")[0].scrollTop,37);
  assert.equal(x.$(".ujg-esi-due-scroll")[0].scrollLeft,52);
  assert.equal(x.dom.window.document.activeElement.getAttribute("data-row-id"),"2");
});

test("loading and uncertain write results never render as success", t => {
  const x=setup(); t.after(x.close);
  x.state.dueDateSync.loading=true;x.state.dueDateSync.error="Jira недоступна";
  x.state.dueDateSync.rows=[row("1",{status:"unconfirmed",message:"Нет подтверждения Jira"})];x.render();
  assert.match(x.$(".ujg-esi-due-progress").text(),/Чтение сроков Jira/);
  assert.match(x.$(".ujg-esi-due-error").text(),/Jira недоступна/);
  assert.equal(x.$(".ujg-esi-due-confirm").prop("disabled"),true);
  assert.equal(x.$(".ujg-esi-due-result svg").length,0);
  assert.match(x.$(".ujg-esi-due-result").text(),/Не подтверждено/);
});

test("date columns sort by ISO chronology rather than display text", t => {
  const x=setup(); t.after(x.close);
  x.state.dueDateSync.rows=[row("1",{oldDate:"2026-12-30",newDate:"2026-12-30"}),row("2",{oldDate:"2027-01-02",newDate:"2027-01-02"})];
  x.render();
  for (const column of ["oldDate","newDate"]) {
    x.$(`[data-due-sort="${column}"]`).trigger("click");
    assert.equal(x.$(".ujg-esi-due-row").first().attr("data-row-id"),"1");
  }
});

test("async render retains unapplied filter draft, search and focused control", t => {
  const x=setup(); t.after(x.close);
  x.$('[data-due-filter="key"]').trigger("click");
  x.$(".ujg-esi-due-filter-clear").trigger("click");
  x.$(".ujg-esi-due-filter-search").val("P-2").trigger("input");
  const input=x.$('.ujg-esi-due-filter-values input[type="checkbox"]')[0];
  input.checked=true;input.dispatchEvent(new x.dom.window.Event("change",{bubbles:true}));
  x.$(".ujg-esi-due-filter-search")[0].focus();
  x.state.dueDateSync.loading=true;x.render();
  assert.equal(x.$(".ujg-esi-due-filter-search").val(),"P-2");
  assert.equal(x.dom.window.document.activeElement.className,"ujg-esi-due-filter-search");
  assert.equal(x.$('.ujg-esi-due-filter-values input[type="checkbox"]').prop("checked"),true);
  x.$(".ujg-esi-due-filter-apply").trigger("click");
  assert.match(x.$(".ujg-esi-due-count").text(),/1 из 3/);
});

test("stored filter values past 500 survive reload without silent loss", t => {
  const x=setup(); t.after(x.close);
  const filters={key:Array.from({length:501},(_,i)=>"P-"+(i+1))};
  x.dom.window.localStorage.setItem("user-17:due-date-sync-ui",JSON.stringify({filters}));
  x.recreate();
  x.$('[data-due-filter="key"]').trigger("click");
  assert.equal(x.$('.ujg-esi-due-filter-values input[type="checkbox"]').filter((_,el)=>el.checked).length,501);
});

test("Shift Tab from dialog container stays inside", t => {
  const x=setup(); t.after(x.close);
  x.$(".ujg-esi-due-dialog")[0].focus();
  x.dom.window.document.dispatchEvent(new x.dom.window.KeyboardEvent("keydown",{key:"Tab",shiftKey:true,bubbles:true}));
  assert.equal(x.dom.window.document.activeElement.classList.contains("ujg-esi-due-confirm"),true);
});

test("resizing updates a fixed column track and table width", t => {
  const x=setup(); t.after(x.close);
  const table=x.$(".ujg-esi-due-table");
  assert.equal(table.find('col[data-column="remark"]').attr("width"),"320");
  const before=parseInt(table.css("width"),10);
  x.$('[data-column="remark"] .ujg-esi-due-column-resize')[0].dispatchEvent(new x.dom.window.KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}));
  assert.equal(x.$('.ujg-esi-due-table col[data-column="remark"]').attr("width"),"330");
  assert.equal(parseInt(x.$(".ujg-esi-due-table").css("width"),10),before+10);
});

test("pointer resize updates header and cells with the column track", t => {
  const x=setup(); t.after(x.close);
  const handle=x.$('[data-column="remark"] .ujg-esi-due-column-resize')[0];
  handle.dispatchEvent(new x.dom.window.MouseEvent("mousedown",{clientX:100,bubbles:true}));
  x.dom.window.document.dispatchEvent(new x.dom.window.MouseEvent("mousemove",{clientX:130,bubbles:true}));
  assert.equal(x.$('.ujg-esi-due-table col[data-column="remark"]').attr("width"),"350");
  assert.equal(x.$('th[data-column="remark"]').css("width"),"350px");
  assert.equal(x.$(".ujg-esi-due-row td").eq(1).css("width"),"350px");
  x.dom.window.document.dispatchEvent(new x.dom.window.MouseEvent("mouseup",{bubbles:true}));
});

test("focused filter checkbox survives async redraw without applying draft", t => {
  const x=setup(); t.after(x.close);
  x.$('[data-due-filter="key"]').trigger("click");
  const option=x.$('.ujg-esi-due-filter-values input[type="checkbox"]').eq(1)[0];
  option.focus();option.checked=true;option.dispatchEvent(new x.dom.window.Event("change",{bubbles:true}));
  x.state.dueDateSync.running=true;x.render();
  assert.equal(x.dom.window.document.activeElement.getAttribute("data-due-focus"),"value-key-P-2");
  assert.equal(x.dom.window.document.activeElement.checked,true);
  assert.match(x.$(".ujg-esi-due-count").text(),/3 из 3/);
});

test("closing restores toolbar focus when open started with body focused", t => {
  const x=setup(); t.after(x.close);
  x.state.dueDateSync.open=false;x.render();
  const toolbar=x.$('<button aria-label="Обновить сроки Jira из Excel">Open</button>').insertBefore(x.$("#host"))[0];
  x.dom.window.document.body.setAttribute("tabindex","-1");x.dom.window.document.body.focus();
  x.state.dueDateSync.open=true;x.render();
  x.$(".ujg-esi-due-close").trigger("click");
  x.state.dueDateSync.open=false;x.render();
  assert.equal(x.dom.window.document.activeElement,toolbar);
});

test("applied empty filter shows no rows until reset", t => {
  const x=setup(); t.after(x.close);
  x.$('[data-due-filter="key"]').trigger("click");
  x.$(".ujg-esi-due-filter-clear").trigger("click");
  x.$(".ujg-esi-due-filter-apply").trigger("click");
  assert.match(x.$(".ujg-esi-due-count").text(),/0 из 3/);
  assert.equal(x.$('[data-due-filter="key"]').hasClass("is-active"),true);
  x.$(".ujg-esi-due-reset-filters").trigger("click");
  assert.match(x.$(".ujg-esi-due-count").text(),/3 из 3/);
});

test("active overlay blocks outside input and clears on close and destroy", t => {
  const x=setup(); t.after(x.close);
  x.state.dueDateSync.open=false;x.render();
  x.dom.window.document.body.style.overflow="auto";
  x.state.dueDateSync.open=true;x.render();
  assert.equal(x.dom.window.document.body.style.overflow,"hidden");
  const overlay=x.$("#host .ujg-esi-due-overlay");
  assert.equal(overlay.length,1);
  assert.equal(x.$("#host").hasClass("ujg-esi-due-active"),true);
  const wheel=new x.dom.window.WheelEvent("wheel",{bubbles:true,cancelable:true});
  overlay[0].dispatchEvent(wheel);
  assert.equal(wheel.defaultPrevented,true);
  x.state.dueDateSync.running=true;x.render();
  x.$(".ujg-esi-due-overlay").trigger("click");
  assert.equal(x.calls.close,0);
  x.state.dueDateSync.running=false;x.state.dueDateSync.open=false;x.render();
  assert.equal(x.$("#host .ujg-esi-due-overlay").length,0);
  assert.equal(x.$("#host").hasClass("ujg-esi-due-active"),false);
  assert.equal(x.dom.window.document.body.style.overflow,"auto");
  x.state.dueDateSync.open=true;x.render();x.destroy();
  assert.equal(x.$("#host .ujg-esi-due-overlay").length,0);
  assert.equal(x.$("#host").hasClass("ujg-esi-due-active"),false);
  assert.equal(x.dom.window.document.body.style.overflow,"auto");
});

test("toolbar reset is a compact labelled icon and updated status is not repeated", t => {
  const x=setup(); t.after(x.close);
  x.$('[data-due-filter="key"]').trigger("click");
  x.$('.ujg-esi-due-filter-only[data-value="P-1"]').trigger("click");
  x.$(".ujg-esi-due-filter-apply").trigger("click");
  const reset=x.$(".ujg-esi-due-reset-filters");
  assert.equal(reset.attr("aria-label"),"Сбросить фильтры");
  assert.equal(reset.children("svg").length,1);
  assert.equal(reset.text(),"");
  x.state.dueDateSync.rows[0].status="updated";
  x.state.dueDateSync.rows[0].message="Обновлено";x.render();
  assert.equal(x.$('.ujg-esi-due-row[data-row-id="1"] .ujg-esi-due-result').text(),"Обновлено");
});

test("table fills modal space and Jira key has a readable default track", t => {
  const x=setup(); t.after(x.close);
  const style=x.dom.window.document.createElement("style");
  style.textContent=fs.readFileSync(path.join(dir,"../ujg-excel-story-importer.css"),"utf8");
  x.dom.window.document.head.appendChild(style);
  const table=x.$(".ujg-esi-due-table")[0];
  assert.equal(x.dom.window.getComputedStyle(table).minWidth,"100%");
  assert.equal(x.$('col[data-column="key"]').attr("width"),"160");
  assert.equal(table.style.width.endsWith("px"),true);
});

test("short modal does not clip filter actions while table keeps its own scroll", t => {
  const x=setup(); t.after(x.close);
  x.state.dueDateSync.rows=[row("1")];x.render();
  x.$('[data-due-filter="key"]').trigger("click");
  const style=x.dom.window.document.createElement("style");
  style.textContent=fs.readFileSync(path.join(dir,"../ujg-excel-story-importer.css"),"utf8");
  x.dom.window.document.head.appendChild(style);
  const win=x.dom.window;
  assert.equal(win.getComputedStyle(x.$(".ujg-esi-due-dialog")[0]).overflow,"visible");
  assert.equal(win.getComputedStyle(x.$(".ujg-esi-due-scroll")[0]).overflow,"auto");
  assert.match(win.getComputedStyle(x.$(".ujg-esi-due-filter-menu")[0]).maxHeight,/100vh - 140px/);
  assert.equal(x.$(".ujg-esi-due-filter-apply").length,1);
  assert.equal(x.$(".ujg-esi-due-filter-cancel").length,1);
});
