define("_ujgUA_aiReport", ["jquery", "_ujgUA_utils"], function($, utils) {
    "use strict";

    var STORAGE_KEY = "ujg-ua-ai-report-config";
    var MAX_HTML_CHARS = 120000;
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

    function normalizeConfig(input) {
        if (!input || typeof input !== "object") return null;
        var url = trimString(input.url || input.endpoint || input.apiBase);
        var model = trimString(input.model);
        var apiKey = trimString(input.apiKey || input.key || input.token);
        if (!url || !model || !apiKey) return null;
        return {
            url: url,
            model: model,
            apiKey: apiKey
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
        var url = promptFn("URL AI API", current.url || "");
        if (url == null) return null;
        var model = promptFn("Модель AI", current.model || "");
        if (model == null) return null;
        var apiKey = promptFn("API key", current.apiKey || "");
        if (apiKey == null) return null;
        return normalizeConfig({
            url: url,
            model: model,
            apiKey: apiKey
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
        var widgetText = trimString(context.widgetText);
        var widgetHtml = trimString(context.widgetHtml);

        if (widgetHtml.length > MAX_HTML_CHARS) {
            widgetHtml = widgetHtml.slice(0, MAX_HTML_CHARS) + "\n<!-- trimmed -->";
        }

        return [
            context.widgetTitle ? "Название виджета: " + context.widgetTitle : "",
            context.widgetId ? "Код виджета: " + context.widgetId : "",
            users.length ? "Выбранные сотрудники: " + users.join(", ") : "",
            period ? "Период: " + period : "",
            context.summary ? "Задача: " + trimString(context.summary) : "",
            widgetText ? "Видимый текст виджета:\n" + widgetText : "",
            "HTML виджета:\n```html\n" + widgetHtml + "\n```"
        ].filter(Boolean).join("\n\n");
    }

    function buildRequestBody(config, context) {
        var normalized = normalizeConfig(config);
        if (!normalized) throw new Error("AI config is invalid");
        return {
            model: normalized.model,
            temperature: 0.2,
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: buildUserPrompt(context) }
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

        return Promise.resolve(callFetch(normalized.url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + normalized.apiKey
            },
            body: JSON.stringify(buildRequestBody(normalized, context))
        })).then(function(resp) {
            return Promise.resolve(resp && typeof resp.text === "function" ? resp.text() : "").then(function(text) {
                if (!resp || !resp.ok) {
                    throw new Error("AI API " + (resp && resp.status != null ? resp.status : "error") + ": " + trimString(text));
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
                    payload: payload
                };
            });
        });
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
                renderMessage("Настройки AI не заданы", "Введите URL AI API, модель и API key.", "text-destructive");
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
        normalizeConfig: normalizeConfig,
        readStoredConfig: readStoredConfig,
        writeStoredConfig: writeStoredConfig,
        promptForConfig: promptForConfig,
        buildUserPrompt: buildUserPrompt,
        buildRequestBody: buildRequestBody,
        extractResponseText: extractResponseText,
        requestReport: requestReport,
        open: open
    };
});
