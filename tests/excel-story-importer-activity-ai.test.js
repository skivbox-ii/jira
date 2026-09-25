const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const load = require("./helpers/load-amd-module");
const ai = () => load(path.join(__dirname, "../ujg-excel-story-importer-modules/activity-ai.js"), {});
const scope = {projectKey:"P",epicKey:"P-1",baseUrl:"https://jira.test",preferencesStorageKey:"user:a",userScope:"alice",viewMode:"team"};
test("LLM distinguishes task returns from whole remark reopening and keeps each event once", () => {
  const source=report();
  source.metrics.taskReturns=1;
  source.events[0].returnKind="review";
  source.groups[0].taskReturns=[source.events[0]];
  const part=ai().prepare(source,scope).parts[0], payload=JSON.parse(part.userPrompt);
  assert.equal(payload.metrics.taskReturns,1);
  assert.deepEqual(payload.records.find(record=>record.type==="remark").data.taskReturns,[source.events[0].id]);
  assert.match(part.systemPrompt,/taskReturns.*reopened/);
  assert.equal((part.userPrompt.match(/"id":"P-1:h1:0"/g)||[]).length,1);
});

test("LLM context includes current journal deadlines coverage and confirmed overdue count", () => {
  const source=report();
  source.metrics.overdue=1;
  source.deadlineCoverage={known:1,missing:2,invalid:0,conflict:0,unknownState:0,total:3};
  source.deadlineReferenceDate="2026-09-24";
  source.groups[0].deadline={date:"2026-09-23",source:"excel",state:"overdue",daysOverdue:1,referenceDate:"2026-09-24"};
  const plan=ai().prepare(source,scope), request=plan.parts[0], payload=JSON.parse(request.userPrompt);
  assert.equal(payload.metrics.overdue,1);
  assert.deepEqual(payload.deadlineCoverage,source.deadlineCoverage);
  assert.equal(payload.deadlineReferenceDate,"2026-09-24");
  assert.equal(payload.records.find(record=>record.type==="remark").data.deadline.date,"2026-09-23");
  assert.match(request.systemPrompt,/срок.*текущего журнала/i);
  assert.match(request.systemPrompt,/перенос/i);
});

test("LLM remark record carries deadline diagnostic candidates once without extra event records", () => {
  const source=report();
  source.groups[0].deadline={date:null,problem:"conflict",reasonCode:"conflict",reasonLabel:"Противоречивые сроки",candidates:[
    {raw:"25.09.2026",source:"excel",field:"Срок"},
    {raw:"26.09.2026",source:"jira-description",field:"Срок исполнения"}
  ]};
  const plan=ai().prepare(source,scope);
  const records=plan.parts.flatMap(part=>JSON.parse(part.userPrompt).records);
  const remark=records.find(record=>record.type==="remark");
  assert.deepEqual(remark.data.deadline.candidates,source.groups[0].deadline.candidates);
  assert.equal(records.filter(record=>record.type==="event").length,1);
});

function report(count = 1) {
  const groups = [], events = [];
  for (let i = 0; i < count; i++) {
    const key = `P-${i + 1}`;
    const event = {id:`${key}:h1:0`,issueKey:key,at:"2026-09-24T08:00:00Z",kind:"status",field:"status",from:"Open",to:"Done",author:{label:"Editor"},assignee:{label:"Owner"},role:"BE"};
    events.push(event);
    groups.push({id:`jira:${key}`,remarkId:String(i+1),key,summary:`Remark ${i} ${"я".repeat(120)}`,currentStatus:"Done",dayComplete:true,events:[event],management:{completed:[{at:event.at,events:[event]}],reopened:[],tasks:[{key,summary:"Work",role:"BE",created:"2026-09-20T00:00:00Z",status:"Done",dayCompletions:[{at:event.at,author:{label:"Editor"}}],spentSeconds:3600,spentAsOf:"2026-09-24T12:00:00Z",worklogs:[{id:"w1",at:event.at,seconds:3600,author:{label:"Worker"}}],comments:[{id:"c1",at:event.at,author:{label:"Reviewer"},body:"Return details"}],notes:["Current effort snapshot"]}],notes:[]}});
  }
  return {date:"2026-09-24",asOf:"2026-09-24T12:00:00Z",generatedAt:"2026-09-24T12:01:00Z",timezone:"МСК",coverage:{complete:count,total:count,isComplete:true,warnings:[]},metrics:{changed:count,newRemarks:0,completed:count,reopened:0,events:count},balance:{startOpen:count,endOpen:0},observed:{changed:count,newRemarks:0},groups,events,teams:[{name:"BE",color:"#123456"}]};
}

