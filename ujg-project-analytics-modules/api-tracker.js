// Трекер API запросов
define("_ujgPA_apiTracker", [], function() {
    "use strict";
    
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
    
    return {
        createApiTracker: createApiTracker
    };
});
