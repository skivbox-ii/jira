# Pico knowledge dashboard: read connections

Task 1 supplies local, stub-tested AMD adapters. **Production transport acceptance is pending.** The controller owns the real JSON, identity, CORS, and browser access checks inside Citrix. A successful bridge `/health` response does not establish Confluence identity. These modules make no LLM calls and are independent of the task assistant and importer.

## AMD interface

- `_ujgKA_transport`: `createTransport({baseUrl, fetchImpl, mode, getToken})` returns `{getJson(path, query, {signal})}`. `fetchImpl` defaults to browser fetch; tests inject a stub. `getToken` is a synchronous callback, used only in bridge mode.
- `_ujgKA_confluenceApi` and `_ujgKA_jiraApi`: `createApi({transport, scopes, baseUrl})` returns `{search, read}`. Both depend on `_ujgKA_transport` for shared contract helpers. Adapter `baseUrl` is the upstream browser URL used for citations, **not** the bridge URL. Include the Jira/Confluence context path when applicable.
- `search({text, scopes?, cursor?, signal?})` resolves `{items, nextCursor, warnings}`. Each item is a Source. `cursor` is a nonnegative integer offset; initial cursor is omitted or zero; `null` means no next page. A request returns at most 20 sources.
- `read({id, offset?, signal?})` resolves `{source, text, total, nextOffset, warnings}`. Fragments contain at most 8000 JavaScript string characters. `total` describes the entire normalized text returned by the upstream read, and `nextOffset` is an integer or `null`. Offsets are UTF-16 positions. Each fragment request refetches the source; compare `version` to detect changes between fragments.
- Source: `{id, kind, title, url, version, updatedAt, fetchedAt}`. `kind` is `confluence` or `jira`. Confluence IDs are decimal strings; Jira source IDs are issue keys (read also accepts numeric issue IDs). `fetchedAt` is client ISO time. Confluence uses `version.number`/`version.when`; Jira uses `fields.updated` as its revision marker and `updatedAt`. Unknown revision/time values are `null`.

Adapter `scopes` is an array of allowed Confluence space keys or Jira project keys. It is copied at construction; missing/empty scopes deny both search and read. A per-search `scopes` array can only narrow that allowlist; unknown keys reject the entire request. Read checks the returned `space.key` or `fields.project.key` before releasing text, including for manually supplied IDs and transferred issues. It does not trust an issue-key prefix or earlier search. Recreate the adapter when the user's selected scope changes, and discard previous results. The read interface intentionally has no per-call scope argument.

Search quotes and escapes text and scope literals inside CQL/JQL. Responses are checked against the requested scopes as well, and out-of-scope results are omitted with warnings. Pagination advances by the raw bounded result count, so scope filtering cannot silently repeat a page. Returned pagination offsets must match the requested offset; malformed totals reject. Unknown totals produce a warning; a full page offers another offset. Upstream next-link URLs are never followed. Keep warnings visible: a terminal cursor with an unknown total or stalled page does not prove complete enumeration.

Confluence text is a plain-text approximation of `body.storage`: active markup is removed, common/numeric entities decoded, and common block boundaries retained. Jira reads `fields.description` as a string (null means empty). Unsupported structured Jira description objects reject rather than silently becoming empty text. This stage does not render Confluence macros, retrieve attachments/comments, or claim those are included in `total`.

## Jira session mode

```javascript
var jiraTransport = transportModule.createTransport({
    mode: 'session', baseUrl: '/jira', fetchImpl: window.fetch.bind(window)
});
var jira = jiraModule.createApi({
    transport: jiraTransport, scopes: ['DOC'], baseUrl: window.location.origin + '/jira'
});
```

`baseUrl` is a context path (empty for root) or an absolute URL on the current Jira origin. Foreign origins, URL credentials, query/hash, encoded paths, backslashes, and dot traversal are rejected. Requests use `GET`, `credentials: 'same-origin'`, and `redirect: 'error'`. There is no Authorization header in this mode.

Fixed endpoint and query allowlist:

| Path | Query keys |
| --- | --- |
| `/rest/api/2/myself` | none |
| `/rest/api/2/search` | `jql`, `fields`, `startAt`, `maxResults` |
| `/rest/api/2/issue/<issue-key-or-digits>` | `fields` |

