const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const load = require("./helpers/load-amd-module");

const root = path.join(__dirname, "..");
function setup(options = {}) {
  const requests = [], prompts = [], storage = new Map();
  if (options.config !== false) storage.set("test-llm", JSON.stringify({apiBase:"https://llm.example.test/v1",model:"configured-model",apiKey:"private-key"}));
  const localStorage = {getItem:key => storage.get(key) || null,setItem:(key,value) => storage.set(key,value)};
  const client = load(path.join(root,"ujg-shared-modules/llm-client.js"),{}, {
    fetch(url,request) {
      requests.push({url,request});
      return Promise.resolve({ok:options.ok !== false,status:options.ok === false ? 500 : 200,text:() => Promise.resolve(options.ok === false ? "private-key echoed by provider" : JSON.stringify({choices:[{message:{content:"# Отчёт\nГотово"}}]}))});
    }
  });
  let callbacks;
  const Gadget = load(path.join(root,"ujg-excel-story-importer-modules/main.js"), {
    jquery:() => ({length:0}),
    _ujgESI_config:{STORY_ISSUE_TYPE:"Story",CREATE_TEMPLATE_ROLES:[],LLM_CONFIG_STORAGE_KEY:"test-llm"},
    _ujgESI_api:{baseUrl:"https://jira.example.test",getProjects:() => Promise.resolve([])},
    "_ujgESI_excel-loader":{},_ujgESI_parser:{},_ujgESI_creator:{},
    _ujgESI_mappingStore:null,_ujgESI_xlsxPatcher:null,_ujgESI_teams:null,_ujgESI_activity:null,
    _ujgESI_rendering:{init(_container,services) { callbacks=services; },render() {}},
    _ujgShared_llmClient:client
  },{localStorage,window:{localStorage,prompt:message => { prompts.push(message); return null; }}});
  new Gadget({getGadgetContentEl:() => ({find:() => ({length:1})}),resize() {}});
  return {callbacks,requests,prompts,storage};
}

test("Dynamics exposes an explicit LLM transport without automatic requests", async () => {
  const x=setup();
  assert.equal(typeof x.callbacks.onActivityLlmRequest,"function");
  assert.equal(x.requests.length,0);
  const result=await x.callbacks.onActivityLlmRequest({systemPrompt:"Use supplied facts",userPrompt:"Selected-day evidence",temperature:0});
  assert.equal(result.text,"# Отчёт\nГотово");
  assert.deepEqual(Object.keys(result),["text"]);
  assert.equal(x.requests.length,1);
  const sent=x.requests[0];
  assert.equal(sent.url,"https://llm.example.test/v1/chat/completions");
  assert.equal(sent.request.headers.Authorization,"Bearer private-key");
  const body=JSON.parse(sent.request.body);
  assert.equal(body.model,"configured-model");
  assert.equal(body.messages[1].content,"Selected-day evidence");
  assert.equal(x.prompts.length,0);
});

test("a cancelled missing-config prompt does not send data", async () => {
  const x=setup({config:false});
  await assert.rejects(() => x.callbacks.onActivityLlmRequest({systemPrompt:"Rules",userPrompt:"Facts"}),/LLM не настроен/);
  assert.equal(x.requests.length,0);
  assert.equal(x.storage.has("test-llm"),false);
  assert.equal(x.prompts.length,1);
});

test("oversized Unicode prompts fail before the shared client can truncate them", async () => {
  const x=setup();
  await assert.rejects(() => x.callbacks.onActivityLlmRequest({systemPrompt:"Rules",userPrompt:"Я".repeat(21001)}),/размер|лимит/i);
  await assert.rejects(() => x.callbacks.onActivityLlmRequest({systemPrompt:"Я".repeat(3001),userPrompt:"Facts"}),/размер|лимит/i);
  assert.equal(x.requests.length,0);
});

test("provider errors do not disclose credentials or raw response bodies", async () => {
  const x=setup({ok:false});
  await assert.rejects(() => x.callbacks.onActivityLlmRequest({systemPrompt:"Rules",userPrompt:"Facts"}),error => {
    assert.match(error.message,/LLM/);
    assert.doesNotMatch(error.message,/private-key|echoed|https:/);
    return true;
  });
  assert.equal(x.requests.length,1);
});

test("blank requests fail without prompting for settings", async () => {
  const x=setup({config:false});
  await assert.rejects(() => x.callbacks.onActivityLlmRequest({systemPrompt:" ",userPrompt:"Facts"}),/пуст/i);
  assert.equal(x.prompts.length,0);
  assert.equal(x.requests.length,0);
});
