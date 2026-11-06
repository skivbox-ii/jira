const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit } = require('./helpers/ticket-assistant-fixture');

function adapter(ajax, baseUrl = '/jira') {
    return loadUnit('api', {}, { location: { origin: 'https://jira.example', pathname: '/jira/plugins/servlet/gadgets' }, URL }).createApi({ ajax, baseUrl });
}

test('board and sprint discovery uses scoped Agile endpoints and actual pagination',async()=>{
    const calls=[],api=adapter(o=>{calls.push(o);return Promise.resolve({values:[{id:o.data.startAt+1,name:'Item',state:'active'}],startAt:o.data.startAt,isLast:o.data.startAt===1});});
    const boards=await api.getBoards('DO');assert.equal(boards.complete,true);assert.equal(boards.values.length,2);
    assert.equal(calls[0].url,'/jira/rest/agile/1.0/board');assert.equal(calls[0].data.projectKeyOrId,'DO');assert.equal(calls[0].data.type,'scrum');
    calls.length=0;await api.getSprints('DO','12');assert.equal(calls[0].url,'/jira/rest/agile/1.0/board/12/sprint');
    assert.equal(calls[0].data.state,'active,future');
    await assert.rejects(api.getSprints('DO','../12'));
});
test('epic lookup confirms Agile identity and project; sprint lookup rejects closed and unrelated boards',async()=>{
    const api=adapter(o=>Promise.resolve(o.url.includes('/epic/')?{id:42,name:'Epic'}:
        o.url.includes('/issue/')?{id:'42',key:'DO-42',fields:{project:{key:'DO'}}}:
        o.url.endsWith('/sprint/73')?{id:73,name:'Sprint',state:'closed',originBoardId:12}:{values:[],isLast:true}));
    assert.equal((await api.getEpic('DO','DO-42')).id,'DO-42');
    await assert.rejects(api.getEpic('APP','DO-42'));
    await assert.rejects(api.getSprint('DO',73));
});
test('epic search is a bounded partial project page and never interpolates raw JQL',async()=>{
    const calls=[],api=adapter(o=>{calls.push(o);return Promise.resolve(o.url.endsWith('/field')?[{id:'customfield_629',schema:{custom:'com.pyxis.greenhopper.jira:gh-epic-label'}}]:o.url.endsWith('/search')?{issues:[{key:'DO-42',fields:{project:{key:'DO'},summary:'Epic'}}]}:
        o.url.includes('/epic/')?{id:42,name:'Epic'}:{id:'42',key:'DO-42',fields:{project:{key:'DO'}}});});
    const result=await api.searchEpics('DO','a" OR project = "APP');
    assert.equal(result.complete,false);assert.equal(result.values[0].id,'DO-42');
    assert.equal(calls.length,2);assert.equal(calls[1].data.maxResults,20);assert.ok(calls[1].data.jql.includes('a\\" OR project = \\"APP'));
    assert.ok(calls[1].data.jql.includes('cf[629] IS NOT EMPTY'));
    assert.equal(calls[0].type,'GET');
});
test('exact Epic key bypasses search and missing Epic Name metadata cannot masquerade as empty choices',async()=>{
    const calls=[],api=adapter(o=>{calls.push(o);return Promise.resolve(o.url.includes('/epic/')?{id:42,name:'Epic'}:
        o.url.includes('/issue/')?{id:'42',key:'DO-42',fields:{project:{key:'DO'}}}:[]);});
    const result=await api.searchEpics('DO','DO-42');assert.equal(result.values[0].id,'DO-42');assert.equal(calls.length,2);
    assert.ok(calls.every(c=>!c.url.endsWith('/search')&&!c.url.endsWith('/field')));
    await assert.rejects(api.searchEpics('DO','name'),e=>e.kind==='incomplete');
});
test('sprint confirmation rechecks project board membership and active/future catalog',async()=>{
    for(const scenario of ['valid','foreign','incomplete','forbidden']) {
        const api=adapter(o=> {
            if(scenario==='forbidden')return Promise.reject({status:403,responseText:'SECRET'});
            if(o.url.endsWith('/sprint/73'))return Promise.resolve({id:73,state:'future',name:'Sprint',originBoardId:12});
            if(o.url.endsWith('/board'))return Promise.resolve({values:scenario==='foreign'?[]:[{id:12,name:'Board'}],isLast:true});
            return Promise.resolve({values:[{id:73,name:'Sprint',state:'future'}],...(scenario==='incomplete'?{}:{isLast:true})});
        });
        if(scenario==='valid')assert.equal((await api.getSprint('DO',73)).id,'73');
        else await assert.rejects(api.getSprint('DO',73),e=>!JSON.stringify(e).includes('SECRET'));
    }
});
test('shared Sprint confirms accessible project board membership despite unrelated origin board',async()=>{
    const calls=[],api=adapter(o=>{calls.push(o);return Promise.resolve(o.url.endsWith('/sprint/73')?
        {id:73,state:'active',originBoardId:12}:o.url.endsWith('/board')?{values:[{id:13,name:'Project board'}],isLast:true}:
        {values:[{id:73,name:'Shared',state:'active'}],isLast:true});});
    assert.equal((await api.getSprint('DO',73)).id,'73');
    assert.ok(calls.some(o=>o.url.endsWith('/board/13/sprint')));
});

