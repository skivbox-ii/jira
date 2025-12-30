// Модальное окно прогресса загрузки
define("_ujgPA_progressModal", ["jquery"], function($) {
    "use strict";
    
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
});
