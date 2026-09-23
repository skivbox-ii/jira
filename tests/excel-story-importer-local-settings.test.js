const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const load = require("./helpers/load-amd-module");
const dir = path.join(__dirname, "..", "ujg-excel-story-importer-modules");
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

async function setup(options = {}) {
  const values = new Map([["ujg-shared-llm-config", "malformed"], ["unrelated", "keep"]]);
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const app = { values, storage };
  const config = load(path.join(dir, "config.js"), {});
  const teams = load(path.join(dir, "teams.js"), {});
  const Gadget = load(path.join(dir, "main.js"), {
    jquery: () => ({ length: 0 }), _ujgESI_config: config,
    _ujgESI_api: { getProjects: () => Promise.resolve([{key:"P"},{key:"Q"}]), getProjectEpics: () => Promise.resolve([]), getProjectCreateMeta: () => Promise.resolve({projects:[]}), searchUsers: options.searchUsers || (() => Promise.resolve([])) },
    "_ujgESI_excel-loader": {}, _ujgESI_parser: {}, _ujgESI_creator: {}, _ujgESI_mappingStore: null, _ujgESI_xlsxPatcher: null,
    _ujgESI_teams: teams,
    _ujgESI_rendering: { init: (_el, hooks) => { app.hooks = hooks; }, render: state => { app.state = state; } },
    _ujgShared_llmClient: options.llmClient || { request: () => { throw Error("No LLM request allowed"); } },
  }, { localStorage: storage, window: {localStorage: storage} });
  new Gadget({getGadgetContentEl:()=>({find:()=>({length:1})}),resize(){}});
  await flush();
  return app;
}

test("LLM reset requires confirmation and removes only connection config including malformed JSON", async () => {
  const app = await setup();
  app.hooks.onLlmResetRequest();
  assert.equal(app.state.llmResetConfirm, true);
  assert.equal(app.values.get("ujg-shared-llm-config"), "malformed");
  app.hooks.onLlmResetCancel();
  app.hooks.onLlmResetConfirm();
  assert.equal(app.values.get("ujg-shared-llm-config"), "malformed");
  app.hooks.onLlmResetRequest();
  app.hooks.onLlmResetConfirm();
  assert.equal(app.values.has("ujg-shared-llm-config"), false);
  assert.equal(app.values.get("unrelated"), "keep");
  assert.match(app.state.llmResetNotice, /сброшены/i);
});

test("LLM reset is blocked while a request is running and reports denied storage", async () => {
  const app = await setup();
  app.state.llmLoadingTarget = "story";
  app.hooks.onLlmResetRequest();
  assert.equal(app.state.llmResetConfirm, false);
  app.state.llmLoadingTarget = "";
  app.hooks.onLlmResetRequest();
  app.storage.removeItem = () => { throw Error("denied"); };
  app.hooks.onLlmResetConfirm();
  assert.equal(app.values.has("ujg-shared-llm-config"), true);
  assert.match(app.state.llmResetError, /denied/);
  assert.equal(app.state.llmResetNotice, "");
});

test("the next AI operation asks for new configuration after reset without using old credentials", async () => {
  let prompts = 0, requests = 0;
  const app = await setup({llmClient:{
    readStoredConfig: (storage,key) => storage.getItem(key) ? {apiKey:"old"} : null,
    promptForConfig: () => { prompts++; return null; },
    requestText: () => { requests++; throw Error("Must not reuse old connection"); }
  }});
  app.hooks.onLlmResetRequest(); app.hooks.onLlmResetConfirm();
  assert.equal(prompts, 0); assert.equal(requests, 0);
  app.state.summaryDialog = {target:"story",beforeText:"Remark",afterText:"",prompt:"",useSystemPrompt:true};
  app.hooks.onSummaryDialogImprove();
  assert.equal(prompts, 1); assert.equal(requests, 0);
  assert.match(app.state.llmError, /не настроен/);
});

test("team edits persist locally per project without changing preferences or mappings", async () => {
  const app = await setup();
  app.hooks.onProjectChange("P");
  const first = app.state.teams[0].id;
  app.hooks.onTeamChange(first, "name", "Backend P");
  app.hooks.onTeamMemberToggle(first, {id:"bob",label:"Bob",identifiers:["bob","JIRAUSER1"]});
  app.hooks.onProjectChange("Q");
  assert.notEqual(app.state.teams[0].name, "Backend P");
  app.hooks.onProjectChange("P");
  assert.equal(app.state.teams[0].name, "Backend P");
  assert.equal(app.state.teams[0].members[0].id, "bob");
  assert.equal(app.values.get("unrelated"), "keep");
});

test("stale team user search cannot change a different project's picker", async () => {
  let resolve;
  const app = await setup({searchUsers:()=>new Promise(r=>{resolve=r;})});
  app.hooks.onProjectChange("P");
  app.hooks.onTeamMembersOpen(app.state.teams[0].id);
  app.hooks.onProjectChange("Q");
  resolve([{name:"bob",displayName:"Bob",key:"JIRAUSER1"}]);
  await flush();
  assert.equal(app.state.teamUsers.length, 0);
  assert.equal(app.state.teamUsersLoading, false);
});
