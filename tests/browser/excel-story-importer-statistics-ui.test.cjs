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
test("analytics leads with four story statuses and keeps old tables in collapsed details",t=>{
  const {dom,$,state,render}=setup();t.after(()=>dom.window.close());render();
  assert.equal($("table").length,5);
  const $main=$("table[aria-label='Истории по текущему статусу Jira']");
  assert.equal($main.closest("details").length,0);
  assert.deepEqual($main.find("tbody th").map((_,el)=>$(el).clone().children().remove().end().text()).get(),
    ["Исправлено","На тестировании","Снято","В работе"]);
  assert.deepEqual($main.find("tbody td").map((_,el)=>$(el).text()).get(),["0","0","0","1"]);
  assert.match($main.text(),/Open: 1/);
  const $details=$("details.ujg-esi-stats-details");
  assert.equal($details.length,1); assert.equal($details.prop("open"),false);
  assert.equal($details.find("table").length,4);
  assert.match($details.children("summary").text(),/Подробности по задачам и командам/);
  assert.match($("#root").text(),/Все загруженные/);
  assert.match($("#root").text(),/пересекаются/);
  assert.match($("table[aria-label='Итог по замечаниям']").text(),/Есть открытые работы1/);
  assert.match($("table[aria-label='Текущие направления']").text(),/Разработка11/);
  assert.match($("table[aria-label='Текущие направления']").text(),/Тестирование11/);
  state.teams[0].name="<img src=x onerror=alert(1)>";render();
  assert.equal($("img").length,0);assert.match($("#root").text(),/<img src=x/);
});
test("summary exposes unknown parent status and uncreated Excel rows without counting child states",t=>{
  const {dom,$,state,render}=setup();t.after(()=>dom.window.close());
  state.rows=[{jiraKey:"P-1",storyDetails:{key:"P-1",status:"Done"},childStatuses:[{key:"P-2",status:"Open"}]},
    {jiraKey:"P-3"},{id:"excel:1"}];
  render();
  const $main=$("table[aria-label='Истории по текущему статусу Jira']");
  assert.match($main.text(),/Исправлено1/); assert.match($main.text(),/Статус неизвестен1/);
  assert.match($(".ujg-esi-stats-scope").text(),/Историй в Jira: 2/);
  assert.match($(".ujg-esi-stats-uncreated").text(),/Не заведено в Jira: 1/);
  assert.match($("table[aria-label='Итог по замечаниям']").text(),/Есть открытые работы1/);
});
test("empty analytics renders zero totals without NaN or fake readiness",t=>{
  const {dom,$,state,render}=setup();t.after(()=>dom.window.close());state.rows=[];render();
  assert.match($("#root").text(),/Замечаний: 0/);
  assert.doesNotMatch($("#root").text(),/NaN|undefined/);
});
