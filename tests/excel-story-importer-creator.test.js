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
    "_ujgESI_remarkId": loadAmdModule(path.join(MODULE_DIR, "remark-id.js"), {}),
  });
}

test("storyFields prefixes only the source remark ID and keeps existing prefixes", function () {
  const creator = loadCreator();
  const cases = [
    [{ "№": 42, ID: 7 }, "Fix alarm", "№42 Fix alarm"],
    [{ "№": " 0042 " }, "Fix alarm", "№0042 Fix alarm"],
    [{ "№": 0 }, "Fix alarm", "№0 Fix alarm"],
    [{ "№": "", ID: "R-42" }, "Fix alarm", "№R-42 Fix alarm"],
    [{ "Номер": "42.1" }, "Fix alarm", "№42.1 Fix alarm"],
    [{ "Номер замечания": "42" }, "Fix alarm", "№42 Fix alarm"],
    [{ " id ": "42" }, "Fix alarm", "№42 Fix alarm"],
    [{ "№": 42 }, "№42 Fix alarm", "№42 Fix alarm"],
    [{ "№": 42 }, "№ 42. Fix alarm", "№ 42. Fix alarm"],
    [{ "№": 42 }, "42. Fix alarm", "42. Fix alarm"],
    [{ "№": 42 }, "[42] Fix alarm", "[42] Fix alarm"],
    [{ "№": 42 }, "#42 Fix alarm", "#42 Fix alarm"],
    [{ "№": 42 }, "420 Fix alarm", "№42 420 Fix alarm"],
    [{ "№": 42 }, "42.1 Fix alarm", "№42 42.1 Fix alarm"],
    [{ "№": "undefined" }, "Fix alarm", "Fix alarm"],
    [{ "№": 42 }, "", ""],
    [{ "№": 42 }, undefined, ""],
    [{ ID: { value: 42 } }, "Fix alarm", "Fix alarm"],
    [{}, "Fix alarm", "Fix alarm"],
  ];
  for (const [sourceColumns, summary, expected] of cases) {
    const row = { id: 999, excelRowNumber: 123, summary, sourceColumns };
    assert.equal(creator.storyFields(row, {}).summary, expected, JSON.stringify(sourceColumns) + " / " + summary);
  }
});

test("summaryWithRemarkId keeps child role before remark ID and enforces the summary limit", function () {
  const creator = loadCreator();
  const row = { sourceColumns: { "№": "42" } };
  assert.equal(typeof creator.summaryWithRemarkId, "function");
  assert.equal(creator.summaryWithRemarkId(row, "[FE] Fix alarm"), "[FE] №42 Fix alarm");
  assert.equal(creator.summaryWithRemarkId(row, "[FE] №42 Fix alarm"), "[FE] №42 Fix alarm");
  assert.equal(creator.summaryWithRemarkId(row, "[FE] 42. Fix alarm"), "[FE] 42. Fix alarm");
  assert.equal(creator.summaryWithRemarkId(null, undefined), "");
  assert.equal(creator.summaryWithRemarkId(row, "[FE] " + "x".repeat(300)), "[FE] №42 " + "x".repeat(246));
  assert.equal(creator.storyFields(row, { summary: "x".repeat(300) }).summary, "№42 " + "x".repeat(251));
});

