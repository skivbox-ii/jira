const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const loadAmdModule = require("./helpers/load-amd-module");

function loadLlmClient(extraGlobals) {
  return loadAmdModule(path.join(__dirname, "..", "ujg-shared-modules", "llm-client.js"), {}, extraGlobals || {});
}

const traceConfig={apiBase:"https://llm.example/v1",model:"m",apiKey:"private-trace-key"};
const traceRequest={systemPrompt:"Правила",userPrompt:"Факты",allowProtocolFallback:false};
function response(body,status=200,extra={}) {
  return {ok:status>=200 && status<300,status,statusText:"",text:async()=>body,...extra};
}
async function traced(fetcher,request=traceRequest,config=traceConfig,globals={}) {
  const snapshots=[];let result,error;
  try {result=await loadLlmClient(globals).requestText(config,request,fetcher,{onTrace:trace=>snapshots.push(trace)});}
  catch (failure) {error=failure;}
  return {result,error,snapshots,trace:snapshots.at(-1)};
}

test("diagnostics capture actual normalized payload, phases and provider token usage",async()=>{
  let sent;
  const x=await traced(async(url,options)=>{sent=options;return response(JSON.stringify({choices:[{message:{content:"Ответ"},finish_reason:"stop"}],usage:{prompt_tokens:27,completion_tokens:8,total_tokens:35}}),200,{
    headers:new Map([["content-type","application/json"],["x-request-id","req-17"],["x-secret","private-value"]])
  });},{...traceRequest,userPrompt:"Факты\r\n  сегодня"});
  assert.ok(x.trace,"request must emit diagnostic snapshots");
  assert.equal(x.trace.outcome,"success");assert.equal(x.trace.request.body,sent.body);
  assert.equal(x.trace.request.bodyBytes,Buffer.byteLength(sent.body));
  assert.deepEqual(Array.from(x.trace.stages,s=>s.name),["prepare","headers","body","json","extract"]);
  assert.ok(x.trace.stages.every(s=>s.status==="ok" && s.durationMs>=0));
  assert.equal(x.trace.response.usage.inputTokens,27);assert.equal(x.trace.response.usage.outputTokens,8);
  assert.equal(x.trace.response.finishReason,"stop");assert.equal(x.trace.response.headers["x-request-id"],"req-17");
  assert.equal(x.trace.response.headers["x-secret"],"[скрыто]");
  assert.equal(x.snapshots[0].outcome,"running");assert.equal(x.snapshots[0].response.status,null);
  assert.equal(x.trace.request.headers.Authorization,"Bearer [скрыто]");
  assert.equal(x.result.text,"Ответ");assert.equal(x.trace.request.credentials,"same-origin");
});

test("diagnostics distinguish failure before headers, body failure, JSON and empty extraction",async()=>{
  const cases=[
    [()=>Promise.reject(new TypeError("Failed to fetch")),"headers",null],
    [()=>{throw new TypeError("fetch failed synchronously");},"headers",null],
    [async()=>response("",200,{text:async()=>{throw new TypeError("connection lost");}}),"body",200],
    [async()=>response("<html>gateway</html>"),"json",200],
    [async()=>response('{"bad":'),"json",200],
    [async()=>response(""),"extract",200],
    [async()=>response('{"unexpected":true}'),"extract",200]
  ];
  for(const [fetcher,phase,status] of cases) {
    const x=await traced(fetcher);
    assert.ok(x.trace,phase+" diagnostic is missing");assert.ok(x.error);
    assert.equal(x.trace.outcome,"error");assert.equal(x.trace.phase,phase);
    assert.equal(x.trace.response.status,status);assert.equal(x.trace.response.usage.inputTokens,null);
    assert.ok(x.trace.durationMs>=0);assert.equal(x.trace.stages.at(-1).status,"error");
    assert.doesNotMatch(x.trace.summary,/Проверьте подключение/);
  }
});

