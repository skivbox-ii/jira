define("_ujgUA_repoApi", ["jquery", "_ujgCommon", "_ujgUA_config", "_ujgUA_utils"], function($, Common, config, utils) {
    "use strict";

    var baseUrl = Common.baseUrl || "";
    var CONFIG = config.CONFIG || {};

    function cloneValue(value) {
        if (!value || typeof value !== "object") return value;
        if (Array.isArray(value)) return value.map(cloneValue);

        var out = {};
        Object.keys(value).forEach(function(key) {
            out[key] = cloneValue(value[key]);
        });
        return out;
    }

    function firstNonEmpty(item, keys) {
        var i;
        var value;

        for (i = 0; i < keys.length; i++) {
            value = item && item[keys[i]];
            if (value !== undefined && value !== null && value !== "") return String(value);
        }

        return "";
    }

    function mergeUniqueField(target, source, field, keys) {
        if (!Array.isArray(source[field]) || source[field].length === 0) return;
        target[field] = uniqueByIdentity((target[field] || []).concat(source[field]), keys);
    }

    function uniqueByIdentity(items, keys) {
        var seen = {};
        var out = [];

        (items || []).forEach(function(item) {
            var key = firstNonEmpty(item, keys);

            if (!key) {
                out.push(cloneValue(item));
                return;
            }
            if (seen[key]) return;

            seen[key] = true;
            out.push(cloneValue(item));
        });

        return out;
    }

    function mergeDevStatus(repoResp, prResp) {
        var base = repoResp && typeof repoResp === "object" ? cloneValue(repoResp) : {};
        var add = prResp && typeof prResp === "object" ? cloneValue(prResp) : {};

        if (!Array.isArray(base.detail)) base.detail = [];
        if (!Array.isArray(add.detail)) return base;

        function detailKey(detail) {
            var key = [
                detail && detail.applicationLinkId || "",
                detail && detail.instanceId || "",
                detail && (detail.type || detail.typeName) || "",
                detail && detail.name || ""
            ].join("|");

            return key === "|||" ? "" : key;
        }

        function repoKey(repo) {
            var key = [
                repo && repo.url || "",
                repo && repo.name || "",
                repo && repo.id || ""
            ].join("|");

            return key === "||" ? "" : key;
        }

        function mergeRepoField(targetRepo, addRepo, field) {
            var keysByField = {
                commits: ["id", "hash", "commitHash", "displayId", "url"],
                branches: ["id", "name", "url"],
                pullRequests: ["id", "url", "name"]
            };
            mergeUniqueField(targetRepo, addRepo, field, keysByField[field] || ["id", "url", "name"]);
        }

        function fillMissingFields(target, source) {
            Object.keys(source || {}).forEach(function(key) {
                if (target[key] === undefined || target[key] === null || target[key] === "") {
                    target[key] = cloneValue(source[key]);
                }
            });
        }

        add.detail.forEach(function(addDetail) {
            var targetDetail = null;
            var addDetailKey = detailKey(addDetail);
            var i;

            for (i = 0; i < base.detail.length; i++) {
                var currentDetailKey = detailKey(base.detail[i]);
                if (addDetailKey && currentDetailKey === addDetailKey) {
                    targetDetail = base.detail[i];
                    break;
                }
            }

            if (!targetDetail) {
                base.detail.push(addDetail);
                return;
            }

            fillMissingFields(targetDetail, addDetail);
            mergeUniqueField(targetDetail, addDetail, "pullRequests", ["id", "url", "name"]);
            if (!Array.isArray(targetDetail.repositories) && Array.isArray(addDetail.repositories)) {
                targetDetail.repositories = [];
            }

            (addDetail.repositories || []).forEach(function(addRepo) {
                var targetRepo = null;
                var addRepoKey = repoKey(addRepo);
                var j;

                for (j = 0; j < targetDetail.repositories.length; j++) {
                    var currentRepoKey = repoKey(targetDetail.repositories[j]);
                    if (addRepoKey && currentRepoKey === addRepoKey) {
                        targetRepo = targetDetail.repositories[j];
                        break;
                    }
                }

                if (!targetRepo) {
                    targetDetail.repositories.push(addRepo);
                    return;
                }

                fillMissingFields(targetRepo, addRepo);
                mergeRepoField(targetRepo, addRepo, "commits");
                mergeRepoField(targetRepo, addRepo, "branches");
                mergeRepoField(targetRepo, addRepo, "pullRequests");
            });
        });

        return base;
    }

    function normalizeDevStatus(devStatus) {
        if (!devStatus || !Array.isArray(devStatus.detail) || devStatus.detail.length === 0) {
            return {};
        }
        return devStatus;
    }

    function fetchIssueDevStatus(issue, onProgress) {
        var d = $.Deferred();
        var pending = 2;
        var repoDone = false;
        var prDone = false;
        var repoData = {};
        var prData = {};

        if (!issue || !issue.id) {
            d.resolve({});
            return d.promise();
        }

        function unwrap(resp) {
            return resp && resp[0] ? resp[0] : resp;
        }

        function finish() {
            var status;

            pending -= 1;
            if (pending > 0) return;

            issue.devStatus = (repoDone || prDone)
                ? normalizeDevStatus(mergeDevStatus(repoData, prData) || {})
                : {};
            if (onProgress) {
                status = repoDone && prDone ? "done" : (repoDone || prDone ? "partial" : "empty");
                onProgress({
                    issue: issue,
                    status: status
                });
            }
            d.resolve(issue.devStatus);
        }

        var repoReq = $.ajax({
            url: baseUrl + "/rest/dev-status/1.0/issue/detail",
            type: "GET",
            dataType: "json",
            data: {
                issueId: issue.id,
                applicationType: "stash",
                dataType: "repository"
            }
        });
        var prReq = $.ajax({
            url: baseUrl + "/rest/dev-status/1.0/issue/detail",
            type: "GET",
            dataType: "json",
            data: {
                issueId: issue.id,
                applicationType: "stash",
                dataType: "pullrequest"
            }
        });

        repoReq.done(function(resp) {
            repoDone = true;
            repoData = unwrap(resp) || {};
            finish();
        }).fail(function() {
            finish();
        });

        prReq.done(function(resp) {
            prDone = true;
            prData = unwrap(resp) || {};
            finish();
        }).fail(function() {
            finish();
        });

        return d.promise();
    }

    function fetchRepoActivityForIssues(issues, onProgress) {
        var d = $.Deferred();
        var queue = Array.isArray(issues) ? issues.slice() : [];
        var maxConcurrent = CONFIG.maxConcurrent || 5;
        var issueDevStatusMap = {};
        var running = 0;
        var progress = { phase: "repo-dev-status", loaded: 0, total: queue.length };

        if (onProgress) onProgress(progress);

        function markDone(issue, devStatus) {
            var issueKey = issue && (issue.key || issue.id);
            if (issueKey) issueDevStatusMap[issueKey] = devStatus || {};
            progress.loaded += 1;
            if (onProgress) onProgress(progress);
        }

        function maybeFinish() {
            if (queue.length === 0 && running === 0) {
                d.resolve({ issueDevStatusMap: issueDevStatusMap });
                return true;
            }
            return false;
        }

        function pump() {
            while (running < maxConcurrent && queue.length > 0) {
                var issue = queue.shift();

                if (!issue || !issue.id) {
                    markDone(issue, {});
                    continue;
                }

                running += 1;

                fetchIssueDevStatus(issue).done(function(currentIssue) {
                    return function(devStatus) {
                        markDone(currentIssue, devStatus);
                        running -= 1;
                        if (!maybeFinish()) pump();
                    };
                }(issue)).fail(function(currentIssue) {
                    return function() {
                        markDone(currentIssue, {});
                        running -= 1;
                        if (!maybeFinish()) pump();
                    };
                }(issue));
            }

            maybeFinish();
        }

        pump();
        return d.promise();
    }

    return {
        mergeDevStatus: mergeDevStatus,
        fetchIssueDevStatus: fetchIssueDevStatus,
        fetchRepoActivityForIssues: fetchRepoActivityForIssues
    };
});
