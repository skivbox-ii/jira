const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const load = require("./helpers/load-amd-module");

function client() {
  const calls = [];
  const api = load(path.join(__dirname,"..","ujg-excel-story-importer-modules","api.js"), {
    jquery:{ajax: options => { calls.push(options); return Promise.resolve({}); }},
    _ujgESI_config:{baseUrl:"https://jira.example.test"},
  });
  return {api,calls};
}

test("narrow due date GET requests only due date and summary", async () => {
  const {api,calls} = client();
  await api.getIssueDueDate("AB_1-42");
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,"https://jira.example.test/rest/api/2/issue/AB_1-42");
  assert.equal(calls[0].type,"GET");
  assert.equal(calls[0].timeout,30000);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].data)),{fields:"duedate,summary"});
});

test("narrow due date PUT changes only duedate", async () => {
  const {api,calls} = client();
  await api.updateIssueDueDate("ABC-1","2028-02-29");
  assert.equal(calls[0].type,"PUT");
  assert.equal(calls[0].timeout,30000);
  assert.equal(calls[0].contentType,"application/json");
  assert.deepEqual(JSON.parse(calls[0].data),{fields:{duedate:"2028-02-29"}});
});

test("invalid keys and calendar dates never reach ajax", async () => {
  const {api,calls} = client();
  for (const key of ["", "../ABC-1", "ABC-0", "__proto__", null, 42]) {
    await assert.rejects(() => api.updateIssueDueDate(key,"2026-09-25"));
    await assert.rejects(() => api.getIssueDueDate(key));
  }
  for (const date of [null,"", "2026-02-30", "2025-02-29", "25.09.2026", "2026-09-25T00:00:00Z"]) {
    await assert.rejects(() => api.updateIssueDueDate("ABC-1",date));
  }
  assert.equal(calls.length,0);
});

test("timed-out PUT rejects without an API retry", async () => {
  const timeout = {status:0,statusText:"timeout",responseText:"private body"};
  const calls = [];
  const api = load(path.join(__dirname,"..","ujg-excel-story-importer-modules","api.js"), {
    jquery:{ajax: options => { calls.push(options); return Promise.reject(timeout); }},
    _ujgESI_config:{baseUrl:"https://jira.example.test"},
  });
  await assert.rejects(api.updateIssueDueDate("ABC-1","2026-09-25"), error => error === timeout);
  assert.equal(calls.length,1);
  assert.equal(calls[0].timeout,30000);
});
