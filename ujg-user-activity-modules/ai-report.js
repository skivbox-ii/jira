define("_ujgUA_aiReport", ["jquery", "_ujgUA_utils"], function($, utils) {
    "use strict";

    var STORAGE_KEY = "ujg-ua-ai-report-config";
    var MAX_PROMPT_TOKENS = 50000;
    // Use UTF-8 bytes as a conservative upper bound for tokens and leave headroom
    // for wrapper metadata.
    var MAX_USER_PROMPT_BYTES = 42000;
    var MAX_BASE_PROMPT_BYTES = 6000;
    var MAX_WIDGET_TEXT_BYTES = 30000;
    var MAX_WIDGET_HTML_BYTES = 12000;
    var CHAT_COMPLETIONS_PATH = "/chat/completions";
    var LEGACY_COMPLETIONS_PATH = "/completions";
    var TRIM_SUFFIX = "\n...[trimmed]";
    var PRESET_BASE_PROMPT = [
        "Ты аналитик Jira-виджета User Activity.",
        "Сначала кратко объясни, что именно показывает переданный виджет и какие данные в нем доступны.",
        "Потом сделай выводы только по фактам из контекста.",
        "Не придумывай данные, сотрудников, цифры и события, которых нет в переданном HTML или тексте.",
        "Пиши по-русски."
    ].join("\n");
    var PROMPT_PRESETS = [
        {
            id: "summary",
            label: "Стандартный отчет",
            prompt: PRESET_BASE_PROMPT + "\n\nСделай структурированный markdown-отчет. Кратко опиши, что видно по каждому сотруднику, затем сравни сотрудников между собой и отдельно выдели риски."
        },
        {
            id: "comparison",
            label: "Сравнение сотрудников",
            prompt: PRESET_BASE_PROMPT + "\n\nСфокусируйся на сравнении сотрудников. Покажи различия по активности, коммуникации, объему изменений, стабильности и влиянию на результат."
        },
        {
            id: "risks",
            label: "Риски и аномалии",
            prompt: PRESET_BASE_PROMPT + "\n\nСфокусируйся на рисках, аномалиях, блокерах, перекосах нагрузки и подозрительных паттернах активности. Ответ сделай коротким и практичным."
        },
        {
            id: "manager",
            label: "Кратко для руководителя",
            prompt: PRESET_BASE_PROMPT + "\n\nСделай короткий управленческий markdown-отчет: сначала 5-7 ключевых bullets, затем сотрудники, затем риски и что проверить дальше."
        }
    ];

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

    function sanitizeBasePrompt(value) {
        return truncateByBytes(normalizePromptWhitespace(value), MAX_BASE_PROMPT_BYTES, TRIM_SUFFIX);
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
        var basePrompt = sanitizeBasePrompt(input.basePrompt || input.base_prompt || input.systemPrompt || input.prompt);
        if (!apiBaseParts.apiBase || !model || !apiKey) return null;
        return {
            apiBase: apiBaseParts.apiBase,
            model: model,
            apiKey: apiKey,
            basePrompt: basePrompt,
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
            basePrompt: current.basePrompt,
            useLegacyCompletionsEndpoint: current.useLegacyCompletionsEndpoint
        });
    }

    function getPromptPresets() {
        return PROMPT_PRESETS.map(function(preset) {
            return {
                id: preset.id,
                label: preset.label,
                prompt: preset.prompt
            };
        });
    }

    function getPromptPresetById(id) {
        var normalizedId = trimString(id);
        var i;
        for (i = 0; i < PROMPT_PRESETS.length; i++) {
            if (PROMPT_PRESETS[i].id === normalizedId) {
                return {
                    id: PROMPT_PRESETS[i].id,
                    label: PROMPT_PRESETS[i].label,
                    prompt: PROMPT_PRESETS[i].prompt
                };
            }
        }
        return null;
    }

    function matchPromptPresetId(value) {
        var normalized = sanitizeBasePrompt(value);
        var i;
        for (i = 0; i < PROMPT_PRESETS.length; i++) {
            if (PROMPT_PRESETS[i].prompt === normalized) return PROMPT_PRESETS[i].id;
        }
        return "";
    }

    function getInitialBasePrompt(config) {
        var current = sanitizeBasePrompt(config && config.basePrompt);
        return current || PROMPT_PRESETS[0].prompt;
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
            period ? "Период: " + period : ""
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
        var visiblePrompt;
        if (!normalized) throw new Error("AI config is invalid");
        var useLegacy = forceLegacy == null
            ? !!normalized.useLegacyCompletionsEndpoint
            : !!forceLegacy;
        visiblePrompt = trimString(normalized.basePrompt);
        if (!visiblePrompt) throw new Error("AI prompt is empty");
        var userPrompt = buildUserPrompt(context);
        if (useLegacy) {
            return {
                model: normalized.model,
                temperature: 0.2,
                prompt: visiblePrompt + "\n\n" + userPrompt
            };
        }
        return {
            model: normalized.model,
            temperature: 0.2,
            messages: [
                { role: "user", content: visiblePrompt },
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

    function escapeHtmlSafe(value) {
        if (utils && typeof utils.escapeHtml === "function") {
            return utils.escapeHtml(value);
        }
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function storeMarkdownPlaceholder(placeholders, html) {
        var token = "@@MDPH" + placeholders.length + "@@";
        placeholders.push(html);
        return token;
    }

    function restoreMarkdownPlaceholders(value, placeholders) {
        return String(value || "").replace(/@@MDPH(\d+)@@/g, function(match, idx) {
            var n = Number(idx);
            return isFinite(n) && placeholders[n] != null ? placeholders[n] : "";
        });
    }

    function sanitizeLinkHref(value) {
        var href = trimString(value).replace(/&amp;/g, "&");
        if (!href) return "";
        if (/^https?:\/\//i.test(href)) return href;
        if (/^mailto:/i.test(href)) return href;
        return "";
    }

    function renderInlineMarkdown(value) {
        var placeholders = [];
        var text = escapeHtmlSafe(value);

        text = text.replace(/`([^`\n]+)`/g, function(match, code) {
            return storeMarkdownPlaceholder(
                placeholders,
                '<code class="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground">' + code + "</code>"
            );
        });

        text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, function(match, label, href) {
            var safeHref = sanitizeLinkHref(href);
            if (!safeHref) return label;
            return storeMarkdownPlaceholder(
                placeholders,
                '<a class="text-primary underline underline-offset-4 hover:text-primary/90" href="' +
                    escapeHtmlSafe(safeHref) +
                    '" target="_blank" rel="noopener noreferrer">' +
                    label +
                    "</a>"
            );
        });

        text = text.replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>");
        text = text.replace(/__([\s\S]+?)__/g, "<strong>$1</strong>");
        text = text.replace(/~~([\s\S]+?)~~/g, "<del>$1</del>");
        text = text.replace(/(^|[^\*])\*([^*\n][\s\S]*?[^*\n])\*(?!\*)/g, "$1<em>$2</em>");
        text = text.replace(/(^|[^_])_([^_\n][\s\S]*?[^_\n])_(?!_)/g, "$1<em>$2</em>");

        return restoreMarkdownPlaceholders(text, placeholders);
    }

    function getListLineMeta(line) {
        var ordered = /^\s*(\d+)\.\s+(.+)$/.exec(line);
        if (ordered) return { type: "ol", text: ordered[2] };
        var unordered = /^\s*[-*+]\s+(.+)$/.exec(line);
        if (unordered) return { type: "ul", text: unordered[1] };
        return null;
    }

    function isTableSeparatorLine(line) {
        return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);
    }

    function parseTableRow(line) {
        return String(line || "")
            .trim()
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
            .map(function(cell) {
                return trimString(cell);
            });
    }

    function renderMarkdownTable(headers, rows) {
        var cols = headers.length;
        if (!cols) return "";
        return (
            '<div class="overflow-auto">' +
                '<table class="w-full border-collapse text-sm">' +
                    '<thead><tr>' +
                        headers.map(function(cell) {
                            return '<th class="border border-border bg-muted/40 px-2 py-1.5 text-left font-semibold text-foreground">' +
                                renderInlineMarkdown(cell) +
                                "</th>";
                        }).join("") +
                    "</tr></thead>" +
                    "<tbody>" +
                        rows.map(function(row) {
                            var cells = [];
                            var i;
                            for (i = 0; i < cols; i++) {
                                cells.push(
                                    '<td class="border border-border px-2 py-1.5 align-top text-foreground">' +
                                        renderInlineMarkdown(row[i] || "") +
                                        "</td>"
                                );
                            }
                            return "<tr>" + cells.join("") + "</tr>";
                        }).join("") +
                    "</tbody>" +
                "</table>" +
            "</div>"
        );
    }

    function renderMarkdownToHtml(value) {
        var text = String(value == null ? "" : value).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        var lines = trimString(text).split("\n");
        var out = [];
        var paragraph = [];
        var quote = [];
        var listType = "";
        var listItems = [];
        var codeFence = false;
        var codeLines = [];
        var i;

        function flushParagraph() {
            if (!paragraph.length) return;
            out.push(
                '<p class="text-sm leading-relaxed text-foreground">' +
                    renderInlineMarkdown(paragraph.join("\n")).replace(/\n/g, "<br>") +
                    "</p>"
            );
            paragraph = [];
        }

        function flushQuote() {
            if (!quote.length) return;
            out.push(
                '<blockquote class="border-l-2 border-border pl-3 text-sm italic leading-relaxed text-muted-foreground">' +
                    renderInlineMarkdown(quote.join("\n")).replace(/\n/g, "<br>") +
                    "</blockquote>"
            );
            quote = [];
        }

        function flushList() {
            var listClass;
            if (!listItems.length || !listType) return;
            listClass = listType === "ol" ? "list-decimal" : "list-disc";
            out.push(
                "<" + listType + ' class="pl-5 ' + listClass + ' space-y-1 text-sm text-foreground">' +
                    listItems.map(function(item) {
                        return "<li>" + renderInlineMarkdown(item) + "</li>";
                    }).join("") +
                "</" + listType + ">"
            );
            listType = "";
            listItems = [];
        }

        function flushAll() {
            flushParagraph();
            flushQuote();
            flushList();
        }

        if (!trimString(text)) return "";

        for (i = 0; i < lines.length; i++) {
            var line = lines[i];
            var headingMatch;
            var listMeta;

            if (/^\s*```/.test(line)) {
                flushAll();
                if (codeFence) {
                    out.push(
                        '<pre class="overflow-auto rounded-md bg-muted px-3 py-2 text-[12px] leading-relaxed text-foreground">' +
                            '<code class="font-mono">' + escapeHtmlSafe(codeLines.join("\n")) + "</code>" +
                        "</pre>"
                    );
                    codeLines = [];
                    codeFence = false;
                } else {
                    codeFence = true;
                    codeLines = [];
                }
                continue;
            }

            if (codeFence) {
                codeLines.push(line);
                continue;
            }

            if (!trimString(line)) {
                flushAll();
                continue;
            }

            if (line.indexOf("|") >= 0 && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1])) {
                var headers = parseTableRow(line);
                var rows = [];
                flushAll();
                i += 2;
                while (i < lines.length && trimString(lines[i]) && lines[i].indexOf("|") >= 0) {
                    rows.push(parseTableRow(lines[i]));
                    i += 1;
                }
                i -= 1;
                out.push(renderMarkdownTable(headers, rows));
                continue;
            }

            headingMatch = /^\s*(#{1,6})\s+(.+)$/.exec(line);
            if (headingMatch) {
                var level = Math.min(6, headingMatch[1].length);
                var headingClass = level === 1
                    ? "text-xl font-bold"
                    : level === 2
                        ? "text-lg font-semibold"
                        : "text-base font-semibold";
                flushAll();
                out.push(
                    "<h" + level + ' class="' + headingClass + ' text-foreground">' +
                        renderInlineMarkdown(headingMatch[2]) +
                    "</h" + level + ">"
                );
                continue;
            }

            if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
                flushAll();
                out.push('<hr class="border-border">');
                continue;
            }

            if (/^\s*>\s?/.test(line)) {
                flushParagraph();
                flushList();
                quote.push(line.replace(/^\s*>\s?/, ""));
                continue;
            }
            flushQuote();

            listMeta = getListLineMeta(line);
            if (listMeta) {
                flushParagraph();
                if (listType && listType !== listMeta.type) flushList();
                listType = listMeta.type;
                listItems.push(listMeta.text);
                continue;
            }
            flushList();

            paragraph.push(line);
        }

        if (codeFence) {
            out.push(
                '<pre class="overflow-auto rounded-md bg-muted px-3 py-2 text-[12px] leading-relaxed text-foreground">' +
                    '<code class="font-mono">' + escapeHtmlSafe(codeLines.join("\n")) + "</code>" +
                "</pre>"
            );
        }

        flushAll();
        return out.join("");
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
        var storage = getStorageRef();
        var currentConfig = readStoredConfig(storage) || null;

        var $overlay = $('<div class="fixed inset-0 z-50 overflow-auto bg-black/80 backdrop-blur-sm p-4"></div>');
        var $dialog = $('<div class="dashboard-card bg-card text-card-foreground shadow-xl" style="max-width:1100px;margin:24px auto;"></div>');
        var $header = $('<div class="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-card px-4 py-3"></div>');
        var $title = $('<div class="flex items-center gap-2 text-sm font-semibold text-foreground"></div>');
        var $actions = $('<div class="ml-auto flex items-center gap-2"></div>');
        var $btnSend = $('<button type="button" class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors">Отправить</button>');
        var $btnConfig = $('<button type="button" class="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors">Настроить API</button>');
        var $btnClose = $('<button type="button" class="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"></button>');
        var $body = $('<div class="p-4 space-y-4"></div>');
        var $composer = $('<div class="rounded-md border border-border bg-muted/10 p-3 space-y-3"></div>');
        var $composerHeader = $('<div class="flex items-start justify-between gap-3"></div>');
        var $composerTitle = $('<div class="text-sm font-semibold text-foreground">Prompt</div>');
        var $composerHint = $('<div class="text-xs leading-relaxed text-muted-foreground">В модель уйдет ровно тот prompt, который виден в этом поле. Выбери шаблон или отредактируй текст вручную.</div>');
        var $controls = $('<div class="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]"></div>');
        var $presetWrap = $('<label class="block space-y-1"></label>');
        var $presetLabel = $('<div class="text-xs font-medium text-muted-foreground">Предустановленный prompt</div>');
        var $presetSelect = $('<select class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none"></select>');
        var $promptWrap = $('<label class="block space-y-1"></label>');
        var $promptLabel = $('<div class="text-xs font-medium text-muted-foreground">Текущий prompt</div>');
        var $promptInput = $('<textarea rows="8" class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground outline-none"></textarea>');
        var $result = $('<div class="rounded-md border border-border bg-card/40 p-4"></div>');
        var requestSeq = 0;

        $title.html(utils.icon("sparkles", "w-4 h-4 text-primary") + "<span>" + utils.escapeHtml(title) + "</span>");
        $btnClose.html(utils.icon("x", "w-4 h-4"));
        $actions.append($btnSend, $btnConfig, $btnClose);
        $header.append($title, $actions);
        $presetSelect.append('<option value="">Свой prompt</option>');
        getPromptPresets().forEach(function(preset) {
            $presetSelect.append(
                $("<option></option>")
                    .attr("value", preset.id)
                    .text(preset.label)
            );
        });
        $presetWrap.append($presetLabel, $presetSelect);
        $promptWrap.append($promptLabel, $promptInput);
        $composerHeader.append($composerTitle, $composerHint);
        $controls.append($presetWrap, $promptWrap);
        $composer.append($composerHeader, $controls);
        $dialog.append($header, $body);
        $overlay.append($dialog);
        $host.append($overlay);
        renderContextMeta($body, context);
        $body.append($composer, $result);

        function close() {
            $overlay.remove();
            if (onClose) onClose();
        }

        function setBusy(isBusy) {
            $btnSend.prop("disabled", !!isBusy);
            $btnConfig.prop("disabled", !!isBusy);
            $presetSelect.prop("disabled", !!isBusy);
            $promptInput.prop("disabled", !!isBusy);
        }

        function setPromptValue(value, useDefaultIfEmpty) {
            var nextValue = sanitizeBasePrompt(value);
            if (!nextValue && useDefaultIfEmpty) nextValue = getInitialBasePrompt(currentConfig);
            $promptInput.val(nextValue);
            $presetSelect.val(matchPromptPresetId(nextValue) || "");
        }

        function getPromptValue() {
            var nextValue = sanitizeBasePrompt($promptInput.val());
            if ($promptInput.val() !== nextValue) $promptInput.val(nextValue);
            $presetSelect.val(matchPromptPresetId(nextValue) || "");
            return nextValue;
        }

        function renderResultMessage(titleText, bodyText, toneClass) {
            $result.empty();
            $result.append(
                $('<div class="mb-2 text-sm font-semibold"></div>')
                    .addClass(toneClass || "text-foreground")
                    .text(titleText)
            );
            $result.append(
                $('<div class="text-sm whitespace-pre-wrap break-words"></div>')
                    .addClass(toneClass === "text-destructive" ? "text-destructive" : "text-muted-foreground")
                    .text(bodyText)
            );
        }

        function renderReport(text) {
            $result.empty();
            $result.append(
                $('<div class="space-y-3 break-words"></div>').html(renderMarkdownToHtml(text))
            );
        }

        function saveCurrentPrompt(config, promptValue) {
            var nextConfig = normalizeConfig({
                apiBase: config.apiBase,
                model: config.model,
                apiKey: config.apiKey,
                basePrompt: promptValue,
                useLegacyCompletionsEndpoint: config.useLegacyCompletionsEndpoint
            });
            if (!nextConfig) return null;
            return writeStoredConfig(storage, nextConfig) || nextConfig;
        }

        function configureApi() {
            var config = ensureConfig(true);
            if (!config) {
                renderResultMessage(
                    "Настройки AI не заданы",
                    "Введите API Base URL, например https://llm/v1, модель и API key.",
                    "text-destructive"
                );
                return;
            }
            currentConfig = config;
            renderResultMessage(
                "Настройки AI сохранены",
                "Теперь при необходимости отредактируй prompt и нажми \"Отправить\".",
                "text-foreground"
            );
        }

        function run() {
            var requestId;
            var promptValue;
            var requestConfig = currentConfig || ensureConfig(false);
            if (!requestConfig) {
                renderResultMessage(
                    "Настройки AI не заданы",
                    "Сначала укажи API Base URL, модель и API key через кнопку \"Настроить API\".",
                    "text-destructive"
                );
                return;
            }
            promptValue = getPromptValue();
            if (!promptValue) {
                renderResultMessage(
                    "Prompt пустой",
                    "Введи prompt вручную или выбери один из шаблонов.",
                    "text-destructive"
                );
                return;
            }
            requestConfig = saveCurrentPrompt(requestConfig, promptValue) || requestConfig;
            currentConfig = requestConfig;
            requestId = ++requestSeq;
            renderResultMessage("Готовлю отчет", "Собираю контекст виджета и жду ответ AI...", "text-foreground");
            setBusy(true);

            requestReport(requestConfig, context).then(function(result) {
                if (requestId !== requestSeq) return;
                renderReport(result.text);
            }, function(err) {
                if (requestId !== requestSeq) return;
                renderResultMessage("Не удалось получить AI-отчет", err && err.message ? err.message : String(err), "text-destructive");
            }).then(function() {
                if (requestId === requestSeq) setBusy(false);
            });
        }

        $btnClose.on("click", close);
        $btnSend.on("click", function() {
            run();
        });
        $btnConfig.on("click", function() {
            configureApi();
        });
        $presetSelect.on("change", function() {
            var preset = getPromptPresetById($presetSelect.val());
            if (preset) setPromptValue(preset.prompt, false);
        });
        $promptInput.on("input", function() {
            $presetSelect.val(matchPromptPresetId($promptInput.val()) || "");
        });

        setPromptValue(getInitialBasePrompt(currentConfig), true);
        renderResultMessage(
            "Готово к отправке",
            "Проверь prompt, при необходимости выбери предустановку и нажми \"Отправить\".",
            "text-foreground"
        );

        return {
            close: close
        };
    }

    return {
        STORAGE_KEY: STORAGE_KEY,
        MAX_PROMPT_TOKENS: MAX_PROMPT_TOKENS,
        MAX_USER_PROMPT_BYTES: MAX_USER_PROMPT_BYTES,
        MAX_BASE_PROMPT_BYTES: MAX_BASE_PROMPT_BYTES,
        normalizeConfig: normalizeConfig,
        readStoredConfig: readStoredConfig,
        writeStoredConfig: writeStoredConfig,
        promptForConfig: promptForConfig,
        getPromptPresets: getPromptPresets,
        getPromptPresetById: getPromptPresetById,
        matchPromptPresetId: matchPromptPresetId,
        getInitialBasePrompt: getInitialBasePrompt,
        utf8ByteLength: utf8ByteLength,
        sanitizeTextForPrompt: sanitizeTextForPrompt,
        sanitizeHtmlForPrompt: sanitizeHtmlForPrompt,
        sanitizeBasePrompt: sanitizeBasePrompt,
        renderInlineMarkdown: renderInlineMarkdown,
        renderMarkdownToHtml: renderMarkdownToHtml,
        buildRequestUrl: buildRequestUrl,
        buildUserPrompt: buildUserPrompt,
        buildRequestBody: buildRequestBody,
        extractResponseText: extractResponseText,
        requestReport: requestReport,
        open: open
    };
});
