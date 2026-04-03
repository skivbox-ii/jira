define("_ujgUA_aiReport", ["jquery", "_ujgUA_utils"], function($, utils) {
    "use strict";

    var STORAGE_KEY = "ujg-ua-ai-report-config";
    var MAX_PROMPT_TOKENS = 50000;
    // Use UTF-8 bytes as a conservative upper bound for tokens and leave headroom
    // for system prompt + chat wrapper metadata.
    var MAX_USER_PROMPT_BYTES = 42000;
    var MAX_WIDGET_TEXT_BYTES = 30000;
    var MAX_WIDGET_HTML_BYTES = 12000;
    var CHAT_COMPLETIONS_PATH = "/chat/completions";
    var LEGACY_COMPLETIONS_PATH = "/completions";
    var TRIM_SUFFIX = "\n...[trimmed]";
    var SYSTEM_PROMPT = [
        "Ты аналитик Jira-виджета User Activity.",
        "Сначала кратко объясни, что именно показывает переданный виджет и какие данные в нем доступны.",
        "Потом сделай выводы только по фактам из контекста.",
        "Не придумывай данные, сотрудников, цифры и события, которых нет в переданном HTML или тексте.",
        "Пиши по-русски.",
        "Структура ответа:",
        "1. Что показывает виджет",
        "2. Ключевые наблюдения",
        "3. Выводы по каждому сотруднику",
        "4. Сравнение сотрудников",
        "5. Риски и аномалии",
        "6. Что проверить дальше"
    ].join("\n");

    function trimString(value) {
        return String(value == null ? "" : value).trim();
    }

    function utf8ByteLength(value) {
        var text = String(value == null ? "" : value);
        var total = 0;
        var i;
        var ch;
        if (typeof TextEncoder !== "undefined") {
            return new TextEncoder().encode(text).length;
        }
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

    function sanitizeTextForPrompt(value) {
        return normalizePromptWhitespace(
            String(value == null ? "" : value)
                .replace(/[|]{3,}/g, " | ")
                .replace(/[-=]{4,}/g, " ")
        );
    }

    function sanitizeHtmlForPrompt(value) {
        return normalizePromptWhitespace(
            String(value == null ? "" : value)
                .replace(/<!--[\s\S]*?-->/g, " ")
                .replace(/<(script|style|svg|noscript|canvas)\b[\s\S]*?<\/\1>/gi, " ")
                .replace(/<(path|circle|rect|line|polyline|polygon|ellipse|defs|symbol|use|meta|link)\b[^>]*\/?>/gi, " ")
                .replace(/\s+(class|style|id|role|tabindex|xmlns|width|height|viewbox|fill|stroke|d|x|y|cx|cy|r|rx|ry|points|transform|aria-[\w:-]+|data-[\w:-]+)="[^"]*"/gi, "")
                .replace(/\s+(class|style|id|role|tabindex|xmlns|width|height|viewbox|fill|stroke|d|x|y|cx|cy|r|rx|ry|points|transform|aria-[\w:-]+|data-[\w:-]+)='[^']*'/gi, "")
                .replace(/<([a-z][\w:-]*)(\s[^>]*?)?>/gi, function(match, tagName) {
                    return "<" + String(tagName || "").toLowerCase() + ">";
                })
                .replace(/<\/([a-z][\w:-]*)\s*>/gi, function(match, tagName) {
                    return "</" + String(tagName || "").toLowerCase() + ">";
                })
                .replace(/>\s*</g, ">\n<")
        );
    }

    function buildPromptSection(label, value, maxBytes) {
        var title = trimString(label);
        var content = trimString(value);
        var titleBytes;
        if (!title || !content || maxBytes <= 0) return "";
        title = title + ":\n";
        titleBytes = utf8ByteLength(title);
        if (titleBytes >= maxBytes) return "";
        return title + truncateByBytes(content, maxBytes - titleBytes, TRIM_SUFFIX);
    }

    function toBool(value, fallback) {
        if (value == null || value === "") return !!fallback;
        if (typeof value === "boolean") return value;
        var normalized = trimString(value).toLowerCase();
        if (!normalized) return !!fallback;
        return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "y";
    }

    function normalizeApiBaseParts(rawValue) {
        var value = trimString(rawValue).replace(/\/+$/, "");
        if (!value) {
            return { apiBase: "", useLegacyCompletionsEndpoint: false };
        }
        if (/\/chat\/completions$/i.test(value)) {
            return {
                apiBase: value.replace(/\/chat\/completions$/i, ""),
                useLegacyCompletionsEndpoint: false
            };
        }
        if (/\/completions$/i.test(value)) {
            return {
                apiBase: value.replace(/\/completions$/i, ""),
                useLegacyCompletionsEndpoint: true
            };
        }
        return {
            apiBase: value,
            useLegacyCompletionsEndpoint: false
        };
    }

    function normalizeConfig(input) {
        if (!input || typeof input !== "object") return null;
        var apiBaseParts = normalizeApiBaseParts(input.apiBase || input.url || input.endpoint);
        var model = trimString(input.model);
        var apiKey = trimString(input.apiKey || input.key || input.token);
        if (!apiBaseParts.apiBase || !model || !apiKey) return null;
        return {
            apiBase: apiBaseParts.apiBase,
            model: model,
            apiKey: apiKey,
            useLegacyCompletionsEndpoint: toBool(
                input.useLegacyCompletionsEndpoint,
                apiBaseParts.useLegacyCompletionsEndpoint
            )
        };
    }

    function readStoredConfig(storage) {
        if (!storage || typeof storage.getItem !== "function") return null;
        try {
            return normalizeConfig(JSON.parse(storage.getItem(STORAGE_KEY) || "null"));
        } catch (err) {
            return null;
        }
    }

    function writeStoredConfig(storage, config) {
        var normalized = normalizeConfig(config);
        if (!normalized) return null;
        if (storage && typeof storage.setItem === "function") {
            storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
        }
        return normalized;
    }

    function promptForConfig(promptFn, existing) {
        if (typeof promptFn !== "function") return null;
        var current = existing || {};
        var apiBase = promptFn(
            "API Base URL (например https://llm/v1, можно вставить и полный endpoint)",
            current.apiBase || ""
        );
        if (apiBase == null) return null;
        var model = promptFn("Модель AI", current.model || "");
        if (model == null) return null;
        var apiKey = promptFn("API key", current.apiKey || "");
        if (apiKey == null) return null;
        return normalizeConfig({
            apiBase: apiBase,
            model: model,
            apiKey: apiKey,
            useLegacyCompletionsEndpoint: current.useLegacyCompletionsEndpoint
        });
    }

    function getPromptParts(content) {
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

    function buildUserPrompt(context) {
        context = context || {};
        var users = (context.selectedUsers || []).map(function(user) {
            return trimString(user && (user.displayName || user.name || user.key));
        }).filter(Boolean);
        var period = context.period && context.period.start && context.period.end
            ? context.period.start + " .. " + context.period.end
            : "";
        var widgetText = sanitizeTextForPrompt(context.widgetText);
        var widgetHtml = sanitizeHtmlForPrompt(context.widgetHtml);
        var parts = [
            context.widgetTitle ? "Название виджета: " + context.widgetTitle : "",
            context.widgetId ? "Код виджета: " + context.widgetId : "",
            users.length ? "Выбранные сотрудники: " + users.join(", ") : "",
            period ? "Период: " + period : "",
            context.summary ? "Задача: " + sanitizeTextForPrompt(context.summary) : ""
        ].filter(Boolean);
        var prompt = parts.join("\n\n");
        var remaining = MAX_USER_PROMPT_BYTES - utf8ByteLength(prompt);
        var textBudget;
        var htmlBudget;
        var textSection;
        var htmlSection;

        if (remaining > 0 && widgetText) {
            textBudget = Math.min(MAX_WIDGET_TEXT_BYTES, Math.max(0, remaining - Math.min(MAX_WIDGET_HTML_BYTES, Math.floor(remaining / 3))));
            textSection = buildPromptSection("Видимый текст виджета", widgetText, textBudget);
            if (textSection) {
                parts.push(textSection);
                prompt = parts.join("\n\n");
                remaining = MAX_USER_PROMPT_BYTES - utf8ByteLength(prompt);
            }
        }

        if (remaining > 0 && widgetHtml) {
            htmlBudget = Math.min(MAX_WIDGET_HTML_BYTES, remaining);
            htmlSection = buildPromptSection("Упрощенный HTML виджета", widgetHtml, htmlBudget);
            if (htmlSection) {
                parts.push(htmlSection);
            }
        }

        return truncateByBytes(parts.filter(Boolean).join("\n\n"), MAX_USER_PROMPT_BYTES, TRIM_SUFFIX);
    }

    function buildRequestUrl(config, forceLegacy) {
        var normalized = normalizeConfig(config);
        if (!normalized) throw new Error("AI config is invalid");
        var useLegacy = forceLegacy == null
            ? !!normalized.useLegacyCompletionsEndpoint
            : !!forceLegacy;
        return normalized.apiBase + (useLegacy ? LEGACY_COMPLETIONS_PATH : CHAT_COMPLETIONS_PATH);
    }

    function buildRequestBody(config, context, forceLegacy) {
        var normalized = normalizeConfig(config);
        if (!normalized) throw new Error("AI config is invalid");
        var useLegacy = forceLegacy == null
            ? !!normalized.useLegacyCompletionsEndpoint
            : !!forceLegacy;
        var userPrompt = buildUserPrompt(context);
        if (useLegacy) {
            return {
                model: normalized.model,
                temperature: 0.2,
                prompt: SYSTEM_PROMPT + "\n\n" + userPrompt
            };
        }
        return {
            model: normalized.model,
            temperature: 0.2,
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userPrompt }
            ]
        };
    }

    function extractResponseText(payload) {
        if (!payload) return "";
        if (typeof payload === "string") return trimString(payload);
        if (typeof payload.output_text === "string") return trimString(payload.output_text);
        if (Array.isArray(payload.output)) {
            var outputText = payload.output.map(function(item) {
                return getPromptParts(item && item.content).join("\n");
            }).filter(Boolean).join("\n");
            if (outputText) return trimString(outputText);
        }
        var choice = payload.choices && payload.choices[0];
        if (!choice) return "";
        if (choice.message) {
            var messageText = getPromptParts(choice.message.content).join("\n");
            if (messageText) return trimString(messageText);
        }
        if (typeof choice.text === "string") return trimString(choice.text);
        return "";
    }

    function requestReport(config, context, fetchImpl) {
        var normalized = normalizeConfig(config);
        if (!normalized) return Promise.reject(new Error("AI config is invalid"));
        var callFetch = typeof fetchImpl === "function" ? fetchImpl : (typeof fetch === "function" ? fetch : null);
        if (!callFetch) return Promise.reject(new Error("fetch is unavailable"));

        function performRequest(forceLegacy, allowFallback) {
            var requestUrl = buildRequestUrl(normalized, forceLegacy);
            return Promise.resolve(callFetch(requestUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + normalized.apiKey
                },
                body: JSON.stringify(buildRequestBody(normalized, context, forceLegacy))
            })).then(function(resp) {
                return Promise.resolve(resp && typeof resp.text === "function" ? resp.text() : "").then(function(text) {
                    if ((!resp || !resp.ok) && allowFallback && !forceLegacy && resp && (resp.status === 404 || resp.status === 405)) {
                        return performRequest(true, false);
                    }
                    if (!resp || !resp.ok) {
                        throw new Error(
                            "AI API " +
                            (resp && resp.status != null ? resp.status : "error") +
                            " (" + requestUrl + "): " +
                            trimString(text)
                        );
                    }
                    var payload = {};
                    if (trimString(text)) {
                        try {
                            payload = JSON.parse(text);
                        } catch (err) {
                            throw new Error("AI API вернул не-JSON ответ");
                        }
                    }
                    var reportText = extractResponseText(payload);
                    if (!reportText) {
                        throw new Error("AI API вернул пустой ответ");
                    }
                    return {
                        text: reportText,
                        payload: payload,
                        url: requestUrl
                    };
                });
            });
        }

        return performRequest(!!normalized.useLegacyCompletionsEndpoint, !normalized.useLegacyCompletionsEndpoint);
    }

    function getWindowRef() {
        return typeof window !== "undefined" && window ? window : null;
    }

    function getStorageRef() {
        var win = getWindowRef();
        return win && win.localStorage ? win.localStorage : null;
    }

    function getPromptRef() {
        var win = getWindowRef();
        if (win && typeof win.prompt === "function") {
            return function(message, value) {
                return win.prompt(message, value);
            };
        }
        if (typeof prompt === "function") return prompt;
        return null;
    }

    function ensureConfig(forcePrompt) {
        var storage = getStorageRef();
        var stored = readStoredConfig(storage);
        if (!forcePrompt && stored) return stored;
        var prompted = promptForConfig(getPromptRef(), stored || {});
        if (!prompted) return null;
        return writeStoredConfig(storage, prompted);
    }

    function renderContextMeta($body, context) {
        var users = (context.selectedUsers || []).map(function(user) {
            return trimString(user && (user.displayName || user.name || user.key));
        }).filter(Boolean);
        var lines = [];
        if (users.length) lines.push("Сотрудники: " + users.join(", "));
        if (context.period && context.period.start && context.period.end) {
            lines.push("Период: " + context.period.start + " .. " + context.period.end);
        }
        if (!lines.length) return;
        $body.append(
            $('<div class="mb-3 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground"></div>').text(lines.join(" | "))
        );
    }

    function open($host, options) {
        options = options || {};
        var context = options.context || {};
        var title = trimString(options.title || "ИИ отчет");
        var onClose = typeof options.onClose === "function" ? options.onClose : null;

        var $overlay = $('<div class="fixed inset-0 z-50 overflow-auto bg-black/80 backdrop-blur-sm p-4"></div>');
        var $dialog = $('<div class="dashboard-card bg-card text-card-foreground shadow-xl" style="max-width:1100px;margin:24px auto;"></div>');
        var $header = $('<div class="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-card px-4 py-3"></div>');
        var $title = $('<div class="flex items-center gap-2 text-sm font-semibold text-foreground"></div>');
        var $actions = $('<div class="ml-auto flex items-center gap-2"></div>');
        var $btnRetry = $('<button type="button" class="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors">Повторить</button>');
        var $btnConfig = $('<button type="button" class="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors">Настроить API</button>');
        var $btnClose = $('<button type="button" class="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"></button>');
        var $body = $('<div class="p-4"></div>');

        $title.html(utils.icon("sparkles", "w-4 h-4 text-primary") + "<span>" + utils.escapeHtml(title) + "</span>");
        $btnClose.html(utils.icon("x", "w-4 h-4"));
        $actions.append($btnRetry, $btnConfig, $btnClose);
        $header.append($title, $actions);
        $dialog.append($header, $body);
        $overlay.append($dialog);
        $host.append($overlay);

        function close() {
            $overlay.remove();
            if (onClose) onClose();
        }

        function renderMessage(titleText, bodyText, toneClass) {
            $body.empty();
            renderContextMeta($body, context);
            $body.append(
                $('<div class="mb-2 text-sm font-semibold"></div>')
                    .addClass(toneClass || "text-foreground")
                    .text(titleText)
            );
            $body.append(
                $('<div class="text-sm whitespace-pre-wrap break-words"></div>')
                    .addClass(toneClass === "text-destructive" ? "text-destructive" : "text-muted-foreground")
                    .text(bodyText)
            );
        }

        function renderReport(text) {
            $body.empty();
            renderContextMeta($body, context);
            $body.append(
                $('<div class="text-sm whitespace-pre-wrap break-words leading-snug text-foreground"></div>').text(text)
            );
        }

        function run(forcePrompt) {
            var config = ensureConfig(forcePrompt);
            if (!config) {
                renderMessage(
                    "Настройки AI не заданы",
                    "Введите API Base URL, например https://llm/v1, а также модель и API key.",
                    "text-destructive"
                );
                return;
            }

            renderMessage("Готовлю отчет", "Собираю контекст виджета и жду ответ AI...", "text-foreground");

            requestReport(config, context).then(function(result) {
                renderReport(result.text);
            }, function(err) {
                renderMessage("Не удалось получить AI-отчет", err && err.message ? err.message : String(err), "text-destructive");
            });
        }

        $btnClose.on("click", close);
        $btnRetry.on("click", function() {
            run(false);
        });
        $btnConfig.on("click", function() {
            run(true);
        });

        run(false);

        return {
            close: close
        };
    }

    return {
        STORAGE_KEY: STORAGE_KEY,
        MAX_PROMPT_TOKENS: MAX_PROMPT_TOKENS,
        MAX_USER_PROMPT_BYTES: MAX_USER_PROMPT_BYTES,
        normalizeConfig: normalizeConfig,
        readStoredConfig: readStoredConfig,
        writeStoredConfig: writeStoredConfig,
        promptForConfig: promptForConfig,
        utf8ByteLength: utf8ByteLength,
        sanitizeTextForPrompt: sanitizeTextForPrompt,
        sanitizeHtmlForPrompt: sanitizeHtmlForPrompt,
        buildRequestUrl: buildRequestUrl,
        buildUserPrompt: buildUserPrompt,
        buildRequestBody: buildRequestBody,
        extractResponseText: extractResponseText,
        requestReport: requestReport,
        open: open
    };
});