test("LLM separates confirmed subset from unknown global totals without comparison symbols", async () => {
  const source=report();
  source.coverage={complete:1,total:2,isComplete:false,warnings:["P-2: история не загружена"]};
  source.metrics.completed=null;
  source.metrics.overdue=null;
  source.confirmed={metrics:{changed:1,newRemarks:0,completed:1,reopened:0,taskReturns:0,events:1,overdue:2},
    balance:{startOpen:1,endOpen:0},remarks:1,totalRemarks:2,excluded:[{id:"jira:P-2",key:"P-2",summary:"Unverified",reasons:["История не загружена"]}]};
  source.groups[0].confirmed=true;
  const api=ai(), plan=api.prepare(source,scope), payload=JSON.parse(plan.parts[0].userPrompt);
  assert.equal(payload.metrics.completed,null);
  assert.equal(payload.confirmed.metrics.completed,1);
  assert.equal(payload.confirmed.remarks,1);
  assert.match(plan.parts[0].systemPrompt,/confirmed.*проверенн/);
  assert.equal(payload.metrics.overdue,null);
  assert.equal(payload.confirmed.metrics.overdue,2);
  assert.match(plan.parts[0].systemPrompt,/Просрочку бери из deadline\.state и confirmed\.metrics\.overdue/);
  const result=await api.run(plan,async()=>({text:"Проверено."}));
  assert.match(result.markdown,/Подтверждено замечаний: 1 из 2/);
  assert.match(result.markdown,/полностью завершённые замечания: 1/);
  assert.match(result.markdown,/просроченные замечания: 2/);
  assert.doesNotMatch(result.markdown,/[≥≤]/);
});

test("prepare preserves evidence, fixed totals and scope while ignoring generatedAt", () => {
  const source=report(), plan=ai().prepare(source,scope);
  assert.equal(plan.scopeKey.includes("alice"),true);
  assert.equal(plan.eventCount,1);
  assert.equal(plan.parts.length,1);
  const request=plan.parts[0];
  assert.ok(Buffer.byteLength(request.userPrompt,"utf8")<=42000);
  assert.ok(Buffer.byteLength(request.systemPrompt,"utf8")<=6000);
  for (const value of ["Return details","Worker","Current effort snapshot","P-1:h1:0","spentSeconds","dayCompletions","completed","coverage"]) assert.ok(request.userPrompt.includes(value),value);
  assert.equal((request.userPrompt.match(/"id":"P-1:h1:0"/g)||[]).length,1);
  assert.equal(plan.totals.taskCompletions,1);
  assert.equal(plan.totals.groupCompletions,1);
  assert.equal(plan.totals.effortSnapshot.knownSeconds,3600);
  source.generatedAt="2026-09-24T12:02:00Z";
  assert.equal(ai().prepare(source,scope).fingerprint,plan.fingerprint);
  source.groups[0].management.tasks[0].comments[0].body="Changed";
  assert.notEqual(ai().prepare(source,scope).fingerprint,plan.fingerprint);
  assert.equal(Object.isFrozen(plan.parts[0]),true);
});

test("prepare accepts UI state but transmits only allowed scope fields", () => {
  const plan=ai().prepare(report(),{...scope,sensitiveField:"secret marker",rows:[{private:"hidden marker"}],dialog:{text:"dialog marker"}});
  assert.equal(plan.scope.sensitiveField,undefined);
  assert.equal(plan.scope.rows,undefined);
  assert.equal(plan.scope.dialog,undefined);
  assert.ok(!plan.parts[0].userPrompt.includes("secret marker"));
  assert.ok(!plan.parts[0].userPrompt.includes("hidden marker"));
  assert.ok(!plan.parts[0].userPrompt.includes("dialog marker"));
});