test('read methods use GET, context path and encoded scope without arbitrary autocomplete URLs', async () => {
    const calls = [], api = adapter(opts => { calls.push(opts); return Promise.resolve([]); });
    await api.getProjects(); await api.getCurrentUser(); await api.getCreateMeta('D/O', '10'); await api.getComponents('D/O'); await api.getVersions('D/O'); await api.searchUsers('alice'); await api.getAttachmentMeta();
    assert.deepEqual(calls.map(c => c.url), ['/jira/rest/api/2/project', '/jira/rest/api/2/myself', '/jira/rest/api/2/issue/createmeta', '/jira/rest/api/2/project/D%2FO/components', '/jira/rest/api/2/project/D%2FO/versions', '/jira/rest/api/2/user/picker', '/jira/rest/api/2/attachment/meta']);
    assert.ok(calls.every(c => c.type === 'GET'));
    assert.equal(calls[2].data.projectKeys, 'D/O');
    assert.equal(calls[2].data.issuetypeIds, '10');
    assert.equal(calls[5].data.query, 'alice');
    assert.throws(() => adapter(() => {}, 'https://evil.example/jira'));
    assert.throws(() => adapter(() => {}, '//evil.example'));
    assert.throws(() => adapter(() => {}, '/jira/../evil'));
    const same = [], absolute = adapter(o => { same.push(o); return Promise.resolve([]); }, 'https://jira.example/jira/');
    await absolute.getProjects();
    assert.equal(same[0].url, '/jira/rest/api/2/project');
});

test('catalog pagination is collected, malformed or stalled pages fail visibly', async () => {
    const calls = [], api = adapter(o => { calls.push(o); return Promise.resolve({ values: [{ id: String(o.data.startAt || 0) }], startAt: o.data.startAt || 0, total: 2, maxResults: 1 }); });
    const result = await api.getComponents('DO');
    assert.equal(result.complete, true);
    assert.deepEqual(Array.from(result.values, v => v.id), ['0', '1']);
    assert.equal(calls.length, 2);
    for (const data of [{ values: [], total: 2, startAt: 0 }, { values: [{}], total: 2, startAt: 4 }, { nonsense: [] }]) {
        await assert.rejects(adapter(() => Promise.resolve(data)).getProjects(), e => e.kind === 'incomplete');
    }
});

test('user picker reports limited results as partial and cannot assert assignment rights', async () => {
    const result = await adapter(() => Promise.resolve({ users: [{ name: 'alice' }], total: 20 })).searchUsers('a');
    assert.equal(result.complete, false);
    assert.equal(result.values[0].name, 'alice');
    assert.equal(result.assignable, undefined);
});

test('HTTP and transport errors have only sanitized stable fields', async () => {
    for (const [status, kind] of [[401, 'unauthorized'], [403, 'forbidden'], [404, 'not-found'], [429, 'rate-limit'], [500, 'server'], [0, 'network']]) {
        await assert.rejects(adapter(() => Promise.reject({ status, responseText: 'SECRET', responseJSON: { errors: { summary: 'SECRET' } }, headers: { authorization: 'SECRET' } })).getCurrentUser(), e => {
            assert.equal(e.kind, kind); assert.equal(e.status, status);
            assert.deepEqual(Object.keys(e).sort(), ['fieldErrors', 'kind', 'message', 'status']);
            assert.doesNotMatch(JSON.stringify(e), /SECRET|response|headers|authorization/);
            return true;
        });
    }
    await assert.rejects(adapter(() => { throw new Error('SECRET'); }).getCurrentUser(), e => e.kind === 'network' && !JSON.stringify(e).includes('SECRET'));
});

