const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {JSDOM}=require("jsdom"),jquery=require("jquery");
function setup(){
  const dom=new JSDOM('<div id="root"></div>',{runScripts:"outside-only",url:"http://localhost"});
  const $=jquery(dom.window),modules={jquery:$};
  dom.window.define=(name,deps,factory)=>modules[name]=factory(...deps.map(dep=>modules[dep]));
  for(const file of ["teams","statistics","statistics-ui"])dom.window.eval(fs.readFileSync(path.join(__dirname,"../../ujg-excel-story-importer-modules",file+".js"),"utf8"));
  const state={teams:modules._ujgESI_teams.defaults(),rows:[{jiraKey:"P-1",storyDetails:{key:"P-1",status:"Open"},childStatuses:[{key:"P-2",role:"BE",status:"In progress"},{key:"P-3",role:"QA",status:"Testing"}]}]};
  return {dom,$,state,render:()=>modules._ujgESI_statisticsUi.render($("#root"),state)};
}
test("analytics renders separate outcome, direction, team and role tables with explicit scope",t=>{
  const {dom,$,state,render}=setup();t.after(()=>dom.window.close());render();
  assert.equal($("table").length,4);
  assert.match($("#root").text(),/Все загруженные/);
  assert.match($("#root").text(),/пересекаются/);
  assert.match($("table[aria-label='Итог по замечаниям']").text(),/Есть открытые работы1/);
  assert.match($("table[aria-label='Текущие направления']").text(),/Разработка11/);
  assert.match($("table[aria-label='Текущие направления']").text(),/Тестирование11/);
  state.teams[0].name="<img src=x onerror=alert(1)>";render();
  assert.equal($("img").length,0);assert.match($("#root").text(),/<img src=x/);
});
test("empty analytics renders zero totals without NaN or fake readiness",t=>{
  const {dom,$,state,render}=setup();t.after(()=>dom.window.close());state.rows=[];render();
  assert.match($("#root").text(),/Замечаний: 0/);
  assert.doesNotMatch($("#root").text(),/NaN|undefined/);
});