test("provider receives relevant team metadata without rosters or local session identifiers", async () => {
  const source=report();
  source.teams=Array.from({length:10},(_,i)=>({
    id:`internal-team-${i}`,name:i===0 ? "BE" : `Other team ${i}`,roles:[i===0 ? "BE" : `OTHER${i}`],direction:"development",color:"#123456",
    members:Array.from({length:100},(_,j)=>({id:`unrelated-person-${i}-${j}`,label:`Unrelated Person ${i} ${j}`,identifiers:[`private-account-${i}-${j}`]}))
  }));
  const privateScope={...scope,preferencesStorageKey:"internal-storage-marker",userScope:"internal-user-marker"};
  const engine=ai(), plan=engine.prepare(source,privateScope), sent=[];
  assert.equal(plan.parts.length,1);
  assert.ok(plan.scopeKey.includes(privateScope.preferencesStorageKey));
  assert.ok(plan.scopeKey.includes(privateScope.userScope));
  await engine.run(plan,async request=>{sent.push(request);return {text:"Ответ"};},{question:"Кто завершил?",history:[{question:"Срез?",answer:"Сегодня"}]});
  for (const request of [...plan.parts,...sent]) {
    assert.ok(Buffer.byteLength(request.userPrompt,"utf8")<=42000);
    assert.ok(Buffer.byteLength(request.systemPrompt,"utf8")<=6000);
    const payload=JSON.parse(request.userPrompt);
    assert.deepEqual(payload.scope,{projectKey:"P",epicKey:"P-1",baseUrl:"https://jira.test",viewMode:"team"});
    assert.deepEqual(payload.teams,[{name:"BE",roles:["BE"],direction:"development",color:"#123456"}]);
    for (const forbidden of ["unrelated-person-","private-account-","Unrelated Person","internal-team-",privateScope.preferencesStorageKey,privateScope.userScope,"preferencesStorageKey","userScope"]) {
      assert.ok(!request.userPrompt.includes(forbidden),forbidden);
    }
  }
});

test("heading uses management wording, Moscow cutoff, and unknown effort honestly", async () => {
  const source=report();
  source.groups[0].management.tasks[0].spentSeconds=null;
  source.coverage.isComplete=false;
  source.coverage.incomplete=1;
  const plan=ai().prepare(source,scope);
  const result=await ai().run(plan,async()=>({text:"Ответ"}));
  assert.match(result.markdown,/полностью завершённые замечания/);
  assert.match(result.markdown,/15:00 МСК/);
  assert.match(result.markdown,/Трудозатраты текущего снимка Jira: нет данных/i);
  assert.match(result.markdown,/наблюдаемые завершения задач/i);
});

test("heading formats known snapshot effort in human hours and minutes", async () => {
  for (const [seconds,label] of [[16200,"4 ч 30 мин"],[3600,"1 ч"],[1200,"20 мин"],[0,"0 мин"],[30,"менее 1 мин"]]) {
    const source=report();
    source.groups[0].management.tasks[0].spentSeconds=seconds;
    const engine=ai(), result=await engine.run(engine.prepare(source,scope),async()=>({text:"Ответ"}));
    assert.ok(result.markdown.includes(`Трудозатраты текущего снимка Jira: ${label} по 1 задачам`));
    assert.ok(!result.markdown.includes(`${seconds} сек.`));
  }
});

test("code separates source-story, linked-task, and whole-remark completions", async () => {
  const source=report();
  source.groups[0].management.tasks.push({...source.groups[0].management.tasks[0],key:"P-2",role:"QA",summary:"Verify",spentSeconds:600});
  source.groups[0].management.completed=[];
  source.metrics.completed=0;
  const plan=ai().prepare(source,scope);
  assert.equal(plan.totals.groupCompletions,0);
  assert.equal(plan.totals.parentCompletions,1);
  assert.equal(plan.totals.childTaskCompletions,1);
  assert.equal(plan.totals.childTaskCompletionsByRole.QA,1);
  const result=await ai().run(plan,async()=>({text:"Ответ"}));
  assert.match(result.markdown,/исходные истории: 1/);
  assert.match(result.markdown,/связанные задачи: 1/);
});

