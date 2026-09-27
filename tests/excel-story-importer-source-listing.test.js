const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./helpers/load-amd-module');
const source = load(path.join(__dirname, '../ujg-excel-story-importer-modules/source-export.js'), {});

function issue(key, fields = {}, collections = {}) {
  return {key, raw:{fields:{summary:'Тема ' + key, status:{name:'Done'}, assignee:{displayName:'Ирина Иванова'},
    components:[{name:'Портал'}], duedate:'2026-09-30', ...fields}}, collections:{
      histories:{entries:[],complete:true}, comments:{entries:[],complete:true}, worklogs:{entries:[],complete:true}, ...collections}};
}
function data(issues, extra = {}) {
  return {startedAt:'2026-09-27T08:00:00Z', finishedAt:'2026-09-27T08:01:00Z',
    parentKeys:['P-1'], relationships:[{key:'P-1',children:['P-2']}], issues,
    coverage:{complete:true,loadedParents:1,expectedParents:1,loadedIssues:issues.length,expectedIssues:issues.length},
    errors:[], limitations:['hidden'], ...extra};
}

test('screen shows readable daily event and current status without JSON or transport noise', () => {
  const long = 'Причина '.repeat(700);
  const d = data([issue('P-1', {created:'2026-09-20T10:00:00Z'}, {histories:{entries:[{
    id:'h1',created:'2026-09-27T10:11:12Z',author:{displayName:'Анна Петрова'},
    items:[{field:'status',fromString:'Open',toString:'Done'}, {field:'customfield_123',fromString:'до',toString:'после'}]}],complete:true}}),
    issue('P-2', {issuetype:{name:'QA'},description:'GIANT-DESCRIPTION'.repeat(1000)}, {comments:{entries:[{
      id:'c1',created:'2026-09-27T11:00:01Z',author:{displayName:'Борис Смирнов'},
      body:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:long}]}]}}],complete:true}})],
    {requests:[{url:'https://jira.test/rest/api/2/issue/P-1?token=secret'}],scope:{transport:'NOISE'}});
  const out = source.screen(d, '2026-09-27');
  assert.match(out,/27\.09\.2026|2026-09-27/);
  assert.match(out,/событи[йя]: 2/i);
  assert.match(out,/задач[иа]?.*2/i);
  assert.match(out,/исходн.*замечан.*1/i);
  assert.match(out,/СЕЙЧАС.*Выполнено/i);
  assert.match(out,/Статус: Открыто → Выполнено/);
  assert.match(out,/customfield_123: до → после/);
  assert.match(out,/13:11:12 МСК.*Анна Петрова/);
  assert.match(out,/P-2.*QA/);
  assert.ok(out.includes(long));
  assert.doesNotMatch(out,/GIANT-DESCRIPTION|https:\/\/jira|NOISE|\[object Object\]|"fields"|"requests"/);
});

test('worklog hours use unique issue and ID on started day, not creation or update day', () => {
  const w = {id:'w1',started:'2026-09-26T22:00:00Z',created:'2026-09-27T10:00:00Z',
    updated:'2026-09-27T11:00:00Z',timeSpentSeconds:5400,author:{displayName:'Олег Орлов'},comment:'полное описание'};
  const d = data([issue('P-1', {}, {worklogs:{entries:[w,{...w}],complete:false}})],
    {coverage:{complete:false,loadedParents:1,expectedParents:1,loadedIssues:1,expectedIssues:1}});
  const started = source.screen(d,'2026-09-27');
  assert.match(started,/1 ч 30 мин/);
  assert.match(started,/записей.*1/i);
  assert.match(started,/Создана запись трудозатрат/);
  assert.match(started,/Изменена запись трудозатрат/);
  assert.match(started,/неполные/i);
  const later = source.screen(d,'2026-09-28');
  assert.match(later,/0 ч/);
  assert.doesNotMatch(later,/1 ч 30 мин/);
  assert.match(started,/Дата работы: 2026-09-27/);
});

