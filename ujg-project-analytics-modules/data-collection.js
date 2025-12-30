// Сбор данных из API
define("_ujgPA_dataCollection", ["jquery", "_ujgCommon", "_ujgPA_utils", "_ujgPA_apiTracker", "_ujgPA_progressModal", "_ujgPA_storage", "_ujgPA_workflow"], function($, Common, utils, apiTracker, progressModal, storage, workflow) {
    "use strict";
    
    var baseUrl = Common.baseUrl || "";
    
    function createDataCollector(state, addRequest, isCancelled) {
        var tracker = apiTracker.createApiTracker();
        var fieldMetadataPromise = null;
        
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
            return utils.uniqueList(baseFields);
        }
        
        function fetchAllIssues(jqlFilter, period) {
            var d = $.Deferred();
            var issues = [];
            var maxResults = 100;
            var finalJql = buildJqlString(jqlFilter, period);
            if (!finalJql) finalJql = "ORDER BY updated DESC";
            
            function fetchBatch(startAt) {
                if (isCancelled && isCancelled()) {
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
                if (isCancelled && isCancelled()) {
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
            var merged = utils.uniqueList(current.concat(discovered));
            if (merged.length !== current.length) {
                cfg.allStatuses = merged;
                storage.saveWorkflowConfig(cfg);
            }
        }
        
        return {
            loadFieldMetadata: loadFieldMetadata,
            fetchAllIssues: fetchAllIssues,
            processIssuesSequentially: processIssuesSequentially,
            updateKnownStatuses: updateKnownStatuses,
            tracker: tracker
        };
    }
    
    return {
        createDataCollector: createDataCollector
    };
});