test("partition covers every unique event with labeled provenance and bounded requests", () => {
  const plan=ai().prepare(report(130),scope);
  assert.ok(plan.parts.length>1);
  const ids=plan.parts.flatMap(part=>part.eventIds);
  assert.equal(ids.length,130);
  assert.equal(new Set(ids).size,130);
  for (const part of plan.parts) {
    assert.ok(Buffer.byteLength(part.userPrompt,"utf8")<=42000);
    assert.ok(part.userPrompt.includes('"metrics"'));
    assert.ok(part.userPrompt.includes('"remarkId"'));
    assert.ok(part.userPrompt.includes('"summary"'));
    assert.ok(part.index>=1 && part.index<=part.total);
  }
});

test("shared linked task is sent once with both remark associations", () => {
  const source=report(2);
  source.groups[1].management.tasks.push({...source.groups[0].management.tasks[0],key:"P-3"});
  source.groups[0].management.tasks.push({...source.groups[0].management.tasks[0],key:"P-3"});
  const plan=ai().prepare(source,scope);
  const shared=plan.records.filter(record=>record.type==="task" && record.source==="P-3");
  assert.equal(shared.length,1);
  assert.equal(shared[0].data.remarks.length,2);
});

test("oversized indivisible record fails before any request", () => {
  const source=report();
  source.groups[0].management.tasks[0].comments[0].body="я".repeat(25000);
  assert.throws(()=>ai().prepare(source,scope),/P-1|c1|слишком|large/i);
});

test("prompt JSON preserves Jira whitespace through shared-client normalization", () => {
  const source=report();
  source.groups[0].management.tasks[0].comments[0].body="Two  spaces\u00a0here";
  const user=ai().prepare(source,scope).parts[0].userPrompt;
  const normalized=user.replace(/\u00a0/g," ").replace(/[ \t\f\v]+/g," ");
  assert.equal(JSON.parse(normalized).records.find(record=>record.type==="task").data.task.comments[0].body,"Two  spaces\u00a0here");
});

test("summarize clock ticks preserve cutoff fingerprint when captured evidence is fixed", () => {
  const dir=path.join(__dirname,"../ujg-excel-story-importer-modules");
  const teams=load(path.join(dir,"teams.js"),{});
  const remarkId=load(path.join(dir,"remark-id.js"),{});
  const deadlines=load(path.join(dir,"deadlines.js"),{_ujgESI_config:load(path.join(dir,"config.js"),{})});
  const activity=load(path.join(dir,"activity.js"),{_ujgESI_teams:teams,_ujgESI_remarkId:remarkId,_ujgESI_deadlines:deadlines});
  const snapshot={complete:true,capturedAt:"2026-09-24T10:00:00Z",created:"2026-09-20T00:00:00Z",updated:"2026-09-24T09:00:00Z",currentStatus:{id:"1",name:"Open",category:"new"},currentAssignee:{label:"Owner",identifiers:["owner"]},histories:[],warnings:[],spentSeconds:0,worklogs:{entries:[],complete:true},comments:{entries:[],complete:true}};
  const rows=[{jiraKey:"P-1",summary:"Remark",storyDetails:{key:"P-1",summary:"Remark",status:"Open",role:"",activity:snapshot},childStatuses:[]}];
  const first=activity.summarize(rows,[],{date:"2026-09-24",now:"2026-09-24T12:00:00Z"});
  const second=activity.summarize(rows,[],{date:"2026-09-24",now:"2026-09-24T13:00:00Z"});
  assert.equal(first.asOf,"2026-09-24T10:00:00.000Z");
  assert.equal(ai().prepare(first,scope).fingerprint,ai().prepare(second,scope).fingerprint);
  second.asOf="2026-09-24T11:00:00.000Z";
  assert.notEqual(ai().prepare(first,scope).fingerprint,ai().prepare(second,scope).fingerprint);
});

test("oversized current question fails before transport", async () => {
  const engine=ai(), plan=engine.prepare(report(),scope);
  let calls=0;
  await assert.rejects(engine.run(plan,async()=>{calls++;return {text:"unexpected"};},{question:"я".repeat(25000),history:[{question:"Earlier",answer:"Да"}]}),/вопрос/i);
  assert.equal(calls,0);
});

