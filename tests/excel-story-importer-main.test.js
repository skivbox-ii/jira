const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const loadAmdModule = require("./helpers/load-amd-module");

const MODULE_DIR = path.join(__dirname, "..", "ujg-excel-story-importer-modules");
const CONFIG = {
  STORY_ISSUE_TYPE: "Story",
  CREATE_TEMPLATE_ROLES: [
    { role: "SE", issueType: "System Engineer", summary: "Анализ и описание функционала" },
    { role: "FE", issueType: "Frontend Task", summary: "Вёрстка / UI" },
    { role: "BE", issueType: "Backend Task", summary: "Реализация логики" },
    { role: "QA", issueType: "QA", summary: "Тестирование" },
    { role: "DevOps", issueType: "DevOps", summary: "Подготовка окружения / деплой" },
  ],
};

function flush() {
  return new Promise(function (resolve) {
    setTimeout(resolve, 0);
  });
}

test("file import surfaces parser exceptions as visible errors", async function () {
  const states = [];
  let callbacks = null;
  const rendering = {
    init: function (_container, services) {
      callbacks = services;
    },
    render: function (state) {
      states.push({
        loading: !!state.loading,
        error: state.error || "",
      });
    },
  };
  const api = {
    baseUrl: "https://jira.example.com",
    getProjects: function () {
      return Promise.resolve([]);
    },
  };
  const excelLoader = {
    readWorkbook: function () {
      return Promise.resolve({ SheetNames: [] });
    },
  };
  const parser = {
    parseWorkbook: function () {
      throw new Error("bad workbook");
    },
  };
  const Gadget = loadAmdModule(path.join(MODULE_DIR, "main.js"), {
    jquery: function () {
      return { length: 0 };
    },
    "_ujgESI_config": CONFIG,
    "_ujgESI_api": api,
    "_ujgESI_excel-loader": excelLoader,
    "_ujgESI_parser": parser,
    "_ujgESI_creator": {},
    "_ujgESI_rendering": rendering,
  });

  new Gadget({
    getGadgetContentEl: function () {
      return {
        find: function () {
          return { length: 1 };
        },
      };
    },
    resize: function () {},
  });
  await flush();

  callbacks.onFileChange({ name: "bad.xlsx" });
  await flush();
  await flush();

  const last = states[states.length - 1];
  assert.equal(last.loading, false);
  assert.match(last.error, /Не удалось прочитать Excel: bad workbook/);
});

