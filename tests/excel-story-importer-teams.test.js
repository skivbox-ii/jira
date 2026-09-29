const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const loadAmd = require("./helpers/load-amd-module");

const teams = loadAmd(path.join(__dirname, "../ujg-excel-story-importer-modules/teams.js"), {});
const plain = value => JSON.parse(JSON.stringify(value));

test("explicit reissued status wins over stale completion flags without changing terminal statuses", () => {
  for (const status of ["Выдано", "Повторно выдано", "Reopened"]) {
    assert.equal(teams.statusKind({status, done:true, statusCategory:"done", statusState:"done"}), "active", status);
  }
  assert.equal(teams.statusKind({status:"Resolved", done:false, statusCategory:"indeterminate", statusState:"progress"}), "active");
  assert.equal(teams.statusKind({status:"Done", done:true, statusCategory:"done"}), "done");
  assert.equal(teams.statusKind({status:"Снята", done:true, statusCategory:"done"}), "cancelled");
});

test("queue assigns every configured QA-role team for exact testing statuses", () => {
  const configured = teams.normalize([
    { id: "qa-east", name: "Renamed", roles: [" qa "] },
    { id: "custom-42", name: "Another", roles: ["QA"] },
    { id: "qa-label", name: "QA", roles: ["BE"] },
    { id: "testing-direction", name: "Testing", direction: "testing", roles: [] }
  ]);
  for (const status of ["Testing", "In Testing", "Тестирование", "На тестировании", "  in   testing  "]) {
    assert.deepEqual(plain(teams.queueTeamIds({ status }, configured)), ["qa-east", "custom-42"], status);
    assert.deepEqual(plain(teams.queueTeamIds({ status, role: "BE" }, configured)), ["qa-east", "custom-42", "qa-label"], status);
  }
  assert.deepEqual(plain(teams.queueTeamIds({ status: "Review" }, configured)), [], "review is not a QA status alias");
});

test("queue QA role matches any status, including absent, completed and cancelled", () => {
  const configured = teams.normalize([{ id: "quality", name: "Renamed", roles: ["qA"] }]);
  for (const task of [
    { status: "Open", role: "QA" },
    { status: "In progress", role: "qa", done: false },
    { status: "Review", statusCategory: "indeterminate", role: "QA" },
    { role: "QA", done: false },
    { status: "Mystery", role: "QA", done: false },
    { status: "Done", role: "QA", done: false },
    { status: "Completed", role: "QA", done: false },
    { status: "Cancelled", role: "QA", done: false },
    { status: "Готово", role: "QA", done: true, statusCategory: "done" }
  ]) assert.deepEqual(plain(teams.queueTeamIds(task, configured)), ["quality"], JSON.stringify(task));
});

test("queue testing status matches QA even when terminal metadata disagrees", () => {
  const configured = teams.normalize([{ id: "quality", name: "Renamed", roles: ["QA"] }]);
  for (const task of [
    { status: "Testing", done: true },
    { status: "Testing", statusCategory: "done" },
    { status: "In Testing", statusState: "done" },
    { status: "Testing", statusState: "cancelled" }
  ]) assert.deepEqual(plain(teams.queueTeamIds(task, configured)), ["quality"], JSON.stringify(task));
  assert.deepEqual(plain(teams.queueTeamIds({ status: "Review", done: false }, configured)), []);
});

test("queue QA matches member identifiers on any task and does not duplicate OR matches", () => {
  const configured = teams.normalize([{ id: "quality", name: "Renamed", roles: ["QA"],
    members: [{ id: "tester-login", label: "Tester", identifiers: ["tester-key", "tester-account"] }] }]);
  for (const task of [
    { status: "В работе", role: "BE", assigneeIdentifiers: ["tester-key"] },
    { status: "Готово", assigneeIdentifiers: ["tester-login"] },
    { status: "Снята", assigneeIdentifiers: ["tester-account"] },
    { assigneeIdentifiers: ["tester-account"] },
    { status: "Тестирование", role: "QA", assigneeIdentifiers: ["tester-key", "tester-key"] }
  ]) assert.deepEqual(plain(teams.queueTeamIds(task, configured)), ["quality"], JSON.stringify(task));
  assert.deepEqual(plain(teams.queueTeamIds({ status: "Open", assignee: "Tester" }, configured)), []);
  assert.deepEqual(plain(teams.queueTeamIds({ status: "Open", assigneeIdentifiers: ["someone-else"] }, configured)), []);
});

