// Главный класс MyGadget и инициализация
define("_ujgPA_main", ["jquery", "_ujgCommon", "_ujgPA_config", "_ujgPA_utils", "_ujgPA_storage", "_ujgPA_workflow", "_ujgPA_apiTracker", "_ujgPA_progressModal", "_ujgPA_settingsModal", "_ujgPA_dataCollection", "_ujgPA_basicAnalytics", "_ujgPA_devCycle", "_ujgPA_developerAnalytics", "_ujgPA_testerAnalytics", "_ujgPA_bottlenecks", "_ujgPA_riskAssessment", "_ujgPA_teamMetrics", "_ujgPA_velocity", "_ujgPA_rendering"], function($, Common, config, utils, storage, workflow, apiTracker, progressModal, settingsModal, dataCollection, basicAnalytics, devCycle, developerAnalytics, testerAnalytics, bottlenecks, riskAssessment, teamMetrics, velocity, rendering) {
    "use strict";
    
    var CONFIG = config.CONFIG;
    var STATUS_CATEGORIES = workflow.STATUS_CATEGORIES;
    
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
        
        utils.log("Content element found:", $content.length, "elements");
        
        var $container = $content.find(".ujg-project-analytics");
        if ($container.length === 0) {
            if ($content.hasClass("ujg-project-analytics")) {
                $container = $content;
                utils.log("Using content element as container");
            } else {
                utils.log("Container not found, creating new one");
                $container = $('<div class="ujg-project-analytics"></div>');
                $content.append($container);
            }
        } else {
            utils.log("Found existing container:", $container.length);
        }
        
        if ($container.length === 0) {
            console.error("[UJG-ProjectAnalytics] Failed to create/find container!");
            $content.html('<div style="padding:20px;color:red;">Ошибка: не удалось создать контейнер виджета</div>');
            return;
        }
        
        utils.log("Using container with", $container.length, "element(s)");
        
        var state = {
            jqlFilter: "",
            period: utils.getDefaultPeriod(),
            loading: false,
            issues: [],
            lastError: "",
            workflowConfig: storage.loadWorkflowConfig(),
            thresholds: null,
            riskWeights: null,
            customFields: null,
            fieldMetadata: null,
            analyticsSummary: null,
            bottlenecks: null,
            teamMetrics: [],
            devSummary: null,
            velocity: null,
            developerAnalytics: null
        };
        
        Object.keys(STATUS_CATEGORIES).forEach(function(cat) {
            if (!state.workflowConfig.categoryStatuses) state.workflowConfig.categoryStatuses = {};
            if (!state.workflowConfig.categoryStatuses[cat]) state.workflowConfig.categoryStatuses[cat] = [];
        });
        if (!state.workflowConfig.statusCategories) {
            state.workflowConfig.statusCategories = workflow.buildStatusIndexFromCategory(state.workflowConfig.categoryStatuses);
        }
        
        var pendingRequests = [];
        var settings = storage.loadSettings();
        if (settings.jql) state.jqlFilter = settings.jql;
        if (settings.periodStart && settings.periodEnd) {
            state.period = utils.clampPeriod(settings.periodStart, settings.periodEnd);
        }
        state.thresholds = storage.getThresholds(settings);
        state.riskWeights = storage.getRiskWeights(settings);
        state.customFields = storage.getCustomFields(settings);
        
        var dataCollector = dataCollection.createDataCollector(state, addRequest, function() { return !state.loading; });
        var basicAnalyticsCalc = basicAnalytics.createBasicAnalytics(state);
        var devCycleAnalyzer = devCycle.createDevCycleAnalyzer(state);
        var developerAnalyticsCalc = developerAnalytics.createDeveloperAnalytics(state);
        var testerAnalyticsCalc = testerAnalytics.createTesterAnalytics(state);
        var bottleneckDetector = bottlenecks.createBottleneckDetector(state);
        var riskAssessor = riskAssessment.createRiskAssessor(state);
        var teamMetricsCalc = teamMetrics.createTeamMetricsCalculator(state);
        var velocityCalc = velocity.createVelocityCalculator(state);
        var renderer = rendering.createRenderer(state);
        
        var $panel, $jqlInput, $startInput, $endInput, $loadBtn, $statusBox, $resultsContainer;
        
        utils.log("MyGadget initialized, container:", $container.length);
        
        function handleWorkflowChange(cfg) {
            state.workflowConfig = cfg;
        }
        
        function handleCustomFieldsChange(fields) {
            state.customFields = $.extend({}, fields);
            storage.saveCustomFields(settings, state.customFields);
            updateStatus("Кастомные поля обновлены");
        }
        
        function handleThresholdsChange(thresholds) {
            state.thresholds = $.extend({}, thresholds);
            storage.saveThresholds(settings, state.thresholds);
            updateStatus("Пороговые значения сохранены");
        }
        
        function handleRiskWeightsChange(weights) {
            state.riskWeights = $.extend({}, weights);
            storage.saveRiskWeights(settings, state.riskWeights);
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
            utils.log("initPanel called");
            if (!$container || $container.length === 0) {
                utils.log("ERROR: container not found!");
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
                storage.saveSettings(settings);
            });
            $jqlRow.append($('<label>JQL: </label>'), $jqlInput, $applyBtn);
            
            var $dateRow = $('<div class="ujg-pa-row"></div>');
            $startInput = $('<input type="date" class="ujg-pa-date">');
            $endInput = $('<input type="date" class="ujg-pa-date">');
            $startInput.val(state.period.start);
            $endInput.val(state.period.end);
            var $settingsBtn = $('<button class="aui-button">Настройки</button>').on("click", function() {
                function computeAvailableStatusesForPeriod() {
                    var set = {};
                    (state.issues || []).forEach(function(issue) {
                        var current = issue && issue.fields && issue.fields.status && issue.fields.status.name;
                        if (current) set[current] = true;
                        // Берём только события за выбранный период
                        var events = (basicAnalyticsCalc.extractFieldEventsInPeriod ?
                            basicAnalyticsCalc.extractFieldEventsInPeriod(issue, "status") :
                            basicAnalyticsCalc.extractFieldEvents(issue, "status")) || [];
                        events.forEach(function(e) {
                            if (e && e.from) set[e.from] = true;
                            if (e && e.to) set[e.to] = true;
                        });
                    });
                    return Object.keys(set).sort(function(a, b) { return a.localeCompare(b); });
                }

                settingsModal.open({
                    workflowConfig: state.workflowConfig,
                    // Для UI workflow-настроек: показываем только статусы из текущей выборки за период,
                    // чтобы не копить "гипотетические" статусы из старых запусков.
                    availableStatuses: computeAvailableStatusesForPeriod(),
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
            utils.log("Panel appended to container, panel children:", $panel.children().length);
            
            if ($panel.parent().length === 0) {
                console.error("[UJG-ProjectAnalytics] Panel was not added to DOM!");
            } else {
                utils.log("Panel is in DOM, parent:", $panel.parent().length);
            }
            
            $resultsContainer = $('<div class="ujg-pa-results"></div>');
            $container.append($resultsContainer);
            renderer.renderAnalyticsTable($resultsContainer);
            
            utils.log("initPanel completed, container HTML length:", $container.html().length);
            
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
            dataCollector.tracker.incrementProcessed(dataCollector.tracker.issues.total);
            progressModal.hide();
            updateStatus(message || "Загрузка завершена");
        }
        
        function failLoading(err) {
            state.loading = false;
            progressModal.hide();
            updateStatus(err || "Ошибка при загрузке");
        }
        
        function calculateAdvancedInsights(issues) {
            bottleneckDetector.detectBottlenecks(issues);
            devCycleAnalyzer.calculateDevSummary(issues);
            developerAnalyticsCalc.calculateDeveloperAnalytics(issues);
            testerAnalyticsCalc.calculateTesterAnalytics(issues);
            riskAssessor.calculateRiskScores(issues);
            teamMetricsCalc.calculateTeamMetrics(issues);
            velocityCalc.calculateVelocity(issues);
        }
        
        function startLoading() {
            if (state.loading) return;
            var newPeriod = utils.clampPeriod($startInput.val(), $endInput.val());
            state.period = newPeriod;
            settings.periodStart = newPeriod.start;
            settings.periodEnd = newPeriod.end;
            storage.saveSettings(settings);
            
            state.jqlFilter = $jqlInput.val().trim();
            
            dataCollector.tracker.reset(0);
            state.loading = true;
            updateStatus("Загрузка началась...");
            progressModal.show(function() {
                state.loading = false;
                cancelPendingRequests();
                progressModal.hide();
                updateStatus("Загрузка отменена");
            });
            progressModal.update(dataCollector.tracker);
            API.resize();
            
            var pipeline = dataCollector.loadFieldMetadata()
                .then(function() {
                    return dataCollector.fetchAllIssues(state.jqlFilter, state.period);
                })
                .then(function(issues) {
                    state.issues = issues;
                    dataCollector.tracker.setTotalIssues(issues.length);
                    dataCollector.updateKnownStatuses(issues);
                    progressModal.update(dataCollector.tracker);
                    return dataCollector.processIssuesSequentially(issues).then(function() {
                        basicAnalyticsCalc.calculateAnalytics(issues);
                        calculateAdvancedInsights(issues);
                        renderer.renderAnalyticsTable($resultsContainer);
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
        
        try {
            initPanel();
            updateStatus("Готово к запуску. Версия " + CONFIG.version);
            utils.log("Gadget initialization completed successfully");
            
            if (typeof API.resize === "function") {
                API.resize();
                utils.log("API.resize() called");
            }
            
            setTimeout(function() {
                if ($container && $container.children().length === 0) {
                    utils.log("WARNING: Container is empty after init, adding fallback message");
                    $container.html('<div class="ujg-pa-panel" style="padding:20px;"><div class="ujg-pa-status">Виджет загружен. Если панель не отображается, проверьте консоль браузера (F12).</div></div>');
                    if (typeof API.resize === "function") API.resize();
                } else {
                    utils.log("Container has", $container.children().length, "children after init");
                }
            }, 500);
        } catch (e) {
            utils.log("ERROR during initialization:", e);
            console.error("[UJG-ProjectAnalytics] Initialization error:", e);
            if ($container) {
                var errorMsg = e.message || String(e);
                var escapeHtml = utils.utils && utils.utils.escapeHtml ? utils.utils.escapeHtml : function(str) { return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); };
                var escapedMsg = escapeHtml(errorMsg);
                $container.html('<div style="padding:20px;color:red;background:#ffebe6;border:1px solid #de350b;border-radius:3px;"><strong>Ошибка инициализации:</strong><br>' + escapedMsg + '<br><small>Проверьте консоль браузера (F12) для подробностей.</small></div>');
            }
        }
    }
    
    return MyGadget;
});