Search requests `summary,project,updated`; read requests `summary,description,project,updated`. The project field is required to enforce read scopes.

## Python bridge mode for Confluence

Configure the user's bridge URL, typically `http://127.0.0.1:8769`. HTTP is accepted only for `127.0.0.1`, `localhost`, or `[::1]`; HTTPS is accepted for configured bridge hosts. URL credentials, query/hash, encoded paths, backslashes, and traversal are rejected. The bridge is responsible for forwarding these read routes to its fixed Confluence upstream and permitting the Jira origin via CORS. Do not change Confluence CORS or reuse the old PowerShell script.

```javascript
// Illustrative only: called by the controller after the user's connection action.
var bridge = transportModule.createTransport({
    mode: 'bridge', baseUrl: bridgeUrl,
    fetchImpl: window.fetch.bind(window),
    getToken: function() { return inMemoryToken; }
});
await bridge.getJson('/rest/api/user/current', {}, {signal: signal});
var confluence = confluenceModule.createApi({
    transport: bridge, scopes: ['DOC'], baseUrl: confluenceBrowserBaseUrl
});
```

Before identity succeeds, content requests reject with `code: 'not-configured'`, message `Подключение не настроено`, without dispatching fetch. Identity must be JSON with `type: 'known'` and a nonempty string user identifier (`userKey`, `username`, or `accountId`). Anonymous, HTML, and malformed identities never unlock reads. The controller must show the connection as unfinished until that explicit identity call succeeds. A 401/403 clears the transport's verified state. A new identity attempt also clears the previous state before fetching. Recreate the transport and check identity when changing credentials or bridge configuration; disconnect by dropping the transport and clearing the in-memory token.

Every bridge fetch obtains the current bearer through `getToken()` and sends `Authorization: Bearer …`, `credentials: 'omit'`, and `redirect: 'error'`. No token is embedded in URLs, sources, errors, persisted settings, storage, history, diagnostics, logs, or LLM context. The controller must keep its callback's token in tab memory only and must not log fetch options/headers or serialize them into model tools. Only the bridge URL and nonsecret scope preferences may be persisted. `getToken()` must return a nonempty string; callback errors and missing credentials yield a fixed error without exposing callback text.

Fixed endpoint and query allowlist:

| Path | Query keys |
| --- | --- |
| `/rest/api/user/current` | none |
| `/rest/api/content/search` | `cql`, `expand`, `start`, `limit` |
| `/rest/api/content/<digits>` | `expand` |

Search expands `space,version`; read expands `body.storage,version,space`. `/health` is intentionally outside the transport API. CORS preflight OPTIONS is browser/bridge infrastructure; the application sends no write methods.

## Errors and cancellation

All asynchronous transport/adapter failures are fixed objects `{code, message, retryAfter}`. Codes: `not-configured`, `invalid-request`, `invalid-response`, `unauthorized` (401), `forbidden` (403), `rate-limit` (429), `aborted`, `network`, `http`, `scope`. `retryAfter` is seconds for a valid 429 `Retry-After` numeric or HTTP-date header; otherwise `null`. There are no automatic retries. Server error bodies and raw exceptions are not exposed. Invalid citation base URLs reject at adapter construction with the same error shape.

HTML 200, unexpected media types, non-object/invalid JSON, and redirected responses reject. `getJson` cannot accept arbitrary endpoints or headers, and rejects explicit non-GET methods and query keys outside its allowlist. Callers propagate `AbortSignal`; cancellation is checked before dispatch and after fetch/JSON. No identity, search, or read is run automatically when constructing an adapter.

## Local verification and remaining acceptance

Run `node --test tests/knowledge-assistant-api.test.js`. Every request uses a local fetch stub: no production, network, LLM, or Citrix activity. Coverage includes scoped search and read, returned-space/project checks, escaping, path/method/origin restrictions, auth/error mapping, identity gating/invalidation, abort, metadata, explicit search pagination, and 8000-character fragments.

The controller still needs to accept Confluence authorization and Jira-origin browser fetch through the Python bridge in Citrix, and confirm the deployed Jira/Confluence versions accept the emitted query syntax and expansions. The controller also owns browser identity UI and the later model/tool budgets (8/12/180 seconds, context default 32768 with reserve 4096); these API modules do not invoke a model or run an agent turn. Production readiness is not asserted by the local tests.