test("queue other teams use configured roles or assignee identifiers, including closed work", () => {
  const configured = teams.normalize([
    { id: "dev", name: "Not BE", roles: ["BE"], members: [{ id: "person-1", label: "Alice", identifiers: ["acct-1"] }] },
    { id: "ops", name: "BE", roles: ["OPS"], members: [{ id: "person-2", label: "Bob", identifiers: ["acct-2"] }] },
    { id: "quality", name: "Renamed", roles: ["QA"], members: [{ id: "person-3", label: "Carol", identifiers: ["acct-3"] }] }
  ]);
  assert.deepEqual(plain(teams.queueTeamIds({ status: "Done", role: "be", assigneeIdentifiers: ["acct-1", "acct-2"] }, configured)), ["dev", "ops"]);
  assert.deepEqual(plain(teams.queueTeamIds({ status: "Open", assigneeIdentifiers: ["person-1"] }, configured)), ["dev"]);
  assert.deepEqual(plain(teams.queueTeamIds({ status: "Open", role: "OPS", assigneeIdentifiers: ["acct-2", "acct-2"] }, configured)), ["ops"]);
  assert.deepEqual(plain(teams.queueTeamIds({ status: "Open", role: "BE", assignee: "Carol" }, configured)), ["dev"]);
  assert.deepEqual(plain(teams.queueTeamIds({ status: "Open", assigneeIdentifiers: ["acct-3"] }, configured)), ["quality"]);
});

test("defaults contain editable role teams and bounded directions", () => {
  assert.deepEqual(plain(teams.directions.map(x => x.id)), ["development", "testing", "implementation", "analysis", "other"]);
  const defaults = plain(teams.defaults());
  assert.deepEqual(defaults.map(x => x.name), ["BE", "FE", "DE", "QA", "SE", "DevOps", "Внедрение"]);
  assert.deepEqual(defaults.map(x => x.direction), ["development", "development", "development", "testing", "analysis", "other", "implementation"]);
  assert.deepEqual(defaults[6].roles, ["IMP", "IMPLEMENTATION"]);
  assert.ok(defaults.every(x => teams.colors.includes(x.color)));
});

test("normalization keeps explicit empty list and bounds unsafe values", () => {
  assert.deepEqual(plain(teams.normalize([])), []);
  const value = plain(teams.normalize([{ id: "__proto__", name: " A ", direction: "bad", roles: [" QA ", "QA", ""], members: [{ id: "id-1", label: " Alice ", identifiers: ["acct-1", "acct-1"] }], color: "url(x)" }]));
  assert.equal(value.length, 1);
  assert.notEqual(value[0].id, "__proto__");
  assert.equal(value[0].name, "A");
  assert.equal(value[0].direction, "other");
  assert.deepEqual(value[0].roles, ["QA"]);
  assert.deepEqual(value[0].members[0].identifiers, ["acct-1"]);
  assert.ok(teams.colors.includes(value[0].color));
});

test("storage is scoped and malformed data falls back; save surfaces failures", () => {
  const data = new Map();
  const storage = { getItem: key => data.has(key) ? data.get(key) : null, setItem: (key, value) => data.set(key, value) };
  const a = teams.storageKey("user-a", "P");
  assert.notEqual(a, teams.storageKey("user-b", "P"));
  assert.notEqual(a, teams.storageKey("user-a", "Q"));
  teams.save(storage, "user-a", "P", []);
  assert.deepEqual(plain(teams.load(storage, "user-a", "P")), []);
  assert.equal(teams.load(storage, "user-b", "P").length, 7);
  data.set(a, "not json");
  assert.equal(teams.load(storage, "user-a", "P").length, 7);
  assert.throws(() => teams.save({ setItem: () => { throw Error("quota"); } }, "u", "P", []), /quota/);
});