test("long Unicode history is reconstructed exactly across bounded requests with complete Jira coverage", async () => {
  const engine=ai(), source=report(35), plan=engine.prepare(source,scope), before=JSON.stringify(plan);
  const history=[
    {question:"Начальный отчёт",answer:"я".repeat(42000)},
    {question:("Вопрос \u{1F680}  \"\\\n\u00a0").repeat(5500),answer:("Ответ \u{1F9EA}  \r\n\tе\u0301\u00a0").repeat(5500)},
    {question:"",answer:""}
  ];
  const original=JSON.stringify(history), sent=[];
  const result=await engine.run(plan,async request=>{sent.push(request);return {text:"Проверено"};},{question:"  Что осталось?  ",history});
  assert.ok(sent.length>plan.parts.length);
  const payloads=sent.map(request=>{
    assert.ok(Buffer.byteLength(request.userPrompt,"utf8")<=42000);
    assert.ok(Buffer.byteLength(request.systemPrompt,"utf8")<=6000);
    assert.ok(request.systemPrompt.includes("прошлые ответы модели"));
    assert.ok(request.sourceKeys.every(key=>/^P-\d+$/.test(key)));
    return JSON.parse(request.userPrompt.replace(/\u00a0/g," ").replace(/[ \t\f\v]+/g," "));
  });
  const fragments=payloads.flatMap(payload=>payload.records.filter(record=>record.type==="history"));
  assert.ok(fragments.length>history.length*2);
  const expectedBytes=history.reduce((sum,turn)=>sum+Buffer.byteLength(turn.question,"utf8")+Buffer.byteLength(turn.answer,"utf8"),0);
  for (const payload of payloads) {
    assert.equal(payload.conversation.question,"Что осталось?");
    assert.equal(Object.hasOwn(payload.conversation,"history"),false);
    assert.deepEqual(payload.conversation.historyCoverage,{turns:history.length,fields:history.length*2,fragments:fragments.length,utf8Bytes:expectedBytes,
      includedFragments:payload.records.filter(record=>record.type==="history").length});
    assert.deepEqual(payload.metrics,source.metrics);
  }
  for (let turn=1;turn<=history.length;turn++) for (const field of ["question","answer"]) {
    const parts=fragments.filter(record=>record.data.turn===turn && record.data.field===field);
    assert.ok(parts.length>=1);
    assert.deepEqual(parts.map(record=>record.data.part),parts.map((_,i)=>i+1));
    for (const record of parts) {
      assert.equal(record.data.totalParts,parts.length);
      assert.equal(record.data.origin,field==="answer" ? "model" : "user");
      assert.equal(record.source,`history:${turn}:${field}:${record.data.part}`);
      assert.ok(!/^[\uDC00-\uDFFF]/.test(record.data.text));
      assert.ok(!/[\uD800-\uDBFF]$/.test(record.data.text));
    }
    assert.equal(parts.map(record=>record.data.text).join(""),history[turn-1][field]);
  }
  assert.deepEqual(sent.flatMap(request=>Array.from(request.eventIds)),source.events.map(event=>event.id));
  assert.equal(result.completedParts,sent.filter(request=>request.stage==="answer").length);
  assert.equal(result.eventCount,source.events.length);
  assert.equal(JSON.stringify(plan),before);
  assert.equal(JSON.stringify(history),original);
});

test("initial generation reuses a 41985-byte prepared request despite empty history or blank question", async () => {
  const source=report(), engine=ai(), comment=source.groups[0].management.tasks[0].comments[0];
  comment.body="";
  const baseline=engine.prepare(source,scope);
  comment.body="x".repeat(41985-Buffer.byteLength(baseline.parts[0].userPrompt,"utf8"));
  const plan=engine.prepare(source,scope);
  assert.equal(plan.parts.length,1);
  assert.equal(Buffer.byteLength(plan.parts[0].userPrompt,"utf8"),41985);
  for (const options of [{history:[]},{question:" \t\n",history:[{question:"Old",answer:"y".repeat(50000)}]}]) {
    const sent=[];
    const result=await engine.run(plan,async request=>{sent.push(request);return {text:"Ответ"};},options);
    assert.equal(result.totalParts,1);
    assert.equal(sent[0],plan.parts[0]);
    assert.equal(Object.hasOwn(JSON.parse(sent[0].userPrompt),"conversation"),false);
  }
});

