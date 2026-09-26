const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const vm = require("node:vm");
const {spawn} = require("node:child_process");

test("offline preview includes one synthetic long description change today", async t => {
  const server = spawn(process.execPath,[path.join(__dirname,"import-preview-server.cjs")],{
    env:{...process.env,PORT:"0"},stdio:["ignore","pipe","pipe"]
  });
  t.after(() => server.kill());
  const url = await new Promise((resolve,reject) => {
    let output="";
    server.stdout.on("data",chunk => {
      output+=chunk.toString();
      const match=output.match(/Offline import preview: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) resolve(match[1]);
    });
    server.once("error",reject);
    server.once("exit",code => reject(new Error("Preview server exited: "+code)));
  });
  const response=await fetch(url+"/test/fixture.js");
  assert.equal(response.status,200);
  const context={window:{}};
  vm.runInNewContext(await response.text(),context);
  const target=context.window.fixtureIssues["EVOSCADA-30040"];
  const changes=target.changelog.histories.filter(history => history.created.startsWith(context.window.fixtureNow.slice(0,10)))
    .flatMap(history => history.items.filter(item => item.field === "description"));
  assert.equal(changes.length,1);
  const change=changes[0];
  assert.ok(change.fromString.length>500 && change.toString.length>500);
  assert.match(change.fromString,/Локальный пример.*\|\|Параметр\|\|Значение\|\|/s);
  assert.match(change.toString,/Локальный пример.*\|\|Параметр\|\|Значение\|\|/s);
  assert.equal(target.fields.description,change.toString);
});
