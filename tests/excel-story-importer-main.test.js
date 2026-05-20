const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const loadAmdModule = require("./helpers/load-amd-module");

const MODULE_DIR = path.join(__dirname, "..", "ujg-excel-story-importer-modules");
const CONFIG = {
  STORY_ISSUE_TYPE: "Story",
  LLM_CONFIG_STORAGE_KEY: "ujg-test-llm",
  LLM_PROJECT_PROMPT: "Project prompt",
  LLM_REMARK_PROMPT: "Remark prompt",
  LLM_SUMMARY_PROMPTS: {
    story: "Story prompt",
    SE: "SE prompt",
    FE: "FE prompt",
    BE: "BE prompt",
    QA: "QA prompt",
    DevOps: "DevOps prompt",
  },
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

function createLocalStorage() {
  const values = {};
  return {
    getItem: function (key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    setItem: function (key, value) {
      values[key] = String(value);
    },
    removeItem: function (key) {
      delete values[key];
    },
  };
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
    "_ujgShared_llmClient": null,
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

test("project selection is stored in localStorage and restored on next load", async function () {
  const storage = createLocalStorage();
  const config = Object.assign({}, CONFIG, { STORAGE_KEY: "ujg-esi-state-test" });
  const firstStates = [];
  const secondStates = [];
  const firstEpicCalls = [];
  const secondEpicCalls = [];
  let firstCallbacks = null;

  function loadWith(renderedStates, epicCalls, captureCallbacks) {
    const rendering = {
      init: function (_container, services) {
        if (captureCallbacks) firstCallbacks = services;
      },
      render: function (state) {
        renderedStates.push({
          projectKey: state.projectKey || "",
          epicKey: state.epicKey || "",
        });
      },
    };
    const api = {
      baseUrl: "https://jira.example.com",
      getProjects: function () {
        return Promise.resolve([{ key: "P1", name: "Project 1" }, { key: "P2", name: "Project 2" }]);
      },
      getProjectEpics: function (projectKey) {
        epicCalls.push(projectKey);
        return Promise.resolve([]);
      },
      getProjectCreateMeta: function () {
        return Promise.resolve({ projects: [] });
      },
    };
    const Gadget = loadAmdModule(path.join(MODULE_DIR, "main.js"), {
      jquery: function () {
        return { length: 0 };
      },
      "_ujgESI_config": config,
      "_ujgESI_api": api,
      "_ujgESI_excel-loader": {},
      "_ujgESI_parser": {},
      "_ujgESI_creator": {},
      "_ujgESI_mappingStore": null,
      "_ujgESI_xlsxPatcher": null,
      "_ujgESI_rendering": rendering,
    "_ujgShared_llmClient": null,
    }, { localStorage: storage });
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
  }

  loadWith(firstStates, firstEpicCalls, true);
  await flush();
  await flush();
  firstCallbacks.onProjectChange("P2");
  await flush();
  await flush();

  assert.equal(JSON.parse(storage.getItem("ujg-esi-state-test")).projectKey, "P2");
  assert.deepEqual(firstEpicCalls, ["P2"]);

  loadWith(secondStates, secondEpicCalls, false);
  await flush();
  await flush();
  await flush();

  assert.equal(secondStates[secondStates.length - 1].projectKey, "P2");
  assert.deepEqual(secondEpicCalls, ["P2"]);
});

test("epic picker search opens filtered epic choices and select stores epic key", async function () {
  const states = [];
  let callbacks = null;
  const rendering = {
    init: function (_container, services) {
      callbacks = services;
    },
    render: function (state) {
      states.push({
        projectKey: state.projectKey || "",
        epicKey: state.epicKey || "",
        epicPicker: state.epicPicker
          ? {
              open: !!state.epicPicker.open,
              query: state.epicPicker.query || "",
            }
          : null,
      });
    },
  };
  const api = {
    baseUrl: "https://jira.example.com",
    getProjects: function () {
      return Promise.resolve([{ key: "EVOSCADA" }]);
    },
    getProjectEpics: function () {
      return Promise.resolve({
        issues: [
          { key: "EVOSCADA-10", fields: { summary: "Север замечания" } },
          { key: "EVOSCADA-20", fields: { summary: "Юг замечания" } },
        ],
      });
    },
    getProjectCreateMeta: function () {
      return Promise.resolve({ projects: [] });
    },
  };
  const Gadget = loadAmdModule(path.join(MODULE_DIR, "main.js"), {
    jquery: function () {
      return { length: 0 };
    },
    "_ujgESI_config": CONFIG,
    "_ujgESI_api": api,
    "_ujgESI_excel-loader": {},
    "_ujgESI_parser": {},
    "_ujgESI_creator": {},
    "_ujgESI_mappingStore": null,
    "_ujgESI_xlsxPatcher": null,
    "_ujgESI_rendering": rendering,
    "_ujgShared_llmClient": null,
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
  await flush();
  callbacks.onEpicSearch("Север");
  let last = states[states.length - 1];
  assert.equal(last.epicPicker.open, true);
  assert.equal(last.epicPicker.query, "Север");

  callbacks.onEpicSelect("EVOSCADA-10");
  last = states[states.length - 1];
  assert.equal(last.epicKey, "EVOSCADA-10");
  assert.equal(last.epicPicker.open, false);
});

test("row create opens confirmation before creating without Epic", async function () {
  const states = [];
  let callbacks = null;
  let creatorOptions = null;
  const llmRequests = [];
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
          return { status: row.status, createdKey: row.createdKey || "", summary: row.summary || "", sourceColumns: Object.assign({}, row.sourceColumns || {}) };
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
  const llmClient = {
    readStoredConfig: function () {
      return { apiBase: "https://llm.example/v1", model: "model", apiKey: "key" };
    },
    requestText: function (_config, request) {
      llmRequests.push(request);
      return Promise.resolve({
        text: request.systemPrompt.indexOf("Remark prompt") >= 0
          ? "Corrected remark text"
          : request.systemPrompt.indexOf("SE prompt") >= 0
            ? "[SE] Improved story"
            : "Improved story",
      });
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
    "_ujgShared_llmClient": llmClient,
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
  callbacks.onDialogImproveSummary("story");
  await flush();
  await flush();
  last = states[states.length - 1];
  assert.equal(last.createDialog.summary, "Improved story");
  assert.equal(llmRequests[0].systemPrompt, "Project prompt\n\nStory prompt");
  assert.match(llmRequests[0].userPrompt, /Test jira task/);
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
  assert.equal(states[states.length - 1].rows[0].summary, "Test jira task");
  callbacks.onDialogImproveRemark(0);
  await flush();
  await flush();
  last = states[states.length - 1];
  assert.equal(last.createDialog.sourceRows[0], "Замечание:Corrected remark text");
  assert.equal(last.rows[0].summary, "Corrected remark text");
  assert.equal(last.rows[0].sourceColumns["Замечание"], "Corrected remark text");
  callbacks.onDialogChildToggle(1, false);
  callbacks.onDialogChildChange(0, "summary", "[SE] Edited story");
  assert.equal(states.length, rendersBeforeInlineEdits + 3);
  callbacks.onDialogImproveSummary("child-0");
  await flush();
  await flush();
  last = states[states.length - 1];
  assert.equal(last.createDialog.childTasks[0], "SE:System Engineer:[SE] Improved story:true::");
  assert.equal(llmRequests[1].systemPrompt, "Project prompt\n\nRemark prompt");
  assert.match(llmRequests[1].userPrompt, /Corrected|Edited story from modal|Test jira task/);
  assert.equal(llmRequests[2].systemPrompt, "Project prompt\n\nSE prompt");
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
  assert.equal(creatorOptions.summary, "Improved story");
  assert.equal(creatorOptions.assignee.accountId, "story-acc");
  assert.equal(creatorOptions.originalEstimate, "2h");
  assert.equal(creatorOptions.remainingEstimate, "1h");
  assert.equal(creatorOptions.sourceRows[0].value, "Corrected remark text");
  assert.equal(creatorOptions.childTasks[0].summary, "[SE] Improved story");
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
            childStatuses: Array.from(row.childStatuses || []).map(function (child) {
              return [
                child.role || "",
                child.key || "",
                child.status || "",
                child.statusCategory || "",
                child.statusState || "",
                child.done ? "doneFlag" : "openFlag",
                child.assignee || "",
                child.blocked ? "blocked" : "open",
              ].join(":");
            }),
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
                assignee: { displayName: "Сергей" },
              },
            },
            {
              key: "EVOSCADA-12",
              fields: {
                summary: "[QA] Existing",
                status: { name: "Testing" },
                assignee: { displayName: "Ольга" },
                issuelinks: [
                  {
                    type: { name: "Blocks", inward: "is blocked by", outward: "blocks" },
                    inwardIssue: { key: "EVOSCADA-11" },
                  },
                ],
              },
            },
            {
              key: "EVOSCADA-14",
              fields: {
                summary: "[BE] Existing",
                status: { name: "Workflow final state" },
                resolutiondate: "2026-05-16T10:00:00.000+0300",
              },
            },
            {
              key: "EVOSCADA-15",
              fields: {
                summary: "[QA] Existing",
                status: { name: "Open" },
                issuelinks: [
                  {
                    type: { name: "Blocks", inward: "is blocked by", outward: "blocks" },
                    inwardIssue: { key: "EVOSCADA-14" },
                  },
                ],
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
                    key: "EVOSCADA-12",
                    fields: {
                      summary: "[QA] Existing",
                      status: { name: "Testing" },
                    },
                  },
                },
                {
                  type: { name: "Child", inward: "child" },
                  inwardIssue: {
                    key: "EVOSCADA-11",
                    fields: {
                      summary: "[SE] Existing",
                      status: { name: "Любой закрытый статус", statusCategory: { key: "done", name: "Done", colorName: "green" } },
                    },
                  },
                },
              ],
            },
          },
          {
            key: "EVOSCADA-13",
            fields: {
              status: { name: "Testing" },
              assignee: { displayName: "Мария" },
              customfield_10020: [],
              issuelinks: [
                {
                  type: { name: "Hierarchy", inward: "is child of", outward: "has child" },
                  outwardIssue: {
                    key: "EVOSCADA-14",
                    fields: {
                      summary: "[BE] Existing",
                      status: { name: "In Progress" },
                    },
                  },
                },
                {
                  type: { name: "Hierarchy", inward: "is child of", outward: "has child" },
                  outwardIssue: {
                    key: "EVOSCADA-15",
                    fields: {
                      summary: "[QA] Existing",
                      status: { name: "Open" },
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
          {
            excelRowNumber: 13,
            summary: "Existing with outward children",
            jiraKey: "EVOSCADA-13",
            sourceColumns: { Замечание: "Existing with outward children", Jira: "EVOSCADA-13" },
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
    "_ujgShared_llmClient": null,
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

  assert.deepEqual(issueKeyCalls, [["EVOSCADA-10", "EVOSCADA-13"], ["EVOSCADA-12", "EVOSCADA-11", "EVOSCADA-14", "EVOSCADA-15"]]);
  assert.equal(patchArgs.buffer, sourceBuffer);
  assert.equal(patchArgs.patch.sheetName, "Журнал");
  assert.equal(patchArgs.patch.headerRowNumber, 9);
  assert.equal(patchArgs.patch.rows[0].excelRowNumber, 12);
  assert.equal(Object.prototype.hasOwnProperty.call(patchArgs.patch.rows[0].values, "Jira"), false);
  assert.equal(patchArgs.patch.rows[0].values["Статус в Jira"], "In Review");
  assert.equal(patchArgs.patch.rows[0].values["Исполнитель в Jira"], "Иван Иванов");
  assert.equal(patchArgs.patch.rows[0].values["Спринт"], "Sprint 42");
  assert.deepEqual(Object.keys(patchArgs.patch.rows[0].comments), []);
  assert.deepEqual(Object.keys(patchArgs.patch.rows[1].comments), []);
  assert.deepEqual(patchArgs.patch.headerColumns, {
    Jira: 11,
    "Статус в Jira": 15,
    "Исполнитель в Jira": 16,
    "Спринт": 17,
  });

  const last = states[states.length - 1];
  assert.equal(last.syncError, "");
  assert.equal(last.syncSummary, "Синхронизировано 2 тикет");
  assert.equal(last.exportReady, true);
  assert.equal(last.exportFileName, "test.synced.xlsx");
  assert.equal(last.rows[0].statusInJira, "In Review");
  assert.equal(last.rows[0].assigneeInJira, "Иван Иванов");
  assert.equal(last.rows[0].sprintInJira, "Sprint 42");
  assert.equal(last.rows[0].statusTitle, "[SE] Existing | Любой закрытый статус | Сергей\n[QA] Existing | Testing | Ольга");
  assert.deepEqual(last.rows[0].childStatuses, [
    "SE:EVOSCADA-11:Любой закрытый статус:done:done:doneFlag:Сергей:open",
    "QA:EVOSCADA-12:Testing::progress:openFlag:Ольга:open",
  ]);
  assert.equal(last.rows[1].statusInJira, "Testing");
  assert.deepEqual(last.rows[1].childStatuses, [
    "BE:EVOSCADA-14:Workflow final state::done:doneFlag:Не назначен:open",
    "QA:EVOSCADA-15:Open::todo:openFlag:Не назначен:open",
  ]);
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
    "_ujgShared_llmClient": null,
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
            sourceColumns: { Замечание: "Test jira task", Jira: "Обсудить" },
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
    "_ujgShared_llmClient": null,
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
    "_ujgShared_llmClient": null,
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
    "_ujgShared_llmClient": null,
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
    "_ujgShared_llmClient": null,
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
    "_ujgShared_llmClient": null,
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
    "_ujgShared_llmClient": null,
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
    "_ujgShared_llmClient": null,
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
  assert.equal(patchArgs.rows[0].values["Статус исполнителя"], "Done");
  assert.deepEqual(Object.keys(patchArgs.rows[0].comments), []);
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
              llmProjectPrompt: state.mappingSettings.llmProjectPrompt || "",
              llmRemarkPrompt: state.mappingSettings.llmRemarkPrompt || "",
              llmPrompts: Object.assign({}, state.mappingSettings.llmPrompts || {}),
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
    "_ujgShared_llmClient": null,
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

  callbacks.onMappingBlockSelect("llmPrompts");
  await flush();
  last = states[states.length - 1];
  assert.equal(last.activeMappingBlock, "llmPrompts");
  assert.equal(last.mappingSettings.llmProjectPrompt, "Project prompt");
  assert.equal(last.mappingSettings.llmRemarkPrompt, "Remark prompt");
  callbacks.onMappingLlmProjectPromptChange("Dashboard project context");
  callbacks.onMappingLlmRemarkPromptChange("Dashboard remark prompt");
  callbacks.onMappingLlmPromptChange("story", "Dashboard story prompt");
  assert.equal(savedMappings.llmProjectPrompt, "Dashboard project context");
  assert.equal(savedMappings.llmRemarkPrompt, "Dashboard remark prompt");
  assert.equal(savedMappings.llmPrompts.story, "Dashboard story prompt");

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

test("mapping text input changes save without rerendering the focused editor", async function () {
  const states = [];
  let callbacks = null;
  let savedMappings = null;
  let clearMappingErrorCount = 0;
  const rendering = {
    init: function (_container, services) {
      callbacks = services;
    },
    clearMappingError: function () {
      clearMappingErrorCount += 1;
    },
    render: function (state) {
      states.push({
        mappingEditorOpen: !!state.mappingEditorOpen,
        activeMappingBlock: state.activeMappingBlock || "",
        mappingError: state.mappingError || "",
        priorityOptions: (state.priorityOptions || []).map(function (row) {
          return row.name;
        }),
        priorityMap: state.mappingSettings ? Object.assign({}, state.mappingSettings.priorityMap) : null,
      });
    },
  };
  const mappingStore = {
    create: function () {
      return {
        load: function () {
          return Promise.resolve({
            moduleComponentMap: {},
            priorityMap: {},
            columnMap: {
              summary: "Замечание",
              jira: "Jira",
            },
            tableStart: {
              headerMarker: "Замечание",
            },
            sheetName: "Замечания",
            roles: [
              {
                role: "SE",
                issueType: "System Engineer",
                originalEstimate: "2h",
                remainingEstimate: "2h",
                enabled: true,
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
  const Gadget = loadAmdModule(path.join(MODULE_DIR, "main.js"), {
    jquery: function () {
      return { length: 0 };
    },
    "_ujgESI_config": CONFIG,
    "_ujgESI_api": {
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
                    priority: {
                      allowedValues: [
                        { name: "Критический" },
                        { name: "Высокий" },
                        { name: "Средний" },
                      ],
                    },
                  },
                },
              ],
            },
          ],
        });
      },
    },
    "_ujgESI_excel-loader": {},
    "_ujgESI_parser": {},
    "_ujgESI_creator": {},
    "_ujgESI_rendering": rendering,
    "_ujgShared_llmClient": null,
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

  callbacks.onProjectChange("EVOSCADA");
  await flush();
  await flush();
  await flush();

  callbacks.onOpenMappings();
  callbacks.onMappingBlockSelect("priorities");
  callbacks.onMappingPairAdd("priorities");
  await flush();
  await flush();
  const renderCountBeforeTyping = states.length;
  let last = states[states.length - 1];

  assert.deepEqual(Array.from(last.priorityOptions), ["Критический", "Высокий", "Средний"]);
  assert.equal(savedMappings.priorityMap["Новое значение"], "Критический");

  callbacks.onMappingPairChange("priorities", 0, "jira", "High");
  await flush();
  await flush();

  assert.equal(savedMappings.priorityMap["Новое значение"], "High");
  assert.equal(states.length, renderCountBeforeTyping);

  const renderCountBeforeColumnTyping = states.length;
  callbacks.onMappingColumnChange("summary", "Содержание замечания");
  await flush();
  await flush();
  assert.equal(savedMappings.columnMap.summary, "Содержание замечания");
  assert.equal(states.length, renderCountBeforeColumnTyping);

  const renderCountBeforeTableTyping = states.length;
  callbacks.onMappingTableStartChange("headerMarker", "Содержание замечания");
  callbacks.onMappingSheetNameChange("Замечания 2026");
  await flush();
  await flush();
  assert.equal(savedMappings.tableStart.headerMarker, "Содержание замечания");
  assert.equal(savedMappings.sheetName, "Замечания 2026");
  assert.equal(states.length, renderCountBeforeTableTyping);

  const renderCountBeforeRoleTyping = states.length;
  callbacks.onMappingRoleChange(0, "role", "QA");
  callbacks.onMappingRoleChange(0, "originalEstimate", "4h");
  callbacks.onMappingRoleChange(0, "remainingEstimate", "3h");
  await flush();
  await flush();
  assert.equal(savedMappings.roles[0].role, "QA");
  assert.equal(savedMappings.roles[0].originalEstimate, "4h");
  assert.equal(savedMappings.roles[0].remainingEstimate, "3h");
  assert.equal(states.length, renderCountBeforeRoleTyping);

  const renderCountBeforeIssueTypeTyping = states.length;
  callbacks.onIssueTypeSearch("mapping-role-type-0", "Task");
  await flush();
  await flush();
  assert.equal(savedMappings.roles[0].issueType, "Task");
  assert.equal(states.length, renderCountBeforeIssueTypeTyping + 1);

  callbacks.onMappingBlockSelect("modules");
  callbacks.onMappingPairAdd("modules");
  await flush();
  await flush();
  callbacks.onMappingPairAdd("modules");
  await flush();
  await flush();
  callbacks.onMappingPairChange("modules", 1, "excel", "Новое значение");
  await flush();
  await flush();
  last = states[states.length - 1];
  assert.equal(savedMappings.moduleComponentMap["Новое значение"], "");
  assert.equal(savedMappings.moduleComponentMap["Новое значение 2"], "");
  assert.match(last.mappingError, /уже есть/i);

  callbacks.onMappingPairChange("modules", 1, "excel", "Уникальное значение");
  await flush();
  await flush();
  assert.equal(savedMappings.moduleComponentMap["Уникальное значение"], "");
  assert.equal(clearMappingErrorCount > 0, true);

  callbacks.onMappingPairRemove("modules", 1);
  await flush();
  await flush();
  last = states[states.length - 1];
  assert.equal(last.mappingError, "");
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
    "_ujgShared_llmClient": null,
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