test("HTTP diagnostics preserve status and response without exposing secrets or retrying",async()=>{
  for(const status of [401,403,404,405,429,500]) {
    let calls=0;
    const body=JSON.stringify({error:{message:'Bearer private-trace-key; password="another-secret"',api_key:"unknown-api-secret"}});
    const x=await traced(async()=>{calls++;return response(body,status,{headers:new Map([["set-cookie","sessionid=cookie-secret"],["retry-after","30"]])});});
    assert.ok(x.trace);assert.equal(calls,1);assert.equal(x.trace.phase,"http");
    assert.equal(x.trace.response.status,status);assert.match(x.trace.summary,new RegExp(String(status)));
    assert.equal(x.trace.stages.find(stage=>stage.name==="body").status,"ok");
    assert.equal(x.trace.stages.at(-1).name,"http");
    assert.match(x.trace.response.body,/скрыто/);
    assert.doesNotMatch(JSON.stringify(x.snapshots),/private-trace-key|another-secret|unknown-api-secret|cookie-secret/);
    assert.doesNotMatch(x.error.message,/private-trace-key|another-secret|unknown-api-secret|cookie-secret/);
    assert.equal(x.trace.response.headers["retry-after"],"30");
  }
});

test("URL, request, exception and response credentials are redacted before callbacks",async()=>{
  const key='key-"/+$';
  const x=await traced(async()=>response(JSON.stringify({choices:[{message:{content:key}}],secret:"other-secret"})),
    {...traceRequest,userPrompt:JSON.stringify({token:"jira-source-secret",description:key})},
    {...traceConfig,apiKey:key,apiBase:"https://user:pass@llm.example/v1?token=query-secret#frag-secret"});
  assert.ok(x.trace);assert.equal(x.trace.outcome,"success");
  assert.doesNotMatch(JSON.stringify(x.snapshots),/jira-source-secret|other-secret|query-secret|frag-secret|user:pass/);
  assert.ok(!JSON.stringify(x.snapshots).includes(JSON.stringify(key).slice(1,-1)));
  assert.match(x.trace.request.url,/llm.example/);
  const failed=await traced(()=>Promise.reject(new Error('password="secret-exception" '+key)),traceRequest,{...traceConfig,apiKey:key});
  assert.doesNotMatch(JSON.stringify(failed.snapshots),/secret-exception/);
});

test("missing usage and opaque network details stay unknown, bounded previews are explicit",async()=>{
  const raw=JSON.stringify({choices:[{message:{content:"x".repeat(100000)}}]});
  const x=await traced(async()=>response(raw));
  assert.ok(x.trace);assert.equal(x.trace.response.usage.inputTokens,null);
  assert.equal(x.trace.response.usage.source,"unavailable");
  assert.equal(x.trace.network.available,false);assert.ok(x.trace.limitations.length);
  assert.equal(x.trace.response.bodyBytes,Buffer.byteLength(raw));assert.equal(x.trace.response.bodyTruncated,true);
  assert.ok(x.trace.response.body.length<100000);assert.equal(x.result.text.length,100000);
});

test("diagnostic callback failures cannot break or retry the actual request",async()=>{
  let calls=0;
  const result=await loadLlmClient().requestText(traceConfig,traceRequest,async()=>{calls++;return response('{"choices":[{"text":"ok"}]}');},
    {onTrace(){throw new Error("UI detached");}});
  assert.equal(result.text,"ok");assert.equal(calls,1);
});

test("diagnostics strip URL credentials even when fetch echoes a URL in its error",async()=>{
  const x=await traced(()=>Promise.reject(new Error("Cannot reach https://login:url-password@llm.example/v1?signature=signed-secret#fragment-secret")));
  assert.doesNotMatch(JSON.stringify(x.snapshots),/url-password|signed-secret|fragment-secret/);
});

test("encoded path keys and alternate credential fields never enter diagnostics",async()=>{
  const encoded=Array.from(traceConfig.apiKey,c=>"%"+c.charCodeAt(0).toString(16)).join("");
  const config={...traceConfig,apiBase:"https://llm.example/"+encoded+"/v1"};
  const x=await traced(async()=>response(JSON.stringify({error:{client_secret:"client-secret-value",pwd:"password-value",id_token:"id-token-value",message:"token at https://llm.example/"+encoded+"/v1"}}),401),traceRequest,config);
  assert.doesNotMatch(JSON.stringify(x.snapshots),/client-secret-value|password-value|id-token-value/);
  assert.ok(!JSON.stringify(x.snapshots).includes(encoded));
});