test("row create opens confirmation before creating without Epic", async function () {
  const states = [];
  let callbacks = null;
  let creatorOptions = null;
  const rendering = {
    init: function (_container, services) {
      callbacks = services;
    },
    render: function (state) {
      states.push({
        projectKey: state.projectKey || "",
        epicKey: state.epicKey || "",
        error: state.error || "",
        createDialog: state.createDialog
          ? {
              rowIndex: state.createDialog.rowIndex,
              summary: state.createDialog.summary,
              epicText: state.createDialog.epicText,
              assigneeId: state.createDialog.assigneeId || "",
              assigneeLabel: state.createDialog.assigneeLabel || "",
              userPicker: state.userPicker
                ? {
                    target: state.userPicker.target || "",
                    query: state.userPicker.query || "",
                    loading: !!state.userPicker.loading,
                    rows: (state.userPicker.rows || []).map(function (user) {
                      return user.id + ":" + user.label;
                    }),
                  }
                : null,
              originalEstimate: state.createDialog.originalEstimate || "",
              remainingEstimate: state.createDialog.remainingEstimate || "",
              sourceRows: state.createDialog.sourceRows.map(function (row) {
                return row.name + ":" + row.value;
              }),
              childTasks: state.createDialog.childTasks.map(function (task) {
                return task.role + ":" + task.issueType + ":" + task.summary + ":" + task.enabled + ":" + (task.assigneeId || "") + ":" + (task.assigneeLabel || "");
              }),
            }
          : null,
        rows: (state.rows || []).map(function (row) {
          return { status: row.status, createdKey: row.createdKey || "" };
        }),
      });
    },
  };
  const userResponses = {
    story: [{ name: "story-user", displayName: "Story User", accountId: "story-acc" }],
    se: [{ name: "se-user", displayName: "SE User" }],
  };
  const userSearchCalls = [];
  const api = {
    baseUrl: "https://jira.example.com",
    getProjects: function () {
      return Promise.resolve([{ key: "EVOSCADA" }]);
    },
    getProjectEpics: function () {
      return Promise.resolve([]);
    },
    searchUsers: function (query) {
      userSearchCalls.push(query);
      return Promise.resolve({
        users: userResponses[query] || [],
      });
    },
  };
  const excelLoader = {
    readWorkbook: function () {
      return Promise.resolve({ SheetNames: ["Лист1"] });
    },
  };
  const parser = {
    parseWorkbook: function () {
      return {
        sheetName: "Лист1",
        headerRowNumber: 0,
        rows: [
          {
            summary: "Test jira task",
            sourceColumns: { "Замечание": "Test jira task" },
            status: "ready",
            errors: [],
          },
        ],
      };
    },
  };
  const creator = {
    createRow: function (_api, _row, options) {
      creatorOptions = options;
      return Promise.resolve({ ok: true, createdKey: "EVOSCADA-1", errors: [] });
    },
  };
  const Gadget = loadAmdModule(path.join(MODULE_DIR, "main.js"), {
    jquery: function () {
      return { length: 0 };
    },
    "_ujgESI_config": CONFIG,
    "_ujgESI_api": api,
    "_ujgESI_excel-loader": excelLoader,
    "_ujgESI_parser": parser,
    "_ujgESI_creator": creator,
    "_ujgESI_rendering": rendering,
  });

  new Gadget({
    getGadgetContentEl: function () {
      return {
        find: function () {
          return { length: 1 };
        },
      };
    },
    resize: function () {},
  });
  await flush();

  callbacks.onProjectChange("EVOSCADA");
  await flush();
  callbacks.onFileChange({ name: "rows.xlsx" });
  await flush();
  await flush();
  callbacks.onCreateRow(0);
  await flush();
  await flush();

  assert.equal(creatorOptions, null);
  let last = states[states.length - 1];
  assert.equal(last.error, "");
  assert.equal(last.createDialog.rowIndex, 0);
  assert.equal(last.createDialog.summary, "Test jira task");
  assert.equal(last.createDialog.epicText, "Без Epic");
  assert.deepEqual(last.createDialog.childTasks, [
    "SE:System Engineer:[SE] Test jira task:true::",
    "FE:Frontend Task:[FE] Test jira task:true::",
    "BE:Backend Task:[BE] Test jira task:true::",
    "QA:QA:[QA] Test jira task:true::",
    "DevOps:DevOps:[DevOps] Test jira task:true::",
  ]);
  assert.equal(last.rows[0].status, "ready");

  callbacks.onDialogFieldChange("summary", "Edited story");
  callbacks.onDialogAssigneeSearch("story", "story");
  await flush();
  await flush();
  last = states[states.length - 1];
  assert.deepEqual(userSearchCalls, ["story"]);
  assert.equal(last.createDialog.userPicker.target, "story");
  assert.equal(last.createDialog.userPicker.query, "story");
  assert.deepEqual(last.createDialog.userPicker.rows, ["story-acc:Story User"]);
  callbacks.onDialogAssigneeSelect("story", "story-acc");
  callbacks.onDialogFieldChange("originalEstimate", "2h");
  callbacks.onDialogFieldChange("remainingEstimate", "1h");
  callbacks.onDialogSourceChange(0, "Edited story from modal");
  callbacks.onDialogChildToggle(1, false);
  callbacks.onDialogChildChange(0, "summary", "[SE] Edited story");
  callbacks.onDialogAssigneeSearch("child-0", "se");
  await flush();
  await flush();
  callbacks.onDialogAssigneeSelect("child-0", "se-user");
  callbacks.onDialogChildChange(0, "originalEstimate", "4h");
  callbacks.onDialogChildChange(0, "remainingEstimate", "4h");
  await flush();

  callbacks.onConfirmCreate();
  await flush();
  await flush();

  assert.equal(creatorOptions.projectKey, "EVOSCADA");
  assert.equal(creatorOptions.epicKey, "");
  assert.equal(creatorOptions.createSubtasks, true);
  assert.equal(creatorOptions.summary, "Edited story");
  assert.equal(creatorOptions.assignee.accountId, "story-acc");
  assert.equal(creatorOptions.originalEstimate, "2h");
  assert.equal(creatorOptions.remainingEstimate, "1h");
  assert.equal(creatorOptions.sourceRows[0].value, "Edited story from modal");
  assert.equal(creatorOptions.childTasks[0].summary, "[SE] Edited story");
  assert.equal(creatorOptions.childTasks[0].assignee.name, "se-user");
  assert.equal(creatorOptions.childTasks[0].originalEstimate, "4h");
  assert.equal(creatorOptions.childTasks[0].remainingEstimate, "4h");
  assert.equal(creatorOptions.childTasks[1].enabled, false);
  last = states[states.length - 1];
  assert.equal(last.error, "");
  assert.equal(last.createDialog, null);
  assert.equal(last.rows[0].status, "created");
  assert.equal(last.rows[0].createdKey, "EVOSCADA-1");
});