test("createRow numbers default and edited children while retaining Epic fallback and source details", async function () {
  const creator = loadCreator();
  for (const childTasks of [undefined, [
    { role: "FE", issueType: "Task", summary: "[FE] Edited child", description: "Edited details" },
    { role: "BE", issueType: "Task", summary: "[BE] №42 Already numbered" },
    { role: "QA", issueType: "Task", summary: "Disabled", enabled: false },
  ]]) {
    const calls = [];
    const row = { summary: "Full source remark", sourceColumns: { "№": 42, "Замечание": "Full source remark" } };
    const result = await creator.createRow({
      createIssue(payload) {
        calls.push(payload.fields);
        if (calls.length === 1) return Promise.reject({ responseJSON: { errors: { customfield_10109: "Not allowed" } } });
        return Promise.resolve({ key: "TEST-" + calls.length });
      },
      createIssueLink() { return Promise.resolve({}); },
    }, row, { projectKey: "TEST", epicKey: "TEST-1", summary: "Edited story", createSubtasks: true, childTasks });
    assert.equal(result.ok, true);
    assert.equal(result.epicLinkSkipped, true);
    assert.equal(calls[0].summary, "№42 Edited story");
    assert.equal(calls[1].summary, "№42 Edited story");
    assert.equal(calls[1].customfield_10109, undefined);
    assert.match(calls[1].description, /Full source remark/);
    assert.match(calls[1].description, /42/);
    assert.equal(calls[2].summary, childTasks ? "[FE] №42 Edited child" : "[SE] №42 Edited story");
    if (childTasks) {
      assert.equal(calls.length, 4);
      assert.equal(calls[2].description, "Edited details");
      assert.equal(calls[3].summary, "[BE] №42 Already numbered");
      assert.equal(childTasks[0].summary, "[FE] Edited child");
    }
    assert.equal(row.summary, "Full source remark");
  }
});

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
  assert.equal(calls[0].fields.customfield_10109, "EVOSCADA-100");
  assert.equal(calls[0].fields.components.length, 1);
  assert.equal(calls[0].fields.components[0].name, "Алармы");
  assert.equal(calls[0].fields.priority.name, "High");
  assert.equal(calls[1].fields.issuetype.name, "Задача разработки");
  assert.equal(calls[1].fields.summary, "[SE] Нет настроек полей сообщений");
  assert.equal(calls[5].fields.summary, "[DevOps] Нет настроек полей сообщений");
  assert.equal(calls[1].fields.parent, undefined);
  assert.equal(links.length, 9);
  assert.equal(links[0].type.name, "Child");
  assert.equal(links[0].outwardIssue.key, "EVOSCADA-2000");
  assert.equal(links[0].inwardIssue.key, "EVOSCADA-2001");
  assert.deepEqual(
    links.slice(5).map(function (link) {
      return [link.type.name, link.outwardIssue.key, link.inwardIssue.key];
    }),
    [
      ["Blocks", "EVOSCADA-2004", "EVOSCADA-2001"],
      ["Blocks", "EVOSCADA-2004", "EVOSCADA-2002"],
      ["Blocks", "EVOSCADA-2004", "EVOSCADA-2003"],
      ["Blocks", "EVOSCADA-2004", "EVOSCADA-2005"],
    ]
  );
});

test("createRow limits story and child summaries to 255 characters", async function () {
  const creator = loadCreator();
  const calls = [];
  const links = [];
  const longSummary = "Д".repeat(320);
  const api = {
    createIssue: function (payload) {
      calls.push(payload);
      return Promise.resolve({ key: "EVOSCADA-" + String(4000 + calls.length) });
    },
    createIssueLink: function (payload) {
      links.push(payload);
      return Promise.resolve({});
    },
  };

  const result = await creator.createRow(
    api,
    {
      summary: longSummary,
      sourceColumns: { "Замечание": longSummary },
      alreadyLinked: false,
    },
    { projectKey: "EVOSCADA", createSubtasks: true }
  );

  assert.equal(result.ok, true);
  assert.equal(calls[0].fields.summary.length, 255);
  assert.equal(calls[0].fields.summary, longSummary.slice(0, 255));
  assert.equal(calls[1].fields.summary.length, 255);
  assert.equal(calls[1].fields.summary.startsWith("[SE] "), true);
  assert.equal(calls[1].fields.summary, ("[SE] " + longSummary).slice(0, 255));
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
              customfield_10109: "Field 'customfield_10109' cannot be set. It is not on the appropriate screen, or unknown.",
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
  assert.equal(calls[0].fields.customfield_10109, "EVOSCADA-18333");
  assert.equal(calls[1].fields.customfield_10109, undefined);
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
  assert.equal(links.length, 3);
  assert.equal(links[2].type.name, "Blocks");
  assert.equal(links[2].outwardIssue.key, "EVOSCADA-3002");
  assert.equal(links[2].inwardIssue.key, "EVOSCADA-3001");
});

