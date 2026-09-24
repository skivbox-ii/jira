const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("xlsx");
const root = path.join(__dirname, "../..");
const issues = {};
const rows = [["№", "Замечание", "Модуль", "Приоритет", "Ответственный от\nТНТ", "Jira", "Статус в Jira", "Исполнитель в Jira"]];
rows.push([815, "После смены пользователя сбрасывается масштаб мнемосхемы", "Интерфейс", "Средний", "Орлова Н.", "", "", ""]);
rows.push([816, "При переключении вкладок пропадает выбранный фильтр", "Интерфейс", "Средний", "Смирнов Д.", "", "", ""]);
const descriptions = ["Драйвер МЭК устанавливает сигналу недостоверность только на основе флага IV. Учитывать OV и NT.", "Интерфейс просмотра настроек МЭК-соединений", "Сохранение настроек попапов после обновления", "Плановая линия на участке профиля", "Автомасштабирование при переходе между ТУ", "Курсор и границы осей X и Y"];
const keys = ["EVOSCADA-16104", "EVOSCADA-17906", "EVOSCADA-20000", "EVOSCADA-21032", "EVOSCADA-20862", "EVOSCADA-20914"];
function issue(key, title, status, person, type) {
  const statusId = status === "Готово" ? "3" : status === "Тестирование" ? "4" : status === "В работе" ? "2" : "1";
  const number = Number(key.split("-").pop());
  const since = new Date(Date.UTC(2026,8,22,10) - (number % 12 * 86400000 + number % 6 * 3600000)).toISOString();
  const description = /^\[QA\]/.test(title)
    ? "h2. Проверка качества сигнала\nПроверить обработку признаков недостоверности в драйвере МЭК и отображение качества в OPC UA.\nh3. Сценарии проверки\n* Передать сигнал с флагами OV и NT.\n* Проверить отображение состояния в журнале и контейнере МЭК.\n* Повторить проверку после переподключения.\nh3. Ожидаемый результат\nКачество сигнала и его описание соответствуют полученным флагам; результат зафиксирован в протоколе тестирования."
    : "h2. " + title + "\n" + (type === "История" ? "Исходное замечание из журнала приёмки." : "Реализовать изменение и проверить обработку граничных состояний.") + "\nh3. Критерии приёмки\n* Изменение сохраняется после обновления.\n* Существующие сценарии работают без регрессий.";
  const username = {"Иванов И.":"ivanov", "Сидоров А.":"sidorov", "Соколова А.":"sokolova", "Петров П.":"petrov", "Орлова Н.":"orlova"}[person] || person;
  return {key, fields:{summary:title,description, status:{id:statusId,name:status,statusCategory:{key:statusId === "3" ? "done" : /^(2|4)$/.test(statusId) ? "indeterminate" : "new"}}, assignee:person ? {name:username,displayName:person} : null, creator:{name:"orlova",displayName:"Орлова Н."}, priority:{name:number % 7 === 0 ? "Высокий" : "Средний"}, issuetype:{name:type},created:"2026-09-01T09:00:00Z",updated:"2026-09-22T10:00:00Z",issuelinks:[]},changelog:{startAt:0,total:1,histories:[{id:key+"-h",created:since,author:{name:"ivanov",displayName:"Иванов И."},items:[{field:"status",from:"0",fromString:"Новая",to:statusId,toString:status}]}]}};
}
for (let i = 0; i < 68; i++) {
  const id = 744 + i, key = keys[i] || "EVOSCADA-" + (24000 + i), description = descriptions[i % descriptions.length];
  const status = ["Готово","В работе","Тестирование","К выполнению"][i % 4];
  const name = ["Иванов И.","Сидоров А.","Соколова А."][i % 3];
  rows.push([id,description,i % 2 ? "Интерфейс" : "МЭК","Средний",i % 2 ? "Орлова Н." : "Смирнов Д.",key,status,name]);
  const parent = issue(key, id + ". " + description, status, name, "История");
  if (i === 0) {
    parent.fields.summary = "744. МЭК: признак недостоверности";
    parent.fields.description = "Импортировано из журнала замечаний.\n\n||Поле||Значение||\n|Лист|Замечания|\n|Строка Excel|4|\n|ID|744|\n|Ответственный|Смирнов Д.|\n|Замечание|Учитывать признаки качества IV, OV и NT.|\n|Приоритет|Средний|";
  }
  issues[key] = parent;
  for (let j = 0; j < (i === 0 ? 23 : 2); j++) {
    const childKey = i === 0 ? (["EVOSCADA-18057","EVOSCADA-18080","EVOSCADA-18368","EVOSCADA-18371","EVOSCADA-18743"][j] || "EVOSCADA-" + (34000+j)) : "EVOSCADA-" + (30000 + i * 10 + j);
    const role = j % 2 ? "QA" : "BE";
    const sampleTitle = i === 0 ? ["МЭК: качество OV и NT","Проверка качества OV и NT","МЭК: флаги SB, BL, NT, IV","OPC: проверка качества","МЭК: обработка флага SB"][j] : "";
    const child = issue(childKey, "[" + role + "] " + id + ". " + (sampleTitle || description), i === 1 && j === 0 ? "В работе" : j % 2 ? "Тестирование" : "Готово", i === 1 && j === 1 ? "" : j % 2 ? "Соколова А." : "Петров П.", "Задача разработки");
    if (i === 0 && j === 0) child.fields.description += "\n\n```mermaid\nflowchart LR\n    A[Сигнал МЭК] --> B{IV / OV / NT}\n    B --> C[Недостоверное качество]\n    B --> D[Журнал и OPC UA]\n```";
    issues[childKey] = child;
    parent.fields.issuelinks.push({type:{name:"Child",outward:"is parent of",inward:"is child of"},outwardIssue:{key:childKey,fields:child.fields}});
  }
  if (i === 2) {
    rows.push([817,"Нет индикации потери связи с контроллером","Интерфейс","Высокий","Орлова Н.","EVOSCADA-23110","К выполнению","Иванов И."]);
    const partial = issue("EVOSCADA-23110","817. Индикация потери связи","К выполнению","Иванов И.","История");
    const child = issue("EVOSCADA-23111","[BE] 817. Обработка потери связи","В работе","Петров П.","Задача разработки");
    issues[partial.key] = partial; issues[child.key] = child;
    partial.fields.issuelinks.push({type:{name:"Child",outward:"is parent of",inward:"is child of"},outwardIssue:{key:child.key,fields:child.fields}});
  }
}
// Explicit daily movements supplement the existing tree fixture, without live Jira.
const activityDate = new Date(Date.now() + 3 * 3600000).toISOString().slice(0,10);
const statusIds = {"Новая":"0","К выполнению":"1","В работе":"2","Готово":"3","Тестирование":"4"};
function movement(key, time, field, from, to, author) {
  const target = issues[key];
  const item = {field, fromString:from, toString:to};
  if (field === "status") {
    item.from = statusIds[from]; item.to = statusIds[to];
    target.fields.status = {id:item.to,name:to,statusCategory:{key:to === "Готово" ? "done" : /В работе|Тестирование/.test(to) ? "indeterminate" : "new"}};
  } else {
    item.from = from === "Петров П." ? "petrov" : "sokolova";
    item.to = to === "Петров П." ? "petrov" : "sokolova";
    target.fields.assignee = {name:item.to,displayName:to};
  }
  const created = activityDate + "T" + time + ":00+03:00";
  target.changelog.histories.push({id:key+"-day-"+target.changelog.histories.length,created,author:{name:author || "ivanov",displayName:author === "sokolova" ? "Соколова А." : "Иванов И."},items:[item]});
  target.changelog.total = target.changelog.histories.length;
  target.fields.updated = created;
}
movement("EVOSCADA-18080","09:15","status","Тестирование","В работе","sokolova");
movement("EVOSCADA-18080","09:15","assignee","Соколова А.","Петров П.","sokolova");
movement("EVOSCADA-18057","10:20","status","Готово","В работе");
movement("EVOSCADA-18057","11:10","status","В работе","Готово");
movement("EVOSCADA-30040","11:45","status","Готово","Готово");
movement("EVOSCADA-30041","12:05","status","Тестирование","Готово","sokolova");
movement("EVOSCADA-30050","10:00","assignee","Петров П.","Соколова А.");
for (const key of ["EVOSCADA-20914","EVOSCADA-30051"]) {
  const target = issues[key];
  target.changelog.histories[0].items[0].to = "3";
  target.changelog.histories[0].items[0].toString = "Готово";
  target.fields.status = {id:"3",name:"Готово",statusCategory:{key:"done"}};
}
movement("EVOSCADA-20914","10:10","status","Готово","В работе","sokolova");
movement("EVOSCADA-20914","10:30","status","В работе","Тестирование");
const worked = issues["EVOSCADA-18057"];
worked.changelog.histories.push({id:worked.key+"-work",created:activityDate+"T11:15:00.853+03:00",author:{name:"petrov",displayName:"Петров П."},items:[
  {field:"timeestimate",from:"14400",fromString:"14400",to:"10800",toString:"10800"},
  {field:"timespent",from:"14400",fromString:"14400",to:"18000",toString:"18000"},
  {field:"WorklogId",from:"42",fromString:"42",to:null,toString:null}
]});
worked.changelog.total = worked.changelog.histories.length;
worked.fields.updated = activityDate+"T11:15:00.000+03:00";
for (const key of ["EVOSCADA-20000","EVOSCADA-30020","EVOSCADA-30021"]) {
  const target = issues[key];
  target.fields.created = activityDate + "T08:30:00+03:00";
  target.changelog.histories[0].created = activityDate + "T08:40:00+03:00";
  target.fields.updated = target.changelog.histories[0].created;
}
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Лист1");
const excel = XLSX.write(workbook, {type:"buffer",bookType:"xlsx"});
const files = {
  "/": [path.join(__dirname,"import-preview.html"),"text/html; charset=utf-8"],
  "/test/preview-bootstrap.js": [path.join(__dirname,"import-preview-bootstrap.js"),"text/javascript"],
  "/test/jquery.js": [require.resolve("jquery/dist/jquery.js"),"text/javascript"],
  "/test/xlsx.js": [require.resolve("xlsx/dist/xlsx.full.min.js"),"text/javascript"],
  "/test/jszip.js": [require.resolve("jszip/dist/jszip.min.js"),"text/javascript"],
  "/test/mermaid.js": [require.resolve("mermaid/dist/mermaid.min.js"),"text/javascript"],
  "/ujg-excel-story-importer.js": [path.join(root,"ujg-excel-story-importer.js"),"text/javascript"],
  "/ujg-excel-story-importer.css": [path.join(root,"ujg-excel-story-importer.css"),"text/css"]
};
const server = http.createServer((req,res) => {
  const pathname = new URL(req.url,"http://localhost").pathname;
  res.setHeader("Cache-Control","no-store");
  if (pathname === "/fixture.xlsx") {res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");return res.end(excel);}
  if (pathname === "/test/fixture.js") {res.setHeader("Content-Type","text/javascript");return res.end("window.fixtureIssues=" + JSON.stringify(issues) + ";");}
  if (files[pathname]) {res.setHeader("Content-Type",files[pathname][1]);return fs.createReadStream(files[pathname][0]).pipe(res);}
  res.statusCode=404;res.end("Not found");
});
server.listen(Number(process.env.PORT || 4317),"127.0.0.1",() => console.log("Offline import preview: http://127.0.0.1:" + server.address().port));