test("run is sequential, sends question and history, and combines labeled parts", async () => {
  const engine=ai(), plan=engine.prepare(report(130),scope), seen=[], progress=[];
  let answerCount=0;
  const result=await engine.run(plan,async request=>{seen.push(request);return {text:request.stage==="answer" ? `Ответ ${++answerCount}` : "Внутренняя заметка"};},{question:"  Что осталось?  ",history:[{question:"Ранее?",answer:"Да"}],onProgress:value=>progress.push(value)});
  assert.ok(seen.length>=plan.parts.length);
  assert.ok(seen[0].userPrompt.includes("Что осталось?"));
  assert.ok(seen.every(request=>request.stage==="answer"));
  for (const request of seen) assert.deepEqual(JSON.parse(request.userPrompt).conversation.history,[{question:"Ранее?",answer:"Да"}]);
  assert.equal(JSON.parse(seen[0].userPrompt).conversation.question,"Что осталось?");
  assert.ok(seen[0].systemPrompt.includes("вопрос"));
  assert.ok(result.markdown.includes("Часть 1"));
  assert.ok(result.markdown.includes("Источники:"));
  assert.ok(result.markdown.includes("События части:"));
  assert.ok(!result.markdown.includes("P-1:h1:0"));
  const answers=seen.filter(request=>request.stage==="answer");
  assert.ok(answers[0].systemPrompt.includes("МСК"));
  assert.ok(answers[0].systemPrompt.includes("5–7"));
  assert.ok(result.markdown.includes(`Ответ ${answerCount}`));
  assert.ok(!result.markdown.includes("Внутренняя заметка"));
  for (let i=1;i<=answerCount;i++) {
    const start=result.markdown.indexOf(`## Часть ${i} из`);
    const body=result.markdown.indexOf(`Ответ ${i}`,start);
    assert.ok(body>=start && body<result.markdown.indexOf("Источники:",start));
  }
  assert.ok(result.markdown.includes("Покрытие"));
  assert.equal(progress.at(-1).completed,seen.length);
  assert.equal(progress.at(-1).total,seen.length);
  assert.equal(progress[0].phase,"answer");
  assert.equal(progress[0].completed,0);
  assert.equal(progress.at(-1).phase,"answer");
  assert.equal(result.completedParts,answerCount);
});

test("one Jira event and 30000 emoji history produce internal notes followed by a grounded answer", async () => {
  const engine=ai(), source=report(), plan=engine.prepare(source,scope), sent=[], progress=[];
  const result=await engine.run(plan,async request=>{
    sent.push(request);
    return {text:request.stage==="answer" ? "Ответ по P-1, 11:00 МСК" : `INTERNAL-NOTE-${sent.length}`};
  },{question:"Что осталось?",history:[{question:"Отчёт",answer:"\u{1F680}".repeat(30000)}],onProgress:value=>progress.push(value)});
  const internal=sent.filter(request=>request.stage==="history-notes"), answers=sent.filter(request=>request.stage==="answer");
  assert.ok(internal.length>1);
  assert.equal(answers.length,1);
  for (const request of internal) {
    const payload=JSON.parse(request.userPrompt);
    assert.equal(payload.stage,"history-notes");
    assert.ok(payload.records.every(record=>record.type==="history"));
    assert.match(request.systemPrompt,/не отвечай на текущий вопрос/i);
  }
  const answer=JSON.parse(answers[0].userPrompt);
  assert.equal(answer.stage,"answer");
  assert.ok(answer.records.some(record=>record.type==="event" && record.data.event.id===source.events[0].id));
  assert.ok(answer.records.every(record=>record.type!=="history"));
  assert.equal(answer.conversation.contextNotes.origin,"model-summary");
  assert.equal(answer.conversation.contextNotes.untrusted,true);
  assert.equal(answer.conversation.contextNotes.notes.length,internal.length);
  assert.ok(answer.conversation.contextNotes.notes.every(note=>note.text.startsWith("INTERNAL-NOTE-")));
  assert.ok(Buffer.byteLength(JSON.stringify(answer.conversation.contextNotes),"utf8")<=6000);
  assert.ok(!result.markdown.includes("INTERNAL-NOTE-"));
  assert.ok(result.markdown.includes("Ответ по P-1"));
  assert.equal(result.completedParts,1);
  assert.equal(result.totalParts,1);
  assert.deepEqual(progress.filter(value=>value.phase==="context").map(value=>[value.completed,value.total]),
    Array.from({length:internal.length+1},(_,i)=>[i,internal.length]));
  assert.deepEqual(progress.filter(value=>value.phase==="answer").map(value=>[value.completed,value.total]),[[0,1],[1,1]]);
});

