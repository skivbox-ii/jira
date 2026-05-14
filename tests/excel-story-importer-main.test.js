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
    "_ujgESI_mappingStore": null,
    "_ujgESI_xlsxPatcher": null,
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
        syncLoading: !!state.syncLoading,
        syncError: state.syncError || "",
        syncSummary: state.syncSummary || "",
        exportReady: !!state.exportBuffer,
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
              epicLinkAllowed: state.createDialog.epicLinkAllowed,
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
    getProjectCreateMeta: function () {
      return Promise.resolve({
        projects: [
          {
            key: "EVOSCADA",
            issuetypes: [
              {
                name: "Story",
                fields: {
                  summary: {},
                },
              },
            ],
          },
        ],
      });
    },
    searchUsers: function (query) {
      userSearchCalls.push(query);
      return Promise.resolve({
        users: userResponses[query] || [],
      });
    },
    getIssuesByKeys: function () {
      return Promise.resolve({ issues: [] });
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
  const xlsxPatcher = {
    patchWorkbook: function () {
      return Promise.resolve(new ArrayBuffer(1));
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
    "_ujgESI_mappingStore": null,
    "_ujgESI_xlsxPatcher": xlsxPatcher,
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
  assert.equal(last.createDialog.epicLinkAllowed, false);
  assert.deepEqual(last.createDialog.childTasks, [
    "SE:System Engineer:[SE] Test jira task:true::",
    "FE:Frontend Task:[FE] Test jira task:true::",
    "BE:Backend Task:[BE] Test jira task:true::",
    "QA:QA:[QA] Test jira task:true::",
    "DevOps:DevOps:[DevOps] Test jira task:true::",
  ]);
  assert.equal(last.rows[0].status, "ready");

  const rendersBeforeTextEdit = states.length;
  callbacks.onDialogFieldChange("summary", "Edited story");
  assert.equal(states.length, rendersBeforeTextEdit);
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
  const rendersBeforeInlineEdits = states.length;
  callbacks.onDialogSourceChange(0, "Edited story from modal");
  assert.equal(states.length, rendersBeforeInlineEdits);
  callbacks.onDialogChildToggle(1, false);
  callbacks.onDialogChildChange(0, "summary", "[SE] Edited story");
  assert.equal(states.length, rendersBeforeInlineEdits + 1);
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
  assert.equal(creatorOptions.epicLinkAllowed, false);
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

test("sync from Jira updates parsed rows and prepares patched Excel for download", async function () {
  const states = [];
  let callbacks = null;
  const issueKeyCalls = [];
  let patchArgs = null;
  const sourceBuffer = new ArrayBuffer(12);
  const patchedBuffer = new ArrayBuffer(8);
  const rendering = {
    init: function (_container, services) {
      callbacks = services;
    },
    render: function (state) {
      states.push({
        syncLoading: !!state.syncLoading,
        syncError: state.syncError || "",
        syncSummary: state.syncSummary || "",
        exportReady: !!state.exportBuffer,
        exportFileName: state.exportFileName || "",
        rows: (state.rows || []).map(function (row) {
          return {
            jiraKey: row.jiraKey || "",
            createdKey: row.createdKey || "",
            statusInJira: row.sourceColumns && row.sourceColumns["Статус в Jira"] || "",
            assigneeInJira: row.sourceColumns && row.sourceColumns["Исполнитель в Jira"] || "",
            sprintInJira: row.sourceColumns && row.sourceColumns["Спринт"] || "",
            statusTitle: row.statusTitle || "",
          };
        }),
      });
    },
  };
  const api = {
    baseUrl: "https://jira.example.com",
    getProjects: function () {
      return Promise.resolve([]);
    },
    getIssuesByKeys: function (keys) {
      issueKeyCalls.push(keys.slice());
      if (keys[0] !== "EVOSCADA-10") {
        return Promise.resolve({
          issues: [
            {
              key: "EVOSCADA-11",
              fields: {
                summary: "[SE] Existing",
                status: { name: "Done" },
                assignee: { displayName: "Сергей" },
              },
            },
            {
              key: "EVOSCADA-12",
              fields: {
                summary: "[QA] Existing",
                status: { name: "Testing" },
                assignee: { displayName: "Ольга" },
              },
            },
          ],
        });
      }
      return Promise.resolve({
        issues: [
          {
            key: "EVOSCADA-10",
            fields: {
              status: { name: "In Review" },
              assignee: { displayName: "Иван Иванов" },
              customfield_10020: [{ name: "Sprint 42" }],
              issuelinks: [
                {
                  type: { name: "Child", inward: "child" },
                  inwardIssue: {
                    key: "EVOSCADA-11",
                    fields: {
                      summary: "[SE] Existing",
                      status: { name: "Done" },
                    },
                  },
                },
                {
                  type: { name: "Child", inward: "child" },
                  inwardIssue: {
                    key: "EVOSCADA-12",
                    fields: {
                      summary: "[QA] Existing",
                      status: { name: "Testing" },
                    },
                  },
                },
              ],
            },
          },
        ],
        ujgSprintField: "customfield_10020",
      });
    },
  };
  const excelLoader = {
    readFileBuffer: function () {
      return Promise.resolve(sourceBuffer);
    },
    readWorkbookFromBuffer: function () {
      return Promise.resolve({ SheetNames: ["Журнал"] });
    },
  };
  const parser = {
    parseWorkbook: function () {
      return {
        sheetName: "Журнал",
        headerRowNumber: 9,
        headerColumns: {
          Jira: 11,
          "Статус в Jira": 15,
          "Исполнитель в Jira": 16,
          "Спринт": 17,
        },
        rows: [
          {
            excelRowNumber: 12,
            summary: "Existing",
            jiraKey: "EVOSCADA-10",
            sourceColumns: { Замечание: "Existing", Jira: "EVOSCADA-10" },
            sourceColumnIndexes: { Jira: 11 },
            alreadyLinked: true,
            status: "linked",
            errors: [],
          },
        ],
      };
    },
  };
  const xlsxPatcher = {
    patchWorkbook: function (buffer, patch) {
      patchArgs = { buffer, patch };
      return Promise.resolve(patchedBuffer);
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
    "_ujgESI_mappingStore": null,
    "_ujgESI_xlsxPatcher": xlsxPatcher,
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

  callbacks.onFileChange({ name: "test.xlsx" });
  await flush();
  await flush();
  callbacks.onSyncJira();
  await flush();
  await flush();

  assert.deepEqual(issueKeyCalls, [["EVOSCADA-10"], ["EVOSCADA-11", "EVOSCADA-12"]]);
  assert.equal(patchArgs.buffer, sourceBuffer);
  assert.equal(patchArgs.patch.sheetName, "Журнал");
  assert.equal(patchArgs.patch.headerRowNumber, 9);
  assert.equal(patchArgs.patch.rows[0].excelRowNumber, 12);
  assert.equal(Object.prototype.hasOwnProperty.call(patchArgs.patch.rows[0].values, "Jira"), false);
  assert.equal(patchArgs.patch.rows[0].values["Статус в Jira"], "In Review");
  assert.equal(patchArgs.patch.rows[0].values["Исполнитель в Jira"], "Иван Иванов");
  assert.equal(patchArgs.patch.rows[0].values["Спринт"], "Sprint 42");
  assert.equal(patchArgs.patch.rows[0].comments["Статус в Jira"], "[SE] Existing | Done | Сергей\n[QA] Existing | Testing | Ольга");
  assert.deepEqual(patchArgs.patch.headerColumns, {
    Jira: 11,
    "Статус в Jira": 15,
    "Исполнитель в Jira": 16,
    "Спринт": 17,
  });

  const last = states[states.length - 1];
  assert.equal(last.syncError, "");
  assert.equal(last.syncSummary, "Синхронизировано 1 тикет");
  assert.equal(last.exportReady, true);
  assert.equal(last.exportFileName, "test.synced.xlsx");
  assert.equal(last.rows[0].statusInJira, "In Review");
  assert.equal(last.rows[0].assigneeInJira, "Иван Иванов");
  assert.equal(last.rows[0].sprintInJira, "Sprint 42");
  assert.equal(last.rows[0].statusTitle, "[SE] Existing | Done | Сергей\n[QA] Existing | Testing | Ольга");
});

test("sync from Jira does not blank existing sprint when issue has no sprint field", async function () {
  const states = [];
  let callbacks = null;
  let patchArgs = null;
  const rendering = {
    init: function (_container, services) {
      callbacks = services;
    },
    render: function (state) {
      states.push({
        rows: (state.rows || []).map(function (row) {
          return {
            sprintInJira: row.sourceColumns && row.sourceColumns["Спринт"] || "",
          };
        }),
      });
    },
  };
  const api = {
    baseUrl: "https://jira.example.com",
    getProjects: function () {
      return Promise.resolve([]);
    },
    getIssuesByKeys: function () {
      return Promise.resolve({
        issues: [
          {
            key: "EVOSCADA-10",
            fields: {
              status: { name: "In Review" },
              assignee: { displayName: "Иван Иванов" },
            },
          },
        ],
      });
    },
  };
  const excelLoader = {
    readFileBuffer: function () {
      return Promise.resolve(new ArrayBuffer(12));
    },
    readWorkbookFromBuffer: function () {
      return Promise.resolve({ SheetNames: ["Журнал"] });
    },
  };
  const parser = {
    parseWorkbook: function () {
      return {
        sheetName: "Журнал",
        headerRowNumber: 1,
        headerColumns: {
          Jira: 16,
          "Статус в Jira": 13,
          "Исполнитель в Jira": 15,
          "Спринт": 22,
        },
        rows: [
          {
            excelRowNumber: 792,
            summary: "Existing",
            jiraKey: "EVOSCADA-10",
            sourceColumns: {
              Замечание: "Existing",
              Jira: "EVOSCADA-10",
              "Спринт": "18.05-01.06",
            },
            sourceColumnIndexes: { Jira: 16, "Спринт": 22 },
            alreadyLinked: true,
            status: "linked",
            errors: [],
          },
        ],
      };
    },
  };
  const xlsxPatcher = {
    patchWorkbook: function (_buffer, patch) {
      patchArgs = patch;
      return Promise.resolve(new ArrayBuffer(8));
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
    "_ujgESI_mappingStore": null,
    "_ujgESI_xlsxPatcher": xlsxPatcher,
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

  callbacks.onFileChange({ name: "test.xlsx" });
  await flush();
  await flush();
  callbacks.onSyncJira();
  await flush();
  await flush();

  assert.equal(states[states.length - 1].rows[0].sprintInJira, "18.05-01.06");
  assert.equal(Object.prototype.hasOwnProperty.call(patchArgs.rows[0].values, "Спринт"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(patchArgs.rows[0].values, "Jira"), false);
});

test("sync from Jira tries to find missing Jira key by summary in selected project", async function () {
  const states = [];
  let callbacks = null;
  const searchCalls = [];
  const issueKeyCalls = [];
  let patchArgs = null;
  const rendering = {
    init: function (_container, services) {
      callbacks = services;
    },
    render: function (state) {
      states.push({
        syncError: state.syncError || "",
        syncSummary: state.syncSummary || "",
        rows: (state.rows || []).map(function (row) {
          return {
            jira: row.sourceColumns && row.sourceColumns.Jira || "",
            statusInJira: row.sourceColumns && row.sourceColumns["Статус в Jira"] || "",
          };
        }),
      });
    },
  };
  const api = {
    baseUrl: "https://jira.example.com",
    getProjects: function () {
      return Promise.resolve([{ key: "EVOSCADA" }]);
    },
    getProjectEpics: function () {
      return Promise.resolve([]);
    },
    searchIssueBySummary: function (projectKey, summary) {
      searchCalls.push([projectKey, summary]);
      return Promise.resolve({
        issues: [
          {
            key: "EVOSCADA-77",
            fields: {
              summary: "Test jira task",
            },
          },
        ],
      });
    },
    getIssuesByKeys: function (keys) {
      issueKeyCalls.push(keys.slice());
      return Promise.resolve({
        issues: [
          {
            key: "EVOSCADA-77",
            fields: {
              status: { name: "In Progress" },
              assignee: { displayName: "Иван" },
            },
          },
        ],
      });
    },
  };
  const excelLoader = {
    readFileBuffer: function () {
      return Promise.resolve(new ArrayBuffer(12));
    },
    readWorkbookFromBuffer: function () {
      return Promise.resolve({ SheetNames: ["Журнал"] });
    },
  };
  const parser = {
    parseWorkbook: function () {
      return {
        sheetName: "Журнал",
        headerRowNumber: 1,
        headerColumns: {
          Jira: 11,
          "Статус в Jira": 15,
        },
        rows: [
          {
            excelRowNumber: 3,
            summary: "Test jira task",
            jiraKey: "",
            sourceColumns: { Замечание: "Test jira task", Jira: "" },
            sourceColumnIndexes: { Jira: 11 },
            alreadyLinked: false,
            status: "ready",
            errors: [],
          },
        ],
      };
    },
  };
  const xlsxPatcher = {
    patchWorkbook: function (_buffer, patch) {
      patchArgs = patch;
      return Promise.resolve(new ArrayBuffer(8));
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
    "_ujgESI_mappingStore": null,
    "_ujgESI_xlsxPatcher": xlsxPatcher,
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
  callbacks.onFileChange({ name: "test.xlsx" });
  await flush();
  await flush();

  callbacks.onSyncJira();
  await flush();
  await flush();
  await flush();

  assert.equal(searchCalls.length, 1);
  assert.equal(searchCalls[0][0], "EVOSCADA");
  assert.equal(searchCalls[0][1], "Test jira task");
  assert.deepEqual(issueKeyCalls, [["EVOSCADA-77"]]);
  assert.equal(patchArgs.rows[0].values.Jira, "EVOSCADA-77");
  assert.equal(patchArgs.rows[0].values["Статус в Jira"], "In Progress");
  assert.equal(patchArgs.rows[0].values["Исполнитель в Jira"], "Иван");
  const last = states[states.length - 1];
  assert.equal(last.syncError, "");
  assert.equal(last.syncSummary, "Синхронизировано 1 тикет");
  assert.equal(last.rows[0].jira, "EVOSCADA-77");
});

test("sync from Jira finds missing key by summary using project inferred from existing Jira keys", async function () {
  let callbacks = null;
  const searchCalls = [];
  const issueKeyCalls = [];
  let patchArgs = null;
  const rendering = {
    init: function (_container, services) {
      callbacks = services;
    },
    render: function () {},
  };
  const api = {
    baseUrl: "https://jira.example.com",
    getProjects: function () {
      return Promise.resolve([{ key: "EVOSCADA" }]);
    },
    searchIssueBySummary: function (projectKey, summary) {
      searchCalls.push([projectKey, summary]);
      return Promise.resolve({
        issues: [
          {
            key: "EVOSCADA-18440",
            fields: {
              summary: "Присутствует возможность вывода в ремонт объектов, которые не должны выводиться",
              issuetype: { name: "История" },
            },
          },
        ],
      });
    },
    getIssuesByKeys: function (keys) {
      issueKeyCalls.push(keys.slice());
      return Promise.resolve({
        issues: keys.map(function (key) {
          return {
            key: key,
            fields: {
              status: { name: "Выдано" },
              assignee: null,
            },
          };
        }),
      });
    },
  };
  const excelLoader = {
    readFileBuffer: function () {
      return Promise.resolve(new ArrayBuffer(12));
    },
    readWorkbookFromBuffer: function () {
      return Promise.resolve({ SheetNames: ["Замечания"] });
    },
  };
  const parser = {
    extractJiraKey: function (value) {
      const match = String(value || "").match(/[A-Z][A-Z0-9_]+-\d+/);
      return match ? match[0] : "";
    },
    parseWorkbook: function () {
      return {
        sheetName: "Замечания",
        headerRowNumber: 1,
        headerColumns: {
          Jira: 16,
          "Статус в Jira": 13,
        },
        rows: [
          {
            excelRowNumber: 792,
            summary: "Присутствует возможность вывода в ремонт объектов, которые не должны выводиться в ремонт",
            jiraKey: "",
            sourceColumns: { Замечание: "Присутствует возможность вывода в ремонт объектов, которые не должны выводиться в ремонт", Jira: "" },
            sourceColumnIndexes: { Jira: 16 },
            alreadyLinked: false,
            status: "ready",
            errors: [],
          },
          {
            excelRowNumber: 822,
            summary: "Реализовать сохранение состояния панели распределения плотности после перезагрузки",
            jiraKey: "EVOSCADA-18116",
            sourceColumns: { Замечание: "Реализовать сохранение состояния панели распределения плотности после перезагрузки", Jira: "EVOSCADA-18116" },
            sourceColumnIndexes: { Jira: 16 },
            alreadyLinked: true,
            status: "linked",
            errors: [],
          },
        ],
      };
    },
  };
  const xlsxPatcher = {
    patchWorkbook: function (_buffer, patch) {
      patchArgs = patch;
      return Promise.resolve(new ArrayBuffer(8));
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
    "_ujgESI_mappingStore": null,
    "_ujgESI_xlsxPatcher": xlsxPatcher,
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
  callbacks.onFileChange({ name: "journal.xlsx" });
  await flush();
  await flush();

  callbacks.onSyncJira();
  await flush();
  await flush();
  await flush();

  assert.equal(searchCalls.length, 1);
  assert.equal(searchCalls[0][0], "EVOSCADA");
  assert.deepEqual(issueKeyCalls[0], ["EVOSCADA-18440", "EVOSCADA-18116"]);
  assert.equal(patchArgs.rows[0].values.Jira, "EVOSCADA-18440");
});

test("sync from Jira picks the story when summary search also returns linked child tasks", async function () {
  let callbacks = null;
  const issueKeyCalls = [];
  let patchArgs = null;
  const rendering = {
    init: function (_container, services) {
      callbacks = services;
    },
    render: function () {},
  };
  const api = {
    baseUrl: "https://jira.example.com",
    getProjects: function () {
      return Promise.resolve([{ key: "EVOSCADA" }]);
    },
    getProjectEpics: function () {
      return Promise.resolve([]);
    },
    searchIssueBySummary: function () {
      return Promise.resolve({
        issues: [
          {
            key: "EVOSCADA-18441",
            fields: {
              summary: "[SE] Присутствует возможность вывода в ремонт объектов, которые не должны выводиться",
              issuetype: { name: "Задача разработки" },
            },
          },
          {
            key: "EVOSCADA-18440",
            fields: {
              summary: "Присутствует возможность вывода в ремонт объектов, которые не должны выводиться",
              issuetype: { name: "История" },
            },
          },
          {
            key: "EVOSCADA-18442",
            fields: {
              summary: "[QA] Присутствует возможность вывода в ремонт объектов, которые не должны выводиться",
              issuetype: { name: "Задача разработки" },
            },
          },
        ],
      });
    },
    getIssuesByKeys: function (keys) {
      issueKeyCalls.push(keys.slice());
      return Promise.resolve({
        issues: [
          {
            key: "EVOSCADA-18440",
            fields: {
              status: { name: "Выдано" },
              assignee: null,
            },
          },
        ],
      });
    },
  };
  const excelLoader = {
    readFileBuffer: function () {
      return Promise.resolve(new ArrayBuffer(12));
    },
    readWorkbookFromBuffer: function () {
      return Promise.resolve({ SheetNames: ["Замечания"] });
    },
  };
  const parser = {
    parseWorkbook: function () {
      return {
        sheetName: "Замечания",
        headerRowNumber: 1,
        headerColumns: {
          Jira: 16,
          "Статус в Jira": 13,
        },
        rows: [
          {
            excelRowNumber: 792,
            summary: "Присутствует возможность вывода в ремонт объектов, которые не должны выводиться в ремонт",
            jiraKey: "",
            sourceColumns: { Замечание: "Присутствует возможность вывода в ремонт объектов, которые не должны выводиться в ремонт", Jira: "" },
            sourceColumnIndexes: { Jira: 16 },
            alreadyLinked: false,
            status: "ready",
            errors: [],
          },
        ],
      };
    },
  };
  const xlsxPatcher = {
    patchWorkbook: function (_buffer, patch) {
      patchArgs = patch;
      return Promise.resolve(new ArrayBuffer(8));
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
    "_ujgESI_mappingStore": null,
    "_ujgESI_xlsxPatcher": xlsxPatcher,
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
  callbacks.onFileChange({ name: "journal.xlsx" });
  await flush();
  await flush();

  callbacks.onSyncJira();
  await flush();
  await flush();
  await flush();

  assert.deepEqual(issueKeyCalls[0], ["EVOSCADA-18440"]);
  assert.equal(patchArgs.rows[0].values.Jira, "EVOSCADA-18440");
});

test("sync from Jira retries shorter summary searches when the long Russian query finds nothing", async function () {
  let callbacks = null;
  const searchCalls = [];
  const issueKeyCalls = [];
  let patchArgs = null;
  const rendering = {
    init: function (_container, services) {
      callbacks = services;
    },
    render: function () {},
  };
  const api = {
    baseUrl: "https://jira.example.com",
    getProjects: function () {
      return Promise.resolve([{ key: "EVOSCADA" }]);
    },
    getProjectEpics: function () {
      return Promise.resolve([]);
    },
    searchIssueBySummary: function (projectKey, summary) {
      searchCalls.push([projectKey, summary]);
      if (searchCalls.length === 1) return Promise.resolve({ issues: [] });
      return Promise.resolve({
        issues: [
          {
            key: "EVOSCADA-18440",
            fields: {
              summary: "Присутствует возможность вывода в ремонт объектов, которые не должны выводиться",
              issuetype: { name: "История" },
            },
          },
        ],
      });
    },
    getIssuesByKeys: function (keys) {
      issueKeyCalls.push(keys.slice());
      return Promise.resolve({
        issues: [
          {
            key: "EVOSCADA-18440",
            fields: {
              status: { name: "Выдано" },
              assignee: null,
            },
          },
        ],
      });
    },
  };
  const excelLoader = {
    readFileBuffer: function () {
      return Promise.resolve(new ArrayBuffer(12));
    },
    readWorkbookFromBuffer: function () {
      return Promise.resolve({ SheetNames: ["Замечания"] });
    },
  };
  const parser = {
    parseWorkbook: function () {
      return {
        sheetName: "Замечания",
        headerRowNumber: 1,
        headerColumns: {
          Jira: 16,
          "Статус в Jira": 13,
        },
        rows: [
          {
            excelRowNumber: 792,
            summary: "Присутствует возможность вывода в ремонт объектов, которые не должны выводиться в ремонт",
            jiraKey: "",
            sourceColumns: { Замечание: "Присутствует возможность вывода в ремонт объектов, которые не должны выводиться в ремонт", Jira: "" },
            sourceColumnIndexes: { Jira: 16 },
            alreadyLinked: false,
            status: "ready",
            errors: [],
          },
        ],
      };
    },
  };
  const xlsxPatcher = {
    patchWorkbook: function (_buffer, patch) {
      patchArgs = patch;
      return Promise.resolve(new ArrayBuffer(8));
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
    "_ujgESI_mappingStore": null,
    "_ujgESI_xlsxPatcher": xlsxPatcher,
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
  callbacks.onFileChange({ name: "journal.xlsx" });
  await flush();
  await flush();

  callbacks.onSyncJira();
  await flush();
  await flush();
  await flush();
  await flush();

  assert.ok(searchCalls.length > 1);
  assert.equal(searchCalls[0][1], "Присутствует возможность вывода ремонт объектов которые должны выводиться");
  assert.equal(searchCalls[1][1], "Присутствует возможность вывода ремонт объектов которые");
  assert.deepEqual(issueKeyCalls[0], ["EVOSCADA-18440"]);
  assert.equal(patchArgs.rows[0].values.Jira, "EVOSCADA-18440");
});

test("sync from Jira picks the closest story when text search returns several stories", async function () {
  let callbacks = null;
  const issueKeyCalls = [];
  let patchArgs = null;
  const rendering = {
    init: function (_container, services) {
      callbacks = services;
    },
    render: function () {},
  };
  const api = {
    baseUrl: "https://jira.example.com",
    getProjects: function () {
      return Promise.resolve([{ key: "EVOSCADA" }]);
    },
    getProjectEpics: function () {
      return Promise.resolve([]);
    },
    searchIssueBySummary: function () {
      return Promise.resolve({
        issues: [
          {
            key: "EVOSCADA-18000",
            fields: {
              summary: "Нерелевантная история про ремонт объектов",
              issuetype: { name: "История" },
            },
          },
          {
            key: "EVOSCADA-18440",
            fields: {
              summary: "Присутствует возможность вывода в ремонт объектов, которые не должны выводиться",
              issuetype: { name: "История" },
            },
          },
        ],
      });
    },
    getIssuesByKeys: function (keys) {
      issueKeyCalls.push(keys.slice());
      return Promise.resolve({
        issues: [
          {
            key: "EVOSCADA-18440",
            fields: {
              status: { name: "Выдано" },
              assignee: null,
            },
          },
        ],
      });
    },
  };
  const excelLoader = {
    readFileBuffer: function () {
      return Promise.resolve(new ArrayBuffer(12));
    },
    readWorkbookFromBuffer: function () {
      return Promise.resolve({ SheetNames: ["Замечания"] });
    },
  };
  const parser = {
    parseWorkbook: function () {
      return {
        sheetName: "Замечания",
        headerRowNumber: 1,
        headerColumns: {
          Jira: 16,
          "Статус в Jira": 13,
        },
        rows: [
          {
            excelRowNumber: 792,
            summary: "Присутствует возможность вывода в ремонт объектов, которые не должны выводиться в ремонт",
            jiraKey: "",
            sourceColumns: { Замечание: "Присутствует возможность вывода в ремонт объектов, которые не должны выводиться в ремонт", Jira: "" },
            sourceColumnIndexes: { Jira: 16 },
            alreadyLinked: false,
            status: "ready",
            errors: [],
          },
        ],
      };
    },
  };
  const xlsxPatcher = {
    patchWorkbook: function (_buffer, patch) {
      patchArgs = patch;
      return Promise.resolve(new ArrayBuffer(8));
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
    "_ujgESI_mappingStore": null,
    "_ujgESI_xlsxPatcher": xlsxPatcher,
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
  callbacks.onFileChange({ name: "journal.xlsx" });
  await flush();
  await flush();

  callbacks.onSyncJira();
  await flush();
  await flush();
  await flush();

  assert.deepEqual(issueKeyCalls[0], ["EVOSCADA-18440"]);
  assert.equal(patchArgs.rows[0].values.Jira, "EVOSCADA-18440");
});

test("sync from Jira prefers exact remark text found in issue description over summary similarity", async function () {
  let callbacks = null;
  const issueKeyCalls = [];
  let patchArgs = null;
  const remark = "Присутствует возможность вывода в ремонт объектов, которые не должны выводиться в ремонт (колодцы, КППСОД, емкости и т.п.). При этом объект раскрашивается коричневым цветом";
  const rendering = {
    init: function (_container, services) {
      callbacks = services;
    },
    render: function () {},
  };
  const api = {
    baseUrl: "https://jira.example.com",
    getProjects: function () {
      return Promise.resolve([{ key: "EVOSCADA" }]);
    },
    getProjectEpics: function () {
      return Promise.resolve([]);
    },
    searchIssueBySummary: function () {
      return Promise.resolve({
        issues: [
          {
            key: "EVOSCADA-18000",
            fields: {
              summary: "Присутствует возможность вывода в ремонт объектов, которые не должны выводиться",
              description: "Импортировано из журнала замечаний.\n\n||Поле||Значение||\n|Замечание|Похожее замечание про ремонт объектов|",
              issuetype: { name: "История" },
            },
          },
          {
            key: "EVOSCADA-18440",
            fields: {
              summary: "Укороченный заголовок",
              description: "Импортировано из журнала замечаний.\n\n||Поле||Значение||\n|Замечание|" + remark + "|",
              issuetype: { name: "История" },
            },
          },
        ],
      });
    },
    getIssuesByKeys: function (keys) {
      issueKeyCalls.push(keys.slice());
      return Promise.resolve({
        issues: [
          {
            key: "EVOSCADA-18440",
            fields: {
              status: { name: "Выдано" },
              assignee: null,
            },
          },
        ],
      });
    },
  };
  const excelLoader = {
    readFileBuffer: function () {
      return Promise.resolve(new ArrayBuffer(12));
    },
    readWorkbookFromBuffer: function () {
      return Promise.resolve({ SheetNames: ["Замечания"] });
    },
  };
  const parser = {
    parseWorkbook: function () {
      return {
        sheetName: "Замечания",
        headerRowNumber: 1,
        headerColumns: {
          Jira: 16,
          "Статус в Jira": 13,
        },
        rows: [
          {
            excelRowNumber: 792,
            summary: remark,
            jiraKey: "",
            sourceColumns: { Замечание: remark, Jira: "" },
            sourceColumnIndexes: { Jira: 16 },
            alreadyLinked: false,
            status: "ready",
            errors: [],
          },
        ],
      };
    },
  };
  const xlsxPatcher = {
    patchWorkbook: function (_buffer, patch) {
      patchArgs = patch;
      return Promise.resolve(new ArrayBuffer(8));
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
    "_ujgESI_mappingStore": null,
    "_ujgESI_xlsxPatcher": xlsxPatcher,
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
  callbacks.onFileChange({ name: "journal.xlsx" });
  await flush();
  await flush();

  callbacks.onSyncJira();
  await flush();
  await flush();
  await flush();

  assert.deepEqual(issueKeyCalls[0], ["EVOSCADA-18440"]);
  assert.equal(patchArgs.rows[0].values.Jira, "EVOSCADA-18440");
});

test("column mapping changes reparse the loaded workbook before Jira sync export", async function () {
  const states = [];
  let callbacks = null;
  let patchArgs = null;
  const parserOptions = [];
  const rendering = {
    init: function (_container, services) {
      callbacks = services;
    },
    render: function (state) {
      states.push({
        rows: (state.rows || []).map(function (row) {
          return {
            statusInJira: row.sourceColumns && row.sourceColumns["Статус в Jira"] || "",
          };
        }),
      });
    },
  };
  const api = {
    baseUrl: "https://jira.example.com",
    getProjects: function () {
      return Promise.resolve([]);
    },
    getIssuesByKeys: function () {
      return Promise.resolve({
        issues: [
          {
            key: "EVOSCADA-10",
            fields: {
              status: { name: "Done" },
              assignee: null,
            },
          },
        ],
      });
    },
  };
  const excelLoader = {
    readFileBuffer: function () {
      return Promise.resolve(new ArrayBuffer(12));
    },
    readWorkbookFromBuffer: function () {
      return Promise.resolve({ SheetNames: ["Журнал"] });
    },
  };
  const parser = {
    parseWorkbook: function (_workbook, options) {
      parserOptions.push(JSON.parse(JSON.stringify(options || {})));
      return {
        sheetName: "Журнал",
        headerRowNumber: 1,
        headerColumns: {
          Jira: 16,
          "Статус в Jira": options.columnMap.statusInJira === "Статус исполнителя" ? 13 : 15,
        },
        rows: [
          {
            excelRowNumber: 792,
            summary: "Existing",
            jiraKey: "EVOSCADA-10",
            sourceColumns: { Замечание: "Existing", Jira: "EVOSCADA-10" },
            sourceColumnIndexes: { Jira: 16 },
            alreadyLinked: true,
            status: "linked",
            errors: [],
          },
        ],
      };
    },
  };
  const xlsxPatcher = {
    patchWorkbook: function (_buffer, patch) {
      patchArgs = patch;
      return Promise.resolve(new ArrayBuffer(8));
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
    "_ujgESI_mappingStore": null,
    "_ujgESI_xlsxPatcher": xlsxPatcher,
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

  callbacks.onFileChange({ name: "test.xlsx" });
  await flush();
  await flush();
  callbacks.onMappingColumnChange("statusInJira", "Статус исполнителя");
  await flush();
  callbacks.onSyncJira();
  await flush();
  await flush();

  assert.equal(parserOptions.length >= 2, true);
  assert.equal(parserOptions[parserOptions.length - 1].columnMap.statusInJira, "Статус исполнителя");
  assert.equal(patchArgs.headerColumns["Статус в Jira"], 13);
  assert.equal(patchArgs.rows[0].values["Статус в Jira"], "Done");
  assert.equal(states[states.length - 1].rows[0].statusInJira, "Done");
});

test("mapping editor opens from renderer callbacks and mappings are passed into creation", async function () {
  const states = [];
  let callbacks = null;
  let creatorOptions = null;
  let savedMappings = null;
  let parserOptions = null;
  const rendering = {
    init: function (_container, services) {
      callbacks = services;
    },
    render: function (state) {
      states.push({
        mappingEditorOpen: !!state.mappingEditorOpen,
        activeMappingBlock: state.activeMappingBlock || "",
        mappingSettings: state.mappingSettings
          ? {
              moduleComponentMap: Object.assign({}, state.mappingSettings.moduleComponentMap),
              priorityMap: Object.assign({}, state.mappingSettings.priorityMap),
              storyAssigneeId: state.mappingSettings.storyAssigneeId || "",
              storyAssigneeLabel: state.mappingSettings.storyAssigneeLabel || "",
              roles: state.mappingSettings.roles.map(function (role) {
                return role.role + ":" + role.issueType + ":" + role.enabled + ":" + role.originalEstimate + ":" + role.remainingEstimate + ":" + (role.assigneeId || "") + ":" + (role.assigneeLabel || "");
              }),
            }
          : null,
        createDialog: state.createDialog
          ? {
              assigneeId: state.createDialog.assigneeId || "",
              assigneeLabel: state.createDialog.assigneeLabel || "",
              childTasks: state.createDialog.childTasks.map(function (task) {
                return task.role + ":" + task.issueType + ":" + task.enabled + ":" + task.originalEstimate + ":" + task.remainingEstimate + ":" + (task.assigneeId || "") + ":" + (task.assigneeLabel || "");
              }),
            }
          : null,
        issueTypePicker: state.issueTypePicker
          ? {
              target: state.issueTypePicker.target || "",
              query: state.issueTypePicker.query || "",
              rows: (state.issueTypePicker.rows || []).map(function (row) {
                return row.name;
              }),
            }
          : null,
      });
    },
  };
  const mappingStore = {
    create: function () {
      return {
        load: function () {
          return Promise.resolve({
            moduleComponentMap: {
              "Примитивы (tnWP)": "Primitive Component",
            },
            priorityMap: {
              "Срочно": "Highest",
            },
            columnMap: {
              summary: "Тема",
              jira: "Тикет",
            },
            tableStart: {
              headerMarker: "Тема",
            },
            sheetName: "Замечания",
            storyAssigneeId: "story-acc",
            storyAssigneeLabel: "Story User",
            storyAssignee: { accountId: "story-acc", displayName: "Story User" },
            roles: [
              {
                role: "SE",
                issueType: "System Engineer",
                originalEstimate: "2h",
                remainingEstimate: "2h",
                enabled: true,
                assigneeId: "se-user",
                assigneeLabel: "SE User",
                assignee: { name: "se-user", displayName: "SE User" },
              },
              {
                role: "QA",
                issueType: "QA",
                originalEstimate: "3h",
                remainingEstimate: "3h",
                enabled: false,
                assigneeId: "qa-old",
                assigneeLabel: "Old QA",
                assignee: { name: "qa-old", displayName: "Old QA" },
              },
            ],
          });
        },
        save: function (settings) {
          savedMappings = settings;
          return Promise.resolve(settings);
        },
      };
    },
  };
  const api = {
    baseUrl: "https://jira.example.com",
    getProjects: function () {
      return Promise.resolve([{ key: "EVOSCADA" }]);
    },
    getProjectEpics: function () {
      return Promise.resolve([]);
    },
    getProjectCreateMeta: function () {
      return Promise.resolve({
        projects: [
          {
            key: "EVOSCADA",
            issuetypes: [
              { name: "Story", fields: {} },
              { name: "Задача разработки", fields: {} },
              { name: "Задача аналитики", fields: {} },
              { name: "QA", fields: {} },
            ],
          },
        ],
      });
    },
    searchUsers: function (query) {
      if (query === "lead") return Promise.resolve({ users: [{ accountId: "lead-acc", displayName: "Lead User" }] });
      if (query === "qa") return Promise.resolve({ users: [{ name: "qa-user", displayName: "QA User" }] });
      return Promise.resolve({ users: [] });
    },
  };
  const excelLoader = {
    readWorkbook: function () {
      return Promise.resolve({ SheetNames: ["Лист1"] });
    },
  };
  const parser = {
    parseWorkbook: function (_workbook, options) {
      parserOptions = options;
      return {
        sheetName: "Лист1",
        headerRowNumber: 1,
        rows: [
          {
            summary: "Mapped story",
            sourceColumns: {
              "Замечание": "Mapped story",
              "Модуль": "Примитивы (tnWP)",
              "Приоритет": "Срочно",
            },
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
      return Promise.resolve({ ok: true, createdKey: "EVOSCADA-2", errors: [] });
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
    "_ujgESI_mappingStore": mappingStore,
    "_ujgESI_xlsxPatcher": null,
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
  await flush();

  callbacks.onOpenMappings();
  await flush();
  let last = states[states.length - 1];
  assert.equal(last.mappingEditorOpen, true);
  assert.equal(last.activeMappingBlock, "modules");
  assert.equal(last.mappingSettings.moduleComponentMap["Примитивы (tnWP)"], "Primitive Component");
  assert.equal(last.mappingSettings.storyAssigneeId, "story-acc");

  callbacks.onMappingBlockSelect("roles");
  callbacks.onMappingRoleChange(1, "enabled", true);
  await flush();
  last = states[states.length - 1];
  assert.equal(last.activeMappingBlock, "roles");
  assert.equal(savedMappings.roles[1].enabled, true);
  callbacks.onDialogAssigneeSearch("mapping-story", "lead");
  await flush();
  await flush();
  callbacks.onDialogAssigneeSelect("mapping-story", "lead-acc");
  assert.equal(savedMappings.storyAssigneeId, "lead-acc");
  assert.equal(savedMappings.storyAssignee.displayName, "Lead User");
  callbacks.onDialogAssigneeSearch("mapping-role-1", "qa");
  await flush();
  await flush();
  callbacks.onDialogAssigneeSelect("mapping-role-1", "qa-user");
  assert.equal(savedMappings.roles[1].assigneeId, "qa-user");
  assert.equal(savedMappings.roles[1].assignee.displayName, "QA User");
  callbacks.onProjectChange("EVOSCADA");
  await flush();
  await flush();
  callbacks.onIssueTypeSearch("mapping-role-type-1", "разраб");
  last = states[states.length - 1];
  assert.equal(last.issueTypePicker.rows.join("|"), "Задача разработки");
  callbacks.onIssueTypeSelect("mapping-role-type-1", "Задача разработки");
  assert.equal(savedMappings.roles[1].issueType, "Задача разработки");

  callbacks.onFileChange({ name: "rows.xlsx" });
  await flush();
  await flush();
  assert.equal(parserOptions.columnMap.summary, "Тема");
  assert.equal(parserOptions.tableStart.headerMarker, "Тема");
  assert.equal(parserOptions.sheetName, "Замечания");
  callbacks.onCreateRow(0);
  await flush();
  last = states[states.length - 1];
  assert.equal(last.createDialog.assigneeId, "lead-acc");
  assert.equal(last.createDialog.assigneeLabel, "Lead User");
  assert.deepEqual(last.createDialog.childTasks, [
    "SE:System Engineer:true:2h:2h:se-user:SE User",
    "QA:Задача разработки:true:3h:3h:qa-user:QA User",
  ]);
  callbacks.onIssueTypeSearch("child-type-0", "аналит");
  last = states[states.length - 1];
  assert.equal(last.issueTypePicker.rows.join("|"), "Задача аналитики");
  callbacks.onIssueTypeSelect("child-type-0", "Задача аналитики");

  callbacks.onConfirmCreate();
  await flush();
  await flush();

  assert.equal(creatorOptions.mappings.moduleComponentMap["Примитивы (tnWP)"], "Primitive Component");
  assert.equal(creatorOptions.mappings.priorityMap["Срочно"], "Highest");
  assert.equal(creatorOptions.assignee.accountId, "lead-acc");
  assert.equal(creatorOptions.childTasks[0].issueType, "Задача аналитики");
  assert.equal(creatorOptions.childTasks[0].assignee.name, "se-user");
  assert.equal(creatorOptions.childTasks[1].assignee.name, "qa-user");
});

test("meta sheet picker saves selected sheet and reparses current workbook", async function () {
  const states = [];
  let callbacks = null;
  let savedMappings = null;
  const parserOptions = [];
  const workbook = {
    SheetNames: ["Черновик", "Замечания"],
    Sheets: {},
  };
  const rendering = {
    init: function (_container, services) {
      callbacks = services;
    },
    render: function (state) {
      states.push({
        sheetNames: (state.sheetNames || []).slice(),
        sheetPickerOpen: !!state.sheetPickerOpen,
        parseMeta: state.parseMeta
          ? {
              sheetName: state.parseMeta.sheetName,
              headerRowNumber: state.parseMeta.headerRowNumber,
            }
          : null,
        rows: (state.rows || []).map(function (row) {
          return row.summary;
        }),
      });
    },
  };
  const mappingStore = {
    create: function () {
      return {
        load: function () {
          return Promise.resolve({
            columnMap: { summary: "Замечание", jira: "Jira" },
            tableStart: { headerMarker: "Замечание" },
            sheetName: "",
            roles: [],
          });
        },
        save: function (settings) {
          savedMappings = settings;
          return Promise.resolve(settings);
        },
      };
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
      return Promise.resolve(workbook);
    },
  };
  const parser = {
    parseWorkbook: function (_workbook, options) {
      parserOptions.push(options);
      const selectedSheet = options.sheetName || "Черновик";
      return {
        sheetName: selectedSheet,
        headerRowNumber: 1,
        headerColumns: { Jira: 3 },
        rows: [
          {
            summary: selectedSheet + " row",
            sourceColumns: { Замечание: selectedSheet + " row" },
            status: "ready",
            errors: [],
          },
        ],
      };
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
    "_ujgESI_mappingStore": mappingStore,
    "_ujgESI_xlsxPatcher": null,
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
  await flush();

  callbacks.onFileChange({ name: "rows.xlsx" });
  await flush();
  await flush();

  let last = states[states.length - 1];
  assert.deepEqual(last.sheetNames, ["Черновик", "Замечания"]);
  assert.equal(last.parseMeta.sheetName, "Черновик");
  assert.deepEqual(last.rows, ["Черновик row"]);

  callbacks.onToggleSheetPicker();
  last = states[states.length - 1];
  assert.equal(last.sheetPickerOpen, true);

  callbacks.onMetaSheetSelect("Замечания");
  await flush();
  await flush();

  last = states[states.length - 1];
  assert.equal(last.sheetPickerOpen, false);
  assert.equal(last.parseMeta.sheetName, "Замечания");
  assert.deepEqual(last.rows, ["Замечания row"]);
  assert.equal(savedMappings.sheetName, "Замечания");
  assert.equal(parserOptions[parserOptions.length - 1].sheetName, "Замечания");
});
