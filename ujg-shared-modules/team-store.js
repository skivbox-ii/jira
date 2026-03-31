define("_ujgShared_teamStore", ["jquery"], function($) {
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
        var key = u.accountId || u.key || u.name || u.username || "";
        var displayName = u.displayName || u.name || key || "";
        return { key: String(key), displayName: String(displayName) };
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
                    return { teams: [], displayNameByKey: {} };
                }
                var raw = localStorage.getItem(getStorageKey());
                if (!raw) return { teams: [], displayNameByKey: {} };
                var parsed = JSON.parse(raw);
                var teamsPart = parsed && Array.isArray(parsed.teams) ? normalizeTeams(parsed.teams) : [];
                var names =
                    parsed && parsed.displayNameByKey && typeof parsed.displayNameByKey === "object"
                        ? parsed.displayNameByKey
                        : {};
                return { teams: teamsPart, displayNameByKey: Object.assign({}, names) };
            } catch (e) {
                return { teams: [], displayNameByKey: {} };
            }
        }

        function writeLocalTeams(list) {
            try {
                if (typeof localStorage !== "undefined") {
                    localStorage.setItem(
                        getStorageKey(),
                        JSON.stringify({
                            teams: list,
                            displayNameByKey: displayNameByKey
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
                }
            }
        }

        function fetchUserDisplayName(key) {
            var d = $.Deferred();
            $.ajax({
                url: apiUrl("/rest/api/2/user"),
                type: "GET",
                dataType: "json",
                data: { key: key }
            })
                .done(function(user) {
                    var row = normalizeUserRow(user);
                    if (row && row.displayName) {
                        displayNameByKey[key] = row.displayName;
                    }
                    d.resolve();
                })
                .fail(function() {
                    $.ajax({
                        url: apiUrl("/rest/api/2/user"),
                        type: "GET",
                        dataType: "json",
                        data: { accountId: key }
                    })
                        .done(function(user) {
                            var row = normalizeUserRow(user);
                            if (row && row.displayName) {
                                displayNameByKey[key] = row.displayName;
                            }
                            d.resolve();
                        })
                        .fail(function() {
                            d.resolve();
                        });
                });
            return d.promise();
        }

        function backfillDisplayNames() {
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
                    if (!key || displayNameByKey[key] || seen[key]) {
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
                fetchUserDisplayName(needed[i]).always(function() {
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
            backfillDisplayNames().always(function() {
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
                    } else {
                        var storedState = readStoredState();
                        teams = storedState.teams;
                        displayNameByKey = Object.assign({}, storedState.displayNameByKey || {});
                    }
                    finishLoadTeams(d);
                })
                .fail(function() {
                    var storedState = readStoredState();
                    teams = storedState.teams;
                    displayNameByKey = Object.assign({}, storedState.displayNameByKey || {});
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
                data: JSON.stringify({ teams: list, displayNameByKey: displayNameByKey })
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

        function setDisplayName(key, displayName) {
            if (!key) return;
            displayNameByKey[String(key)] = String(displayName || "");
        }

        return {
            detectDashboardId: detectDashboardId,
            loadTeams: loadTeams,
            saveTeams: saveTeams,
            getTeams: getTeams,
            getDisplayNameByKey: getDisplayNameByKey,
            setDisplayName: setDisplayName
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
        getTeams: function() {
            return defaultStore.getTeams();
        },
        setDisplayName: function(key, displayName) {
            defaultStore.setDisplayName(key, displayName);
        }
    };
});
