// Модальное окно настроек
define("_ujgPA_settingsModal", ["jquery", "_ujgPA_config", "_ujgPA_utils", "_ujgPA_workflow", "_ujgPA_storage"], function($, config, utils, workflow, storage) {
    "use strict";
    
    var $modal, $tabs, $content;
    var currentTab = "workflow";
    var ctx = null;
    var TAB_DEFS = [
        { id: "workflow", label: "Workflow" },
        { id: "custom", label: "Кастомные поля" },
        { id: "thresholds", label: "Пороги" }
    ];
    
    var STATUS_CATEGORIES = workflow.STATUS_CATEGORIES;
    var DEFAULT_THRESHOLDS = config.DEFAULT_THRESHOLDS;
    var DEFAULT_RISK_WEIGHTS = config.DEFAULT_RISK_WEIGHTS;
    var DEFAULT_CUSTOM_FIELDS = config.DEFAULT_CUSTOM_FIELDS;
    
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
        
        // Нормализуем структуру (на случай старых сохранений)
        Object.keys(STATUS_CATEGORIES).forEach(function(cat) {
            if (!cfg.categoryStatuses[cat]) cfg.categoryStatuses[cat] = [];
        });
        if (!cfg.statusCategories) {
            cfg.statusCategories = workflow.buildStatusIndexFromCategory(cfg.categoryStatuses);
        }
        
        // Полный набор статусов для сохранения (исторический/конфиг)
        var allStatusesForSave = utils.uniqueList(cfg.allStatuses
            .concat(Object.keys(cfg.statusCategories || {}))
            .concat([].concat.apply([], Object.keys(cfg.categoryStatuses || {}).map(function(cat) { return cfg.categoryStatuses[cat] || []; })))
        );

        // Набор статусов для отображения в пуле "Нераспределённые".
        // Если виджет уже загружал данные за период — используем только реальные статусы из текущей выборки,
        // чтобы не показывать "гипотетические" статусы из прошлых запусков.
        var visibleStatuses = (ctx && ctx.availableStatuses && ctx.availableStatuses.length)
            ? utils.uniqueList(ctx.availableStatuses)
            : allStatusesForSave.slice();
        
        // Локальное состояние для UI
        var categoryLists = {};
        Object.keys(STATUS_CATEGORIES).forEach(function(cat) {
            categoryLists[cat] = utils.uniqueList(cfg.categoryStatuses[cat] || []);
        });
        
        function computeAssignedSet() {
            var assigned = {};
            Object.keys(categoryLists).forEach(function(cat) {
                (categoryLists[cat] || []).forEach(function(s) {
                    var name = utils.normalizeStatusName(s);
                    if (!name) return;
                    assigned[name] = true;
                });
            });
            return assigned;
        }
        
        function computePoolStatuses() {
            var assigned = computeAssignedSet();
            return visibleStatuses.filter(function(s) { return !assigned[s]; });
        }
        
        function removeFromAllCategories(status) {
            Object.keys(categoryLists).forEach(function(cat) {
                categoryLists[cat] = (categoryLists[cat] || []).filter(function(s) { return s !== status; });
            });
        }
        
        function ensureInAllStatuses(status) {
            if (allStatusesForSave.indexOf(status) === -1) allStatusesForSave.push(status);
            // показываем в пуле только если UI работает не от ctx.availableStatuses
            if (!ctx || !ctx.availableStatuses || !ctx.availableStatuses.length) {
                if (visibleStatuses.indexOf(status) === -1) visibleStatuses.push(status);
            }
        }
        
        function moveStatus(status, targetCat) {
            var name = utils.normalizeStatusName(status);
            if (!name) return;
            ensureInAllStatuses(name);
            
            // По умолчанию один статус = одна категория.
            // Перетаскивание в категорию удаляет из других категорий.
            removeFromAllCategories(name);
            
            if (targetCat) {
                if (!categoryLists[targetCat]) categoryLists[targetCat] = [];
                if (categoryLists[targetCat].indexOf(name) === -1) categoryLists[targetCat].push(name);
            }
        }
        
        function removeStatusToPool(status) {
            var name = utils.normalizeStatusName(status);
            if (!name) return;
            ensureInAllStatuses(name);
            removeFromAllCategories(name);
        }
        
        function getDragPayload(e) {
            var dt = e && e.originalEvent && e.originalEvent.dataTransfer;
            if (!dt) return null;
            var raw = "";
            try { raw = dt.getData("application/x-ujg-pa-status") || ""; } catch (err) {}
            if (raw) {
                try { return JSON.parse(raw); } catch (err2) {}
            }
            // fallback
            try {
                var txt = dt.getData("text/plain") || "";
                txt = utils.normalizeStatusName(txt);
                if (!txt) return null;
                return { status: txt };
            } catch (err3) {}
            return null;
        }
        
        function setDragPayload(e, payload) {
            var dt = e && e.originalEvent && e.originalEvent.dataTransfer;
            if (!dt) return;
            try {
                dt.setData("application/x-ujg-pa-status", JSON.stringify(payload || {}));
                dt.setData("text/plain", payload && payload.status ? payload.status : "");
            } catch (err) {}
        }
        
        var $info = $('<p>Распределите статусы Jira по аналитическим категориям. Перетаскивайте статусы мышкой из «Нераспределённых» в нужный блок. Статус может быть только в одной категории.</p>');
        var $statusManager = $('<div class="ujg-pa-status-manager"></div>');
        var $poolHeader = $('<div class="ujg-pa-status-pool-header"></div>');
        var $poolCount = $('<span class="ujg-pa-status-pool-count"></span>');
        $poolHeader.append('<strong>Нераспределённые</strong> ', $poolCount);
        var $statusList = $('<div class="ujg-pa-status-list ujg-pa-dropzone" data-zone="pool"></div>');
        var $statusInput = $('<input type="text" class="ujg-pa-status-input" placeholder="Новый статус...">');
        var $addStatusBtn = $('<button class="aui-button">Добавить</button>');
        
        function renderStatusList(filterText) {
            $statusList.empty();
            var pool = computePoolStatuses();
            var q = utils.normalizeStatusName(filterText || "").toLowerCase();
            if (q) {
                pool = pool.filter(function(s) { return s.toLowerCase().indexOf(q) >= 0; });
            }
            $poolCount.text("(" + computePoolStatuses().length + ")");
            if (pool.length === 0) {
                $statusList.append('<span class="ujg-pa-status-chip ujg-pa-status-chip-empty">Нет нераспределённых статусов</span>');
                return;
            }
            pool.forEach(function(status) {
                var $chip = $('<span class="ujg-pa-status-chip ujg-pa-status-chip-draggable" draggable="true" data-status=""></span>');
                $chip.attr("data-status", status).text(status);
                $chip.on("dragstart", function(e) {
                    $(this).addClass("ujg-pa-dragging");
                    setDragPayload(e, { status: status, from: "pool" });
                });
                $chip.on("dragend", function() {
                    $(this).removeClass("ujg-pa-dragging");
                });
                $statusList.append($chip);
            });
        }
        
        $addStatusBtn.on("click", function() {
            var value = utils.normalizeStatusName($statusInput.val());
            if (!value) return;
            ensureInAllStatuses(value);
            renderStatusList();
            $statusInput.val("");
        });
        
        var $filterRow = $('<div class="ujg-pa-status-filter"></div>');
        var $filterInput = $('<input type="text" class="ujg-pa-status-input" placeholder="Фильтр статусов...">');
        $filterInput.on("input", function() { renderStatusList($filterInput.val()); });
        $filterRow.append($filterInput);
        
        // Если есть реальные статусы из текущей выборки — убираем ручное добавление, чтобы не плодить "гипотетические"
        var hasAvailable = ctx && ctx.availableStatuses && ctx.availableStatuses.length;
        if (hasAvailable) {
            $statusManager.append($poolHeader, $statusList, $filterRow);
        } else {
            $statusManager.append($poolHeader, $statusList, $filterRow, $('<div class="ujg-pa-status-add"></div>').append($statusInput, $addStatusBtn));
        }
        renderStatusList();
        
        var $categories = $('<div class="ujg-pa-categories-grid"></div>');
        
        function renderCategory(cat, $dropzone) {
            $dropzone.empty();
            var items = categoryLists[cat] || [];
            if (!items.length) {
                $dropzone.append('<div class="ujg-pa-dropzone-empty">Перетащите статус сюда</div>');
                return;
            }
            items.forEach(function(status) {
                var $chip = $('<span class="ujg-pa-status-chip ujg-pa-status-chip-draggable ujg-pa-status-chip-in-category" draggable="true"></span>');
                $chip.text(status);
                $chip.attr("data-status", status);
                var $rm = $('<button type="button" class="ujg-pa-chip-remove" title="Убрать">×</button>');
                $rm.on("click", function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    removeStatusToPool(status);
                    renderAll();
                });
                $chip.append($rm);
                $chip.on("dragstart", function(e) {
                    $(this).addClass("ujg-pa-dragging");
                    setDragPayload(e, { status: status, from: "cat", cat: cat });
                });
                $chip.on("dragend", function() {
                    $(this).removeClass("ujg-pa-dragging");
                });
                $dropzone.append($chip);
            });
        }
        
        function wireDropzone($dz) {
            $dz.on("dragover", function(e) {
                e.preventDefault();
                $(this).addClass("ujg-pa-dropzone-over");
                try { e.originalEvent.dataTransfer.dropEffect = "move"; } catch (err) {}
            });
            $dz.on("dragleave", function() {
                $(this).removeClass("ujg-pa-dropzone-over");
            });
            $dz.on("drop", function(e) {
                e.preventDefault();
                $(this).removeClass("ujg-pa-dropzone-over");
                var payload = getDragPayload(e);
                if (!payload || !payload.status) return;
                var zone = $(this).data("zone");
                var cat = $(this).data("cat");
                
                if (zone === "pool") {
                    removeStatusToPool(payload.status);
                } else if (zone === "cat" && cat) {
                    moveStatus(payload.status, cat);
                }
                renderAll();
            });
        }
        
        var categoryDropzones = {};
        
        Object.keys(STATUS_CATEGORIES).forEach(function(cat) {
            var categoryInfo = STATUS_CATEGORIES[cat];
            var $section = $('<div class="ujg-pa-category-section"></div>');
            $section.append('<h4>' + categoryInfo.name + '</h4>');
            $section.append('<p class="ujg-pa-category-desc">' + categoryInfo.description + '</p>');
            var $dropzone = $('<div class="ujg-pa-category-dropzone ujg-pa-dropzone" data-zone="cat" data-cat="' + cat + '"></div>');
            categoryDropzones[cat] = $dropzone;
            wireDropzone($dropzone);
            $section.append($dropzone);
            $categories.append($section);
        });
        
        // Пул тоже dropzone (возврат в нераспределённые)
        wireDropzone($statusList);
        
        function renderAll() {
            renderStatusList($filterInput.val());
            Object.keys(categoryDropzones).forEach(function(cat) {
                renderCategory(cat, categoryDropzones[cat]);
            });
        }
        renderAll();
        
        var $actions = $('<div class="ujg-pa-settings-actions"></div>');
        var $saveBtn = $('<button class="aui-button aui-button-primary">Сохранить</button>');
        var $cancelBtn = $('<button class="aui-button aui-button-link">Отмена</button>');
        
        $saveBtn.on("click", function() {
            var newCategoryMap = {};
            Object.keys(STATUS_CATEGORIES).forEach(function(cat) {
                newCategoryMap[cat] = utils.uniqueList((categoryLists[cat] || []).slice());
            });
            var statusFromCategories = workflow.buildStatusIndexFromCategory(newCategoryMap);
            var mergedStatuses = utils.uniqueList(allStatusesForSave.concat(Object.keys(statusFromCategories)));
            
            cfg.categoryStatuses = newCategoryMap;
            cfg.statusCategories = statusFromCategories;
            cfg.allStatuses = mergedStatuses;
            cfg.isManuallyConfigured = true;
            cfg.lastUpdated = new Date().toISOString();
            ctx.workflowConfig = cfg;
            storage.saveWorkflowConfig(cfg);
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
});