test("createRow links testing child as blocked by every other created child", async function () {
  const creator = loadCreator();
  const calls = [];
  const links = [];
  const api = {
    createIssue: function (payload) {
      calls.push(payload);
      return Promise.resolve({ key: "EVOSCADA-" + String(7000 + calls.length - 1) });
    },
    createIssueLink: function (payload) {
      links.push(payload);
      return Promise.resolve({});
    },
  };

  const result = await creator.createRow(
    api,
    {
      summary: "Story with QA blocker",
      sourceColumns: { "Замечание": "Story with QA blocker" },
      alreadyLinked: false,
    },
    {
      projectKey: "EVOSCADA",
      createSubtasks: true,
      childTasks: [
        { enabled: true, role: "SE", issueType: "Task", summary: "[SE] Story with QA blocker" },
        { enabled: true, role: "BE", issueType: "Task", summary: "[BE] Story with QA blocker" },
        { enabled: true, role: "QA", issueType: "Task", summary: "[QA] Story with QA blocker" },
      ],
    }
  );

  assert.equal(result.ok, true);
  assert.equal(calls.length, 4);
  assert.deepEqual(
    links.map(function (link) {
      return [link.type.name, link.outwardIssue.key, link.inwardIssue.key];
    }),
    [
      ["Child", "EVOSCADA-7000", "EVOSCADA-7001"],
      ["Child", "EVOSCADA-7000", "EVOSCADA-7002"],
      ["Child", "EVOSCADA-7000", "EVOSCADA-7003"],
      ["Blocks", "EVOSCADA-7003", "EVOSCADA-7001"],
      ["Blocks", "EVOSCADA-7003", "EVOSCADA-7002"],
    ]
  );
});

test("createRow resolves child issue link type from Jira metadata", async function () {
  const creator = loadCreator();
  const calls = [];
  const links = [];
  const api = {
    createIssue: function (payload) {
      calls.push(payload);
      return Promise.resolve({ key: "EVOSCADA-" + String(8000 + calls.length - 1) });
    },
    getIssueLinkTypes: function () {
      return Promise.resolve({
        issueLinkTypes: [
          { id: "10001", name: "Blocks", outward: "blocks", inward: "is blocked by" },
          { id: "10002", name: "Hierarchy", outward: "parent", inward: "child" },
        ],
      });
    },
    createIssueLink: function (payload) {
      links.push(payload);
      return Promise.resolve({});
    },
  };

  const result = await creator.createRow(
    api,
    {
      summary: "Story with Jira child link metadata",
      sourceColumns: { "Замечание": "Story with Jira child link metadata" },
      alreadyLinked: false,
    },
    {
      projectKey: "EVOSCADA",
      createSubtasks: true,
      childTasks: [
        { enabled: true, role: "SE", issueType: "Task", summary: "[SE] Story with Jira child link metadata" },
      ],
    }
  );

  assert.equal(result.ok, true);
  assert.equal(links.length, 1);
  assert.equal(links[0].type.name, "Hierarchy");
  assert.equal(links[0].inwardIssue.key, "EVOSCADA-8000");
  assert.equal(links[0].outwardIssue.key, "EVOSCADA-8001");
});

for (const method of ["createRow", "createAdditionalTasks"]) {
  for (const name of ["Child", "Hierarchy"]) {
    for (const parentLabel of ["is parent of", "parent", "has children", "has child"]) {
      for (const parentSide of ["outward", "inward"]) {
        test(method + " keeps Story as parent for " + name + " " + parentSide + "=" + parentLabel, async function () {
          const creator = loadCreator();
          const type = { name, outward: "is child of", inward: "is child of" };
          type[parentSide] = parentLabel;
          const calls = [], links = [];
          const parentKey = "TEST-1";
          const api = {
            getIssueLinkTypes: () => Promise.resolve({ issueLinkTypes: [type] }),
            createIssue(payload) {
              calls.push(payload.fields);
              return Promise.resolve({ key: method === "createRow" && calls.length === 1 ? parentKey : "TEST-2" });
            },
            createIssueLink(payload) { links.push(payload); return Promise.resolve({}); },
          };
          const row = { summary: "Original remark", sourceColumns: { "№": 42 } };
          if (method === "createAdditionalTasks") row.jiraKey = parentKey;
          const result = await creator[method](api, row, {
            projectKey: "TEST", createSubtasks: true,
            childTasks: [{ role: "QA", issueType: "Task", enabled: true }],
          });
          assert.equal(result.ok, true);
          assert.equal(result.createdKey, parentKey);
          assert.equal(calls.length, method === "createRow" ? 2 : 1);
          assert.equal(links.length, 1);
          const link = links[0];
          assert.equal(link.type.name, name);
          // In Jira's issue view the OTHER endpoint chooses the relation label.
          const childEndpoint = parentSide + "Issue";
          const parentEndpoint = (parentSide === "outward" ? "inward" : "outward") + "Issue";
          assert.equal(link[parentEndpoint].key, parentKey);
          assert.equal(link[childEndpoint].key, "TEST-2");
          assert.equal(type[childEndpoint.replace("Issue", "")], parentLabel);
        });
      }
    }
  }
}

