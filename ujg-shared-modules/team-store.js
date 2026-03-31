(function(moduleId) {
    function hasDefinedModule(loader) {
        var contexts;
        var contextName;
        if (!loader) return false;
        if (typeof loader.defined === "function") {
            try {
                if (loader.defined(moduleId)) return true;
            } catch (e) {}
        }
        if (loader._defined && Object.prototype.hasOwnProperty.call(loader._defined, moduleId)) {
            return true;
        }
        contexts = loader.s && loader.s.contexts;
        if (!contexts) return false;
        for (contextName in contexts) {
            if (
                Object.prototype.hasOwnProperty.call(contexts, contextName) &&
                contexts[contextName] &&
                contexts[contextName].defined &&
                Object.prototype.hasOwnProperty.call(contexts[contextName].defined, moduleId)
            ) {
                return true;
            }
        }
        return false;
    }

    if (hasDefinedModule(typeof requirejs !== "undefined" ? requirejs : null)) return;
    if (hasDefinedModule(typeof require !== "undefined" ? require : null)) return;

define(moduleId, ["jquery"], function($) {
    "use strict";

    var DEFAULT_STORAGE_KEY = "ujg-dd-teams";

    function trimSlash(s) {
        return String(s || "").replace(/\/+$/, "");
    }

    function resolveAutoJiraBaseUrl() {
        var origin = "";
        var protocol = "https:";
        if (typeof window !== "undefined") {
            origin = trimSlash(window.location.origin || "");
            protocol = window.location.protocol || protocol;
            if (window.AJS && window.AJS.params && window.AJS.params.baseURL != null) {
                var baseUrl = trimSlash(String(window.AJS.params.baseURL).trim());
                if (!baseUrl) return origin;
                if (/^[a-z]+:\/\//i.test(baseUrl)) return baseUrl;
                if (baseUrl.indexOf("//") === 0) return trimSlash(protocol + baseUrl);
                if (baseUrl.charAt(0) === "/") return trimSlash(origin + baseUrl);
                if (/^[^\/]+\.[^\/]+/.test(baseUrl) || /^[^\/]+:\d+(\/|$)/.test(baseUrl)) {
                    return trimSlash(protocol + "//" + baseUrl.replace(/^\/+/, ""));
                }
                return trimSlash(origin + "/" + baseUrl.replace(/^\/+/, ""));
            }
        }
        return origin;
    }

    function normalizeTeam(team) {
        var normalized = team && typeof team === "object" ? team : {};
        if (!Array.isArray(normalized.memberKeys)) {
            normalized.memberKeys = [];
        }
        return normalized;
    }

    function normalizeTeams(list) {
        var normalized;
        var i;
        if (!Array.isArray(list)) return [];
        normalized = typeof list.slice === "function" ? list.slice() : [];
        for (i = 0; i < normalized.length; i++) {
            normalized[i] = normalizeTeam(normalized[i]);
        }
        return normalized;
    }

    function normalizeUserRow(u) {
        if (!u || typeof u !== "object") return null;
        var key = u.accountId || u.key || u.name || u.username || u.userKey || "";
        var queryName = u.name || u.username || u.userName || u.key || u.accountId || u.userKey || "";
        var displayName = u.displayName || u.name || key || "";
        if (!key) return null;
        return {
            key: String(key),
            queryName: String(queryName || key),
            displayName: String(displayName)
        };
    }

    function detectDashboardId() {
        if (typeof window === "undefined") return null;
        var loc = window.location || {};
        var search = String(loc.search || "");
        var m = /[?&]selectPageId=(\d+)/.exec(search);
        if (m) return m[1];
        if (window.AJS && window.AJS.params) {
            var p = window.AJS.params;
            if (p.selectPageId != null && String(p.selectPageId).length) return String(p.selectPageId);
            if (p.pageId != null && String(p.pageId).length) return String(p.pageId);
        }
        return null;
    }

    function create(options) {
        var settings = options && typeof options === "object" ? options : {};
        var teams = [];
        var dashboardId = null;
        var displayNameByKey = {};
        var queryNameByKey = {};

        function getStorageKey() {
            var storageKey = settings.storageKey != null ? String(settings.storageKey).trim() : "";
            return storageKey || DEFAULT_STORAGE_KEY;
        }

        function getJiraBaseUrl() {
            var jiraBaseUrl = settings.jiraBaseUrl != null ? String(settings.jiraBaseUrl).trim() : "";
            return jiraBaseUrl ? trimSlash(jiraBaseUrl) : resolveAutoJiraBaseUrl();
        }

        function apiUrl(path) {
            var base = trimSlash(getJiraBaseUrl() || "");
            if (!path) return base;
            if (path.charAt(0) !== "/") path = "/" + path;
            return base + path;
        }

        function readStoredState() {
            try {
                if (typeof localStorage === "undefined") {
                    return { teams: [], displayNameByKey: {}, queryNameByKey: {} };
                }
                var raw = localStorage.getItem(getStorageKey());
                if (!raw) return { teams: [], displayNameByKey: {}, queryNameByKey: {} };
                var parsed = JSON.parse(raw);
                var teamsPart = parsed && Array.isArray(parsed.teams) ? normalizeTeams(parsed.teams) : [];
                var names =
                    parsed && parsed.displayNameByKey && typeof parsed.displayNameByKey === "object"
                        ? parsed.displayNameByKey
                        : {};
                var queryNames =
                    parsed && parsed.queryNameByKey && typeof parsed.queryNameByKey === "object"
                        ? parsed.queryNameByKey
                        : {};
                return {
                    teams: teamsPart,
                    displayNameByKey: Object.assign({}, names),
                    queryNameByKey: Object.assign({}, queryNames)
                };
            } catch (e) {
                return { teams: [], displayNameByKey: {}, queryNameByKey: {} };
            }
        }

        function writeLocalTeams(list) {
            try {
                if (typeof localStorage !== "undefined") {
                    localStorage.setItem(
                        getStorageKey(),
                        JSON.stringify({
                            teams: list,
                            displayNameByKey: displayNameByKey,
                            queryNameByKey: queryNameByKey
                        })
                    );
                }
            } catch (e) {}
        }

        function augmentDisplayNamesFromLocalCache() {
            var storedState = readStoredState();
            var localDisplayNameByKey =
                storedState.displayNameByKey && typeof storedState.displayNameByKey === "object"
                    ? storedState.displayNameByKey
                    : {};
            var localQueryNameByKey =
                storedState.queryNameByKey && typeof storedState.queryNameByKey === "object"
                    ? storedState.queryNameByKey
                    : {};
            var i;
            var j;
            var key;
            var memberKeys;
            for (i = 0; i < teams.length; i++) {
                memberKeys = teams[i].memberKeys || [];
                for (j = 0; j < memberKeys.length; j++) {
                    key = memberKeys[j];
                    if (key && !displayNameByKey[key] && localDisplayNameByKey[key]) {
                        displayNameByKey[key] = localDisplayNameByKey[key];
                    }
                    if (key && !queryNameByKey[key] && localQueryNameByKey[key]) {
                        queryNameByKey[key] = localQueryNameByKey[key];
                    }
                }
            }
        }

        function fetchUserIdentity(key) {
            var d = $.Deferred();
            var lookups = [
                { key: key },
                { accountId: key },
                { username: key }
            ];

            function tryLookup(index) {
                if (index >= lookups.length) {
                    d.resolve();
                    return;
                }
                $.ajax({
                    url: apiUrl("/rest/api/2/user"),
                    type: "GET",
                    dataType: "json",
                    data: lookups[index]
                })
                    .done(function(user) {
                        var row = normalizeUserRow(user);
                        if (row && row.displayName) {
                            displayNameByKey[key] = row.displayName;
                        }
                        if (row && row.queryName) {
                            queryNameByKey[key] = row.queryName;
                        }
                        if (!queryNameByKey[key] && key) {
                            queryNameByKey[key] = String(key);
                        }
                        d.resolve();
                    })
                    .fail(function() {
                        tryLookup(index + 1);
                    });
            }

            tryLookup(0);
            return d.promise();
        }

        function backfillUserInfo() {
            var needed = [];
            var seen = Object.create(null);
            var i;
            var j;
            var key;
            var memberKeys;
            var dEmpty;
            for (i = 0; i < teams.length; i++) {
                memberKeys = teams[i].memberKeys || [];
                for (j = 0; j < memberKeys.length; j++) {
                    key = memberKeys[j];
                    if (!key || (displayNameByKey[key] && queryNameByKey[key]) || seen[key]) {
                        continue;
                    }
                    seen[key] = true;
                    needed.push(key);
                }
            }
            if (needed.length === 0) {
                dEmpty = $.Deferred();
                dEmpty.resolve(teams);
                return dEmpty.promise();
            }
            var dAll = $.Deferred();
            var remaining = needed.length;
            for (i = 0; i < needed.length; i++) {
                fetchUserIdentity(needed[i]).always(function() {
                    remaining -= 1;
                    if (remaining === 0) {
                        dAll.resolve(teams);
                    }
                });
            }
            return dAll.promise();
        }

        function finishLoadTeams(d) {
            augmentDisplayNamesFromLocalCache();
            backfillUserInfo().always(function() {
                writeLocalTeams(teams);
                d.resolve(teams);
            });
        }

        function loadTeams() {
            var d = $.Deferred();
            var storageKey = getStorageKey();
            dashboardId = detectDashboardId();
            if (!dashboardId) {
                var localOnly = readStoredState();
                teams = localOnly.teams;
                displayNameByKey = Object.assign({}, localOnly.displayNameByKey || {});
                queryNameByKey = Object.assign({}, localOnly.queryNameByKey || {});
                finishLoadTeams(d);
                return d.promise();
            }
            $.ajax({
                url: apiUrl(
                    "/rest/api/2/dashboard/" +
                        encodeURIComponent(dashboardId) +
                        "/properties/" +
                        encodeURIComponent(storageKey)
                ),
                type: "GET",
                dataType: "json"
            })
                .done(function(data) {
                    if (data && data.value && Array.isArray(data.value.teams)) {
                        teams = normalizeTeams(data.value.teams);
                        displayNameByKey = Object.assign(
                            {},
                            data.value.displayNameByKey && typeof data.value.displayNameByKey === "object"
                                ? data.value.displayNameByKey
                                : {}
                        );
                        queryNameByKey = Object.assign(
                            {},
                            data.value.queryNameByKey && typeof data.value.queryNameByKey === "object"
                                ? data.value.queryNameByKey
                                : {}
                        );
                    } else {
                        var storedState = readStoredState();
                        teams = storedState.teams;
                        displayNameByKey = Object.assign({}, storedState.displayNameByKey || {});
                        queryNameByKey = Object.assign({}, storedState.queryNameByKey || {});
                    }
                    finishLoadTeams(d);
                })
                .fail(function() {
                    var storedState = readStoredState();
                    teams = storedState.teams;
                    displayNameByKey = Object.assign({}, storedState.displayNameByKey || {});
                    queryNameByKey = Object.assign({}, storedState.queryNameByKey || {});
                    finishLoadTeams(d);
                });
            return d.promise();
        }

        function saveTeams(teamsList) {
            var list = normalizeTeams(teamsList);
            var storageKey = getStorageKey();
            teams = list;
            writeLocalTeams(list);
            var d = $.Deferred();
            var id = dashboardId != null ? dashboardId : detectDashboardId();
            dashboardId = id;
            if (!id) {
                d.resolve(list);
                return d.promise();
            }
            $.ajax({
                url: apiUrl(
                    "/rest/api/2/dashboard/" + encodeURIComponent(id) + "/properties/" + encodeURIComponent(storageKey)
                ),
                type: "PUT",
                contentType: "application/json",
                dataType: "json",
                data: JSON.stringify({
                    teams: list,
                    displayNameByKey: displayNameByKey,
                    queryNameByKey: queryNameByKey
                })
            })
                .done(function() {
                    d.resolve(list);
                })
                .fail(function(xhr, status, err) {
                    d.reject(xhr, status, err);
                });
            return d.promise();
        }

        function getTeams() {
            return teams.slice();
        }

        function getDisplayNameByKey() {
            return Object.assign({}, displayNameByKey);
        }

        function getQueryNameByKey() {
            return Object.assign({}, queryNameByKey);
        }

        function setDisplayName(key, displayName) {
            if (!key) return;
            displayNameByKey[String(key)] = String(displayName || "");
        }

        function setQueryName(key, queryName) {
            if (!key) return;
            queryNameByKey[String(key)] = String(queryName || key);
        }

        return {
            detectDashboardId: detectDashboardId,
            loadTeams: loadTeams,
            saveTeams: saveTeams,
            getTeams: getTeams,
            getDisplayNameByKey: getDisplayNameByKey,
            getQueryNameByKey: getQueryNameByKey,
            setDisplayName: setDisplayName,
            setQueryName: setQueryName
        };
    }

    var defaultStore = create();

    return {
        create: create,
        normalizeTeams: normalizeTeams,
        loadTeams: function() {
            return defaultStore.loadTeams();
        },
        saveTeams: function(teamsList) {
            return defaultStore.saveTeams(teamsList);
        },
        detectDashboardId: detectDashboardId,
        getDisplayNameByKey: function() {
            return defaultStore.getDisplayNameByKey();
        },
        getQueryNameByKey: function() {
            return defaultStore.getQueryNameByKey();
        },
        getTeams: function() {
            return defaultStore.getTeams();
        },
        setDisplayName: function(key, displayName) {
            defaultStore.setDisplayName(key, displayName);
        },
        setQueryName: function(key, queryName) {
            defaultStore.setQueryName(key, queryName);
        }
    };
});
}("_ujgShared_teamStore"));
