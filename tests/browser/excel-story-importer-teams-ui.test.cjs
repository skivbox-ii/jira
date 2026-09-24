const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const jquery = require("jquery");
const root = path.join(__dirname, "../..");

function setup() {
  const dom = new JSDOM('<div id="root"></div>', { runScripts: "outside-only" });
  const $ = jquery(dom.window), modules = { jquery: $ };
  dom.window.define = (name, deps, factory) => { modules[name] = factory(...deps.map(dep => modules[dep])); };
  for (const file of ["icons", "teams", "teams-ui"]) dom.window.eval(fs.readFileSync(path.join(root, "ujg-excel-story-importer-modules", file + ".js"), "utf8"));
  const calls = [];
  const state = { projectKey: "P", teams: [{ id: "qa", name: "QA", direction: "testing", roles: ["QA"], color: modules._ujgESI_teams.colors[0], members: [{ id: "a", label: "Alice", identifiers: ["acct-a"] }] }], teamUsers: [{ id: "a", label: "Alice", identifiers: ["acct-a"] }, { id: "b", label: "Bob", identifiers: ["acct-b"] }], teamMemberPicker: { teamId: "qa", query: "" } };
  const hooks = Object.fromEntries(["onTeamAdd", "onTeamRemove", "onTeamChange", "onTeamMemberToggle", "onTeamMembersOpen", "onTeamMembersSearch"].map(key => [key, (...args) => calls.push([key, ...args])]));
  const render = () => modules._ujgESI_teamsUi.render($("#root"), state, hooks);
  render();
  return { dom, $, state, calls, render };
}

test("editor reports local project and commits edits through hooks", t => {
  const { dom, $, calls } = setup(); t.after(() => dom.window.close());
  assert.match($("#root").text(), /Локально · P/);
  $(".ujg-esi-team-add").trigger("click");
  $(".ujg-esi-team-name").val("Testers").trigger("change");
  $(".ujg-esi-team-direction").val("development").trigger("change");
  $(".ujg-esi-team-roles").val("QA, TEST").trigger("change");
  $(".ujg-esi-team-color").last().trigger("click");
  $(".ujg-esi-team-remove").trigger("click");
  assert.deepEqual(calls[0], ["onTeamAdd"]);
  assert.deepEqual(calls[1], ["onTeamChange", "qa", "name", "Testers"]);
  assert.deepEqual(calls[2], ["onTeamChange", "qa", "direction", "development"]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[3])), ["onTeamChange", "qa", "roles", ["QA", "TEST"]]);
  assert.deepEqual(calls.at(-1), ["onTeamRemove", "qa"]);
});

test("selected member stays pinned and removable without a duplicate candidate during search", t => {
  const { dom, $, calls, state, render } = setup(); t.after(() => dom.window.close());
  $(".ujg-esi-team-members-button").trigger("click");
  assert.match($(".ujg-esi-team-members-button").text(), /1/);
  $(".ujg-esi-team-search").val("Bob").trigger("input");
  state.teamMemberPicker.query = "Bob"; render();
  assert.equal($(".ujg-esi-team-chip").length, 1);
  assert.deepEqual($(".ujg-esi-team-member-row").map((_, el) => $(el).attr("data-user-id")).get(), ["b"]);
  $(".ujg-esi-team-chip").trigger("click");
  assert.equal(calls.at(-1)[0], "onTeamMemberToggle");
  assert.equal(calls.at(-1)[1], "qa");
  assert.equal(calls.at(-1)[2].id, "a");
});

test("candidate selection and user loading states remain local", t => {
  const { dom, $, calls, state, render } = setup(); t.after(() => dom.window.close());
  $(".ujg-esi-team-member-row").last().trigger("click");
  assert.equal(calls.at(-1)[2].id, "b");
  state.teamUsersLoading = true; state.teamUsersError = ""; render();
  assert.match($("#root").text(), /Загрузка/);
  state.teamUsersLoading = false; state.teamUsersError = "Ошибка"; render();
  assert.match($("#root").text(), /Ошибка/);
});

test("editor exposes stable row and user IDs with compact column labels", t => {
  const { dom, $ } = setup(); t.after(() => dom.window.close());
  assert.equal($(".ujg-esi-team-row").attr("data-team-id"), "qa");
  assert.deepEqual($(".ujg-esi-team-columns").children().map((_, element) => $(element).text()).get(),
    ["Название", "Направление", "Роли", "Цвет", "Участники"]);
  assert.equal($(".ujg-esi-team-chip").attr("data-user-id"), "a");
  assert.deepEqual($(".ujg-esi-team-member-row").map((_, element) => $(element).attr("data-user-id")).get(), ["b"]);
});

test("selected names are escaped in chips and never repeated among candidates", t => {
  const {dom, $, state, render} = setup(); t.after(() => dom.window.close());
  state.teams[0].members[0].label = '<img src=x onerror=alert(1)>';
  render();
  assert.equal($(".ujg-esi-team-chip").text(), '<img src=x onerror=alert(1)>');
  assert.equal($(".ujg-esi-team-picker img").length, 0);
  assert.equal($(".ujg-esi-team-member-row[data-user-id=a]").length, 0);
});

test("selected ID and candidate identifier aliases do not duplicate a member", t => {
  const {dom,$,state,render} = setup(); t.after(() => dom.window.close());
  state.teams[0].members = [{id:"acct-a",label:"Alice",identifiers:[]}];
  state.teamUsers = [{id:"jira-a",label:"Alice from Jira",identifiers:["acct-a"]}, {id:"b",label:"Bob",identifiers:["acct-b"]}];
  render();
  assert.equal($(".ujg-esi-team-chip").length,1);
  assert.deepEqual($(".ujg-esi-team-member-row").map((_,el)=>$(el).attr("data-user-id")).get(),["b"]);
  state.teams[0].members = [{id:"jira-a",label:"Alice",identifiers:["acct-a"]}];
  state.teamUsers = [{id:"acct-a",label:"Alice alias",identifiers:[]}];
  render();
  assert.equal($(".ujg-esi-team-member-row").length,0);
});
