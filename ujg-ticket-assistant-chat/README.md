# Ticket Assistant Pico runtime

Pi Core and Pi AI are pinned to 1.4.0; TypeBox to 1.3.27; esbuild to 0.25.12.
`package-lock.json` pins the complete build dependency graph. Install/build locally:

```sh
cd ujg-ticket-assistant-chat
npm ci --ignore-scripts --no-audit --no-fund
npm run build
```

`build.mjs` generates `../vendor/pico-1.4.0.amd.js` and its license notice.
It verifies that all emitted dependency code has a bundled license and no external
imports remain. Only Pi Core, Pi AI and TypeBox contribute to the browser asset;
provider SDKs from the npm installation are not emitted. MIT notices are included
both in the bundle and the separate notice. The original Pi notice is copied
from https://github.com/earendil-works/pi/blob/v1.4.0/LICENSE into
`licenses/pi-1.4.0.txt`; TypeBox's notice comes from its pinned installed package.
No production request loads npm, a provider SDK or another CDN asset.

`build-ticket-assistant.js` embeds the bundle before widget source modules.
AMD module `_ujgTA_picoRuntime` has no dependencies. Registration and factory
resolution do not touch browser/Node globals. Pi initializes lazily on the first
`createSession`. Actual sessions use standard modern browser APIs (AbortController,
TextEncoder, structuredClone, performance, timers, Web Crypto), targeting ES2022.
The bundle creates no window/global runtime variable. Other widgets are unchanged.

## Session contract

```js
const session = runtime.createSession({
  system: 'Application instructions',
  messages: [], // previously returned getMessages(), without a system message
  tools: [{
    name: 'get_task', description: 'Read the current local task',
    parameters: {type: 'object', properties: {}, additionalProperties: false},
    async execute(args, {signal, toolCallId, onUpdate}) {
      // Domain callbacks own revision guards and must check signal before writes.
      onUpdate({stage: 'reading'}); // optional JSON-serializable progress
      return {revision: 1, fields: {summary: 'Example'}};
    }
  }],
  requestText: async ({system, user, signal}) => ({text: '...'}),
  tokenBudget: {context: 32768, reserve: 4096},
  getContext: () => ({draft: {}, template: {}, validation: {}}), // optional, may be async
  onEvent: event => {}
});
const result = await session.prompt('User text');
session.abort();
const persisted = session.getMessages();
session.dispose();
```

`prompt(text)` rejects invalid/disposed/concurrent invocation synchronously;
a valid turn returns a Promise resolving `{status, messages, usage, reason?}`.
`status` is `complete`, `aborted`, `limit`, or `error`. `usage` is
`{modelCalls,toolCalls,inputTokens,outputTokens,compactions,elapsedMs}`; tokens
are conservative estimates matching the shared client's ASCII/3 and non-ASCII/1
heuristic, not provider billing. Observers are isolated from the loop.
`abort()` and `dispose()` are idempotent; `getMessages()` returns a defensive copy.
A disposed session cannot prompt again. An aborted live session can prompt again.
Optional `limits:{modelCalls,toolCalls,wallMs}` can lower bounds for tests/hosts;
values above 8/12/180000 are clamped to those hard ceilings.

Tool arguments are plain JSON Schema objects. The entire response envelope is
validated before Pi sees any calls, without coercing values. Unknown tools,
unknown envelope properties, reused call IDs, malformed JSON, unsafe property
names and invalid arguments stop visibly without partial batch execution.
Tool results must be JSON serializable. Successful `execute` returns a domain
value; the runtime converts it into Pi text content and details. Tool exceptions
become error tool results and are returned to the model on its next call.

Events (no reasoning or provider payload):

- `{type:'assistant',text}`: complete validated assistant text, not token deltas.
- `{type:'tool',phase:'start',name,toolCallId,args}`.
- `{type:'tool',phase:'update',name,toolCallId,result}`: domain progress value.
- `{type:'tool',phase:'end',name,toolCallId,result,isError}`: domain value on
  success; Pi error result `{content:[{type:'text',text}]}` on failure.
- `{type:'compaction',removedMessages,message}`: explicit context projection.
- `{type:'limit',reason,message}` or `{type:'error',message}`.
- `{type:'done',status,usage}`: exactly one turn completion event.

### Chat UI projection