test("provider text cannot disclose lower-case or repeated percent-encoded keys",async()=>{
  const key="key/+secret";
  for(const encoded of ["key%2f%2bsecret","key%252f%252bsecret","%6b%65%79%2f%2b%73%65%63%72%65%74"]) {
    const x=await traced(async()=>response(JSON.stringify({error:{message:"echo "+encoded}}),500),traceRequest,{...traceConfig,apiKey:key});
    assert.ok(!JSON.stringify(x.snapshots).includes(encoded));
  }
});

test("provider usage numbers must be present, finite and nonnegative",async()=>{
  const x=await traced(async()=>response(JSON.stringify({choices:[{text:"ok"}],usage:{prompt_tokens:"52",completion_tokens:-1,total_tokens:0}})));
  assert.equal(x.trace.response.usage.inputTokens,null);assert.equal(x.trace.response.usage.outputTokens,null);assert.equal(x.trace.response.usage.totalTokens,0);
});

test("diagnostic snapshots remain separate across overlapping requests",async()=>{
  const client=loadLlmClient(),snapshots=[],releases=[];
  const fetcher=()=>new Promise(resolve=>releases.push(resolve));
  const a=client.requestText(traceConfig,{...traceRequest,userPrompt:"first"},fetcher,{onTrace:x=>snapshots.push(x)});
  const b=client.requestText(traceConfig,{...traceRequest,userPrompt:"second"},fetcher,{onTrace:x=>snapshots.push(x)});
  await Promise.resolve();releases[1](response('{"choices":[{"text":"second"}]}'));await b;
  releases[0](response("no",500));await assert.rejects(a,/500/);
  const finals=snapshots.filter(x=>x.outcome!=="running");assert.equal(finals.length,2);assert.notEqual(finals[0].id,finals[1].id);
  assert.match(finals[0].request.body,/second/);assert.match(finals[1].request.body,/first/);
});

test("single-request callers disable protocol fallback on 404 and 405", async () => {
  for (const status of [404,405]) {
    let calls=0;
    await assert.rejects(loadLlmClient().requestText({apiBase:"https://llm.example/v1",model:"m",apiKey:"test"},
      {systemPrompt:"Rules",userPrompt:"Facts",allowProtocolFallback:false},async()=>{
        calls++;return {ok:false,status,text:async()=>"unavailable"};
      }),/AI API/);
    assert.equal(calls,1);
  }
});

test("shared llm client calls chat completions and extracts text", async function () {
  const llm = loadLlmClient();
  const calls = [];
  const result = await llm.requestText({
    apiBase: "https://llm.example/v1",
    model: "model-a",
    apiKey: "sk-test",
  }, {
    systemPrompt: "Сократи название.",
    userPrompt: "Очень длинное замечание",
  }, function (url, options) {
    calls.push({ url: url, body: JSON.parse(options.body), headers: options.headers });
    return Promise.resolve({
      ok: true,
      status: 200,
      text: function () {
        return Promise.resolve(JSON.stringify({ choices: [{ message: { content: "Короткое название" } }] }));
      },
    });
  });

  assert.equal(result.text, "Короткое название");
  assert.equal(calls[0].url, "https://llm.example/v1/chat/completions");
  assert.equal(calls[0].headers.Authorization, "Bearer sk-test");
  assert.equal(calls[0].body.messages[0].content, "Сократи название.");
  assert.equal(calls[0].body.messages[1].content, "Очень длинное замечание");
});

test("shared llm client falls back to legacy completions on chat 404", async function () {
  const llm = loadLlmClient();
  const calls = [];
  const result = await llm.requestText({
    apiBase: "https://llm.example/v1",
    model: "model-a",
    apiKey: "sk-test",
  }, {
    systemPrompt: "Сократи название.",
    userPrompt: "Очень длинное замечание",
  }, function (url, options) {
    calls.push({ url: url, body: JSON.parse(options.body) });
    if (calls.length === 1) {
      return Promise.resolve({
        ok: false,
        status: 404,
        text: function () {
          return Promise.resolve("{}");
        },
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      text: function () {
        return Promise.resolve(JSON.stringify({ choices: [{ text: "Legacy title" }] }));
      },
    });
  });

  assert.equal(result.text, "Legacy title");
  assert.equal(calls[0].url, "https://llm.example/v1/chat/completions");
  assert.equal(calls[1].url, "https://llm.example/v1/completions");
  assert.match(calls[1].body.prompt, /^Сократи название\./);
});
