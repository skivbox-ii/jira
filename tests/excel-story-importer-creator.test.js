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
      sourceColumns: {
        "Замечание": "Нет настроек полей сообщений",
        "Модуль": "Алармы",
        "Приоритет": "Высокий",
      },
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
  assert.equal(calls[0].fields.components.length, 1);
  assert.equal(calls[0].fields.components[0].name, "Алармы");
  assert.equal(calls[0].fields.priority.name, "High");
  assert.equal(calls[1].fields.issuetype.name, "System Engineer");
  assert.equal(calls[1].fields.summary, "[SE] Нет настроек полей сообщений");
  assert.equal(calls[5].fields.summary, "[DevOps] Нет настроек полей сообщений");
  assert.equal(calls[1].fields.parent, undefined);
  assert.equal(links.length, 5);
  assert.equal(links[0].type.name, "Child");
  assert.equal(links[0].outwardIssue.key, "EVOSCADA-2000");
  assert.equal(links[0].inwardIssue.key, "EVOSCADA-2001");
});

test("createRow retries without Epic Link when Jira rejects the epic field", async function () {
  const creator = loadCreator();
  const calls = [];
  const api = {
    createIssue: function (payload) {
      calls.push(payload);
      if (calls.length === 1) {
        return Promise.reject({
          responseJSON: {
            errorMessages: [],
            errors: {
              customfield_10014: "Field 'customfield_10014' cannot be set. It is not on the appropriate screen, or unknown.",
            },
          },
        });
      }
      return Promise.resolve({ key: "EVOSCADA-5000" });
    },
  };

  const result = await creator.createRow(
    api,
    {
      summary: "Epic field rejected",
      sourceColumns: { "Замечание": "Epic field rejected" },
      alreadyLinked: false,
    },
    {
      projectKey: "EVOSCADA",
      epicKey: "EVOSCADA-18333",
      issueType: "Story",
      createSubtasks: false,
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.createdKey, "EVOSCADA-5000");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].fields.customfield_10014, "EVOSCADA-18333");
  assert.equal(calls[1].fields.customfield_10014, undefined);
  assert.equal(result.epicLinkSkipped, true);
  assert.match(result.errors.join(" "), /Epic EVOSCADA-18333 не установлен/);
});

test("createRow uses edited dialog fields, assignees, and selected child tasks", async function () {
  const creator = loadCreator();
  const calls = [];
  const links = [];
  const api = {
    createIssue: function (payload) {
      calls.push(payload);
      return Promise.resolve({ key: "EVOSCADA-" + String(3000 + calls.length - 1) });
    },
    createIssueLink: function (payload) {
      links.push(payload);
      return Promise.resolve({});
    },
  };

  const result = await creator.createRow(
    api,
    {
      summary: "Original story",
      sourceColumns: { "Замечание": "Original story", "Комментарий": "Old" },
      alreadyLinked: false,
    },
    {
      projectKey: "EVOSCADA",
      epicKey: "",
      issueType: "Story",
      summary: "Edited story",
      assignee: { accountId: "story-acc", name: "ignored" },
      originalEstimate: "2h",
      remainingEstimate: "1h",
      sourceRows: [
        { name: "Замечание", value: "Edited story" },
        { name: "Комментарий", value: "Changed in modal" },
      ],
      createSubtasks: true,
      childTasks: [
        {
          enabled: true,
          role: "SE",
          issueType: "System Engineer",
          summary: "[SE] Edited story",
          assignee: { name: "se-user" },
          originalEstimate: "4h",
          remainingEstimate: "4h",
        },
        {
          enabled: false,
          role: "FE",
          issueType: "Frontend Task",
          summary: "[FE] Edited story",
          assignee: { name: "fe-user" },
          originalEstimate: "6h",
          remainingEstimate: "6h",
        },
        {
          enabled: true,
          role: "QA",
          issueType: "QA",
          summary: "[QA] Edited story",
          assignee: { accountId: "qa-acc" },
          originalEstimate: "3h",
          remainingEstimate: "2h",
        },
      ],
    }
  );

  assert.equal(result.ok, true);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].fields.summary, "Edited story");
  assert.equal(calls[0].fields.assignee.accountId, "story-acc");
  assert.equal(calls[0].fields.timetracking.originalEstimate, "2h");
  assert.equal(calls[0].fields.timetracking.remainingEstimate, "1h");
  assert.match(calls[0].fields.description, /Changed in modal/);
  assert.doesNotMatch(calls[0].fields.description, /Old/);
  assert.equal(calls[1].fields.summary, "[SE] Edited story");
  assert.equal(calls[1].fields.assignee.name, "se-user");
  assert.equal(calls[1].fields.timetracking.originalEstimate, "4h");
  assert.equal(calls[2].fields.summary, "[QA] Edited story");
  assert.equal(calls[2].fields.assignee.accountId, "qa-acc");
  assert.equal(calls[2].fields.timetracking.remainingEstimate, "2h");
  assert.equal(links.length, 2);
});

test("storyFields omits Epic Link when create metadata marks it unavailable", function () {
  const creator = loadCreator();

  const fields = creator.storyFields(
    {
      summary: "No epic field",
      sourceColumns: { "Замечание": "No epic field" },
    },
    {
      projectKey: "EVOSCADA",
      epicKey: "EVOSCADA-18333",
      epicLinkAllowed: false,
    }
  );

  assert.equal(fields.customfield_10014, undefined);
});

test("storyFields omits unknown module component and unknown priority", function () {
  const creator = loadCreator();

  const fields = creator.storyFields(
    {
      summary: "Unknown values",
      sourceColumns: {
        "Замечание": "Unknown values",
        "Модуль": "Примитивы (tnWP)",
        "Приоритет": "Срочно когда-нибудь",
      },
    },
    { projectKey: "EVOSCADA" }
  );

  assert.equal(fields.components, undefined);
  assert.equal(fields.priority, undefined);
});

test("storyFields applies editable mapping settings from create options", function () {
  const creator = loadCreator();

  const fields = creator.storyFields(
    {
      summary: "Mapped values",
      sourceColumns: {
        "Замечание": "Mapped values",
        "Модуль": "Примитивы (tnWP)",
        "Приоритет": "Срочно",
      },
    },
    {
      projectKey: "EVOSCADA",
      mappings: {
        moduleComponentMap: {
          "Примитивы (tnWP)": "Primitive Component",
        },
        priorityMap: {
          "Срочно": "Highest",
        },
      },
    }
  );

  assert.equal(fields.components[0].name, "Primitive Component");
  assert.equal(fields.priority.name, "Highest");
});