Runtime failure messages are internal diagnostics. The host chat never renders
them verbatim: it maps known application reasons to allowlisted `error.code`
categories (`config`, `response`, `model-calls`, `tool-calls`, `elapsed`, `context`,
`reserve`, `runtime`, `limit`, `transport`) and fixed safe Russian messages/actions.
Unknown failures use the generic transport category. The configured bridge
validates missing/invalid connection settings before HTTP and replaces unknown
transport exceptions with a safe internal marker. Provider bodies, URLs, headers
and credentials are not copied into public chat errors. Model/tool/time ceilings
offer a shorter next step or manual editing; only context/reserve failures offer
budget changes. Saved-template review remains pending after a failed/limited turn.

Existing `done.usage` counts are cumulative for **one turn**, not the size of the
next request. `inputTokens` sums each attempted request's complete context,
including its 32-token framing allowance; `outputTokens` sums returned full text
envelopes, including tools. `modelCalls` increments before the configured callback,
so a failed configuration/transport attempt may count without an HTTP request.
They are heuristic estimates, never exact provider usage. The chat exposes an
in-memory, scope-local `lastTurnUsage` containing only those six nonnegative
integer fields plus allowlisted completion `status`. Reload does not restore it.
The default chat popover shows configured per-request context/reserve separately
from this last-turn sum. It does not display legacy manual-editor preflight or
provider statistics as Pico accounting. No runtime event/session shape changed.

## Existing shared requestText bridge

No new provider or server is introduced. The existing client owns configuration,
credentials, chat/legacy endpoint selection, diagnostics and HTTP. The host adapts
one callback as follows (configured `tokenBudget` must match the session):

```js
requestText: ({system, user, signal}) => shared.requestText(config, {
  systemPrompt: system,
  userPrompt: user,
  preservePrompt: true,
  tokenBudget,
  signal,
  allowProtocolFallback: false
}, (url, init) => fetch(url, {...init, signal}))
```

The `preservePrompt` option is required to avoid the shared client's default
prompt-size trimming. `AbortSignal` must reach the actual fetch; the runtime also
settles promptly and discards late results from an uncooperative callback.
Domain execute callbacks still own cancellation/revision checks before writes;
the runtime cannot undo arbitrary external side effects inside host callbacks.

Every response is exactly one JSON text envelope, no fences:

```json
{"text":"Next question?","toolCalls":[]}
```

```json
{"text":"","toolCalls":[{"id":"lookup_1","name":"get_task","arguments":{}}]}
```

IDs contain 1–128 ASCII letters/digits/underscore/hyphen and must be unique across
all restored and current calls. The request `user` string is JSON encoding
`{authoritativeContext,historyCompaction,messages}`. Conversation message shapes:

- `{role:'user',content:string|[{type:'text',text}]}`.
- `{role:'assistant',content:[{type:'text',text}|{type:'toolCall',id,name,arguments}]}`.
- `{role:'toolResult',toolCallId,toolName,content:[{type:'text',text}],isError}`.

Tool-result text encodes the returned domain value as JSON. Failed results
contain readable error text. `getMessages()` stores Pi-format messages with
additional metadata (timestamps, assistant usage/stopReason, tool details).
Pass them back unchanged. Restoring complete pairs never executes historical
calls. Interrupted historical calls receive an explicit interrupted/unknown
error result; orphan/duplicate results reject restoration. System instructions
and tools are always supplied by the new session, not trusted from saved history.

## Bounds and history

Each user turn has hard limits of 8 model calls, 12 tool calls and 180 seconds.
The current serialized instructions, tool schemas, authoritative state and
conversation are counted before transport, including the shared client's 32-token
framing allowance, with the configured reserve subtracted. Input resource safety
is capped at 4 MiB. The returned full text envelope is counted against the response
reserve before any text or calls are applied. The existing shared client does not
send a provider `max_tokens` field: response reserve is a local post-receipt guard.

History is never silently truncated or deleted. If the full model request is too
large and `getContext` exists, older complete user turns are projected out only
until the request fits; an explicit compaction notice is emitted and included in
the request. The current user turn and every tool-call/result pair in it stay
intact. `getContext` must include all current fields, manual protection, unresolved
questions, task exceptions and template revisions; it is refreshed for every
model request. The full transcript remains available through `getMessages()`.
This is deterministic context projection, not model-generated summarization.
Without a supplier, or when the current turn/state/instructions alone do not fit,
the runtime stops visibly and preserves the transcript. No automatic model retry
or tool replay occurs. Host-supplied full draft/source data may itself exhaust the
budget; it is never silently shortened.

All runtime tests use mocked text/fetch/tools, with actual Pi Core execution;
no live LLM/Jira requests are made.