test('abort signal aborts jqXHR and pre-aborted reads send no request', async () => {
    const controller = new AbortController(); let aborted = 0, calls = 0;
    const api = adapter(() => { calls++; const request = new Promise(() => {}); request.abort = () => aborted++; return request; });
    const pending = api.getProjects({ signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, e => e.kind === 'abort');
    assert.equal(aborted, 1);
    await assert.rejects(api.getCurrentUser({ signal: controller.signal }), e => e.kind === 'abort');
    assert.equal(calls, 1);
});

test('project catalogs carry scope and cancellation reaches later pages', async () => {
    const calls = [], controller = new AbortController(); let aborted = 0;
    const api = adapter(o => {
        calls.push(o);
        if (calls.length === 1) return Promise.resolve({ values: [{ id: '1' }], total: 2, startAt: 0 });
        const pending = new Promise(() => {}); pending.abort = () => aborted++;
        return pending;
    });
    const pending = api.getVersions('DO', { signal: controller.signal });
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    await assert.rejects(pending, e => e.kind === 'abort');
    assert.equal(calls.length, 2);
    assert.equal(aborted, 1);
    const catalog = await adapter(() => Promise.resolve([{ id: '1' }])).getComponents('DO');
    assert.equal(catalog.projectKey, 'DO');
});

test('duplicate and inconsistent pages cannot be declared complete', async () => {
    for (const second of [
        { values: [{ id: '1' }], total: 2, startAt: 1 },
        { values: [{ id: '2' }], total: 3, startAt: 1 },
        { values: [{ id: '2' }], total: 2, startAt: 1, isLast: false }
    ]) {
        let count = 0;
        await assert.rejects(adapter(() => Promise.resolve(count++ ? second : { values: [{ id: '1' }], total: 2, startAt: 0 })).getProjects(), e => e.kind === 'incomplete');
    }
});

test('create metadata preserves legacy project wrappers and collects explicit pages', async () => {
    const project = { id: '1', key: 'DO', issuetypes: [{ id: '10', fields: {} }] };
    const legacy = await adapter(() => Promise.resolve({ projects: [project] })).getCreateMeta('DO', '10');
    assert.equal(legacy.projects[0].key, 'DO');
    const calls = [], api = adapter(o => {
        calls.push(o);
        return Promise.resolve({ projects: [calls.length === 1 ? project : { id: '2', key: 'APP', issuetypes: [] }], startAt: calls.length - 1, total: 2 });
    });
    const result = await api.getCreateMeta('DO', null);
    assert.equal(result.projects.length, 2);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].data.startAt, 1);
    assert.equal(calls[1].data.projectKeys, 'DO');
});

test('DEVOPS duplicate check distinguishes same title from identical content',async()=>{
    const draft={fields:{summary:'Перенос API в TEST',description:'Обновить версию на TEST'}};
    function apiWith(content) {
        return adapter(o=>{
            assert.equal(o.type,'GET');
            assert.match(o.data.jql,/^project = DEVOPS AND summary ~/);
            return Promise.resolve({total:1,issues:[{key:'DEVOPS-21',fields:{summary:draft.fields.summary,description:content}}]});
        });
    }
    const possible=await apiWith('Другая версия').checkDevopsIssue(draft,{});
    assert.match(possible.warnings[0],/DEVOPS-21/);
    assert.deepEqual(Object.keys(possible.fieldErrors),[]);
    const differentCase=await apiWith(draft.fields.description.toLowerCase()).checkDevopsIssue(draft,{});
    assert.deepEqual(Object.keys(differentCase.fieldErrors),[]);
    const duplicate=await apiWith(draft.fields.description).checkDevopsIssue(draft,{});
    assert.match(duplicate.fieldErrors.summary[0],/DEVOPS-21/);
});

test('DEVOPS attaches only an explicitly supplied parent using the live child relation direction',async()=>{
    for(const direction of ['inward','outward']) {
        const type={name:'Hierarchy',inward:'is parent of',outward:'is parent of'};
        type[direction]='is child of';
        const paths=[],api=adapter(o=>{
            paths.push(o.url);
            if(o.url.endsWith('/search'))return Promise.resolve({total:0,issues:[]});
            if(o.url.endsWith('/issueLinkType'))return Promise.resolve({issueLinkTypes:[type]});
            assert.match(o.url,/\/issue\/APP-123$/);
            return Promise.resolve({key:'APP-123',fields:{issuetype:{name:'История'}}});
        });
        const draft={issueTypeId:'5',source:'Работа в рамках истории APP-123',fields:{summary:'Обновить API',description:'Родительская история: APP-123'}};
        const meta={issueTypes:[{id:'5',fields:[{id:'issuelinks'}]}]};
        assert.deepEqual(JSON.parse(JSON.stringify((await api.checkDevopsIssue(draft,meta)).link)),{type:{name:'Hierarchy'},[direction+'Issue']:{key:'APP-123'}});
        for (const source of ['Связанный инцидент APP-123. Родительской истории нет.', 'Родительская история: APP-123. Без истории.', 'Родительская история: APP-123. Не связывай с APP-123.', 'Родительская история: APP-123. Убери родителя.', 'Родительская история: APP-123. Родительская история: APP-124.']) {
            draft.source=source;
            assert.match((await api.checkDevopsIssue(draft,meta)).fieldErrors.description[0],/Для связи/);
        }
        paths.length=0;draft.fields.description='Связанные заявки: APP-123';
        assert.equal((await api.checkDevopsIssue(draft,meta)).link,null);
        assert.equal(paths.length,1);
        draft.source='Связанная задача APP-124';draft.fields.description='Родительская история: APP-124';
        assert.match((await api.checkDevopsIssue(draft,meta)).fieldErrors.description[0],/Для связи/);
    }
});
