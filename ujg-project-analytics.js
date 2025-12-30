define("_ujgProjectAnalytics", ["jquery", "_ujgCommon"], function($, Common) {
    "use strict";
    
    if (typeof $ === "undefined" || !$) {
        console.error("[UJG-ProjectAnalytics] jQuery is not loaded!");
        return function() { console.error("jQuery required"); };
    }
    
    if (!Common || !Common.utils) {
        console.error("[UJG-ProjectAnalytics] _ujgCommon is not loaded!");
        return function() { console.error("_ujgCommon required"); };
    }

    var utils = Common.utils;
    var baseUrl = Common.baseUrl || "";
    var STORAGE_KEY = "ujg_pa_settings";

    var CONFIG = {
        version: "0.1.0",
        maxPeriodDays: 365,
        debug: true
    };

    var WORKFLOW_STORAGE_KEY = "ujg_pa_workflow_default";

    var STATUS_CATEGORIES = {
        queue: { name: "Очередь", description: "Задачи, ожидающие начала работы" },
        work: { name: "В работе", description: "Активная разработка" },
        review: { name: "Ревью", description: "Code Review / проверка" },
        testing: { name: "Тестирование", description: "QA / тестирование" },
        waiting: { name: "Ожидание", description: "Blocked / On Hold" },
        done: { name: "Завершено", description: "Задачи, помеченные как Done" }
    };

    var DEFAULT_THRESHOLDS = {
        ageRisk: 30,
        noProgressRisk: 7,
        longReviewRisk: 5,
        longTestingRisk: 3,
        prIterationsRisk: 3,
        wipLimit: 5,
        sprintChangesRisk: 2,
        assigneeChangesRisk: 3
    };

    var DEFAULT_RISK_WEIGHTS = {
        age: 30,
        sprintChanges: 20,
        assigneeChanges: 15,
        noProgress: 25,
        reopens: 20,
        longReview: 15,
        longTesting: 15,
        prIterations: 20
    };

    var DEFAULT_CUSTOM_FIELDS = {
        storyPoints: "",
        epicLink: "",
        sprint: ""
    };

    function log() {
        if (!CONFIG.debug) return;
        var args = Array.prototype.slice.call(arguments);
        args.unshift("[UJG-ProjectAnalytics]");
        window.console && console.log.apply(console, args);
    }

    function loadSettings() {
        try {
            var stored = localStorage.getItem(STORAGE_KEY);
            if (stored) return JSON.parse(stored);
        } catch (e) {
            log("Failed to load settings", e);
        }
        return {};
    }

    function saveSettings(settings) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings || {}));
        } catch (e) {
            log("Failed to save settings", e);
        }
    }

    function mergeWithDefaults(defaults, overrides) {
        var result = {};
        Object.keys(defaults).forEach(function(key) {
            result[key] = overrides && overrides[key] !== undefined ? overrides[key] : defaults[key];
        });
        if (overrides) {
            Object.keys(overrides).forEach(function(key) {
                if (result[key] === undefined) result[key] = overrides[key];
            });
        }
        return result;
    }

    function loadWorkflowConfig() {
        try {
            var raw = localStorage.getItem(WORKFLOW_STORAGE_KEY);
            if (raw) {
                var parsed = JSON.parse(raw);
                parsed.allStatuses = parsed.allStatuses || [];
                parsed.statusCategories = parsed.statusCategories || {};
                parsed.categoryStatuses = parsed.categoryStatuses || buildCategoryIndexFromStatus(parsed.statusCategories);
                return parsed;
            }
        } catch (e) {
            log("Failed to load workflow config", e);
        }
        return {
            projectKey: "default",
            lastUpdated: null,
            allStatuses: [],
            statusCategories: {},
            categoryStatuses: {},
            isManuallyConfigured: false
        };
    }

    function saveWorkflowConfig(config) {
        try {
            localStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(config || {}));
        } catch (e) {
            log("Failed to save workflow config", e);
        }
    }

    function buildCategoryIndexFromStatus(statusCategories) {
        var categoryMap = {};
        Object.keys(STATUS_CATEGORIES).forEach(function(key) {
            categoryMap[key] = [];
        });
        Object.keys(statusCategories || {}).forEach(function(statusName) {
            (statusCategories[statusName] || []).forEach(function(cat) {
                if (!categoryMap[cat]) categoryMap[cat] = [];
                if (categoryMap[cat].indexOf(statusName) === -1) {
                    categoryMap[cat].push(statusName);
                }
            });
        });
        return categoryMap;
    }

    function buildStatusIndexFromCategory(categoryStatuses) {
        var statusMap = {};
        Object.keys(categoryStatuses || {}).forEach(function(cat) {
            (categoryStatuses[cat] || []).forEach(function(statusName) {
                var name = normalizeStatusName(statusName);
                if (!name) return;
                if (!statusMap[name]) statusMap[name] = [];
                if (statusMap[name].indexOf(cat) === -1) statusMap[name].push(cat);
            });
        });
        return statusMap;
    }

    function normalizeStatusName(name) {
        return (name || "").trim();
    }

    function uniqueList(list) {
        var seen = {};
        var result = [];
        (list || []).forEach(function(item) {
            var name = normalizeStatusName(item);
            if (!name || seen[name]) return;
            seen[name] = true;
            result.push(name);
        });
        return result;
    }

    function parseDateSafe(value) {
        if (!value) return null;
        var d = utils.parseDate ? utils.parseDate(value) : new Date(value);
        if (!d || isNaN(d.getTime())) return null;
        return d;
    }

    function getThresholds(settings) {
        settings.thresholds = settings.thresholds || {};
        return mergeWithDefaults(DEFAULT_THRESHOLDS, settings.thresholds);
    }

    function saveThresholds(settings, thresholds) {
        settings.thresholds = thresholds;
        saveSettings(settings);
    }

    function getRiskWeights(settings) {
        settings.riskWeights = settings.riskWeights || {};
        return mergeWithDefaults(DEFAULT_RISK_WEIGHTS, settings.riskWeights);
    }

    function saveRiskWeights(settings, weights) {
        settings.riskWeights = weights;
        saveSettings(settings);
    }

    function getCustomFields(settings) {
        settings.customFields = settings.customFields || {};
        return mergeWithDefaults(DEFAULT_CUSTOM_FIELDS, settings.customFields);
    }

    function saveCustomFields(settings, fields) {
        settings.customFields = fields;
        saveSettings(settings);
    }

    function getDefaultPeriod() {
        var now = new Date();
        var end = utils.getDayKey(now);
        var startDate = new Date(now);
        startDate.setDate(startDate.getDate() - Math.min(CONFIG.maxPeriodDays - 1, 29));
        var start = utils.getDayKey(startDate);
        return { start: start, end: end };
    }

    function clampPeriod(start, end) {
        if (!start || !end) return getDefaultPeriod();
        var startDate = new Date(start);
        var endDate = new Date(end);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return getDefaultPeriod();
        if (startDate > endDate) {
            var tmp = startDate;
            startDate = endDate;
            endDate = tmp;
        }
        var diffDays = Math.floor((endDate - startDate) / 86400000) + 1;
        if (diffDays > CONFIG.maxPeriodDays) {
            startDate = new Date(endDate);
            startDate.setDate(endDate.getDate() - (CONFIG.maxPeriodDays - 1));
        }
        return {
            start: utils.getDayKey(startDate),
            end: utils.getDayKey(endDate)
        };
    }

    function createApiTracker() {
        var tracker = {};

        var endpointNames = ["search", "changelog", "worklog", "dev-status"];
        tracker.reset = function(totalIssues) {
            tracker.issues = {
                total: totalIssues || 0,
                processed: 0
            };
            tracker.startTime = Date.now();
            tracker.endpoints = {};
            endpointNames.forEach(function(name) {
                tracker.endpoints[name] = {
                    calls: 0,
                    done: 0,
                    errors: 0,
                    totalMs: 0
                };
            });
        };

        tracker.track = function(endpoint, status, ms) {
            var item = tracker.endpoints[endpoint];
            if (!item) return;
            item.calls += 1;
            if (status === "done") item.done += 1;
            if (status === "error") item.errors += 1;
            if (typeof ms === "number") item.totalMs += ms;
        };

        tracker.incrementProcessed = function(count) {
            tracker.issues.processed = Math.min(
                tracker.issues.total,
                tracker.issues.processed + (count || 1)
            );
        };

        tracker.setTotalIssues = function(total) {
            tracker.issues.total = total;
        };

        tracker.getProgress = function() {
            if (!tracker.issues.total) return 0;
            return Math.min(100, Math.round((tracker.issues.processed / tracker.issues.total) * 100));
        };

        tracker.getETA = function() {
            if (!tracker.issues.total || tracker.issues.processed === 0) return "—";
            var elapsed = Date.now() - tracker.startTime;
            var perUnit = elapsed / tracker.issues.processed;
            var remaining = tracker.issues.total - tracker.issues.processed;
            var etaMs = remaining * perUnit;
            var seconds = Math.round(etaMs / 1000);
            if (seconds < 60) return seconds + "с";
            var minutes = Math.floor(seconds / 60);
            seconds = seconds % 60;
            return minutes + "м " + seconds + "с";
        };

        tracker.getEndpointStats = function() {
            var list = [];
            endpointNames.forEach(function(name) {
                var item = tracker.endpoints[name];
                list.push({
                    name: name,
                    calls: item.calls,
                    done: item.done,
                    errors: item.errors,
                    avgMs: item.done ? Math.round(item.totalMs / item.done) : 0
                });
            });
            return list;
        };

        tracker.reset(0);
        return tracker;
    }

    var progressModal = (function() {
        var $modal, $progressBar, $progressLabel, $endpointTable, $issuesLabel, $etaLabel, $cancelBtn;
        var cancelHandler = null;

        function ensureModal() {
            if ($modal) return;
            $modal = $('<div class="ujg-pa-progress-backdrop ujg-pa-hidden"></div>');
            var $dialog = $('<div class="ujg-pa-progress-modal"></div>');
            var $header = $('<div class="ujg-pa-progress-header"><span>Сбор данных</span><button class="aui-button aui-button-link ujg-pa-close">×</button></div>');
            var $body = $('<div class="ujg-pa-progress-body"></div>');
            var $footer = $('<div class="ujg-pa-progress-footer"></div>');

            $progressBar = $('<div class="ujg-pa-progress-bar"><div class="ujg-pa-progress-fill"></div></div>');
            $progressLabel = $('<div class="ujg-pa-progress-label">0%</div>');
            $issuesLabel = $('<div class="ujg-pa-issues-label">0 / 0</div>');
            $etaLabel = $('<div class="ujg-pa-eta-label">ETA: —</div>');
            $endpointTable = $('<table class="ujg-pa-progress-table"><thead><tr><th>Endpoint</th><th>Calls</th><th>Done</th><th>Errors</th><th>Avg ms</th></tr></thead><tbody></tbody></table>');
            $cancelBtn = $('<button class="aui-button aui-button-link">Отменить</button>');

            $body.append($progressBar, $progressLabel, $issuesLabel, $etaLabel, $endpointTable);
            $footer.append($cancelBtn);
            $dialog.append($header, $body, $footer);
            $modal.append($dialog);
            $("body").append($modal);

            $header.find(".ujg-pa-close").on("click", hide);
            $cancelBtn.on("click", function() {
                if (typeof cancelHandler === "function") cancelHandler();
            });
        }

        function show(onCancel) {
            ensureModal();
            cancelHandler = onCancel || null;
            $modal.removeClass("ujg-pa-hidden");
        }

        function hide() {
            if ($modal) $modal.addClass("ujg-pa-hidden");
        }

        function update(tracker) {
            ensureModal();
            var progress = tracker.getProgress();
            $progressBar.find(".ujg-pa-progress-fill").css("width", progress + "%");
            $progressLabel.text(progress + "%");
            $issuesLabel.text(tracker.issues.processed + " / " + tracker.issues.total);
            $etaLabel.text("ETA: " + tracker.getETA());

            var $tbody = $endpointTable.find("tbody");
            $tbody.empty();
            tracker.getEndpointStats().forEach(function(item) {
                var $row = $("<tr></tr>");
                $row.append("<td>" + item.name + "</td>");
                $row.append("<td>" + item.calls + "</td>");
                $row.append("<td>" + item.done + "</td>");
                $row.append("<td>" + item.errors + "</td>");
                $row.append("<td>" + (item.avgMs || "—") + "</td>");
                $tbody.append($row);
            });
        }

        return {
            show: show,
            hide: hide,
            update: update
        };
    })();

    var settingsModal = (function() {
        var $modal, $tabs, $content;
        var currentTab = "workflow";
        var ctx = null;
        var TAB_DEFS = [
            { id: "workflow", label: "Workflow" },
            { id: "custom", label: "Кастомные поля" },
            { id: "thresholds", label: "Пороги" }
        ];

        function ensureModal() {
            if ($modal) return;
            $modal = $('<div class="ujg-pa-settings-backdrop ujg-pa-hidden"></div>');
            var $dialog = $('<div class="ujg-pa-settings-modal"></div>');
            var $header = $('<div class="ujg-pa-settings-header"><span>Настройки</span><button class="aui-button aui-button-link ujg-pa-close">×</button></div>');
            $tabs = $('<div class="ujg-pa-settings-tabs"></div>');
            TAB_DEFS.forEach(function(tab) {
                var $btn = $('<button class="aui-button aui-button-link" data-tab="' + tab.id + '">' + tab.label + '</button>');
                $btn.on("click", function() {
                    selectTab(tab.id);
                });
                $tabs.append($btn);
            });
            $content = $('<div class="ujg-pa-settings-content"></div>');

            $dialog.append($header, $tabs, $content);
            $modal.append($dialog);
            $("body").append($modal);

            $header.find(".ujg-pa-close").on("click", close);
        }

        function open(context, tabId) {
            ctx = context;
            ensureModal();
            $modal.removeClass("ujg-pa-hidden");
            selectTab(tabId || currentTab || "workflow");
        }

        function close() {
            if ($modal) $modal.addClass("ujg-pa-hidden");
        }

        function selectTab(tabId) {
            currentTab = tabId;
            $tabs.find("button").removeClass("active");
            $tabs.find('button[data-tab="' + tabId + '"]').addClass("active");
            $content.empty();
            if (tabId === "workflow") buildWorkflowTab($content);
            else if (tabId === "custom") buildCustomFieldsTab($content);
            else buildThresholdsTab($content);
        }

        function buildWorkflowTab($root) {
            var cfg = $.extend(true, {}, ctx.workflowConfig || {});
            cfg.categoryStatuses = cfg.categoryStatuses || {};
            cfg.allStatuses = cfg.allStatuses || [];

            var localStatuses = cfg.allStatuses.slice();
            var textareas = {};

            var $info = $('<p>Распределите статусы Jira по аналитическим категориям. Указывайте по одному статусу на строку.</p>');
            var $statusManager = $('<div class="ujg-pa-status-manager"></div>');
            var $statusList = $('<div class="ujg-pa-status-list"></div>');
            var $statusInput = $('<input type="text" class="ujg-pa-status-input" placeholder="Новый статус...">');
            var $addStatusBtn = $('<button class="aui-button">Добавить</button>');

            function renderStatusList() {
                $statusList.empty();
                if (localStatuses.length === 0) {
                    $statusList.append('<span class="ujg-pa-status-chip ujg-pa-status-chip-empty">Статусы пока не заданы</span>');
                    return;
                }
                localStatuses.forEach(function(status) {
                    var $chip = $('<span class="ujg-pa-status-chip"></span>').text(status);
                    $statusList.append($chip);
                });
            }

            $addStatusBtn.on("click", function() {
                var value = normalizeStatusName($statusInput.val());
                if (!value) return;
                if (localStatuses.indexOf(value) === -1) {
                    localStatuses.push(value);
                    renderStatusList();
                }
                $statusInput.val("");
            });

            $statusManager.append($statusList, $('<div class="ujg-pa-status-add"></div>').append($statusInput, $addStatusBtn));
            renderStatusList();

            var $categories = $('<div class="ujg-pa-categories-grid"></div>');
            Object.keys(STATUS_CATEGORIES).forEach(function(cat) {
                var categoryInfo = STATUS_CATEGORIES[cat];
                var $section = $('<div class="ujg-pa-category-section"></div>');
                $section.append('<h4>' + categoryInfo.name + '</h4>');
                $section.append('<p class="ujg-pa-category-desc">' + categoryInfo.description + '</p>');
                var $textarea = $('<textarea class="ujg-pa-category-textarea" rows="4" data-cat="' + cat + '"></textarea>');
                $textarea.val((cfg.categoryStatuses[cat] || []).join("\n"));
                textareas[cat] = $textarea;
                $section.append($textarea);
                $categories.append($section);
            });

            var $actions = $('<div class="ujg-pa-settings-actions"></div>');
            var $saveBtn = $('<button class="aui-button aui-button-primary">Сохранить</button>');
            var $cancelBtn = $('<button class="aui-button aui-button-link">Отмена</button>');

            $saveBtn.on("click", function() {
                var newCategoryMap = {};
                Object.keys(textareas).forEach(function(cat) {
                    var values = textareas[cat].val().split(/\n|,/);
                    newCategoryMap[cat] = uniqueList(values);
                });
                var statusFromCategories = buildStatusIndexFromCategory(newCategoryMap);
                var mergedStatuses = uniqueList(localStatuses.concat(Object.keys(statusFromCategories)));

                cfg.categoryStatuses = newCategoryMap;
                cfg.statusCategories = statusFromCategories;
                cfg.allStatuses = mergedStatuses;
                cfg.isManuallyConfigured = true;
                cfg.lastUpdated = new Date().toISOString();
                ctx.workflowConfig = cfg;
                saveWorkflowConfig(cfg);
                if (typeof ctx.onWorkflowChange === "function") ctx.onWorkflowChange(cfg);
                close();
            });

            $cancelBtn.on("click", close);

            $actions.append($saveBtn, $cancelBtn);
            $root.append($info, $statusManager, $categories, $actions);
        }

        function buildCustomFieldsTab($root) {
            var fields = $.extend({}, ctx.customFields || DEFAULT_CUSTOM_FIELDS);
            var $info = $('<p>Укажите кастомные поля Jira, которые будут использованы в аналитике. Оставьте поле пустым, если оно не применимо.</p>');
            var $form = $('<div class="ujg-pa-form"></div>');
            var inputs = {};

            function createFieldRow(key, label, placeholder) {
                var $row = $('<div class="ujg-pa-form-row"></div>');
                var $input = $('<input type="text" class="ujg-pa-form-input" placeholder="' + (placeholder || "customfield_XXXXX") + '">');
                $input.val(fields[key] || "");
                $input.on("input", function() {
                    fields[key] = $(this).val().trim();
                });
                 inputs[key] = $input;
                $row.append('<label>' + label + ':</label>', $input);
                return $row;
            }

            $form.append(createFieldRow("storyPoints", "Story Points", "customfield_10004"));
            $form.append(createFieldRow("epicLink", "Epic Link", "customfield_10008"));
            $form.append(createFieldRow("sprint", "Sprint", "customfield_10007"));

            var $actions = $('<div class="ujg-pa-settings-actions"></div>');
            var $detectBtn = $('<button class="aui-button">Автоопределение</button>');
            var $saveBtn = $('<button class="aui-button aui-button-primary">Сохранить</button>');
            var $cancelBtn = $('<button class="aui-button aui-button-link">Отмена</button>');

            $detectBtn.on("click", function() {
                if (typeof ctx.autoDetectCustomFields === "function") {
                    $detectBtn.prop("disabled", true).text("Поиск...");
                    ctx.autoDetectCustomFields().always(function(result) {
                        var detected = result || {};
                        Object.keys(detected).forEach(function(key) {
                            if (!detected[key]) return;
                            fields[key] = detected[key];
                            if (inputs[key]) inputs[key].val(fields[key]);
                        });
                        $detectBtn.prop("disabled", false).text("Автоопределение");
                    });
                } else {
                    alert("Автоопределение будет добавлено позже.");
                }
            });

            $saveBtn.on("click", function() {
                ctx.customFields = fields;
                if (typeof ctx.onCustomFieldsChange === "function") ctx.onCustomFieldsChange(fields);
                close();
            });

            $cancelBtn.on("click", close);
            $actions.append($detectBtn, $saveBtn, $cancelBtn);
            $root.append($info, $form, $actions);
        }

        function buildThresholdsTab($root) {
            var thresholds = $.extend({}, ctx.thresholds || DEFAULT_THRESHOLDS);
            var riskWeights = $.extend({}, ctx.riskWeights || DEFAULT_RISK_WEIGHTS);

            var $info = $('<p>Настройте пороговые значения и веса рисков. Эти параметры влияют на расчёт индикаторов и приоритетов.</p>');
            var $thresholdSection = $('<div class="ujg-pa-thresholds-section"><h4>Пороги</h4></div>');
            var thresholdInputs = {};

            Object.keys(DEFAULT_THRESHOLDS).forEach(function(key) {
                var label = key;
                var $row = $('<div class="ujg-pa-form-row"></div>');
                var $input = $('<input type="number" min="0" class="ujg-pa-form-input-small">').val(thresholds[key]);
                thresholdInputs[key] = $input;
                $row.append('<label>' + label + ':</label>', $input);
                $thresholdSection.append($row);
            });

            var $weightsSection = $('<div class="ujg-pa-thresholds-section"><h4>Веса рисков</h4></div>');
            var weightInputs = {};
            Object.keys(DEFAULT_RISK_WEIGHTS).forEach(function(key) {
                var $row = $('<div class="ujg-pa-form-row"></div>');
                var $input = $('<input type="number" min="0" class="ujg-pa-form-input-small">').val(riskWeights[key]);
                weightInputs[key] = $input;
                $row.append('<label>' + key + ':</label>', $input);
                $weightsSection.append($row);
            });

            var $actions = $('<div class="ujg-pa-settings-actions"></div>');
            var $resetBtn = $('<button class="aui-button">Сбросить</button>');
            var $saveBtn = $('<button class="aui-button aui-button-primary">Сохранить</button>');
            var $cancelBtn = $('<button class="aui-button aui-button-link">Отмена</button>');

            $resetBtn.on("click", function() {
                thresholds = $.extend({}, DEFAULT_THRESHOLDS);
                riskWeights = $.extend({}, DEFAULT_RISK_WEIGHTS);
                Object.keys(thresholdInputs).forEach(function(key) {
                    thresholdInputs[key].val(thresholds[key]);
                });
                Object.keys(weightInputs).forEach(function(key) {
                    weightInputs[key].val(riskWeights[key]);
                });
            });

            $saveBtn.on("click", function() {
                Object.keys(thresholdInputs).forEach(function(key) {
                    var value = parseFloat(thresholdInputs[key].val());
                    if (isNaN(value) || value < 0) value = DEFAULT_THRESHOLDS[key];
                    thresholds[key] = value;
                });
                Object.keys(weightInputs).forEach(function(key) {
                    var value = parseFloat(weightInputs[key].val());
                    if (isNaN(value) || value < 0) value = DEFAULT_RISK_WEIGHTS[key];
                    riskWeights[key] = value;
                });
                if (typeof ctx.onThresholdsChange === "function") ctx.onThresholdsChange(thresholds);
                if (typeof ctx.onRiskWeightsChange === "function") ctx.onRiskWeightsChange(riskWeights);
                close();
            });

            $cancelBtn.on("click", close);

            $actions.append($resetBtn, $saveBtn, $cancelBtn);
            $root.append($info, $thresholdSection, $weightsSection, $actions);
        }

        return {
            open: open,
            close: close
        };
    })();

    function MyGadget(API) {
        if (!API) {
            console.error("[UJG-ProjectAnalytics] API object is missing!");
            return;
        }
        
        var $content = API.getGadgetContentEl();
        if (!$content || $content.length === 0) {
            console.error("[UJG-ProjectAnalytics] getGadgetContentEl() returned empty");
            return;
        }
        
        log("Content element found:", $content.length, "elements");
        
        var $container = $content.find(".ujg-project-analytics");
        if ($container.length === 0) {
            if ($content.hasClass("ujg-project-analytics")) {
                $container = $content;
                log("Using content element as container");
            } else {
                log("Container not found, creating new one");
                $container = $('<div class="ujg-project-analytics"></div>');
                $content.append($container);
            }
        } else {
            log("Found existing container:", $container.length);
        }
        
        if ($container.length === 0) {
            console.error("[UJG-ProjectAnalytics] Failed to create/find container!");
            $content.html('<div style="padding:20px;color:red;">Ошибка: не удалось создать контейнер виджета</div>');
            return;
        }
        
        log("Using container with", $container.length, "element(s)");

        var state = {
            jqlFilter: "",
            period: getDefaultPeriod(),
            loading: false,
            issues: [],
            lastError: "",
            workflowConfig: loadWorkflowConfig(),
            thresholds: null,
            riskWeights: null,
            customFields: null,
            fieldMetadata: null,
            analyticsSummary: null,
            bottlenecks: null,
            teamMetrics: [],
            devSummary: null,
            velocity: null
        };

        Object.keys(STATUS_CATEGORIES).forEach(function(cat) {
            if (!state.workflowConfig.categoryStatuses) state.workflowConfig.categoryStatuses = {};
            if (!state.workflowConfig.categoryStatuses[cat]) state.workflowConfig.categoryStatuses[cat] = [];
        });
        if (!state.workflowConfig.statusCategories) {
            state.workflowConfig.statusCategories = buildStatusIndexFromCategory(state.workflowConfig.categoryStatuses);
        }

        var tracker = createApiTracker();
        var pendingRequests = [];
        var fieldMetadataPromise = null;
        var settings = loadSettings();
        if (settings.jql) state.jqlFilter = settings.jql;
        if (settings.periodStart && settings.periodEnd) {
            state.period = clampPeriod(settings.periodStart, settings.periodEnd);
        }
        state.thresholds = getThresholds(settings);
        state.riskWeights = getRiskWeights(settings);
        state.customFields = getCustomFields(settings);

        var $panel, $jqlInput, $startInput, $endInput, $loadBtn, $statusBox, $resultsContainer;
        
        log("MyGadget initialized, container:", $container.length);

        function handleWorkflowChange(cfg) {
            state.workflowConfig = cfg;
        }

        function handleCustomFieldsChange(fields) {
            state.customFields = $.extend({}, fields);
            saveCustomFields(settings, state.customFields);
            updateStatus("Кастомные поля обновлены");
        }

        function handleThresholdsChange(thresholds) {
            state.thresholds = $.extend({}, thresholds);
            saveThresholds(settings, state.thresholds);
            updateStatus("Пороговые значения сохранены");
        }

        function handleRiskWeightsChange(weights) {
            state.riskWeights = $.extend({}, weights);
            saveRiskWeights(settings, state.riskWeights);
        }

        function autoDetectCustomFields() {
            var d = $.Deferred();
            setTimeout(function() {
                updateStatus("Автоопределение кастомных полей появится после интеграции с Jira.");
                d.resolve({});
            }, 200);
            return d.promise();
        }

        function initPanel() {
            log("initPanel called");
            if (!$container || $container.length === 0) {
                log("ERROR: container not found!");
                return;
            }
            $panel = $('<div class="ujg-pa-panel"></div>');

            var $jqlRow = $('<div class="ujg-pa-row"></div>');
            $jqlInput = $('<input type="text" class="ujg-pa-jql" placeholder="project = KEY">');
            $jqlInput.val(state.jqlFilter);
            var $applyBtn = $('<button class="aui-button">Применить</button>');
            $applyBtn.on("click", function() {
                state.jqlFilter = $jqlInput.val().trim();
                settings.jql = state.jqlFilter;
                saveSettings(settings);
            });
            $jqlRow.append($('<label>JQL: </label>'), $jqlInput, $applyBtn);

            var $dateRow = $('<div class="ujg-pa-row"></div>');
            $startInput = $('<input type="date" class="ujg-pa-date">');
            $endInput = $('<input type="date" class="ujg-pa-date">');
            $startInput.val(state.period.start);
            $endInput.val(state.period.end);
            var $settingsBtn = $('<button class="aui-button">Настройки</button>').on("click", function() {
                settingsModal.open({
                    workflowConfig: state.workflowConfig,
                    customFields: state.customFields,
                    thresholds: state.thresholds,
                    riskWeights: state.riskWeights,
                    onWorkflowChange: handleWorkflowChange,
                    onCustomFieldsChange: handleCustomFieldsChange,
                    onThresholdsChange: handleThresholdsChange,
                    onRiskWeightsChange: handleRiskWeightsChange,
                    autoDetectCustomFields: autoDetectCustomFields
                }, "workflow");
            });
            $loadBtn = $('<button class="aui-button aui-button-primary">Загрузить</button>').on("click", startLoading);
            $dateRow.append($('<label>С: </label>'), $startInput, $('<label> По: </label>'), $endInput, $loadBtn, $settingsBtn);

            $statusBox = $('<div class="ujg-pa-status"></div>');
            updateStatus("Укажите фильтры и нажмите «Загрузить»");

            $panel.append($jqlRow, $dateRow, $statusBox);
            $container.append($panel);
            log("Panel appended to container, panel children:", $panel.children().length);
            
            if ($panel.parent().length === 0) {
                console.error("[UJG-ProjectAnalytics] Panel was not added to DOM!");
            } else {
                log("Panel is in DOM, parent:", $panel.parent().length);
            }
            
            $resultsContainer = $('<div class="ujg-pa-results"></div>');
            $container.append($resultsContainer);
            renderAnalyticsTable();
            
            log("initPanel completed, container HTML length:", $container.html().length);
            
            if ($container.html().length < 100) {
                console.warn("[UJG-ProjectAnalytics] Container seems empty after init!");
            }
        }

        function updateStatus(text) {
            if ($statusBox) $statusBox.text(text || "");
        }

        function addRequest(jqXHR) {
            pendingRequests.push(jqXHR);
            jqXHR.always(function() {
                var idx = pendingRequests.indexOf(jqXHR);
                if (idx >= 0) pendingRequests.splice(idx, 1);
            });
            return jqXHR;
        }

        function cancelPendingRequests() {
            pendingRequests.forEach(function(req) {
                try { req.abort(); } catch (e) {}
            });
            pendingRequests = [];
        }

        function finishLoading(message) {
            state.loading = false;
            tracker.incrementProcessed(tracker.issues.total);
            progressModal.hide();
            updateStatus(message || "Загрузка завершена");
        }

        function failLoading(err) {
            state.loading = false;
            progressModal.hide();
            updateStatus(err || "Ошибка при загрузке");
        }

        function startLoading() {
            if (state.loading) return;
            var newPeriod = clampPeriod($startInput.val(), $endInput.val());
            state.period = newPeriod;
            settings.periodStart = newPeriod.start;
            settings.periodEnd = newPeriod.end;
            saveSettings(settings);

            state.jqlFilter = $jqlInput.val().trim();

            tracker.reset(0);
            state.loading = true;
            updateStatus("Загрузка началась...");
            progressModal.show(function() {
                state.loading = false;
                cancelPendingRequests();
                progressModal.hide();
                updateStatus("Загрузка отменена");
            });
            progressModal.update(tracker);
            API.resize();

            var pipeline = loadFieldMetadata()
                .then(function() {
                    return fetchAllIssues(state.jqlFilter, state.period);
                })
                .then(function(issues) {
                    state.issues = issues;
                    tracker.setTotalIssues(issues.length);
                    updateKnownStatuses(issues);
                    progressModal.update(tracker);
                    return processIssuesSequentially(issues).then(function() {
                        calculateAnalytics(issues);
                        calculateAdvancedInsights(issues);
                        renderAnalyticsTable();
                    });
                });

            pipeline.done(function() {
                finishLoading("Загружено задач: " + (state.issues ? state.issues.length : 0));
            }).fail(function(err) {
                if (err === "cancelled") {
                    failLoading("Загрузка отменена");
                } else {
                    failLoading(err || "Ошибка загрузки");
                }
            }).always(function() {
                cancelPendingRequests();
            });
        }

        function loadFieldMetadata(force) {
            if (state.fieldMetadata && !force) {
                return $.Deferred().resolve(state.fieldMetadata).promise();
            }
            if (fieldMetadataPromise && !force) return fieldMetadataPromise;
            var d = $.Deferred();
            var req = $.ajax({
                url: baseUrl + "/rest/api/2/field",
                type: "GET",
                dataType: "json"
            });
            addRequest(req);
            req.done(function(resp) {
                state.fieldMetadata = resp || [];
                d.resolve(state.fieldMetadata);
            }).fail(function(jqXHR, textStatus) {
                if (textStatus === "abort") {
                    d.reject("cancelled");
                } else {
                    d.reject("Не удалось загрузить список полей");
                }
            });
            d.always(function() {
                fieldMetadataPromise = null;
            });
            fieldMetadataPromise = d.promise();
            return fieldMetadataPromise;
        }

        function buildJqlString(userJql, period) {
            var parts = [];
            if (userJql) parts.push("(" + userJql + ")");
            if (period && period.start && period.end) {
                parts.push('updated >= "' + period.start + '" AND updated <= "' + period.end + '"');
            }
            return parts.join(" AND ");
        }

        function getRequestedFields() {
            var baseFields = [
                "summary",
                "status",
                "assignee",
                "created",
                "updated",
                "resolutiondate",
                "priority",
                "issuetype",
                "resolution",
                "components",
                "labels",
                "fixVersions"
            ];
            ["storyPoints", "epicLink", "sprint"].forEach(function(key) {
                var fieldId = state.customFields && state.customFields[key];
                if (fieldId) baseFields.push(fieldId);
            });
            return uniqueList(baseFields);
        }

        function fetchAllIssues(jqlFilter, period) {
            var d = $.Deferred();
            var issues = [];
            var maxResults = 100;
            var finalJql = buildJqlString(jqlFilter, period);
            if (!finalJql) finalJql = "ORDER BY updated DESC";

            function fetchBatch(startAt) {
                if (!state.loading) {
                    d.reject("cancelled");
                    return;
                }
                var payload = {
                    jql: finalJql || "",
                    fields: getRequestedFields(),
                    expand: ["changelog"],
                    maxResults: maxResults,
                    startAt: startAt
                };
                var started = Date.now();
                var req = $.ajax({
                    url: baseUrl + "/rest/api/2/search",
                    type: "POST",
                    contentType: "application/json",
                    dataType: "json",
                    data: JSON.stringify(payload)
                });
                addRequest(req);
                req.done(function(resp) {
                    tracker.track("search", "done", Date.now() - started);
                    var total = resp && resp.total ? resp.total : 0;
                    tracker.setTotalIssues(total);
                    var batch = resp && resp.issues ? resp.issues : [];
                    issues = issues.concat(batch);
                    progressModal.update(tracker);
                    if (issues.length < total && batch.length === maxResults) {
                        fetchBatch(startAt + maxResults);
                    } else {
                        d.resolve(issues);
                    }
                }).fail(function(jqXHR, textStatus) {
                    tracker.track("search", "error", Date.now() - started);
                    if (textStatus === "abort") {
                        d.reject("cancelled");
                        return;
                    }
                    d.reject("Ошибка загрузки задач");
                });
            }

            fetchBatch(0);
            return d.promise();
        }

        function processIssuesSequentially(issues) {
            var d = $.Deferred();
            var idx = 0;

            function next() {
                if (!state.loading) {
                    d.reject("cancelled");
                    return;
                }
                if (idx >= issues.length) {
                    d.resolve();
                    return;
                }
                var issue = issues[idx];
                loadIssueChangelog(issue)
                    .then(function() { return loadIssueWorklogs(issue); })
                    .then(function() { return loadIssueDevStatus(issue); })
                    .done(function() {
                        tracker.incrementProcessed(1);
                        progressModal.update(tracker);
                        idx += 1;
                        next();
                    })
                    .fail(function(err) {
                        if (err === "cancelled") {
                            d.reject("cancelled");
                        } else {
                            tracker.incrementProcessed(1);
                            progressModal.update(tracker);
                            idx += 1;
                            next();
                        }
                    });
            }

            next();
            return d.promise();
        }

        function loadIssueChangelog(issue) {
            var d = $.Deferred();
            var started = Date.now();
            var req = $.ajax({
                url: baseUrl + "/rest/api/2/issue/" + issue.key,
                type: "GET",
                dataType: "json",
                data: {
                    expand: "changelog",
                    fields: "summary"
                }
            });
            addRequest(req);
            req.done(function(resp) {
                tracker.track("changelog", "done", Date.now() - started);
                issue.changelog = resp && resp.changelog ? resp.changelog : {};
                d.resolve(issue.changelog);
            }).fail(function(jqXHR, textStatus) {
                tracker.track("changelog", "error", Date.now() - started);
                if (textStatus === "abort") {
                    d.reject("cancelled");
                } else {
                    issue.changelog = {};
                    d.resolve(issue.changelog);
                }
            });
            return d.promise();
        }

        function loadIssueWorklogs(issue) {
            var d = $.Deferred();
            var started = Date.now();
            var req = $.ajax({
                url: baseUrl + "/rest/api/2/issue/" + issue.key + "/worklog",
                type: "GET",
                dataType: "json"
            });
            addRequest(req);
            req.done(function(resp) {
                tracker.track("worklog", "done", Date.now() - started);
                issue.worklogs = resp && resp.worklogs ? resp.worklogs : [];
                d.resolve(issue.worklogs);
            }).fail(function(jqXHR, textStatus) {
                tracker.track("worklog", "error", Date.now() - started);
                if (textStatus === "abort") {
                    d.reject("cancelled");
                } else {
                    d.resolve([]);
                }
            });
            return d.promise();
        }

        function loadIssueDevStatus(issue) {
            var d = $.Deferred();
            var started = Date.now();
            var req = $.ajax({
                url: baseUrl + "/rest/dev-status/1.0/issue/detail",
                type: "GET",
                dataType: "json",
                data: {
                    issueId: issue.id,
                    applicationType: "stash",
                    dataType: "repository"
                }
            });
            addRequest(req);
            req.done(function(resp) {
                tracker.track("dev-status", "done", Date.now() - started);
                issue.devStatus = resp || {};
                d.resolve(issue.devStatus);
            }).fail(function(jqXHR, textStatus) {
                tracker.track("dev-status", "error", Date.now() - started);
                if (textStatus === "abort") {
                    d.reject("cancelled");
                } else {
                    issue.devStatus = {};
                    d.resolve(issue.devStatus);
                }
            });
            return d.promise();
        }

        function updateKnownStatuses(issues) {
            var cfg = state.workflowConfig;
            if (!cfg) return;
            var current = cfg.allStatuses ? cfg.allStatuses.slice() : [];
            var discovered = [];
            (issues || []).forEach(function(issue) {
                var statusName = issue && issue.fields && issue.fields.status && issue.fields.status.name;
                if (statusName) discovered.push(statusName);
            });
            var merged = uniqueList(current.concat(discovered));
            if (merged.length !== current.length) {
                cfg.allStatuses = merged;
                saveWorkflowConfig(cfg);
            }
        }

        function calculateAnalytics(issues) {
            if (!issues || issues.length === 0) {
                state.analyticsSummary = null;
                return;
            }
            var summary = {
                issueCount: issues.length,
                statusTotals: {},
                categoryTotals: {},
                assigneeTotals: {},
                totalLeadSeconds: 0,
                totalCycleSeconds: 0,
                totalWaitSeconds: 0
            };
            issues.forEach(function(issue) {
                var analytics = issue.analytics || {};
                var statusMetrics = computeTimeInStatuses(issue);
                analytics.timeInStatuses = statusMetrics;
                accumulateStatusTotals(summary, statusMetrics);

                var assigneeMetrics = computeTimeOnAssignees(issue);
                analytics.timeOnAssignees = assigneeMetrics;
                accumulateAssigneeTotals(summary, assigneeMetrics);

                var timing = computeLeadCycleTime(issue);
                analytics.leadTimeSeconds = timing.leadSeconds;
                analytics.cycleTimeSeconds = timing.cycleSeconds;
                analytics.waitTimeSeconds = timing.waitSeconds;

                var statusEvents = extractFieldEvents(issue, "status");
                analytics.reopenCount = countReopens(statusEvents);
                analytics.sprintChanges = extractFieldEvents(issue, "sprint").length;
                analytics.assigneeChanges = extractFieldEvents(issue, "assignee").length;
                analytics.lastActivity = getLastActivityDate(issue);

                summary.totalLeadSeconds += timing.leadSeconds;
                summary.totalCycleSeconds += timing.cycleSeconds;
                summary.totalWaitSeconds += timing.waitSeconds;

                issue.analytics = analytics;
            });
            state.analyticsSummary = summary;
        }

        function accumulateStatusTotals(summary, metrics) {
            Object.keys(metrics.statuses || {}).forEach(function(status) {
                if (!summary.statusTotals[status]) summary.statusTotals[status] = 0;
                summary.statusTotals[status] += metrics.statuses[status].seconds;
            });
            Object.keys(metrics.categories || {}).forEach(function(cat) {
                if (!summary.categoryTotals[cat]) summary.categoryTotals[cat] = 0;
                summary.categoryTotals[cat] += metrics.categories[cat];
            });
        }

        function accumulateAssigneeTotals(summary, metrics) {
            Object.keys(metrics.totals || {}).forEach(function(name) {
                if (!summary.assigneeTotals[name]) summary.assigneeTotals[name] = 0;
                summary.assigneeTotals[name] += metrics.totals[name];
            });
        }

        function computeTimeInStatuses(issue) {
            var initialStatus = getInitialStatus(issue);
            var segments = buildTimelineSegments(issue, "status", initialStatus);
            var bounds = getPeriodBounds();
            var statusTotals = {};
            var categoryTotals = {};
            var entries = [];

            segments.forEach(function(segment) {
                if (!segment.start || !segment.end) return;
                var seconds = calculateOverlapSeconds(segment.start, segment.end, bounds);
                if (seconds <= 0) return;
                var statusName = segment.value || "Unknown";
                if (!statusTotals[statusName]) {
                    statusTotals[statusName] = { seconds: 0, categories: getCategoriesForStatus(statusName) };
                }
                statusTotals[statusName].seconds += seconds;
                var categories = statusTotals[statusName].categories || getCategoriesForStatus(statusName) || [];
                categories.forEach(function(cat) {
                    if (!categoryTotals[cat]) categoryTotals[cat] = 0;
                    categoryTotals[cat] += seconds;
                });
                entries.push({
                    status: statusName,
                    start: segment.start,
                    end: segment.end,
                    seconds: seconds,
                    categories: categories
                });
            });

            return {
                statuses: statusTotals,
                categories: categoryTotals,
                entries: entries
            };
        }

        function computeTimeOnAssignees(issue) {
            var initialAssignee = getInitialAssignee(issue);
            var segments = buildTimelineSegments(issue, "assignee", initialAssignee);
            var bounds = getPeriodBounds();
            var totals = {};
            var entries = [];

            segments.forEach(function(segment) {
                if (!segment.start || !segment.end) return;
                var seconds = calculateOverlapSeconds(segment.start, segment.end, bounds);
                if (seconds <= 0) return;
                var assignee = segment.value || "Unassigned";
                if (!totals[assignee]) totals[assignee] = 0;
                totals[assignee] += seconds;
                entries.push({
                    assignee: assignee,
                    start: segment.start,
                    end: segment.end,
                    seconds: seconds
                });
            });

            return {
                totals: totals,
                entries: entries
            };
        }

        function computeLeadCycleTime(issue) {
            var created = parseDateSafe(issue.fields && issue.fields.created);
            if (!created) return { leadSeconds: 0, cycleSeconds: 0, waitSeconds: 0 };
            var segments = buildTimelineSegments(issue, "status", getInitialStatus(issue));
            var doneTime = null;
            var workStart = null;
            segments.forEach(function(segment) {
                if (!segment.start) return;
                if (!workStart && statusHasCategory(segment.value, "work")) {
                    workStart = segment.start;
                }
                if (!doneTime && statusHasCategory(segment.value, "done")) {
                    doneTime = segment.start;
                }
            });
            var defaultEnd = parseDateSafe(issue.fields && (issue.fields.resolutiondate || issue.fields.updated)) || new Date();
            if (!doneTime) doneTime = defaultEnd;
            var leadSeconds = Math.max(0, (doneTime - created) / 1000);
            var cycleSeconds = workStart ? Math.max(0, (doneTime - workStart) / 1000) : 0;
            if (cycleSeconds > leadSeconds) cycleSeconds = leadSeconds;
            var waitSeconds = Math.max(0, leadSeconds - cycleSeconds);
            return {
                leadSeconds: leadSeconds,
                cycleSeconds: cycleSeconds,
                waitSeconds: waitSeconds
            };
        }

        function buildTimelineSegments(issue, fieldName, initialValue) {
            var events = extractFieldEvents(issue, fieldName);
            var segments = [];
            var currentValue = initialValue;
            if (!currentValue && events.length > 0) {
                currentValue = events[0].from || events[0].to || "";
            }
            var currentStart = parseDateSafe(issue.fields && issue.fields.created);
            if (!currentStart && events.length > 0) currentStart = events[0].at;
            events.forEach(function(evt) {
                if (currentStart && evt.at) {
                    segments.push({
                        value: currentValue,
                        start: currentStart,
                        end: evt.at
                    });
                }
                currentValue = evt.to || currentValue;
                currentStart = evt.at;
            });
            var finalEnd = parseDateSafe(issue.fields && (issue.fields.resolutiondate || issue.fields.updated)) || new Date();
            if (currentStart && finalEnd && finalEnd >= currentStart) {
                segments.push({
                    value: currentValue,
                    start: currentStart,
                    end: finalEnd
                });
            }
            return segments;
        }

        function extractFieldEvents(issue, fieldName) {
            var events = [];
            var histories = (issue && issue.changelog && issue.changelog.histories) || [];
            histories.forEach(function(history) {
                var changeTime = parseDateSafe(history.created);
                if (!changeTime) return;
                (history.items || []).forEach(function(item) {
                    if (!item.field) return;
                    if (item.field.toLowerCase() !== fieldName) return;
                    events.push({
                        from: item.fromString || "",
                        to: item.toString || "",
                        at: changeTime
                    });
                });
            });
            events.sort(function(a, b) { return a.at - b.at; });
            return events;
        }

        function getInitialStatus(issue) {
            var fields = issue && issue.fields;
            if (fields && fields.status && fields.status.name) return fields.status.name;
            return "Unknown";
        }

        function getInitialAssignee(issue) {
            var assignee = issue && issue.fields && issue.fields.assignee;
            if (!assignee) return "Unassigned";
            return assignee.displayName || assignee.name || assignee.accountId || "Unassigned";
        }

        function getCategoriesForStatus(statusName) {
            var cfg = state.workflowConfig;
            if (!cfg || !cfg.statusCategories) return [];
            var normalized = normalizeStatusName(statusName);
            return cfg.statusCategories[normalized] || cfg.statusCategories[statusName] || [];
        }

        function statusHasCategory(statusName, category) {
            if (!category) return false;
            var categories = getCategoriesForStatus(statusName);
            return categories.indexOf(category) >= 0;
        }

        function getPeriodBounds() {
            var start = parseDateSafe(state.period.start + "T00:00:00");
            var end = parseDateSafe(state.period.end + "T23:59:59");
            if (!start || !end || end < start) {
                var fallback = getDefaultPeriod();
                start = parseDateSafe(fallback.start + "T00:00:00");
                end = parseDateSafe(fallback.end + "T23:59:59");
            }
            return { start: start, end: end };
        }

        function calculateOverlapSeconds(segmentStart, segmentEnd, bounds) {
            if (!segmentStart || !segmentEnd) return 0;
            var start = segmentStart < bounds.start ? bounds.start : segmentStart;
            var end = segmentEnd > bounds.end ? bounds.end : segmentEnd;
            if (end <= start) return 0;
            return (end - start) / 1000;
        }

        function renderAnalyticsTable() {
            if (!$resultsContainer) {
                log("WARNING: $resultsContainer not initialized");
                return;
            }
            $resultsContainer.empty();
            if (!state.issues || state.issues.length === 0) {
                $resultsContainer.append('<div class="ujg-pa-empty">Данные не загружены. Укажите JQL фильтр и нажмите "Загрузить".</div>');
                return;
            }
            if (state.analyticsSummary) {
                var summary = state.analyticsSummary;
                var avgLead = summary.totalLeadSeconds / summary.issueCount;
                var avgCycle = summary.totalCycleSeconds / summary.issueCount;
                var avgWait = summary.totalWaitSeconds / summary.issueCount;
                var $summary = $('<div class="ujg-pa-summary"></div>');
                $summary.append('<div class="ujg-pa-summary-item"><span>Avg Lead Time</span><strong>' + formatDuration(avgLead) + '</strong></div>');
                $summary.append('<div class="ujg-pa-summary-item"><span>Avg Cycle Time</span><strong>' + formatDuration(avgCycle) + '</strong></div>');
                $summary.append('<div class="ujg-pa-summary-item"><span>Avg Wait Time</span><strong>' + formatDuration(avgWait) + '</strong></div>');
                $resultsContainer.append($summary);
            }

            var $table = $('<table class="ujg-pa-table"><thead><tr><th>Key</th><th>Summary</th><th>Lead</th><th>Cycle</th><th>Top Status</th><th>Risk</th></tr></thead><tbody></tbody></table>');
            var maxRows = Math.min(50, state.issues.length);
            for (var i = 0; i < maxRows; i++) {
                var issue = state.issues[i];
                var analytics = issue.analytics || {};
                var dominant = getDominantStatus(analytics);
                var $row = $("<tr></tr>");
                var issueUrl = baseUrl + "/browse/" + issue.key;
                $row.append('<td><a href="' + issueUrl + '" target="_blank">' + issue.key + "</a></td>");
                var summary = issue.fields && issue.fields.summary ? issue.fields.summary : "";
                $row.append('<td>' + utils.escapeHtml(summary) + "</td>");
                $row.append('<td>' + formatDuration(analytics.leadTimeSeconds) + "</td>");
                $row.append('<td>' + formatDuration(analytics.cycleTimeSeconds) + "</td>");
                $row.append('<td>' + dominant.name + "</td>");
                var riskScore = analytics.risk ? analytics.risk.score + "%" : "—";
                $row.append("<td>" + riskScore + "</td>");
                $table.find("tbody").append($row);
            }
            if (state.issues.length > maxRows) {
                $resultsContainer.append('<div class="ujg-pa-note">Показаны первые ' + maxRows + " из " + state.issues.length + " задач</div>");
            }
            $resultsContainer.append($table);
            renderCategoryHeatmap($resultsContainer);
            renderRiskMatrixSection($resultsContainer);
            renderTeamMetricsSection($resultsContainer);
            renderVelocitySection($resultsContainer);
            renderDevCycleSection($resultsContainer);
            renderBottlenecksSection($resultsContainer);
            renderTrendPlaceholder($resultsContainer);
        }

        function getDominantStatus(analytics) {
            var result = { name: "—", seconds: 0 };
            if (!analytics || !analytics.timeInStatuses) return result;
            Object.keys(analytics.timeInStatuses.statuses || {}).forEach(function(name) {
                var seconds = analytics.timeInStatuses.statuses[name].seconds || 0;
                if (seconds > result.seconds) {
                    result = { name: name, seconds: seconds };
                }
            });
            return result;
        }

        function formatDuration(seconds) {
            if (!seconds || seconds <= 0) return "0ч";
            var hours = seconds / 3600;
            if (hours >= 24) {
                var days = hours / 24;
                return (Math.round(days * 10) / 10) + "д";
            }
            if (hours >= 1) {
                return (Math.round(hours * 10) / 10) + "ч";
            }
            return Math.round(seconds / 60) + "м";
        }

        function renderCategoryHeatmap($parent) {
            var summary = state.analyticsSummary;
            if (!summary || !summary.categoryTotals) return;
            var categories = Object.keys(summary.categoryTotals);
            if (categories.length === 0) return;
            var maxValue = Math.max.apply(null, categories.map(function(cat) { return summary.categoryTotals[cat]; }));
            if (!maxValue) return;
            var $section = $('<div class="ujg-pa-section"><h3>Heatmap по категориям</h3></div>');
            categories.forEach(function(cat) {
                var value = summary.categoryTotals[cat] || 0;
                var percent = Math.round((value / maxValue) * 100);
                var label = (STATUS_CATEGORIES[cat] && STATUS_CATEGORIES[cat].name) || cat;
                var $row = $('<div class="ujg-pa-bar-row"></div>');
                $row.append('<span class="ujg-pa-bar-label">' + label + "</span>");
                var $track = $('<div class="ujg-pa-bar-track"><div class="ujg-pa-bar-fill"></div></div>');
                $track.find(".ujg-pa-bar-fill").css("width", percent + "%");
                $row.append($track);
                $row.append('<span class="ujg-pa-bar-value">' + formatDuration(value) + "</span>");
                $section.append($row);
            });
            $parent.append($section);
        }

        function renderRiskMatrixSection($parent) {
            var issues = (state.issues || []).filter(function(issue) {
                return issue.analytics && issue.analytics.risk;
            }).sort(function(a, b) {
                return b.analytics.risk.score - a.analytics.risk.score;
            }).slice(0, 8);
            if (issues.length === 0) return;
            var $section = $('<div class="ujg-pa-section"><h3>Risk Matrix</h3></div>');
            var $table = $('<table class="ujg-pa-table"><thead><tr><th>Key</th><th>Risk</th><th>Факторы</th></tr></thead><tbody></tbody></table>');
            issues.forEach(function(issue) {
                var risk = issue.analytics.risk;
                var factors = (risk.factors || []).map(function(f) { return f.message; }).join(", ");
                var $row = $("<tr></tr>");
                $row.append('<td><a href="' + baseUrl + "/browse/" + issue.key + '" target="_blank">' + issue.key + "</a></td>");
                $row.append("<td>" + risk.score + "%</td>");
                $row.append("<td>" + utils.escapeHtml(factors || "—") + "</td>");
                $table.find("tbody").append($row);
            });
            $section.append($table);
            $parent.append($section);
        }

        function renderTeamMetricsSection($parent) {
            if (!state.teamMetrics || state.teamMetrics.length === 0) return;
            var $section = $('<div class="ujg-pa-section"><h3>Team Performance</h3></div>');
            var $table = $('<table class="ujg-pa-table"><thead><tr><th>Участник</th><th>Задачи</th><th>Закрыто</th><th>Avg Lead</th><th>Avg Cycle</th><th>Reopen %</th></tr></thead><tbody></tbody></table>');
            state.teamMetrics.forEach(function(member) {
                var $row = $("<tr></tr>");
                $row.append("<td>" + utils.escapeHtml(member.name) + "</td>");
                $row.append("<td>" + member.issues + "</td>");
                $row.append("<td>" + member.closed + "</td>");
                $row.append("<td>" + formatDuration(member.avgLeadSeconds) + "</td>");
                $row.append("<td>" + formatDuration(member.avgCycleSeconds) + "</td>");
                $row.append("<td>" + Math.round((member.reopenRate || 0) * 100) + "%</td>");
                $table.find("tbody").append($row);
            });
            $section.append($table);
            $parent.append($section);
        }

        function renderVelocitySection($parent) {
            var velocity = state.velocity;
            var devSummary = state.devSummary;
            if (!velocity && !devSummary) return;
            var $section = $('<div class="ujg-pa-section"><h3>Velocity &amp; Dev Cycle</h3></div>');
            if (velocity) {
                var totalPoints = Number(velocity.totalPoints || 0);
                var avgPoints = Number(velocity.avgPointsPerIssue || 0);
                $section.append('<p>Закрыто задач: <strong>' + (velocity.closedIssues || 0) +
                    "</strong>, Story Points: <strong>" + totalPoints.toFixed(1) +
                    "</strong>, Avg SP: <strong>" + avgPoints.toFixed(1) + "</strong></p>");
            }
            if (devSummary) {
                $section.append('<p>Pull Requests: <strong>' + (devSummary.prCount || 0) + "</strong>, Merged: <strong>" + (devSummary.mergedCount || 0) +
                    "</strong>, Open: <strong>" + (devSummary.openCount || 0) + "</strong>, Declined: <strong>" + (devSummary.declinedCount || 0) + "</strong></p>");
                $section.append('<p>Avg PR Cycle Time: <strong>' + formatDuration(devSummary.avgCycleSeconds) + 
                    "</strong>, Avg Iterations: <strong>" + (devSummary.avgIterations || 0).toFixed(1) + "</strong></p>");
            }
            $parent.append($section);
        }
        
        function renderDevCycleSection($parent) {
            var devSummary = state.devSummary;
            if (!devSummary || devSummary.prCount === 0) return;
            
            var $section = $('<div class="ujg-pa-section"><h3>💻 Анализ цикла разработки</h3></div>');
            
            var $overview = $('<div class="ujg-pa-dev-overview"></div>');
            $overview.append('<p><strong>Обзор PR за период:</strong></p>');
            $overview.append('<p>Всего PR: <strong>' + devSummary.prCount + 
                "</strong> | Merged: <strong>" + devSummary.mergedCount + 
                "</strong> | Open: <strong>" + (devSummary.openCount || 0) + 
                "</strong> | Declined: <strong>" + (devSummary.declinedCount || 0) + "</strong></p>");
            $overview.append('<p>Avg PR Cycle Time: <strong>' + formatDuration(devSummary.avgCycleSeconds) + 
                "</strong> | Avg Iterations: <strong>" + (devSummary.avgIterations || 0).toFixed(1) + "</strong></p>");
            $section.append($overview);
            
            if (devSummary.reviewerStats && Object.keys(devSummary.reviewerStats).length > 0) {
                var $reviewers = $('<div class="ujg-pa-reviewers-section"><h4>Нагрузка на ревьюеров</h4></div>');
                var reviewers = Object.keys(devSummary.reviewerStats).map(function(name) {
                    var stats = devSummary.reviewerStats[name];
                    return {
                        name: name,
                        reviews: stats.reviews || 0,
                        avgTime: stats.reviewCount ? stats.totalTimeSeconds / stats.reviewCount : 0
                    };
                }).sort(function(a, b) { return b.reviews - a.reviews; });
                
                var maxReviews = Math.max.apply(null, reviewers.map(function(r) { return r.reviews; }));
                reviewers.forEach(function(reviewer) {
                    var percent = maxReviews ? Math.round((reviewer.reviews / maxReviews) * 100) : 0;
                    var $row = $('<div class="ujg-pa-bar-row"></div>');
                    $row.append('<span class="ujg-pa-bar-label">' + utils.escapeHtml(reviewer.name) + "</span>");
                    var $track = $('<div class="ujg-pa-bar-track"><div class="ujg-pa-bar-fill"></div></div>');
                    $track.find(".ujg-pa-bar-fill").css("width", percent + "%");
                    $row.append($track);
                    $row.append('<span class="ujg-pa-bar-value">' + reviewer.reviews + " reviews (avg " + formatDuration(reviewer.avgTime) + ")</span>");
                    $reviewers.append($row);
                });
                $section.append($reviewers);
            }
            
            if (devSummary.authorStats && Object.keys(devSummary.authorStats).length > 0) {
                var $authors = $('<div class="ujg-pa-authors-section"><h4>Качество по разработчикам (First-time Approval Rate)</h4></div>');
                var authors = Object.keys(devSummary.authorStats).map(function(name) {
                    var stats = devSummary.authorStats[name];
                    var rate = stats.merged ? stats.firstTimeApproved / stats.merged : 0;
                    return {
                        name: name,
                        merged: stats.merged,
                        firstTimeApproved: stats.firstTimeApproved,
                        rate: rate,
                        avgIterations: stats.merged ? stats.totalIterations / stats.merged : 0
                    };
                }).sort(function(a, b) { return b.rate - a.rate; });
                
                var maxRate = 1;
                authors.forEach(function(author) {
                    var percent = Math.round(author.rate * 100);
                    var $row = $('<div class="ujg-pa-bar-row"></div>');
                    var statusIcon = percent >= 85 ? "✓" : percent >= 60 ? "⚠️" : "🔴";
                    var statusText = percent >= 85 ? "Отлично" : percent >= 60 ? "Внимание" : "Проблема";
                    $row.append('<span class="ujg-pa-bar-label">' + utils.escapeHtml(author.name) + " " + statusIcon + "</span>");
                    var $track = $('<div class="ujg-pa-bar-track"><div class="ujg-pa-bar-fill"></div></div>');
                    $track.find(".ujg-pa-bar-fill").css("width", percent + "%");
                    $row.append($track);
                    $row.append('<span class="ujg-pa-bar-value">' + percent + "% " + statusText + "</span>");
                    $authors.append($row);
                });
                $section.append($authors);
            }
            
            if (devSummary.pingPongIssues && devSummary.pingPongIssues.length > 0) {
                var $pingPong = $('<div class="ujg-pa-pingpong-section"><h4>⚠️ Задачи с множественными возвратами (>2 iterations)</h4></div>');
                var $table = $('<table class="ujg-pa-table"><thead><tr><th>Задача</th><th>PR</th><th>Iterations</th><th>Автор</th></tr></thead><tbody></tbody></table>');
                devSummary.pingPongIssues.slice(0, 10).forEach(function(item) {
                    var $row = $("<tr></tr>");
                    $row.append('<td><a href="' + baseUrl + "/browse/" + item.key + '" target="_blank">' + item.key + "</a></td>");
                    $row.append("<td>—</td>");
                    $row.append("<td>" + item.iterations + "</td>");
                    $row.append("<td>" + utils.escapeHtml(item.author) + "</td>");
                    $table.find("tbody").append($row);
                });
                $pingPong.append($table);
                $section.append($pingPong);
            }
            
            $parent.append($section);
        }
        
        function renderDeveloperAnalyticsSection($parent) {
            var developerAnalytics = state.developerAnalytics;
            if (!developerAnalytics || Object.keys(developerAnalytics).length === 0) return;
            
            var $section = $('<div class="ujg-pa-section"><h3>👨‍💻 Аналитика по разработчикам</h3></div>');
            $section.append('<p class="ujg-pa-note">Показаны только разработчики, которые делали коммиты за период</p>');
            
            var developers = Object.keys(developerAnalytics).map(function(key) {
                return developerAnalytics[key];
            }).sort(function(a, b) {
                return b.totalCommits - a.totalCommits;
            });
            
            developers.forEach(function(dev) {
                var $devBlock = $('<div class="ujg-pa-developer-block"></div>');
                $devBlock.append('<h4>' + utils.escapeHtml(dev.name) + "</h4>");
                
                var summary = dev.summary || {};
                
                var $stats = $('<div class="ujg-pa-dev-stats"></div>');
                $stats.append('<p><strong>📊 Общая статистика:</strong></p>');
                $stats.append('<ul>');
                $stats.append('<li>Коммитов: <strong>' + dev.totalCommits + "</strong></li>");
                $stats.append('<li>Pull Requests: <strong>' + dev.totalPRs + "</strong></li>");
                $stats.append('<li>Мержей: <strong>' + dev.totalMerged + "</strong></li>");
                $stats.append('<li>Задач в работе: <strong>' + summary.totalIssues + "</strong></li>");
                $stats.append('</ul>');
                
                $stats.append('<p><strong>⏱️ Средние показатели:</strong></p>');
                $stats.append('<ul>');
                $stats.append('<li>Взял задачу → первый коммит: <strong>' + (summary.avgDaysToFirstCommit || 0).toFixed(1) + " дня</strong></li>');
                $stats.append('<li>Коммитов на задачу: <strong>' + (summary.avgCommitsPerIssue || 0).toFixed(1) + "</strong></li>');
                if (summary.avgDaysToClose > 0) {
                    $stats.append('<li>Последний коммит → закрытие: <strong>' + summary.avgDaysToClose.toFixed(1) + " дня</strong></li>');
                }
                $stats.append('</ul>');
                
                $stats.append('<p><strong>✅ Качество:</strong></p>');
                $stats.append('<ul>');
                $stats.append('<li>Стабильно закрыто (не открывалось): <strong>' + summary.stableClosed + " задач</strong></li>');
                $stats.append('<li>Вернулось на доработку: <strong>' + summary.returnedToWork + " задач</strong></li>');
                $stats.append('<li>После коммита → done: <strong>' + summary.wentToDone + " задач</strong></li>');
                $stats.append('<li>После коммита → work (возврат): <strong>' + summary.wentToWorkAfterCommit + " задач</strong></li>');
                $stats.append('</ul>');
                
                $devBlock.append($stats);
                
                var $details = $('<div class="ujg-pa-dev-details"><p><strong>📋 Детали по задачам:</strong></p></div>');
                var $table = $('<table class="ujg-pa-table"><thead><tr><th>Задача</th><th>Взял → Коммит</th><th>Комм</th><th>Комм/день</th><th>Закрыто</th><th>Возврат</th></tr></thead><tbody></tbody></table>');
                
                var issueKeys = Object.keys(dev.issues).sort();
                issueKeys.forEach(function(issueKey) {
                    var issueData = dev.issues[issueKey];
                    var metrics = issueData.metrics || {};
                    var $row = $("<tr></tr>");
                    
                    var issueUrl = baseUrl + "/browse/" + issueKey;
                    $row.append('<td><a href="' + issueUrl + '" target="_blank">' + issueKey + "</a></td>");
                    
                    var daysToCommit = metrics.daysToFirstCommit !== null ? metrics.daysToFirstCommit.toFixed(1) + " дня" : "—";
                    $row.append("<td>" + daysToCommit + "</td>");
                    
                    $row.append("<td>" + (metrics.commitCount || 0) + "</td>");
                    $row.append("<td>" + (metrics.commitsPerDay ? "✓" : "—") + "</td>");
                    $row.append("<td>" + (metrics.stableClose ? "✓" : "—") + "</td>");
                    $row.append("<td>" + (metrics.returnedToWork ? "✓" : "—") + "</td>");
                    
                    $table.find("tbody").append($row);
                });
                
                $details.append($table);
                $devBlock.append($details);
                
                $section.append($devBlock);
            });
            
            $parent.append($section);
        }
        
        function renderBottlenecksSection($parent) {
            if (!state.bottlenecks) return;
            var $section = $('<div class="ujg-pa-section"><h3>Узкие места</h3></div>');
            function listItems(label, items, formatter) {
                if (!items || items.length === 0) return;
                var $block = $('<div class="ujg-pa-bottleneck-block"><strong>' + label + ":</strong></div>");
                var $list = $("<ul></ul>");
                items.slice(0, 5).forEach(function(item) {
                    var text = formatter(item);
                    $list.append("<li>" + utils.escapeHtml(text) + "</li>");
                });
                $block.append($list);
                $section.append($block);
            }
            listItems("Долгое ревью", state.bottlenecks.longReview, function(item) {
                return item.key + " (" + formatDuration(item.seconds) + ")";
            });
            listItems("Долгое тестирование", state.bottlenecks.longTesting, function(item) {
                return item.key + " (" + formatDuration(item.seconds) + ")";
            });
            listItems("Путешествующие задачи", state.bottlenecks.travellers, function(item) {
                return item.key + " (" + item.changes + " спринтов)";
            });
            listItems("Старые задачи", state.bottlenecks.stale, function(item) {
                return item.key + " (" + item.days + " дн. без активности)";
            });
            listItems("WIP перегруз", state.bottlenecks.wipOverload, function(item) {
                return item.assignee + ": " + item.count + " задач";
            });
            $parent.append($section);
        }

        function renderTrendPlaceholder($parent) {
            var $section = $('<div class="ujg-pa-section ujg-pa-placeholder"></div>');
            $section.append("<h3>Тренды</h3>");
            $section.append("<p>Исторические данные появятся после нескольких запусков виджета. Они будут сохранены локально для расчёта графиков.</p>");
            $parent.append($section);
        }

        function calculateAdvancedInsights(issues) {
            detectBottlenecks(issues);
            calculateDevSummary(issues);
            calculateDeveloperAnalytics(issues);
            calculateRiskScores(issues);
            calculateTeamMetrics(issues);
            calculateVelocity(issues);
        }

        function detectBottlenecks(issues) {
            var thresholds = state.thresholds || DEFAULT_THRESHOLDS;
            var reviewLimit = (thresholds.longReviewRisk || 0) * 86400;
            var testingLimit = (thresholds.longTestingRisk || 0) * 86400;
            var staleDays = thresholds.noProgressRisk || 0;
            var travellerLimit = thresholds.sprintChangesRisk || 0;
            var wipLimit = thresholds.wipLimit || 5;

            var result = {
                longReview: [],
                longTesting: [],
                travellers: [],
                stale: [],
                wipOverload: [],
                reopens: []
            };

            var wipByAssignee = {};
            (issues || []).forEach(function(issue) {
                var analytics = issue.analytics || {};
                var categories = analytics.timeInStatuses && analytics.timeInStatuses.categories || {};
                if (reviewLimit > 0 && categories.review && categories.review > reviewLimit) {
                    result.longReview.push({ key: issue.key, seconds: categories.review });
                }
                if (testingLimit > 0 && categories.testing && categories.testing > testingLimit) {
                    result.longTesting.push({ key: issue.key, seconds: categories.testing });
                }
                if (travellerLimit > 0 && analytics.sprintChanges > travellerLimit) {
                    result.travellers.push({ key: issue.key, changes: analytics.sprintChanges });
                }
                if (analytics.lastActivity && staleDays > 0) {
                    var inactiveDays = daysSince(analytics.lastActivity);
                    if (inactiveDays > staleDays && !statusHasCategory(issue.fields && issue.fields.status && issue.fields.status.name, "done")) {
                        result.stale.push({ key: issue.key, days: inactiveDays });
                    }
                }
                if (analytics.reopenCount > 0) {
                    result.reopens.push({ key: issue.key, count: analytics.reopenCount });
                }
                var currentStatus = issue.fields && issue.fields.status && issue.fields.status.name;
                if (statusHasCategory(currentStatus, "work")) {
                    var assignee = getInitialAssignee(issue);
                    wipByAssignee[assignee] = (wipByAssignee[assignee] || 0) + 1;
                }
            });

            Object.keys(wipByAssignee).forEach(function(name) {
                if (wipByAssignee[name] > wipLimit) {
                    result.wipOverload.push({ assignee: name, count: wipByAssignee[name] });
                }
            });

            state.bottlenecks = result;
        }

        function calculateRiskScores(issues) {
            var thresholds = state.thresholds || DEFAULT_THRESHOLDS;
            var weights = state.riskWeights || DEFAULT_RISK_WEIGHTS;
            (issues || []).forEach(function(issue) {
                var analytics = issue.analytics || {};
                var factors = [];
                var created = parseDateSafe(issue.fields && issue.fields.created);
                if (created && daysSince(created) > (thresholds.ageRisk || 0)) {
                    factors.push({ type: "age", weight: weights.age || 0, message: "Старше " + thresholds.ageRisk + " дн." });
                }
                if (analytics.sprintChanges > (thresholds.sprintChangesRisk || 0)) {
                    factors.push({ type: "sprint_changes", weight: weights.sprintChanges || 0, message: "Смены спринтов: " + analytics.sprintChanges });
                }
                if (analytics.assigneeChanges > (thresholds.assigneeChangesRisk || 0)) {
                    factors.push({ type: "assignee_changes", weight: weights.assigneeChanges || 0, message: "Смены исполнителя: " + analytics.assigneeChanges });
                }
                if (analytics.lastActivity && daysSince(analytics.lastActivity) > (thresholds.noProgressRisk || 0)) {
                    factors.push({ type: "no_progress", weight: weights.noProgress || 0, message: "Нет активности " + daysSince(analytics.lastActivity) + " дн." });
                }
                if (analytics.reopenCount > 0) {
                    factors.push({ type: "reopens", weight: weights.reopens || 0, message: "Возвратов: " + analytics.reopenCount });
                }
                var categories = analytics.timeInStatuses && analytics.timeInStatuses.categories || {};
                if ((categories.review || 0) > (thresholds.longReviewRisk || 0) * 86400) {
                    factors.push({ type: "long_review", weight: weights.longReview || 0, message: "Долгое ревью" });
                }
                if ((categories.testing || 0) > (thresholds.longTestingRisk || 0) * 86400) {
                    factors.push({ type: "long_testing", weight: weights.longTesting || 0, message: "Долгое тестирование" });
                }
                if ((analytics.prIterations || 0) > (thresholds.prIterationsRisk || 0)) {
                    factors.push({ type: "pr_iterations", weight: weights.prIterations || 0, message: "PR итераций: " + analytics.prIterations });
                }
                var priority = issue.fields && issue.fields.priority && issue.fields.priority.name;
                if (priority && /critical|high|highest|крит/i.test(priority)) {
                    factors.push({ type: "priority", weight: 5, message: "Высокий приоритет" });
                }
                var score = 0;
                factors.forEach(function(f) { score += f.weight || 0; });
                if (score > 100) score = 100;
                analytics.risk = {
                    score: Math.round(score),
                    factors: factors
                };
                issue.analytics = analytics;
            });
        }

        function calculateTeamMetrics(issues) {
            var metrics = {};
            (issues || []).forEach(function(issue) {
                var analytics = issue.analytics || {};
                var assignee = getInitialAssignee(issue);
                if (!metrics[assignee]) {
                    metrics[assignee] = {
                        name: assignee,
                        issues: 0,
                        closed: 0,
                        totalLead: 0,
                        totalCycle: 0,
                        reopenCount: 0
                    };
                }
                var entry = metrics[assignee];
                entry.issues += 1;
                entry.totalLead += analytics.leadTimeSeconds || 0;
                entry.totalCycle += analytics.cycleTimeSeconds || 0;
                entry.reopenCount += analytics.reopenCount || 0;
                var currentStatus = issue.fields && issue.fields.status && issue.fields.status.name;
                if (statusHasCategory(currentStatus, "done")) entry.closed += 1;
            });
            state.teamMetrics = Object.keys(metrics).map(function(name) {
                var m = metrics[name];
                return {
                    name: name,
                    issues: m.issues,
                    closed: m.closed,
                    reopenRate: m.issues ? m.reopenCount / m.issues : 0,
                    avgLeadSeconds: m.issues ? m.totalLead / m.issues : 0,
                    avgCycleSeconds: m.issues ? m.totalCycle / m.issues : 0
                };
            }).sort(function(a, b) {
                return (b.closed || 0) - (a.closed || 0);
            });
        }

        function calculateDevSummary(issues) {
            var summary = {
                prCount: 0,
                mergedCount: 0,
                openCount: 0,
                declinedCount: 0,
                avgCycleSeconds: 0,
                avgIterations: 0,
                firstTimeApprovalRate: 0,
                reviewers: {},
                reviewerStats: {},
                authorStats: {},
                pingPongIssues: []
            };
            var totalCycle = 0;
            var mergedCounter = 0;
            var totalIterations = 0;
            var firstTimeApproved = 0;
            
            (issues || []).forEach(function(issue) {
                var devInfo = parseDevData(issue.devStatus);
                if (!devInfo) return;
                
                summary.prCount += devInfo.prCount;
                summary.mergedCount += devInfo.merged;
                summary.openCount += devInfo.open || 0;
                summary.declinedCount += devInfo.declined || 0;
                totalCycle += devInfo.totalCycleSeconds;
                mergedCounter += devInfo.mergedCount;
                totalIterations += devInfo.avgIterations || 0;
                
                Object.keys(devInfo.reviewers || {}).forEach(function(name) {
                    if (!summary.reviewers[name]) summary.reviewers[name] = 0;
                    summary.reviewers[name] += devInfo.reviewers[name];
                });
                
                Object.keys(devInfo.reviewerStats || {}).forEach(function(name) {
                    if (!summary.reviewerStats[name]) {
                        summary.reviewerStats[name] = {
                            reviews: 0,
                            totalTimeSeconds: 0,
                            reviewCount: 0
                        };
                    }
                    var stats = devInfo.reviewerStats[name];
                    summary.reviewerStats[name].reviews += stats.reviews;
                    summary.reviewerStats[name].totalTimeSeconds += stats.totalTimeSeconds;
                    summary.reviewerStats[name].reviewCount += stats.reviewCount;
                });
                
                (devInfo.prs || []).forEach(function(pr) {
                    if (pr.firstTimeApproved) firstTimeApproved += 1;
                    var author = pr.author;
                    if (author && author !== "Unknown") {
                        if (!summary.authorStats[author]) {
                            summary.authorStats[author] = {
                                prs: 0,
                                merged: 0,
                                firstTimeApproved: 0,
                                totalIterations: 0
                            };
                        }
                        summary.authorStats[author].prs += 1;
                        if (pr.status === "merged" || pr.status === "completed") {
                            summary.authorStats[author].merged += 1;
                            summary.authorStats[author].totalIterations += pr.iterations || 1;
                            if (pr.firstTimeApproved) {
                                summary.authorStats[author].firstTimeApproved += 1;
                            }
                        }
                    }
                });
                
                var pingPong = detectPingPongPattern(issue);
                if (pingPong.detected) {
                    summary.pingPongIssues.push({
                        key: issue.key,
                        iterations: pingPong.iterations,
                        author: devInfo.prs && devInfo.prs[0] ? devInfo.prs[0].author : "Unknown"
                    });
                }
                
                issue.analytics = issue.analytics || {};
                issue.analytics.dev = devInfo;
                issue.analytics.prIterations = devInfo.avgIterations || 0;
                if (pingPong.detected) {
                    issue.analytics.pingPong = pingPong;
                }
            });
            
            summary.avgCycleSeconds = mergedCounter ? totalCycle / mergedCounter : 0;
            summary.avgIterations = mergedCounter ? totalIterations / mergedCounter : 0;
            summary.firstTimeApprovalRate = mergedCounter ? firstTimeApproved / mergedCounter : 0;
            
            state.devSummary = summary;
        }
        
        function detectPingPongPattern(issue) {
            var analytics = issue.analytics || {};
            var statusEvents = extractFieldEvents(issue, "status");
            if (!statusEvents || statusEvents.length === 0) {
                return { detected: false, iterations: 0 };
            }
            
            var reviewToWorkTransitions = 0;
            var inReview = false;
            var lastCategory = null;
            
            statusEvents.forEach(function(evt) {
                var fromCat = getCategoriesForStatus(evt.from || "");
                var toCat = getCategoriesForStatus(evt.to || "");
                
                var fromIsReview = fromCat.indexOf("review") >= 0;
                var toIsWork = toCat.indexOf("work") >= 0;
                
                if (fromIsReview && toIsWork) {
                    reviewToWorkTransitions += 1;
                }
            });
            
            return {
                detected: reviewToWorkTransitions > 2,
                iterations: reviewToWorkTransitions
            };
        }

        function parseDevData(devStatus) {
            if (!devStatus || !devStatus.detail || !devStatus.detail.length) return null;
            var prCount = 0;
            var merged = 0;
            var open = 0;
            var declined = 0;
            var mergedCount = 0;
            var totalCycle = 0;
            var reviewers = {};
            var reviewerStats = {};
            var prs = [];

            devStatus.detail.forEach(function(detail) {
                (detail.repositories || []).forEach(function(repo) {
                    (repo.pullRequests || []).forEach(function(pr) {
                        prCount += 1;
                        var status = (pr.status || "").toLowerCase();
                        var prInfo = {
                            id: pr.id || pr.key || "",
                            status: status,
                            author: extractAuthorName(pr.author),
                            created: normalizeTimestamp(pr.createdDate),
                            updated: normalizeTimestamp(pr.updatedDate),
                            merged: normalizeTimestamp(pr.mergedDate || pr.completedDate || pr.closedDate),
                            reviewers: [],
                            iterations: 0,
                            firstTimeApproved: false
                        };
                        
                        if (status === "open" || status === "new") {
                            open += 1;
                        } else if (status === "declined" || status === "rejected") {
                            declined += 1;
                        } else if (status === "merged" || status === "completed") {
                            merged += 1;
                            if (prInfo.created && prInfo.merged && prInfo.merged >= prInfo.created) {
                                totalCycle += (prInfo.merged - prInfo.created) / 1000;
                                mergedCount += 1;
                            }
                        }
                        
                        (pr.reviewers || []).forEach(function(reviewer) {
                            var name = extractReviewerName(reviewer);
                            if (!name) return;
                            prInfo.reviewers.push(name);
                            
                            if (!reviewers[name]) reviewers[name] = 0;
                            reviewers[name] += 1;
                            
                            if (!reviewerStats[name]) {
                                reviewerStats[name] = {
                                    reviews: 0,
                                    totalTimeSeconds: 0,
                                    reviewCount: 0
                                };
                            }
                            reviewerStats[name].reviews += 1;
                            
                            var reviewTime = normalizeTimestamp(reviewer.lastReviewedDate || reviewer.approvedDate);
                            if (reviewTime && prInfo.created && reviewTime >= prInfo.created) {
                                reviewerStats[name].totalTimeSeconds += (reviewTime - prInfo.created) / 1000;
                                reviewerStats[name].reviewCount += 1;
                            }
                        });
                        
                        prs.push(prInfo);
                    });
                });
            });
            
            var firstTimeApproved = 0;
            prs.forEach(function(pr) {
                if (pr.status === "merged" || pr.status === "completed") {
                    pr.iterations = calculatePRIterations(pr);
                    var isFirstTime = determineFirstTimeApproval(pr);
                    pr.firstTimeApproved = isFirstTime;
                    if (isFirstTime) {
                        firstTimeApproved += 1;
                    }
                }
            });

            return {
                prCount: prCount,
                merged: merged,
                open: open,
                declined: declined,
                mergedCount: mergedCount,
                totalCycleSeconds: totalCycle,
                reviewers: reviewers,
                reviewerStats: reviewerStats,
                avgCycleSeconds: mergedCount ? totalCycle / mergedCount : 0,
                firstTimeApprovalRate: mergedCount ? firstTimeApproved / mergedCount : 0,
                avgIterations: calculateAvgIterations(prs),
                prs: prs
            };
        }
        
        function extractAuthorName(author) {
            if (!author) return "Unknown";
            return author.displayName || author.name || author.userName || author.accountId || "Unknown";
        }
        
        function extractReviewerName(reviewer) {
            if (!reviewer) return null;
            if (reviewer.user) {
                return reviewer.user.displayName || reviewer.user.name || reviewer.user.userName || reviewer.user.accountId;
            }
            return reviewer.displayName || reviewer.name || reviewer.userName || reviewer.accountId;
        }
        
        function calculatePRIterations(pr) {
            if (!pr || !pr.status || (pr.status !== "merged" && pr.status !== "completed")) return 0;
            var iterations = 1;
            if (pr.created && pr.updated && pr.updated > pr.created) {
                var updates = Math.floor((pr.updated - pr.created) / 86400000);
                if (updates > 0) iterations += Math.min(3, Math.floor(updates / 3));
            }
            if (pr.reviewers && pr.reviewers.length > 1) {
                iterations += Math.min(2, pr.reviewers.length - 1);
            }
            return Math.max(1, iterations);
        }
        
        function calculateAvgIterations(prs) {
            if (!prs || prs.length === 0) return 0;
            var merged = prs.filter(function(pr) {
                return pr.status === "merged" || pr.status === "completed";
            });
            if (merged.length === 0) return 0;
            var total = 0;
            merged.forEach(function(pr) {
                total += pr.iterations || 1;
            });
            return total / merged.length;
        }
        
        function determineFirstTimeApproval(pr) {
            if (!pr || (pr.status !== "merged" && pr.status !== "completed")) return false;
            if (!pr.created || !pr.merged) return false;
            var daysOpen = (pr.merged - pr.created) / 86400000;
            if (daysOpen > 5) return false;
            if (pr.reviewers && pr.reviewers.length > 2) return false;
            if (pr.created && pr.updated && pr.updated > pr.created) {
                var updateDays = (pr.updated - pr.created) / 86400000;
                if (updateDays > 3) return false;
            }
            return true;
        }

        function calculateVelocity(issues) {
            var summary = {
                closedIssues: 0,
                totalPoints: 0,
                avgPointsPerIssue: 0
            };
            var bounds = getPeriodBounds();
            (issues || []).forEach(function(issue) {
                var currentStatus = issue.fields && issue.fields.status && issue.fields.status.name;
                if (!statusHasCategory(currentStatus, "done")) return;
                var resolutionDate = parseDateSafe(issue.fields && issue.fields.resolutiondate);
                if (resolutionDate && (resolutionDate < bounds.start || resolutionDate > bounds.end)) return;
                summary.closedIssues += 1;
                summary.totalPoints += getStoryPoints(issue);
            });
            summary.avgPointsPerIssue = summary.closedIssues ? summary.totalPoints / summary.closedIssues : 0;
            state.velocity = summary;
        }
        
        function calculateDeveloperAnalytics(issues) {
            var bounds = getPeriodBounds();
            var developers = {};
            
            (issues || []).forEach(function(issue) {
                var devInfo = parseDevData(issue.devStatus);
                if (!devInfo) return;
                
                var commits = extractCommits(issue.devStatus, bounds);
                commits.forEach(function(commit) {
                    var author = commit.author;
                    if (!author || author === "Unknown") return;
                    
                    if (!developers[author]) {
                        developers[author] = {
                            name: author,
                            commits: [],
                            prs: [],
                            issues: {},
                            totalCommits: 0,
                            totalPRs: 0,
                            totalMerged: 0
                        };
                    }
                    
                    developers[author].commits.push({
                        issueKey: issue.key,
                        date: commit.date,
                        message: commit.message
                    });
                    developers[author].totalCommits += 1;
                    
                    if (!developers[author].issues[issue.key]) {
                        developers[author].issues[issue.key] = {
                            key: issue.key,
                            commits: [],
                            prs: [],
                            worklogs: [],
                            statusEvents: []
                        };
                    }
                    developers[author].issues[issue.key].commits.push(commit);
                });
                
                (devInfo.prs || []).forEach(function(pr) {
                    var author = pr.author;
                    if (!author || author === "Unknown") return;
                    
                    if (!developers[author]) {
                        developers[author] = {
                            name: author,
                            commits: [],
                            prs: [],
                            issues: {},
                            totalCommits: 0,
                            totalPRs: 0,
                            totalMerged: 0
                        };
                    }
                    
                    developers[author].prs.push({
                        issueKey: issue.key,
                        pr: pr
                    });
                    developers[author].totalPRs += 1;
                    if (pr.status === "merged" || pr.status === "completed") {
                        developers[author].totalMerged += 1;
                    }
                    
                    if (!developers[author].issues[issue.key]) {
                        developers[author].issues[issue.key] = {
                            key: issue.key,
                            commits: [],
                            prs: [],
                            worklogs: [],
                            statusEvents: []
                        };
                    }
                    developers[author].issues[issue.key].prs.push(pr);
                });
            });
            
            Object.keys(developers).forEach(function(author) {
                var dev = developers[author];
                Object.keys(dev.issues).forEach(function(issueKey) {
                    var issue = findIssueByKey(issues, issueKey);
                    if (!issue) return;
                    
                    var issueData = dev.issues[issueKey];
                    
                    issueData.worklogs = extractWorklogsForDeveloper(issue, author, bounds);
                    issueData.statusEvents = extractFieldEvents(issue, "status");
                    
                    var metrics = calculateDeveloperIssueMetrics(issueData, issue, bounds);
                    issueData.metrics = metrics;
                });
                
                var summary = calculateDeveloperSummary(dev);
                dev.summary = summary;
            });
            
            state.developerAnalytics = developers;
        }
        
        function extractCommits(devStatus, bounds) {
            if (!devStatus || !devStatus.detail || !devStatus.detail.length) return [];
            var commits = [];
            
            devStatus.detail.forEach(function(detail) {
                (detail.repositories || []).forEach(function(repo) {
                    if (repo.commits && Array.isArray(repo.commits)) {
                        repo.commits.forEach(function(commit) {
                            var commitDate = normalizeTimestamp(commit.authorTimestamp || commit.commitTimestamp || commit.date);
                            if (!commitDate) return;
                            if (commitDate < bounds.start || commitDate > bounds.end) return;
                            
                            var author = extractAuthorName(commit.author);
                            commits.push({
                                author: author,
                                date: commitDate,
                                message: commit.message || "",
                                hash: commit.id || commit.hash || commit.commitId || ""
                            });
                        });
                    }
                    if (repo.branches && Array.isArray(repo.branches)) {
                        repo.branches.forEach(function(branch) {
                            if (branch.commits && Array.isArray(branch.commits)) {
                                branch.commits.forEach(function(commit) {
                                    var commitDate = normalizeTimestamp(commit.authorTimestamp || commit.commitTimestamp || commit.date);
                                    if (!commitDate) return;
                                    if (commitDate < bounds.start || commitDate > bounds.end) return;
                                    
                                    var author = extractAuthorName(commit.author);
                                    commits.push({
                                        author: author,
                                        date: commitDate,
                                        message: commit.message || "",
                                        hash: commit.id || commit.hash || commit.commitId || ""
                                    });
                                });
                            }
                        });
                    }
                });
            });
            
            return commits;
        }
        
        function extractWorklogsForDeveloper(issue, developerName, bounds) {
            if (!issue.worklogs || !issue.worklogs.length) return [];
            var worklogs = [];
            
            issue.worklogs.forEach(function(wl) {
                var author = wl.author;
                var authorName = author ? (author.displayName || author.name || author.accountId) : "";
                if (authorName !== developerName) return;
                
                var started = parseDateSafe(wl.started);
                if (!started) return;
                if (started < bounds.start || started > bounds.end) return;
                
                worklogs.push({
                    date: started,
                    timeSpent: wl.timeSpentSeconds || 0,
                    comment: wl.comment || ""
                });
            });
            
            worklogs.sort(function(a, b) { return a.date - b.date; });
            return worklogs;
        }
        
        function findIssueByKey(issues, key) {
            for (var i = 0; i < issues.length; i++) {
                if (issues[i].key === key) return issues[i];
            }
            return null;
        }
        
        function calculateDeveloperIssueMetrics(issueData, issue, bounds) {
            var metrics = {
                firstWorklog: null,
                firstCommit: null,
                daysToFirstCommit: null,
                commitCount: issueData.commits.length,
                commitsPerDay: false,
                lastCommit: null,
                closedAfterCommit: null,
                daysToClose: null,
                stableClose: false,
                returnedToWork: false,
                wentToDone: false,
                wentToWorkAfterCommit: false
            };
            
            if (issueData.worklogs.length > 0) {
                metrics.firstWorklog = issueData.worklogs[0].date;
            }
            
            if (issueData.commits.length > 0) {
                issueData.commits.sort(function(a, b) { return a.date - b.date; });
                metrics.firstCommit = issueData.commits[0].date;
                metrics.lastCommit = issueData.commits[issueData.commits.length - 1].date;
                
                if (metrics.firstWorklog && metrics.firstCommit) {
                    metrics.daysToFirstCommit = (metrics.firstCommit - metrics.firstWorklog) / 86400000;
                }
                
                var commitDays = {};
                issueData.commits.forEach(function(c) {
                    var dayKey = new Date(c.date).toDateString();
                    commitDays[dayKey] = true;
                });
                metrics.commitsPerDay = Object.keys(commitDays).length === issueData.commits.length && issueData.commits.length > 1;
            }
            
            var statusEvents = issueData.statusEvents;
            if (statusEvents.length > 0 && metrics.lastCommit) {
                var lastCommitTime = metrics.lastCommit;
                var doneAfterCommit = false;
                var workAfterCommit = false;
                var stableClose = true;
                var lastDoneTime = null;
                
                statusEvents.forEach(function(evt) {
                    var evtTime = evt.at;
                    if (evtTime < lastCommitTime) return;
                    
                    var toIsDone = statusHasCategory(evt.to, "done");
                    var toIsWork = statusHasCategory(evt.to, "work");
                    var fromIsDone = statusHasCategory(evt.from, "done");
                    var fromIsTesting = statusHasCategory(evt.from, "testing");
                    
                    if (toIsDone && !doneAfterCommit) {
                        doneAfterCommit = true;
                        metrics.wentToDone = true;
                        lastDoneTime = evtTime;
                        metrics.daysToClose = (evtTime - lastCommitTime) / 86400000;
                    }
                    
                    if (fromIsTesting && toIsWork) {
                        metrics.returnedToWork = true;
                    }
                    
                    if (toIsWork && evtTime > lastCommitTime) {
                        workAfterCommit = true;
                        metrics.wentToWorkAfterCommit = true;
                    }
                    
                    if (fromIsDone && !toIsDone) {
                        stableClose = false;
                    }
                });
                
                metrics.stableClose = doneAfterCommit && stableClose;
                metrics.closedAfterCommit = doneAfterCommit;
            }
            
            return metrics;
        }
        
        function calculateDeveloperSummary(dev) {
            var issues = Object.keys(dev.issues);
            var totalIssues = issues.length;
            var totalDaysToFirstCommit = 0;
            var totalCommitsPerIssue = 0;
            var totalDaysToClose = 0;
            var stableClosed = 0;
            var returnedToWork = 0;
            var wentToDone = 0;
            var wentToWorkAfterCommit = 0;
            var commitsPerDayCount = 0;
            
            issues.forEach(function(issueKey) {
                var issueData = dev.issues[issueKey];
                var metrics = issueData.metrics || {};
                
                if (metrics.daysToFirstCommit !== null) {
                    totalDaysToFirstCommit += metrics.daysToFirstCommit;
                }
                totalCommitsPerIssue += metrics.commitCount || 0;
                if (metrics.daysToClose !== null) {
                    totalDaysToClose += metrics.daysToClose;
                }
                if (metrics.stableClose) stableClosed += 1;
                if (metrics.returnedToWork) returnedToWork += 1;
                if (metrics.wentToDone) wentToDone += 1;
                if (metrics.wentToWorkAfterCommit) wentToWorkAfterCommit += 1;
                if (metrics.commitsPerDay) commitsPerDayCount += 1;
            });
            
            return {
                totalIssues: totalIssues,
                avgDaysToFirstCommit: totalIssues > 0 ? totalDaysToFirstCommit / totalIssues : 0,
                avgCommitsPerIssue: totalIssues > 0 ? totalCommitsPerIssue / totalIssues : 0,
                avgDaysToClose: wentToDone > 0 ? totalDaysToClose / wentToDone : 0,
                stableClosed: stableClosed,
                returnedToWork: returnedToWork,
                wentToDone: wentToDone,
                wentToWorkAfterCommit: wentToWorkAfterCommit,
                commitsPerDayIssues: commitsPerDayCount
            };
        }

        function countReopens(statusEvents) {
            var count = 0;
            (statusEvents || []).forEach(function(evt) {
                if (!evt || !evt.from) return;
                if (statusHasCategory(evt.from, "done") && !statusHasCategory(evt.to, "done")) {
                    count += 1;
                }
            });
            return count;
        }

        function getLastActivityDate(issue) {
            var last = parseDateSafe(issue.fields && issue.fields.updated);
            var histories = (issue.changelog && issue.changelog.histories) || [];
            histories.forEach(function(history) {
                var dt = parseDateSafe(history.created);
                if (dt && (!last || dt > last)) last = dt;
            });
            (issue.worklogs || []).forEach(function(wl) {
                var dt = parseDateSafe(wl.started);
                if (dt && (!last || dt > last)) last = dt;
            });
            return last;
        }

        function daysSince(date) {
            if (!date) return 0;
            var now = new Date();
            return Math.floor((now - date) / 86400000);
        }

        function getStoryPoints(issue) {
            var fieldId = state.customFields && state.customFields.storyPoints;
            if (!fieldId) return 0;
            var value = issue.fields ? issue.fields[fieldId] : null;
            if (typeof value === "number") return value;
            var parsed = parseFloat(value);
            return isNaN(parsed) ? 0 : parsed;
        }

        function normalizeTimestamp(value) {
            if (value === undefined || value === null) return null;
            if (value instanceof Date) return value;
            if (typeof value === "number") {
                if (value > 1e12) return new Date(value);
                return new Date(value * 1000);
            }
            return parseDateSafe(value);
        }

        try {
            initPanel();
            updateStatus("Готово к запуску. Версия " + CONFIG.version);
            log("Gadget initialization completed successfully");
            
            if (typeof API.resize === "function") {
                API.resize();
                log("API.resize() called");
            }
            
            setTimeout(function() {
                if ($container && $container.children().length === 0) {
                    log("WARNING: Container is empty after init, adding fallback message");
                    $container.html('<div class="ujg-pa-panel" style="padding:20px;"><div class="ujg-pa-status">Виджет загружен. Если панель не отображается, проверьте консоль браузера (F12).</div></div>');
                    if (typeof API.resize === "function") API.resize();
                } else {
                    log("Container has", $container.children().length, "children after init");
                }
            }, 500);
        } catch (e) {
            log("ERROR during initialization:", e);
            console.error("[UJG-ProjectAnalytics] Initialization error:", e);
            if ($container) {
                $container.html('<div style="padding:20px;color:red;background:#ffebe6;border:1px solid #de350b;border-radius:3px;"><strong>Ошибка инициализации:</strong><br>' + utils.escapeHtml(e.message || String(e)) + '<br><small>Проверьте консоль браузера (F12) для подробностей.</small></div>');
            }
        }
    }

    return MyGadget;
});
