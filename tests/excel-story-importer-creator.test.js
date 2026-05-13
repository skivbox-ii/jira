const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const loadAmdModule = require("./helpers/load-amd-module");

const MODULE_DIR = path.join(__dirname, "..", "ujg-excel-story-importer-modules");

function loadConfig() {
  return loadAmdModule(path.join(MODULE_DIR, "config.js"), {});
}

function loadCreator() {
  const config = loadConfig();
  const description = loadAmdModule(path.join(MODULE_DIR, "description.js"), {});
  return loadAmdModule(path.join(MODULE_DIR, "creator.js"), {
    "_ujgESI_config": config,
    "_ujgESI_description": description,
  });
}

test("createRow skips rows that already have a Jira key", async function () {
  const creator = loadCreator();
  const calls = [];
  const api = {
    createIssue: function (payload) {
      calls.push(payload);
      return Promise.resolve({ key: "NEW-1" });
    },
  };

  const result = await creator.createRow(
    api,
    {
      summary: "Already linked",
      jiraKey: "EVOSCADA-1",
      alreadyLinked: true,
      sourceColumns: { "Замечание": "Already linked", "Jira": "EVOSCADA-1" },
    },
    { projectKey: "EVOSCADA", epicKey: "EVOSCADA-10", createSubtasks: true }
  );

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(calls.length, 0);
});

test("createRow creates Story with selected Epic Link and then template subtasks", async function () {
  const creator = loadCreator();
  const calls = [];
  const links = [];
  const keys = [
    "EVOSCADA-2000",
    "EVOSCADA-2001",
    "EVOSCADA-2002",
    "EVOSCADA-2003",
    "EVOSCADA-2004",
    "EVOSCADA-2005",
  ];
  const api = {
    createIssue: function (payload) {
      calls.push(payload);
      return Promise.resolve({ key: keys[calls.length - 1] });
    },
    createIssueLink: function (payload) {
      links.push(payload);
      return Promise.resolve({});
    },
  };

  const result = await creator.createRow(
    api,
    {
      summary: "Нет настроек полей сообщений",
      sourceColumns: { "Замечание": "Нет настроек полей сообщений", "Модуль": "Алармы" },
      alreadyLinked: false,
    },
    { projectKey: "EVOSCADA", epicKey: "EVOSCADA-100", createSubtasks: true }
  );

  assert.equal(result.ok, true);
  assert.equal(result.createdKey, "EVOSCADA-2000");
  assert.equal(calls.length, 6);
  assert.equal(calls[0].fields.project.key, "EVOSCADA");
  assert.equal(calls[0].fields.summary, "Нет настроек полей сообщений");
  assert.equal(calls[0].fields.customfield_10014, "EVOSCADA-100");
  assert.equal(calls[1].fields.issuetype.name, "System Engineer");
  assert.equal(calls[1].fields.summary, "[SE] Нет настроек полей сообщений");
  assert.equal(calls[5].fields.summary, "[DevOps] Нет настроек полей сообщений");
  assert.equal(calls[1].fields.parent, undefined);
  assert.equal(links.length, 5);
  assert.equal(links[0].type.name, "Child");
  assert.equal(links[0].outwardIssue.key, "EVOSCADA-2000");
  assert.equal(links[0].inwardIssue.key, "EVOSCADA-2001");
});
