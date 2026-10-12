const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./helpers/load-amd-module');
function setup() {
  const calls = [];
  const api = load(path.join(__dirname, '../ujg-excel-story-importer-modules/api.js'), {
    jquery: {ajax: options => { calls.push(options); return Promise.resolve({}); }},
    _ujgESI_config: {baseUrl: 'https://jira.test'}
  });
  return {api, calls};
}
test('transition API reads expanded metadata and writes only a validated transition ID', async () => {
  const {api, calls} = setup();
  assert.equal(typeof api.getIssueTransitions, 'function');
  assert.equal(typeof api.transitionIssue, 'function');
  await api.getIssueTransitions('TEST-1');
  await api.transitionIssue('TEST-1', '21');
  assert.equal(calls[0].url, 'https://jira.test/rest/api/2/issue/TEST-1/transitions');
  assert.equal(calls[0].type, 'GET');
  assert.equal(calls[0].data.expand, 'transitions.fields');
  assert.equal(calls[0].timeout, 30000);
  assert.equal(calls[1].type, 'POST');
  assert.equal(calls[1].timeout, 30000);
  assert.deepEqual(JSON.parse(calls[1].data), {transition: {id: '21'}});
});
test('transition API rejects invalid keys and IDs before any request', async () => {
  const {api, calls} = setup();
  assert.equal(typeof api.transitionIssue, 'function');
  for (const key of ['', null, '../TEST-1', 'TEST-0', {}]) {
    await assert.rejects(() => api.getIssueTransitions(key));
    await assert.rejects(() => api.transitionIssue(key, '21'));
  }
  for (const id of ['', null, 21, '0', '-1', '../21', {id: '21', fields: {}}]) {
    await assert.rejects(() => api.transitionIssue('TEST-1', id));
  }
  assert.equal(calls.length, 0);
});
test('actual issue readback is validated, bounded and includes history', async () => {
  const {api, calls} = setup();
  await api.getIssueWithHistory('TEST-1');
  assert.equal(calls[0].timeout, 30000);
  assert.equal(calls[0].data.expand, 'changelog');
  assert.match(calls[0].data.fields, /resolution/);
  await assert.rejects(() => api.getIssueWithHistory('../TEST-1'));
  assert.equal(calls.length, 1);
});
