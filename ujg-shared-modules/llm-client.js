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

  function requestText(config, request, fetchImpl) {
    var normalized = normalizeConfig(config);
    var callFetch = typeof fetchImpl === "function" ? fetchImpl : (typeof fetch === "function" ? fetch : null);
    if (!normalized) return Promise.reject(new Error("AI config is invalid"));
    if (!callFetch) return Promise.reject(new Error("fetch is unavailable"));

    function performRequest(forceLegacy, allowFallback) {
      var requestUrl = buildRequestUrl(normalized, forceLegacy);
      return Promise.resolve(callFetch(requestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + normalized.apiKey,
        },
        body: JSON.stringify(buildRequestBody(normalized, request, forceLegacy)),
      })).then(function(resp) {
        return Promise.resolve(resp && typeof resp.text === "function" ? resp.text() : "").then(function(text) {
          var payload = {};
          var out;
          if ((!resp || !resp.ok) && allowFallback && !forceLegacy && resp && (resp.status === 404 || resp.status === 405)) {
            return performRequest(true, false);
          }
          if (!resp || !resp.ok) {
            throw new Error("AI API " + (resp && resp.status != null ? resp.status : "error") + " (" + requestUrl + "): " + trimString(text));
          }
          if (trimString(text)) {
            try {
              payload = JSON.parse(text);
            } catch (err) {
              throw new Error("AI API вернул не-JSON ответ");
            }
          }
          out = extractResponseText(payload);
          if (!out) throw new Error("AI API вернул пустой ответ");
          return { text: out, payload: payload, url: requestUrl };
        });
      });
    }

    return performRequest(!!normalized.useLegacyCompletionsEndpoint, !normalized.useLegacyCompletionsEndpoint);
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
  };
});