test("current work counts simultaneous directions, explicit phase before role and dedupes keys", () => {
  const row = { jiraKey: "P-1", storyDetails: { key: "P-1", status: "Open", assignee: "Coordinator" }, childStatuses: [
    { key: "P-2", role: "BE", status: "In progress", summary: "Code", assignee: "Dev" },
    { key: "P-3", role: "BE", status: "Testing", summary: "Check", assignee: "QA" },
    { key: "P-3", role: "BE", status: "Testing" },
    { key: "P-4", role: "IMP", status: "In progress", summary: "Ship" }
  ] };
  const result = plain(teams.currentWork(row, teams.defaults()));
  assert.deepEqual(result.groups.map(x => [x.direction, x.count]), [["development", 1], ["testing", 1], ["implementation", 1]]);
  assert.match(result.groups[1].tasks[0].basis, /статус/i);
  assert.equal(result.parent.assignee, "Coordinator");
});

test("closed, cancelled, unknown, and unlinked children are not active evidence", () => {
  const row = { jiraKey: "P-1", storyDetails: { status: "Open" }, childStatuses: [
    { key: "P-2", role: "QA", status: "Done", done: true },
    { key: "P-3", role: "IMP", status: "Cancelled" },
    { key: "P-4", role: "BE", status: "Mysterious" },
    { key: "P-5", role: "QA", status: "Open", linkedToParent: false }
  ] };
  const result = plain(teams.currentWork(row, teams.defaults()));
  assert.deepEqual(result.groups, []);
  assert.match(result.message, /Нет данных/);
  assert.ok(result.warnings.some(x => /P-5/.test(x)));
});

test("generic parent assignment cannot manufacture development with children", () => {
  const custom = teams.normalize([{ id: "dev", name: "Dev", direction: "development", roles: [], members: [{ id: "alice", label: "Alice", identifiers: ["acct-1"] }], color: teams.colors[0] }]);
  const parent = { key: "P-1", status: "Open", assignee: "Alice", assigneeIdentifiers: ["acct-1"] };
  const withChild = plain(teams.currentWork({ jiraKey: "P-1", storyDetails: parent, childStatuses: [{ key: "P-2", role: "QA", status: "Open" }] }, custom));
  assert.deepEqual(withChild.groups.map(x => x.direction), ["other"]);
  const onlyParent = plain(teams.currentWork({ jiraKey: "P-1", storyDetails: parent, childStatuses: [] }, custom));
  assert.deepEqual(onlyParent.groups.map(x => x.direction), ["development"]);
  assert.match(onlyParent.groups[0].tasks[0].basis, /назначен/i);
  assert.deepEqual(plain(teams.currentWork({ jiraKey: "P-1", storyDetails: { ...parent, status: "Testing" }, childStatuses: [{ key: "P-2", role: "QA", status: "Done" }] }, custom)).groups.map(x => x.direction), ["testing"]);
});

test("stable identifiers only, conflict warning, and open child under done parent", () => {
  const custom = teams.normalize([
    { id: "a", name: "A", direction: "development", roles: ["BE"], members: [], color: teams.colors[0] },
    { id: "b", name: "B", direction: "testing", roles: [], members: [{ id: "bob", label: "Bob", identifiers: ["acct-b"] }], color: teams.colors[1] }
  ]);
  const result = plain(teams.currentWork({ jiraKey: "P-1", storyDetails: { status: "Done" }, childStatuses: [{ key: "P-2", role: "BE", status: "Open", assignee: "Bob", assigneeIdentifiers: ["acct-b"] }] }, custom));
  assert.deepEqual(result.groups.map(x => x.direction), ["development"]);
  assert.ok(result.warnings.some(x => /P-2/.test(x)));
  assert.ok(result.warnings.some(x => /P-1/.test(x)));
  const nameOnly = plain(teams.currentWork({ jiraKey: "P-3", storyDetails: { status: "Open", assignee: "Bob" } }, custom));
  assert.deepEqual(nameOnly.groups, []);
});

