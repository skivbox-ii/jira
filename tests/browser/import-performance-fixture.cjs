const DAY = 86400000;
const quotas = [900,1000,1100];
const statuses = [
  {id:"1",name:"К выполнению",statusCategory:{key:"new"}},
  {id:"2",name:"В работе",statusCategory:{key:"indeterminate"}},
  {id:"4",name:"Тестирование",statusCategory:{key:"indeterminate"}},
  {id:"3",name:"Готово",statusCategory:{key:"done"}}
];
const people = [
  {name:"ivanov",displayName:"Иванов И."},
  {name:"petrov",displayName:"Петров П."},
  {name:"sokolova",displayName:"Соколова А."},
  {name:"orlova",displayName:"Орлова Н."}
];
const components = [{id:"1",name:"АСУТП"},{id:"2",name:"Алармы"},{id:"3",name:"PARA"}];
const roles = ["BE","QA","FE"];

function mskToday() { return new Date(Date.now() + 3 * 3600000).toISOString().slice(0,10); }
function shift(day,delta) { return new Date(Date.parse(day+"T00:00:00Z")+delta*DAY).toISOString().slice(0,10); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function createPerformanceFixture({latestDate=mskToday(),remarks=250}={}) {
  if (!Number.isInteger(remarks) || remarks < 1 || remarks > 1000) throw new Error("Invalid performance fixture size");
  const dailyCounts=quotas.map(count=>Math.round(count*remarks/250));
  const dates = [-2,-1,0].map(delta => shift(latestDate,delta));
  const now = latestDate+"T18:00:00+03:00";
  const issues = Object.create(null), parents = [], ordered = [];
  const expected = Object.fromEntries(dates.map((date,index) => [date,{count:dailyCounts[index],ids:[]}]));
  const teams = [
    {id:"backend",name:"Разработка",direction:"development",roles:["BE","FE"],members:people.slice(0,2).map(person => ({id:person.name,label:person.displayName,identifiers:[person.name]}))},
    {id:"quality",name:"Проверка",direction:"testing",roles:["QA"],members:people.slice(2).map(person => ({id:person.name,label:person.displayName,identifiers:[person.name]}))}
  ];
  for (let remark=0;remark<remarks;remark++) {
    for (let task=0;task<4;task++) {
      const number=50000+remark*4+task, key="EVOSCADA-"+number;
      const title=task ? `[${roles[task-1]}] ${remark+1}. ${["Сигналы МЭК","Экранная форма","Алармы","Проверка качества"][remark%4]}` : `${remark+1}. Замечание по ${["сигналам МЭК","экранной форме","алармам","качеству данных"][remark%4]}`;
      const status=clone(statuses[(remark+task)%4]), assignee=clone(people[(remark+task)%4]);
      const issue={key,fields:{summary:title,description:`h2. ${title}\nПроверить обработку состояний и сохранить результат.`,
        status,assignee,creator:clone(people[3]),priority:{name:remark%7===0?"Высокий":"Средний"},
        issuetype:{name:task?"Задача разработки":"История"},project:{key:"EVOSCADA"},components:[clone(components[remark%3])],
        created:shift(dates[0],-30)+"T09:00:00+03:00",updated:now,timespent:0,
        worklog:{startAt:0,total:0,worklogs:[]},comment:{startAt:0,total:0,comments:[]},issuelinks:[]},
        changelog:{startAt:0,total:0,histories:[]}};
      issues[key]=issue;ordered.push(issue);
      if (!task) parents.push(issue);
      else parents[remark].fields.issuelinks.push({type:{name:"Child",outward:"is parent of",inward:"is child of"},outwardIssue:{key,fields:issue.fields}});
    }
  }
  dates.forEach((date,dayIndex) => {
    for (let event=0;event<dailyCounts[dayIndex];) {
      const ordinal=event, issue=ordered[ordinal%ordered.length], fields=issue.fields;
      const minute=9*60 + (ordinal%ordered.length)%480 + Math.floor(ordinal/ordered.length)*120;
      const stamp=date+"T"+String(Math.floor(minute/60)).padStart(2,"0")+":"+String(minute%60).padStart(2,"0")+":00+03:00";
      const id=`perf-${dayIndex}-${ordinal}`;
      const count=Math.min(ordinal%10===0?2:1,dailyCounts[dayIndex]-event);
      const items=[];
      for (let fieldIndex=0;fieldIndex<count;fieldIndex++) {
        const kind=(event+fieldIndex)%5;
        if (kind===0) {
          const from=fields.status, to=clone(statuses[(statuses.findIndex(item=>item.id===from.id)+1)%4]);
          items.push({field:"status",from:from.id,fromString:from.name,to:to.id,toString:to.name});fields.status=to;
        } else if (kind===1) {
          const from=fields.assignee, to=clone(people[(people.findIndex(person=>person.name===from.name)+1)%4]);
          items.push({field:"assignee",from:from.name,fromString:from.displayName,to:to.name,toString:to.displayName});fields.assignee=to;
        } else if (kind===2) {
          const from=fields.description,to=from+`\nПроверка ${dayIndex+1}.${ordinal}.`;
          items.push({field:"description",fromString:from,toString:to});fields.description=to;
        } else if (kind===3) {
          const from=String(fields.timeestimate || 14400),to=String(Number(from)+900);
          items.push({field:"timeestimate",from,fromString:from,to,toString:to});fields.timeestimate=Number(to);
        } else {
          const from=String(fields.timespent),to=String(Number(from)+600);
          items.push({field:"timespent",from,fromString:from,to,toString:to});fields.timespent=Number(to);
        }
        expected[date].ids.push(`${issue.key}:${id}:${fieldIndex}`);
      }
      issue.changelog.histories.push({id,created:stamp,author:clone(people[(ordinal+dayIndex)%4]),items});
      issue.changelog.total++;
      event+=count;
    }
  });
  return {dates,now,issues,parents,teams,expected};
}

module.exports={createPerformanceFixture};
