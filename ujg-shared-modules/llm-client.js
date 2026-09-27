define("_ujgShared_llmClient", [], function() {
  "use strict";

  var DEFAULT_STORAGE_KEY = "ujg-shared-llm-config";
  var MAX_BASE_PROMPT_BYTES = 6000;
  var MAX_USER_PROMPT_BYTES = 42000;
  var CHAT_COMPLETIONS_PATH = "/chat/completions";
  var LEGACY_COMPLETIONS_PATH = "/completions";
  var TRIM_SUFFIX = "\n...[trimmed]";

  function trimString(value) {
    return String(value == null ? "" : value).trim();
  }

  function utf8ByteLength(value) {
    var text = String(value == null ? "" : value);
    var total = 0;
    var i;
    var ch;
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
    for (i = 0; i < text.length; i++) {
      ch = text.charCodeAt(i);
      if (ch < 128) total += 1;
      else if (ch < 2048) total += 2;
      else if ((ch & 0xFC00) === 0xD800 && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xFC00) === 0xDC00) {
        total += 4;
        i += 1;
      } else {
        total += 3;
      }
    }
    return total;
  }

  function sliceByBytes(value, maxBytes) {
    var text = String(value == null ? "" : value);
    var out = "";
    var total = 0;
    var i;
    var ch;
    var charText;
    var charBytes;
    if (!text || maxBytes <= 0) return "";
    for (i = 0; i < text.length; i++) {
      ch = text.charCodeAt(i);
      charText = text.charAt(i);
      if ((ch & 0xFC00) === 0xD800 && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xFC00) === 0xDC00) {
        charText = text.substring(i, i + 2);
        charBytes = 4;
        i += 1;
      } else if (ch < 128) {
        charBytes = 1;
      } else if (ch < 2048) {
        charBytes = 2;
      } else {
        charBytes = 3;
      }
      if (total + charBytes > maxBytes) break;
      out += charText;
      total += charBytes;
    }
    return out;
  }

  function truncateByBytes(value, maxBytes, suffix) {
    var text = String(value == null ? "" : value);
    var tail = suffix == null ? "" : String(suffix);
    var suffixBytes = utf8ByteLength(tail);
    if (utf8ByteLength(text) <= maxBytes) return text;
    if (maxBytes <= suffixBytes) return sliceByBytes(tail, maxBytes);
    return sliceByBytes(text, maxBytes - suffixBytes) + tail;
  }

  function normalizePromptWhitespace(value) {
    return trimString(String(value == null ? "" : value)
      .replace(/\r/g, "\n")
      .replace(/\u00A0/g, " ")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n"));
  }

  function sanitizePrompt(value, maxBytes) {
    return truncateByBytes(normalizePromptWhitespace(value), maxBytes || MAX_BASE_PROMPT_BYTES, TRIM_SUFFIX);
  }

  function normalizeApiBaseParts(rawValue) {
    var value = trimString(rawValue).replace(/\/+$/, "");
    if (!value) return { apiBase: "", useLegacyCompletionsEndpoint: false };
    if (/\/chat\/completions$/i.test(value)) {
      return { apiBase: value.replace(/\/chat\/completions$/i, ""), useLegacyCompletionsEndpoint: false };
    }
    if (/\/completions$/i.test(value)) {
      return { apiBase: value.replace(/\/completions$/i, ""), useLegacyCompletionsEndpoint: true };
    }
    return { apiBase: value, useLegacyCompletionsEndpoint: false };
  }

  function toBool(value, fallback) {
    if (value == null || value === "") return !!fallback;
    if (typeof value === "boolean") return value;
    var normalized = trimString(value).toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "y";
  }

  function normalizeConfig(input) {
    var apiBaseParts;
    var model;
    var apiKey;
    if (!input || typeof input !== "object") return null;
    apiBaseParts = normalizeApiBaseParts(input.apiBase || input.url || input.endpoint);
    model = trimString(input.model);
    apiKey = trimString(input.apiKey || input.key || input.token);
    if (!apiBaseParts.apiBase || !model || !apiKey) return null;
    return {
      apiBase: apiBaseParts.apiBase,
      model: model,
      apiKey: apiKey,
      basePrompt: sanitizePrompt(input.basePrompt || input.base_prompt || input.systemPrompt || input.prompt, MAX_BASE_PROMPT_BYTES),
      useLegacyCompletionsEndpoint: toBool(input.useLegacyCompletionsEndpoint, apiBaseParts.useLegacyCompletionsEndpoint),
    };
  }

  function readStoredConfig(storage, storageKey) {
    if (!storage || typeof storage.getItem !== "function") return null;
    try {
      return normalizeConfig(JSON.parse(storage.getItem(storageKey || DEFAULT_STORAGE_KEY) || "null"));
    } catch (err) {
      return null;
    }
  }

  function writeStoredConfig(storage, config, storageKey) {
    var normalized = normalizeConfig(config);
    if (!normalized) return null;
    if (storage && typeof storage.setItem === "function") {
      storage.setItem(storageKey || DEFAULT_STORAGE_KEY, JSON.stringify(normalized));
    }
    return normalized;
  }

  function promptForConfig(promptFn, existing) {
    var current = existing || {};
    var apiBase;
    var model;
    var apiKey;
    if (typeof promptFn !== "function") return null;
    apiBase = promptFn("LLM API Base URL (например https://llm/v1, можно вставить полный endpoint)", current.apiBase || "");
    if (apiBase == null) return null;
    model = promptFn("LLM модель", current.model || "");
    if (model == null) return null;
    apiKey = promptFn("LLM API key", current.apiKey || "");
    if (apiKey == null) return null;
    return normalizeConfig({
      apiBase: apiBase,
      model: model,
      apiKey: apiKey,
      basePrompt: current.basePrompt,
      useLegacyCompletionsEndpoint: current.useLegacyCompletionsEndpoint,
    });
  }

  function buildRequestUrl(config, forceLegacy) {
    var normalized = normalizeConfig(config);
    var useLegacy;
    if (!normalized) throw new Error("AI config is invalid");
    useLegacy = forceLegacy == null ? !!normalized.useLegacyCompletionsEndpoint : !!forceLegacy;
    return normalized.apiBase + (useLegacy ? LEGACY_COMPLETIONS_PATH : CHAT_COMPLETIONS_PATH);
  }

  function buildRequestBody(config, request, forceLegacy) {
    var normalized = normalizeConfig(config);
    var systemPrompt = sanitizePrompt(request && request.systemPrompt, MAX_BASE_PROMPT_BYTES);
    var userPrompt = sanitizePrompt(request && request.userPrompt, MAX_USER_PROMPT_BYTES);
    var useLegacy;
    if (!normalized) throw new Error("AI config is invalid");
    if (!systemPrompt) throw new Error("AI prompt is empty");
    if (!userPrompt) throw new Error("AI user prompt is empty");
    useLegacy = forceLegacy == null ? !!normalized.useLegacyCompletionsEndpoint : !!forceLegacy;
    if (useLegacy) {
      return {
        model: normalized.model,
        temperature: request && request.temperature != null ? Number(request.temperature) : 0.2,
        prompt: systemPrompt + "\n\n" + userPrompt,
      };
    }
    return {
      model: normalized.model,
      temperature: request && request.temperature != null ? Number(request.temperature) : 0.2,
      messages: [
        { role: "user", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    };
  }

  function getContentParts(content) {
    if (typeof content === "string") return [content];
    if (!content) return [];
    if (Array.isArray(content)) {
      return content.map(function(part) {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        if (part && typeof part.content === "string") return part.content;
        return "";
      }).filter(Boolean);
    }
    if (typeof content.text === "string") return [content.text];
    if (typeof content.content === "string") return [content.content];
    return [];
  }

  function extractResponseText(payload) {
    var choice;
    var messageText;
    var outputText;
    if (!payload) return "";
    if (typeof payload === "string") return trimString(payload);
    if (typeof payload.output_text === "string") return trimString(payload.output_text);
    if (Array.isArray(payload.output)) {
      outputText = payload.output.map(function(item) {
        return getContentParts(item && item.content).join("\n");
      }).filter(Boolean).join("\n");
      if (outputText) return trimString(outputText);
    }
    choice = payload.choices && payload.choices[0];
    if (!choice) return "";
    if (choice.message) {
      messageText = getContentParts(choice.message.content).join("\n");
      if (messageText) return trimString(messageText);
    }
    if (typeof choice.text === "string") return trimString(choice.text);
    return "";
  }

  var traceSerial = 0;
  var TRACE_BODY_LIMIT = 65536;
  var SECRET_FIELD = /^(?:authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|(?:access|refresh|id)[-_]?token|token|password|passwd|pwd|(?:client[-_]?)?secret|private[-_]?key|secret[-_]?key|signature|sig|credentials|session(?:id)?)$/i;

  function createRequestTrace(config, options) {
    if (!options || typeof options.onTrace !== "function") return null;
    var started = now(), requestUrl = "", clockStart = started;
    var secrets = [config.apiKey, encodeURIComponent(config.apiKey), JSON.stringify(config.apiKey).slice(1,-1)].filter(Boolean);
    var encodedKeyPattern=config.apiKey ? new RegExp(Array.from(config.apiKey).map(function(ch) {
      var literal=ch.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
      var encoded=encodeURIComponent(ch);
      if (encoded===ch) encoded="%"+ch.charCodeAt(0).toString(16).padStart(2,"0");
      return "(?:"+literal+"|"+encoded.replace(/%/g,"%(?:25){0,2}")+")";
    }).join(""),"gi") : null;
    var trace = {
      schemaVersion:1, id:"llm-" + Date.now().toString(36) + "-" + (++traceSerial),
      startedAt:new Date().toISOString(), endedAt:null, durationMs:null, outcome:"running", phase:"prepare", summary:"Подготовка запроса LLM",
      request:{url:"",method:"POST",model:"",headers:{"Content-Type":"application/json",Authorization:"Bearer [скрыто]"},credentials:"same-origin",body:"",bodyBytes:0,systemBytes:0,userBytes:0,bodyTruncated:false,sent:false},
      response:{status:null,statusText:"",url:"",type:"",redirected:null,headers:{},body:"",bodyBytes:null,bodyTruncated:false,format:"неизвестно",jsonShape:"",finishReason:null,usage:{inputTokens:null,outputTokens:null,totalTokens:null,source:"unavailable"}},
      stages:[], network:{available:false,reason:"Браузер не предоставил однозначные сетевые тайминги."},
      limitations:[
        "Cookie и Set-Cookie не читаются. Режим credentials не доказывает, какие cookies отправил браузер.",
        "Fetch не раскрывает причину закрытия сокета. Сбой до HTTP-ответа не различает CORS, DNS, TLS и обрыв связи.",
        "Токены известны только из usage провайдера; размер запроса в байтах не является числом токенов.",
        "Представление очищено от распознанных секретов, но может содержать тексты замечаний и персональные данные."
      ]
    };
    function now() { return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now(); }
    function elapsed() { return Math.max(0, Math.round((now()-clockStart)*100)/100); }
    function cleanText(value) {
      var text = String(value == null ? "" : value);
      secrets.forEach(function(secret) { text = text.split(secret).join("[скрыто]"); });
      if (encodedKeyPattern && text.indexOf("%")!==-1) text=text.replace(encodedKeyPattern,"[скрыто]");
      return text
        .replace(/https?:\/\/[^\s"'<>]+/gi,function(url) {return stripUrlSecrets(url);})
        .replace(/\b(Bearer|Basic)\s+[^\s"'<>;,]+/gi,"$1 [скрыто]")
        .replace(/((?:authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|(?:access|refresh|id)[-_]?token|token|password|passwd|pwd|(?:client[-_]?)?secret|private[-_]?key|secret[-_]?key|signature|sessionid)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s,;}<]+)/gi,"$1[скрыто]");
    }
    function stripUrlSecrets(url) {
      var hideNext=false;
      return String(url || "").replace(/[?#].*$/, "").replace(/^(https?:\/\/)[^/@]+@/i,"$1").split("/").map(function(part) {
        var decoded=part;
        for(var i=0;i<3;i++) {try {var next=decodeURIComponent(decoded);if(next===decoded)break;decoded=next;} catch(ignored) {break;}}
        var hide=hideNext || secrets.some(function(secret){return decoded.indexOf(secret)!==-1;});
        hideNext=SECRET_FIELD.test(decoded);
        return hide ? "[скрыто]" : part;
      }).join("/");
    }
    function cleanValue(value, depth) {
      if (depth > 12) return "[вложенные данные скрыты]";
      if (typeof value === "string") {
        if (/^\s*[\[{]/.test(value)) {
          try { return JSON.stringify(cleanValue(JSON.parse(value),depth+1)); } catch (ignored) { /* Plain source text is valid input. */ }
        }
        return cleanText(value);
      }
      if (Array.isArray(value)) return value.map(function(item) {return cleanValue(item,depth+1);});
      if (value && typeof value === "object") {
        var copy=Object.create(null);
        Object.keys(value).forEach(function(key) {copy[cleanText(key)]=SECRET_FIELD.test(key) ? "[скрыто]" : cleanValue(value[key],depth+1);});
        return copy;
      }
      return value;
    }
    function cleanBody(value) {
      try { return JSON.stringify(cleanValue(JSON.parse(value),0)); }
      catch (ignored) { return cleanText(value); }
    }
    function safeUrl(url) {
      return cleanText(stripUrlSecrets(url));
    }
    function bodyPreview(target, body) {
      var cleaned=cleanBody(String(body || ""));
      target.bodyBytes=utf8ByteLength(body);
      target.bodyTruncated=utf8ByteLength(cleaned)>TRACE_BODY_LIMIT;
      target.body=truncateByBytes(cleaned,TRACE_BODY_LIMIT,"\n[диагностическое представление сокращено]");
    }
    function publish() {
      // Only detached, sanitized data crosses the transport/UI boundary.
      try { options.onTrace(JSON.parse(JSON.stringify(trace))); } catch (ignored) { /* Diagnostics must not affect the request. */ }
    }
    function finishStage(status) {
      var stage=trace.stages[trace.stages.length-1];
      if (stage && stage.status==="running") { stage.durationMs=Math.max(0,Math.round((elapsed()-stage.startedMs)*100)/100);stage.status=status; }
    }
    function stage(name) {
      finishStage("ok");trace.phase=name;
      if (name==="headers") trace.request.sent=null;
      trace.stages.push({name:name,startedMs:elapsed(),durationMs:null,status:"running"});publish();
    }
    function token(value) { return typeof value==="number" && isFinite(value) && value>=0 && Math.floor(value)===value ? value : null; }
    function parsed(payload) {
      var usage=payload && payload.usage || {}, choice=payload && payload.choices && payload.choices[0];
      var input=token(usage.prompt_tokens != null ? usage.prompt_tokens : usage.input_tokens);
      var output=token(usage.completion_tokens != null ? usage.completion_tokens : usage.output_tokens);
      var total=token(usage.total_tokens);
      trace.response.usage={inputTokens:input,outputTokens:output,totalTokens:total,source:input!==null || output!==null || total!==null ? "provider" : "unavailable"};
      trace.response.finishReason=choice && typeof choice.finish_reason==="string" ? cleanText(choice.finish_reason).slice(0,200) : null;
      trace.response.jsonShape=Array.isArray(payload) ? "array ("+payload.length+")" : payload && typeof payload==="object" ? "object: "+Object.keys(payload).slice(0,40).map(cleanText).join(", ") : typeof payload;
    }
    function network() {
      if (typeof performance==="undefined" || typeof performance.getEntriesByName!=="function") return;
      try {
        var entries=performance.getEntriesByName(requestUrl,"resource").filter(function(entry) {return entry.initiatorType==="fetch" && entry.startTime>=started && entry.startTime<=now();});
        if (entries.length!==1 || !(entries[0].requestStart>0) || !(entries[0].responseStart>0)) return;
        var e=entries[0];
        function span(a,b) {return a>0 && b>=a ? Math.round((b-a)*100)/100 : null;}
        trace.network={available:true,source:"PerformanceResourceTiming",dnsMs:span(e.domainLookupStart,e.domainLookupEnd),connectMs:span(e.connectStart,e.connectEnd),tlsMs:span(e.secureConnectionStart,e.connectEnd),ttfbMs:span(e.requestStart,e.responseStart),downloadMs:span(e.responseStart,e.responseEnd),protocol:cleanText(e.nextHopProtocol || "")};
      } catch (ignored) { /* Timing access is optional and origin-dependent. */ }
    }
    function fail(phase, error) {
      if (trace.outcome!=="running") return;
      trace.phase=phase || trace.phase;finishStage("error");trace.outcome="error";
      var messages={prepare:"Не удалось подготовить запрос LLM.",headers:"LLM: браузер не предоставил HTTP-ответ. Причина сетевого сбоя не раскрыта.",body:"LLM: не удалось прочитать тело ответа.",http:"LLM: сервер вернул HTTP " + trace.response.status + ".",json:"LLM: ответ получен, но не удалось разобрать JSON.",extract:"LLM: ответ получен, но текст результата пуст или формат не поддерживается."};
      trace.summary=messages[trace.phase] || "Не удалось обработать ответ LLM.";
      trace.error={name:cleanText(error && error.name || "Error"),message:cleanText(error && error.message || "").slice(0,2000)};
      trace.endedAt=new Date().toISOString();trace.durationMs=elapsed();network();publish();
    }
    stage("prepare");
    return {
      stage:stage,
      prepared:function(url,body,request) {
        requestUrl=url;trace.request.url=safeUrl(url);trace.request.model=cleanText(config.model);bodyPreview(trace.request,body);
        trace.request.systemBytes=utf8ByteLength(sanitizePrompt(request && request.systemPrompt,MAX_BASE_PROMPT_BYTES));
        trace.request.userBytes=utf8ByteLength(sanitizePrompt(request && request.userPrompt,MAX_USER_PROMPT_BYTES));
      },
      notSent:function(request) {
        trace.request.headers={};trace.request.credentials=null;
        trace.request.systemBytes=utf8ByteLength(request && request.systemPrompt || "");
        trace.request.userBytes=utf8ByteLength(request && request.userPrompt || "");
        trace.limitations.unshift("Сетевая отправка не начиналась. Тело запроса не сохранялось.");
      },
      headers:function(resp) {
        trace.request.sent=resp ? true : null;
        trace.response.status=resp && typeof resp.status==="number" ? resp.status : null;
        trace.response.statusText=cleanText(resp && resp.statusText);trace.response.url=safeUrl(resp && resp.url);
        trace.response.type=cleanText(resp && resp.type);trace.response.redirected=resp && typeof resp.redirected==="boolean" ? resp.redirected : null;
        if (resp && resp.headers && typeof resp.headers.forEach==="function") resp.headers.forEach(function(value,name) {
          var key=String(name).toLowerCase();
          trace.response.headers[cleanText(key)]=/^(content-type|content-length|date|retry-after|x-request-id|request-id|x-correlation-id|traceparent|server-timing|timing-allow-origin|x-ratelimit-(limit|remaining|reset)(-requests|-tokens)?)$/.test(key) ? cleanText(value).slice(0,2000) : "[скрыто]";
        });
      },
      body:function(text) {
        bodyPreview(trace.response,text);
        trace.response.format=!trimString(text) ? "empty" : /^\s*</.test(text) ? "html/xml" : "text";
        try {var value=JSON.parse(text);trace.response.format="json";parsed(value);} catch(ignored) { /* The main parser will report non-JSON errors. */ }
      },
      fail:fail,
      success:function() {finishStage("ok");trace.outcome="success";trace.summary="Ответ LLM получен и разобран.";trace.endedAt=new Date().toISOString();trace.durationMs=elapsed();network();publish();},
      summary:function() {return trace.summary;}
    };
  }

  function tracePreparationFailure(message, request, options) {
    var diagnostic=createRequestTrace({apiKey:"",model:""},options);
    if (diagnostic) {diagnostic.notSent(request);diagnostic.fail("prepare",new Error(message));}
  }

  function requestText(config, request, fetchImpl, diagnosticOptions) {
    var normalized = normalizeConfig(config);
    var callFetch = typeof fetchImpl === "function" ? fetchImpl : (typeof fetch === "function" ? fetch : null);
    if (!normalized) return Promise.reject(new Error("AI config is invalid"));
    if (!callFetch) return Promise.reject(new Error("fetch is unavailable"));

    function performRequest(forceLegacy, allowFallback) {
      var diagnostic = createRequestTrace(normalized,diagnosticOptions), requestUrl;
      return Promise.resolve().then(function() {
        requestUrl=buildRequestUrl(normalized,forceLegacy);
        var body=JSON.stringify(buildRequestBody(normalized,request,forceLegacy));
        if (diagnostic) {diagnostic.prepared(requestUrl,body,request);diagnostic.stage("headers");}
        return callFetch(requestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + normalized.apiKey,
        },
        body: body,
      });}).then(function(resp) {
        if (diagnostic) {diagnostic.headers(resp);diagnostic.stage("body");}
        return Promise.resolve().then(function() {return resp && typeof resp.text === "function" ? resp.text() : "";}).then(function(text) {
          var payload = {};
          var out;
          if ((!resp || !resp.ok) && allowFallback && !forceLegacy && resp && (resp.status === 404 || resp.status === 405)) {
            if (diagnostic) {diagnostic.stage("http");diagnostic.body(text);diagnostic.fail("http",new Error("HTTP " + resp.status + "; переход к legacy endpoint разрешён вызывающим кодом."));}
            return performRequest(true, false);
          }
          if (!resp || !resp.ok) {
            if (diagnostic) {
              diagnostic.stage("http");
              diagnostic.body(text);
              diagnostic.fail("http",new Error("HTTP " + (resp && resp.status != null ? resp.status : "неизвестно")));
              throw new Error(diagnostic.summary());
            }
            throw new Error("AI API " + (resp && resp.status != null ? resp.status : "error") + " (" + requestUrl + "): " + trimString(text));
          }
          if (diagnostic) {diagnostic.stage("json");diagnostic.body(text);}
          if (trimString(text)) {
            try {
              payload = JSON.parse(text);
            } catch (err) {
              throw new Error("AI API вернул не-JSON ответ");
            }
          }
          if (diagnostic) diagnostic.stage("extract");
          out = extractResponseText(payload);
          if (!out) throw new Error("AI API вернул пустой ответ");
          if (diagnostic) diagnostic.success();
          return { text: out, payload: payload, url: requestUrl };
        });
      }).catch(function(error) {
        if (!diagnostic) throw error;
        diagnostic.fail(null,error);
        throw new Error(diagnostic.summary());
      });
    }

    return performRequest(!!normalized.useLegacyCompletionsEndpoint, !normalized.useLegacyCompletionsEndpoint && !(request && request.allowProtocolFallback === false));
  }

  return {
    DEFAULT_STORAGE_KEY: DEFAULT_STORAGE_KEY,
    MAX_BASE_PROMPT_BYTES: MAX_BASE_PROMPT_BYTES,
    MAX_USER_PROMPT_BYTES: MAX_USER_PROMPT_BYTES,
    trimString: trimString,
    utf8ByteLength: utf8ByteLength,
    truncateByBytes: truncateByBytes,
    sanitizePrompt: sanitizePrompt,
    normalizeConfig: normalizeConfig,
    readStoredConfig: readStoredConfig,
    writeStoredConfig: writeStoredConfig,
    promptForConfig: promptForConfig,
    buildRequestUrl: buildRequestUrl,
    buildRequestBody: buildRequestBody,
    extractResponseText: extractResponseText,
    requestText: requestText,
    tracePreparationFailure: tracePreparationFailure,
  };
});