test("configured Child type preference does not override its direction metadata", function () {
  const creator = loadCreator();
  const chosen = creator.pickChildLinkType({ issueLinkTypes: [
    { name: "Hierarchy", outward: "is child of", inward: "is parent of" },
    { name: "Child", outward: "is parent of", inward: "is child of" },
  ] });
  const link = creator.childLinkPayload("TEST-1", "TEST-2", chosen);
  assert.equal(link.type.name, "Child");
  assert.equal(link.inwardIssue.key, "TEST-1");
  assert.equal(link.outwardIssue.key, "TEST-2");
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

  assert.equal(fields.customfield_10109, undefined);
});

test("storyFields sends Epic Link as raw Jira key for REST create", function () {
  const creator = loadCreator();

  const fields = creator.storyFields(
    {
      summary: "Epic linked",
      sourceColumns: { "Замечание": "Epic linked" },
    },
    {
      projectKey: "EVOSCADA",
      epicKey: "EVOSCADA-16245",
    }
  );

  assert.equal(fields.customfield_10109, "EVOSCADA-16245");
  assert.equal(fields.customfield_10014, undefined);
});

test("storyFields strips quick-create key prefix from Epic Link before REST create", function () {
  const creator = loadCreator();

  const fields = creator.storyFields(
    {
      summary: "Epic linked",
      sourceColumns: { "Замечание": "Epic linked" },
    },
    {
      projectKey: "EVOSCADA",
      epicKey: "key:EVOSCADA-16245",
    }
  );

  assert.equal(fields.customfield_10109, "EVOSCADA-16245");
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

test("createAdditionalTasks uses existing Story and creates only enabled selected children", async function () {
  const creator = loadCreator();
  const created = [];
  const links = [];
  const result = await creator.createAdditionalTasks({
    createIssue(payload) {
      created.push(payload.fields);
      return Promise.resolve({ key: "EVOSCADA-300" });
    },
    createIssueLink(payload) {
      links.push(payload);
      return Promise.resolve({});
    },
  }, { jiraKey: "EVOSCADA-200", summary: "Original", sourceColumns: { "№": 42 } }, {
    projectKey: "EVOSCADA",
    summary: "Edited",
    childTasks: [
      { role: "FE", issueType: "Task", summary: "[FE] Edited", description: "New UI", assignee: { name: "fe-user" }, enabled: true },
      { role: "BE", issueType: "Task", summary: "[BE] Edited", enabled: false },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.partial, false);
  assert.equal(result.createdKey, "EVOSCADA-200");
  assert.equal(result.errors.length, 0);
  assert.deepEqual(created.map(fields => fields.summary), ["[FE] №42 Edited"]);
  assert.equal(created[0].description, "New UI");
  assert.equal(created[0].assignee.name, "fe-user");
  assert.deepEqual(links.map(link => [link.type.name, link.outwardIssue.key, link.inwardIssue.key]), [
    ["Child", "EVOSCADA-200", "EVOSCADA-300"],
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.createdChildren)), [{
    key: "EVOSCADA-300", role: "FE", summary: "[FE] №42 Edited", description: "New UI",
    assignee: { name: "fe-user" }, issueType: "Task", enabled: true, linkedToParent: true,
  }]);
});

test("createAdditionalTasks validates parent and enabled tasks before Jira writes", async function () {
  const creator = loadCreator();
  let writes = 0;
  const api = { createIssue() { writes++; return Promise.resolve({ key: "NEW-1" }); } };
  const selected = { projectKey: "EVOSCADA", childTasks: [{ role: "QA", issueType: "Task", enabled: true }] };
  const missingParent = await creator.createAdditionalTasks(api, { summary: "No Story" }, selected);
  const noSelection = await creator.createAdditionalTasks(api, { createdKey: "EVOSCADA-200" }, {
    projectKey: "EVOSCADA", childTasks: [{ role: "QA", enabled: false }],
  });
  const noTasks = await creator.createAdditionalTasks(api, { jiraKey: "EVOSCADA-200" }, { projectKey: "EVOSCADA" });
  const noProject = await creator.createAdditionalTasks(api, { jiraKey: "EVOSCADA-200" }, {
    childTasks: [{ role: "FE", issueType: "Task" }],
  });

  assert.equal(missingParent.ok, false);
  assert.match(missingParent.errors.join(" "), /parent|Story/i);
  assert.equal(noSelection.ok, false);
  assert.equal(noTasks.ok, false);
  assert.equal(noProject.ok, false);
  assert.equal(writes, 0);
});

test("createAdditionalTasks retains child keys after link and create failures without retrying", async function () {
  const creator = loadCreator();
  const attempted = [];
  const result = await creator.createAdditionalTasks({
    createIssue(payload) {
      attempted.push(payload.fields.summary);
      if (attempted.length === 2) return Promise.reject(new Error("timeout"));
      return Promise.resolve({ key: "EVOSCADA-" + (300 + attempted.length) });
    },
    createIssueLink() { return Promise.reject(new Error("link denied")); },
  }, { createdKey: "EVOSCADA-200", summary: "Parent" }, {
    projectKey: "EVOSCADA",
    childTasks: [
      { role: "FE", issueType: "Task", summary: "First" },
      { role: "BE", issueType: "Task", summary: "Uncertain" },
      { role: "QA", issueType: "Task", summary: "Third" },
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.partial, true);
  assert.equal(result.createdKey, "EVOSCADA-200");
  assert.deepEqual(attempted, ["First", "Uncertain", "Third"]);
  assert.deepEqual(Array.from(result.createdChildren, child => child.key), ["EVOSCADA-301", "EVOSCADA-303"]);
  assert.deepEqual(Array.from(result.createdChildren, child => child.linkedToParent), [false, false]);
  assert.match(result.createdChildren[0].linkError, /link denied/);
  assert.match(result.errors.join(" "), /link denied/);
  assert.match(result.errors.join(" "), /timeout/);
});

test("createAdditionalTasks reports full failure when no child key is known", async function () {
  const creator = loadCreator();
  let attempts = 0;
  const result = await creator.createAdditionalTasks({
    createIssue() { attempts++; return Promise.reject(new Error("timeout")); },
  }, { jiraKey: "EVOSCADA-200", summary: "Parent" }, {
    projectKey: "EVOSCADA", childTasks: [{ role: "FE", issueType: "Task", summary: "Work" }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.partial, false);
  assert.equal(result.createdKey, "EVOSCADA-200");
  assert.equal(result.createdChildren.length, 0);
  assert.equal(attempts, 1);
});

test("createAdditionalTasks retains earlier child keys when a later create throws synchronously", async function () {
  const creator = loadCreator();
  const attempts = [];
  const result = await creator.createAdditionalTasks({
    createIssue(payload) {
      attempts.push(payload.fields.summary);
      if (payload.fields.summary === "Second") throw new Error("sync create failure");
      return { key: "EVOSCADA-" + (300 + attempts.length) };
    },
    createIssueLink() { return {}; },
  }, { jiraKey: "EVOSCADA-200", summary: "Parent" }, {
    projectKey: "EVOSCADA",
    childTasks: [
      { role: "FE", issueType: "Task", summary: "First" },
      { role: "BE", issueType: "Task", summary: "Second" },
      { role: "QA", issueType: "Task", summary: "Third" },
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.partial, true);
  assert.equal(result.createdKey, "EVOSCADA-200");
  assert.deepEqual(attempts, ["First", "Second", "Third"]);
  assert.deepEqual(Array.from(result.createdChildren, child => [child.key, child.linkedToParent]), [
    ["EVOSCADA-301", true], ["EVOSCADA-303", true],
  ]);
  assert.match(result.errors.join(" "), /sync create failure/);
});

test("createAdditionalTasks reports parent link failure on child after synchronous throw", async function () {
  const creator = loadCreator();
  const attempts = [];
  const result = await creator.createAdditionalTasks({
    createIssue(payload) {
      attempts.push(payload.fields.summary);
      return { key: "EVOSCADA-" + (300 + attempts.length) };
    },
    createIssueLink(payload) {
      if (payload.inwardIssue.key === "EVOSCADA-301") throw new Error("sync link failure");
      return {};
    },
  }, { jiraKey: "EVOSCADA-200", summary: "Parent" }, {
    projectKey: "EVOSCADA",
    childTasks: [
      { role: "FE", issueType: "Task", summary: "First" },
      { role: "BE", issueType: "Task", summary: "Second" },
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.partial, true);
  assert.deepEqual(attempts, ["First", "Second"]);
  assert.deepEqual(Array.from(result.createdChildren, child => child.key), ["EVOSCADA-301", "EVOSCADA-302"]);
  assert.equal(result.createdChildren[0].linkedToParent, false);
  assert.match(result.createdChildren[0].linkError, /sync link failure/);
  assert.equal(result.createdChildren[1].linkedToParent, true);
  assert.equal(result.createdChildren[1].linkError, undefined);
  assert.match(result.errors.join(" "), /sync link failure/);
});

test("createAdditionalTasks links new QA to safely known non-QA children only", async function () {
  const creator = loadCreator();
  const links = [];
  const result = await creator.createAdditionalTasks({
    createIssue() { return Promise.resolve({ key: "EVOSCADA-400" }); },
    createIssueLink(payload) { links.push(payload); return Promise.resolve({}); },
  }, {
    jiraKey: "EVOSCADA-200", summary: "Parent",
    createdChildren: [
      { key: "EVOSCADA-201", role: "FE" },
      { key: "EVOSCADA-202", role: "QA" },
      { key: "", role: "BE" },
    ],
    childStatuses: [
      { key: "EVOSCADA-203", role: "BE" },
      { key: "EVOSCADA-204", role: "QA" },
      { key: "EVOSCADA-205", role: "" },
    ],
  }, { projectKey: "EVOSCADA", childTasks: [{ role: "QA", issueType: "Task", summary: "Another QA" }] });

  assert.equal(result.ok, true);
  assert.deepEqual(links.map(link => [link.type.name, link.outwardIssue.key, link.inwardIssue.key]), [
    ["Child", "EVOSCADA-200", "EVOSCADA-400"],
    ["Blocks", "EVOSCADA-400", "EVOSCADA-201"],
    ["Blocks", "EVOSCADA-400", "EVOSCADA-203"],
  ]);
  assert.deepEqual(Array.from(result.createdChildren, child => child.key), ["EVOSCADA-400"]);
});

test("createAdditionalTasks ignores synced children from a different parent key", async function () {
  const creator = loadCreator();
  const links = [];
  const result = await creator.createAdditionalTasks({
    createIssue() { return Promise.resolve({ key: "EVOSCADA-400" }); },
    createIssueLink(payload) { links.push(payload); return Promise.resolve({}); },
  }, {
    createdKey: "EVOSCADA-200", jiraKey: "EVOSCADA-100", summary: "Parent",
    childStatuses: [{ key: "EVOSCADA-101", role: "BE" }],
  }, { projectKey: "EVOSCADA", childTasks: [{ role: "QA", issueType: "Task", summary: "New QA" }] });

  assert.equal(result.ok, true);
  assert.deepEqual(links.map(link => link.type.name), ["Child"]);
});

test("createAdditionalTasks excludes explicitly orphaned prior children from new QA blockers", async function () {
  const creator = loadCreator();
  const links = [];
  const result = await creator.createAdditionalTasks({
    createIssue() { return { key: "EVOSCADA-400" }; },
    createIssueLink(payload) { links.push(payload); return {}; },
  }, {
    jiraKey: "EVOSCADA-200", summary: "Parent",
    createdChildren: [
      { key: "EVOSCADA-201", role: "FE", linkedToParent: false },
      { key: "EVOSCADA-202", role: "BE", linkedToParent: true },
      { key: "EVOSCADA-203", role: "SE" },
    ],
  }, { projectKey: "EVOSCADA", childTasks: [{ role: "QA", issueType: "Task", summary: "New QA" }] });

  assert.equal(result.ok, true);
  assert.deepEqual(links.filter(link => link.type.name === "Blocks").map(link => link.inwardIssue.key), [
    "EVOSCADA-202", "EVOSCADA-203",
  ]);
});

test("createAdditionalTasks excludes newly created children whose parent link failed from QA blockers", async function () {
  const creator = loadCreator();
  const links = [];
  let creates = 0;
  const result = await creator.createAdditionalTasks({
    createIssue() { creates++; return { key: "EVOSCADA-" + (300 + creates) }; },
    createIssueLink(payload) {
      links.push(payload);
      if (payload.type.name === "Child" && payload.inwardIssue.key === "EVOSCADA-301") {
        return Promise.reject(new Error("parent link denied"));
      }
      return {};
    },
  }, { jiraKey: "EVOSCADA-200", summary: "Parent" }, {
    projectKey: "EVOSCADA",
    childTasks: [
      { role: "FE", issueType: "Task", summary: "New FE" },
      { role: "QA", issueType: "Task", summary: "New QA" },
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.partial, true);
  assert.equal(result.createdChildren[0].linkedToParent, false);
  assert.equal(result.createdChildren[1].linkedToParent, true);
  assert.deepEqual(links.map(link => link.type.name), ["Child", "Child"]);
});

test("createRow returns created child keys on partial failure and skips createdKey rows", async function () {
  const creator = loadCreator();
  let writes = 0;
  const api = {
    createIssue() { writes++; return Promise.resolve({ key: "EVOSCADA-" + writes }); },
    createIssueLink() { return Promise.reject(new Error("link denied")); },
  };
  const result = await creator.createRow(api, { summary: "New Story" }, {
    projectKey: "EVOSCADA", createSubtasks: true,
    childTasks: [{ role: "FE", issueType: "Task", summary: "FE work" }],
  });
  const skipped = await creator.createRow(api, { createdKey: "EVOSCADA-1", summary: "Existing Story" }, {
    projectKey: "EVOSCADA", createSubtasks: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.partial, true);
  assert.equal(result.createdKey, "EVOSCADA-1");
  assert.deepEqual(Array.from(result.createdChildren, child => child.key), ["EVOSCADA-2"]);
  assert.equal(result.createdChildren[0].linkedToParent, false);
  assert.match(result.createdChildren[0].linkError, /link denied/);
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.createdKey, "EVOSCADA-1");
  assert.equal(writes, 2);
});

test("an unlinked new QA task does not receive blocker links", async function () {
  const creator = loadCreator();
  const links = [];
  let creates = 0;
  const result = await creator.createAdditionalTasks({
    createIssue() { return { key: "EVOSCADA-" + (++creates + 300) }; },
    createIssueLink(payload) {
      links.push(payload);
      if (payload.type.name === "Child" && payload.inwardIssue.key === "EVOSCADA-302") return Promise.reject(new Error("QA parent link denied"));
      return {};
    },
  }, { jiraKey: "EVOSCADA-200", summary: "Parent" }, {
    projectKey: "EVOSCADA", childTasks: [{role:"FE",issueType:"Task"}, {role:"QA",issueType:"Task"}],
  });
  assert.equal(result.partial, true);
  assert.equal(result.createdChildren[0].linkedToParent, true);
  assert.equal(result.createdChildren[1].linkedToParent, false);
  assert.deepEqual(links.map(link => link.type.name), ["Child", "Child"]);
});

test("createRow does not repeat Story creation after an uncertain Jira error", async function () {
  const creator = loadCreator();
  let attempts = 0;
  const result = await creator.createRow({
    createIssue() { attempts++; return Promise.reject(new Error("timeout")); },
  }, { summary: "New Story" }, { projectKey: "EVOSCADA", epicKey: "EVOSCADA-100" });

  assert.equal(result.ok, false);
  assert.equal(attempts, 1);
  assert.match(result.errors.join(" "), /timeout/);
});
