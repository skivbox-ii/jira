const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const load = require("./helpers/load-amd-module");

function client() {
  const calls = [];
  const api = load(path.join(__dirname, "..", "ujg-excel-story-importer-modules/api.js"), {
    jquery: {ajax: options => {calls.push(options); return Promise.resolve({});}},
    _ujgESI_config: {baseUrl:"https://jira.example.test"},
  });
  return {api, calls};
}

test("project component catalog is a bounded read-only request", async () => {
  const {api, calls} = client();
  await api.getProjectComponents("AB_1");
  assert.equal(calls[0].url, "https://jira.example.test/rest/api/2/project/AB_1/components");
  assert.equal(calls[0].type, "GET");
  assert.equal(calls[0].timeout, 30000);
});

test("issue details request actual Jira components", async () => {
  const {api, calls} = client();
  await api.getIssueWithHistory("ABC-1");
  assert.ok(calls[0].data.fields.split(",").includes("components"));
});