test("cancelled work does not read as accepted completion", () => {
  const result = plain(teams.currentWork({ jiraKey: "P-1", childStatuses: [{ key: "P-2", status: "Cancelled", statusCategory: "done", role: "QA" }] }, teams.defaults()));
  assert.deepEqual(result.groups, []);
  assert.match(result.message, /Нет данных/);
});

test("multiple matching team directions remain ambiguous", () => {
  const configured = teams.normalize([
    { id: "a", name: "A", direction: "development", roles: ["CODE"], color: teams.colors[0] },
    { id: "b", name: "B", direction: "analysis", roles: ["CODE"], color: teams.colors[1] }
  ]);
  const result = plain(teams.currentWork({ jiraKey: "P-1", childStatuses: [{ key: "P-2", status: "Open", role: "CODE" }] }, configured));
  assert.deepEqual(result.groups.map(x => x.direction), ["other"]);
  assert.match(result.warnings[0], /несколько направлений/);
});

test("explicit status still reports contradictory team evidence", () => {
  const configured = teams.normalize([
    { id: "a", name: "A", direction: "development", roles: ["BE"], color: teams.colors[0] },
    { id: "b", name: "B", direction: "analysis", members: [{ id: "bob", label: "Bob", identifiers: ["acct-b"] }], color: teams.colors[1] }
  ]);
  const result = plain(teams.currentWork({ jiraKey: "P-1", childStatuses: [{ key: "P-2", status: "Testing", role: "BE", assigneeIdentifiers: ["acct-b"] }] }, configured));
  assert.deepEqual(result.groups.map(x => x.direction), ["testing"]);
  assert.ok(result.warnings.some(x => /P-2/.test(x)));
});

test("terminal wording requires an exact status or authoritative done category", () => {
  for (const status of ["не принято", "Not Done", "Waiting for acceptance"]) {
    const result = plain(teams.currentWork({ jiraKey: "P-1", childStatuses: [{ key: "P-2", status, role: "BE" }] }, teams.defaults()));
    assert.deepEqual(result.groups, [], status);
    assert.match(result.message, /Нет данных/, status);
    assert.ok(result.warnings.some(x => /неизвестный статус/.test(x)), status);
  }
  for (const status of ["Done", "Принято", "Готово"]) {
    const result = plain(teams.currentWork({ jiraKey: "P-1", childStatuses: [{ key: "P-2", status, role: "BE" }] }, teams.defaults()));
    assert.deepEqual(result.groups, [], status);
    assert.match(result.message, /Нет подтвержденной передачи/, status);
  }
  const category = plain(teams.currentWork({ jiraKey: "P-1", childStatuses: [{ key: "P-2", status: "Mysterious", statusCategory: "done", role: "BE" }] }, teams.defaults()));
  assert.match(category.message, /Нет подтвержденной передачи/);
});

test("testing handoff wording wins over ready and issued can use supported state", () => {
  const result = plain(teams.currentWork({ jiraKey: "P-1", childStatuses: [
    { key: "P-2", status: "Готово к тестированию", role: "BE" },
    { key: "P-3", status: "Выдано", statusState: "progress", role: "BE" }
  ] }, teams.defaults()));
  assert.deepEqual(result.groups.map(x => [x.direction, x.count]), [["development", 1], ["testing", 1]]);
  assert.deepEqual(result.groups[1].tasks.map(x => x.key), ["P-2"]);
});

test("parent key repeated in children contributes one task", () => {
  const result = plain(teams.currentWork({ jiraKey: "P-1", storyDetails: { key: "P-1", status: "Testing", summary: "Parent" }, childStatuses: [
    { key: "P-1", status: "Testing", role: "QA", summary: "Duplicate" },
    { key: "P-2", status: "Open", role: "BE" }
  ] }, teams.defaults()));
  assert.deepEqual(result.groups.map(x => [x.direction, x.count]), [["development", 1], ["testing", 1]]);
  assert.deepEqual(result.groups[1].tasks.map(x => x.summary), ["Parent"]);
});