test("all notes are preflighted with indivisible Jira evidence before any final request", async () => {
  const engine=ai(), source=report(), sent=[];
  source.groups[0].management.tasks[0].comments[0].body="";
  const baseline=engine.prepare(source,scope);
  source.groups[0].management.tasks[0].comments[0].body="x".repeat(41000-Buffer.byteLength(baseline.parts[0].userPrompt,"utf8"));
  await assert.rejects(engine.run(engine.prepare(source,scope),async request=>{
    sent.push(request);return {text:"N".repeat(1000)};
  },{question:"Почему?",history:[{question:"Отчёт",answer:"\u{1F680}".repeat(30000)}]}),error=>{
    assert.match(error.message,/Jira|42000|контекст/i);
    assert.equal(error.completedParts,0);
    assert.equal(error.markdown,"");
    return true;
  });
  assert.ok(sent.length>1);
  assert.ok(sent.every(request=>request.stage==="history-notes"));
});

test("oversized notes or total notes budget fail without additional LLM stages or rendered notes", async () => {
  for (const notes of ["\u{1F680}".repeat(1501),"x".repeat(2000)]) {
    const engine=ai(), sent=[];
    await assert.rejects(engine.run(engine.prepare(report(),scope),async request=>{
      sent.push(request); return {text:notes};
    },{question:"Почему?",history:[{question:"Ранее",answer:"\u{1F680}".repeat(30000)}]}),error=>{
      assert.match(error.message,/6000/);
      assert.equal(error.completedParts,0);
      assert.equal(error.markdown,"");
      return true;
    });
    assert.ok(sent.every(request=>request.stage==="history-notes"));
  }
});

test("cancellation during history and failure during answers expose only completed grounded answers", async () => {
  const engine=ai(), plan=engine.prepare(report(130),scope);
  let cancelled=false, calls=0;
  await assert.rejects(engine.run(plan,async()=>{calls++;cancelled=true;return {text:"INTERNAL"};},
    {question:"Почему?",history:[{question:"Ранее",answer:"\u{1F680}".repeat(30000)}],isCancelled:()=>cancelled}),error=>{
    assert.match(error.message,/отмен/);
    assert.equal(error.completedParts,0);
    assert.ok(!error.markdown.includes("INTERNAL"));
    return true;
  });
  assert.equal(calls,1);
  let answers=0;
  await assert.rejects(engine.run(plan,async request=>{
    if (request.stage!=="answer") return {text:"INTERNAL"};
    if (++answers===2) throw Error("offline");
    return {text:"Первый ответ Jira"};
  },{question:"Почему?",history:[{question:"Ранее",answer:"\u{1F680}".repeat(30000)}]}),error=>{
    assert.equal(error.completedParts,1);
    assert.ok(error.totalParts>1);
    assert.match(error.markdown,/Первый ответ Jira/);
    assert.ok(!error.markdown.includes("INTERNAL"));
    return true;
  });
});

test("run reports partial failures and cancellation without claiming completion", async () => {
  const engine=ai(), plan=engine.prepare(report(130),scope);
  let n=0;
  await assert.rejects(engine.run(plan,async()=>{if (++n===2) throw Error("offline");return {text:"First"};}),error=>{
    assert.match(error.message,/offline|част/i);
    assert.match(error.markdown,/First/);
    assert.match(error.markdown,/неполон/);
    assert.equal(error.completedParts,1);
    return true;
  });
  let calls=0;
  await assert.rejects(engine.run(plan,async()=>{calls++;return {text:"OK"};},{isCancelled:()=>calls>0}),/отмен|cancel/i);
  assert.equal(calls,1);
});
