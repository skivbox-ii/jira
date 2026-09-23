const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("xlsx");
const root = path.join(__dirname, "../..");
const issues = {};
const rows = [["№", "Замечание", "Модуль", "Приоритет", "Исполнитель", "Jira", "Статус в Jira", "Исполнитель в Jira"]];
rows.push([815, "После смены пользователя сбрасывается масштаб мнемосхемы", "Интерфейс", "Средний", "Орлова Н.", "", "", ""]);
rows.push([816, "При переключении вкладок пропадает выбранный фильтр", "Интерфейс", "Средний", "Смирнов Д.", "", "", ""]);
const descriptions = ["Драйвер МЭК устанавливает сигналу недостоверность только на основе флага IV. Учитывать OV и NT.", "Интерфейс просмотра настроек МЭК-соединений", "Сохранение настроек попапов после обновления", "Плановая линия на участке профиля", "Автомасштабирование при переходе между ТУ", "Курсор и границы осей X и Y"];
const keys = ["EVOSCADA-16104", "EVOSCADA-17906", "EVOSCADA-20000", "EVOSCADA-21032", "EVOSCADA-20862", "EVOSCADA-20914"];
function issue(key, title, status, person, type) {
  const statusId = status === "Готово" ? "3" : /В работе|Тестирование/.test(status) ? "2" : "1";
  const number = Number(key.split("-").pop());
  const since = new Date(Date.UTC(2026,8,22,10) - (number % 12 * 86400000 + number % 6 * 3600000)).toISOString();
  const description = /^\[QA\]/.test(title)
    ? "h2. Проверка качества сигнала\nПроверить обработку признаков недостоверности в драйвере МЭК и отображение качества в OPC UA.\nh3. Сценарии проверки\n* Передать сигнал с флагами OV и NT.\n* Проверить отображение состояния в журнале и контейнере МЭК.\n* Повторить проверку после переподключения.\nh3. Ожидаемый результат\nКачество сигнала и его описание соответствуют полученным флагам; результат зафиксирован в протоколе тестирования."
    : "h2. " + title + "\n" + (type === "История" ? "Исходное замечание из журнала приёмки." : "Реализовать изменение и проверить обработку граничных состояний.") + "\nh3. Критерии приёмки\n* Изменение сохраняется после обновления.\n* Существующие сценарии работают без регрессий.";
  return {key, fields:{summary:title,description, status:{id:statusId,name:status,statusCategory:{key:statusId === "3" ? "done" : statusId === "2" ? "indeterminate" : "new"}}, assignee:person ? {name:person,displayName:person} : null, priority:{name:number % 7 === 0 ? "Высокий" : "Средний"}, issuetype:{name:type},created:"2026-09-01T09:00:00Z",updated:"2026-09-22T10:00:00Z",issuelinks:[]},changelog:{startAt:0,total:1,histories:[{id:key+"-h",created:since,items:[{field:"status",from:"0",fromString:"Новая",to:statusId,toString:status}]}]}};
}
for (let i = 0; i < 68; i++) {
  const id = 744 + i, key = keys[i] || "EVOSCADA-" + (24000 + i), description = descriptions[i % descriptions.length];
  const status = ["Готово","В работе","Тестирование","К выполнению"][i % 4];
  const name = ["Иванов И.","Сидоров А.","Соколова А."][i % 3];
  rows.push([id,description,i % 2 ? "Интерфейс" : "МЭК","Средний",i % 2 ? "Орлова Н." : "Смирнов Д.",key,status,name]);
  const parent = issue(key, id + ". " + description, status, name, "История");
  if (i === 0) parent.fields.summary = "744. МЭК: признак недостоверности";
  issues[key] = parent;
  for (let j = 0; j < (i === 0 ? 23 : 2); j++) {
    const childKey = i === 0 ? (["EVOSCADA-18057","EVOSCADA-18080","EVOSCADA-18368","EVOSCADA-18371","EVOSCADA-18743"][j] || "EVOSCADA-" + (34000+j)) : "EVOSCADA-" + (30000 + i * 10 + j);
    const role = j % 2 ? "QA" : "BE";
    const sampleTitle = i === 0 ? ["МЭК: качество OV и NT","Проверка качества OV и NT","МЭК: флаги SB, BL, NT, IV","OPC: проверка качества","МЭК: обработка флага SB"][j] : "";
    const child = issue(childKey, "[" + role + "] " + id + ". " + (sampleTitle || description), j % 2 ? "Тестирование" : "Готово", i === 1 && j === 1 ? "" : j % 2 ? "Соколова А." : "Петров П.", "Задача разработки");
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
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Лист1");
const excel = XLSX.write(workbook, {type:"buffer",bookType:"xlsx"});
const files = {
  "/": [path.join(__dirname,"import-preview.html"),"text/html; charset=utf-8"],
  "/test/preview-bootstrap.js": [path.join(__dirname,"import-preview-bootstrap.js"),"text/javascript"],
  "/test/jquery.js": [require.resolve("jquery/dist/jquery.js"),"text/javascript"],
  "/test/xlsx.js": [require.resolve("xlsx/dist/xlsx.full.min.js"),"text/javascript"],
  "/test/jszip.js": [require.resolve("jszip/dist/jszip.min.js"),"text/javascript"],
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