test('recursive shared descendants and cycles render once with explicit other parent', () => {
  const d = data([issue('P-1'),issue('P-2'),issue('P-3'),issue('P-4', {created:'2026-09-27T10:00:00Z'})], {
    parentKeys:['P-1','P-3'], relationships:[{key:'P-1',children:['P-2']},{key:'P-2',children:['P-4']},
      {key:'P-3',children:['P-4']},{key:'P-4',children:['P-1']}],
    coverage:{complete:true,loadedParents:2,expectedParents:2,loadedIssues:4,expectedIssues:4}});
  const out = source.screen(d,'2026-09-27');
  assert.equal((out.match(/Создана задача/g)||[]).length,1);
  assert.match(out,/связана также с P-3/i);
  assert.match(out,/За день: событий: 1; затронуто задач: 1; исходных замечаний: 2\./);
});

test('unknown dates, missing fields, empty days and missing IDs are honest', () => {
  const d = data([issue('P-1', {status:null,assignee:null,components:null}, {
    comments:{entries:[null,{id:'c',created:null,body:null}],complete:false},
    worklogs:{entries:[{started:null,created:'2026-09-27T10:00:00Z',timeSpentSeconds:3600}],complete:false}})]);
  assert.match(source.screen(d,'unknown'),/неизвестно/i);
  const out = source.screen(d,'2026-09-27');
  assert.match(out,/неизвестно/);
  assert.match(out,/Списано по дате работы: 0 ч 0 мин; записей: 0/);
  assert.doesNotMatch(out,/NaN|undefined|\[object Object\]/);
  assert.match(source.screen(d,'2026-09-28'),/событи[йя]: 0/i);
});

test('newest version of a worklog ID determines one daily total', () => {
  const base = {id:'w1',started:'2026-09-27T07:00:00Z',created:'2026-09-27T08:00:00Z',
    timeSpentSeconds:3600,updated:'2026-09-27T09:00:00Z'};
  const d = data([issue('P-1', {}, {worklogs:{entries:[base,{...base,updated:'2026-09-27T10:00:00Z',timeSpentSeconds:7200}],complete:false}})]);
  const out = source.screen(d,'2026-09-27');
  assert.match(out,/Списано по дате работы: 2 ч 0 мин; записей: 1/);
  assert.match(out,/различающ/i);
});

test('a corrected started date moves a worklog total to one day only', () => {
  const old = {id:'w1',started:'2026-09-26T08:00:00Z',updated:'2026-09-27T09:00:00Z',timeSpentSeconds:3600};
  const newer = {...old,started:'2026-09-27T08:00:00Z',updated:'2026-09-27T10:00:00Z'};
  const d = data([issue('P-1', {}, {worklogs:{entries:[old,newer],complete:false}})]);
  const oldDay = source.screen(d,'2026-09-26');
  assert.match(oldDay,/Списано по дате работы: 0 ч 0 мин; записей: 0/);
  assert.doesNotMatch(oldDay,/Дата работы по записи трудозатрат/);
  assert.ok(!source.days(d).includes('2026-09-26'));
  assert.match(source.screen(d,'2026-09-27'),/Списано по дате работы: 1 ч 0 мин; записей: 1/);
});

test('null duration is excluded and a summary role beats generic issue type', () => {
  const d = data([issue('P-1'),issue('P-2',{summary:'[FE] экран',issuetype:{name:'Task'}},
    {worklogs:{entries:[{id:'w',started:'2026-09-27T08:00:00Z',timeSpentSeconds:null}],complete:true}})]);
  const out = source.screen(d,'2026-09-27');
  assert.match(out,/Дочерняя задача P-2 · FE · \[FE\] экран/);
  assert.match(out,/Не включены в часы: 1 записей без длительности/);
  assert.match(out,/Списано по дате работы: 0 ч 0 мин; записей: 1/);
});

test('group header shows parent current snapshot when only child has activity', () => {
  const d = data([issue('P-1',{status:{name:'Open'},summary:'Родитель'},{}),
    issue('P-2',{created:'2026-09-27T09:00:00Z'})]);
  const out = source.screen(d,'2026-09-27');
  assert.match(out,/ЗАМЕЧАНИЕ P-1 · Родитель\nСЕЙЧАС: Открыто; исполнитель: Ирина Иванова; срок: 2026-09-30/);
  assert.equal((out.match(/Родитель/g)||[]).length,1);
});

test('time changes are readable durations and people totals separate actions from work date', () => {
  const w = {id:'w',started:'2026-09-27T08:00:00Z',created:'2026-09-28T08:00:00Z',
    timeSpentSeconds:5400,author:{displayName:'Анна Петрова'},comment:'полный текст'};
  const d = data([issue('P-1',{created:'2026-09-27T07:00:00Z',creator:{displayName:'Анна Петрова'}}, {
    histories:{entries:[{id:'h',created:'2026-09-27T09:00:00Z',author:{displayName:'Анна Петрова'},
      items:[{field:'timespent',fromString:'3600',toString:'5400'},
        {field:'timeestimate',fromString:'7200',toString:'3600'},
        {field:'timeoriginalestimate',fromString:null,toString:'3600'}]}],complete:true},
    worklogs:{entries:[w],complete:true}})]);
  const out = source.screen(d,'2026-09-27');
  assert.match(out,/Трудозатраты: 1 ч 0 мин → 1 ч 30 мин/);
  assert.match(out,/Оставшаяся оценка: 2 ч 0 мин → 1 ч 0 мин/);
  assert.match(out,/Исходная оценка: неизвестно → 1 ч 0 мин/);
  assert.match(out,/Активность по людям · действия в Jira и списанное время/);
  assert.match(out,/Анна Петрова · действий: 2; задач: 1; списано по дате работы: 1 ч 30 мин/);
  assert.doesNotMatch(out,/Трудозатраты: 3600|действий: 3/);
});

test('current status distributions cover full snapshot independently of selected day', () => {
  const d = data([issue('P-1',{status:{name:'Done'}}), issue('P-2',{status:{name:'Open'}}),
    issue('P-3',{status:{name:'Done'}})], {
      parentKeys:['P-1','P-3'],relationships:[{key:'P-1',children:['P-2']}],
      coverage:{complete:true,loadedParents:2,expectedParents:2,loadedIssues:3,expectedIssues:3}});
  const out = source.screen(d,'2026-09-28');
  assert.match(out,/Статусы исходных историй СЕЙЧАС: Выполнено 2/);
  assert.match(out,/Статусы дочерних задач СЕЙЧАС: Открыто 1/);
  assert.match(out,/событий: 0/);
});

test('time changes prefer numeric seconds and separate ID-less comments remain visible', () => {
  const d = data([issue('P-1',{}, {histories:{entries:[{id:'h',created:'2026-09-27T09:00:00Z',
    items:[{field:'timespent',from:'3600',fromString:'1h',to:'7200',toString:'2h'}]}],complete:true},
    comments:{entries:[{created:'2026-09-27T10:00:00Z',body:'Первый'},
      {created:'2026-09-27T10:00:00Z',body:'Второй'}],complete:false}})]);
  const out = source.screen(d,'2026-09-27');
  assert.match(out,/Трудозатраты: 1 ч 0 мин → 2 ч 0 мин/);
  assert.match(out,/Первый/);
  assert.match(out,/Второй/);
  assert.match(out,/событий: 3/);
});

test('unknown day shows issue and worklog creation when their dates are missing', () => {
  const d = data([issue('P-1',{created:null},{worklogs:{entries:[{
    id:'w',started:'2026-09-27T08:00:00Z',created:null,timeSpentSeconds:1800
  }],complete:true}})]);
  assert.ok(source.days(d).includes('unknown'));
  const out = source.screen(d,'unknown');
  assert.match(out,/Создана задача/);
  assert.match(out,/Создана запись трудозатрат/);
  assert.match(out,/дата неизвестна/);
  assert.doesNotMatch(out,/За этот день событий не найдено/);
});
