define("_ujgShared_teamStore", ["jquery"], function($) {
    "use strict";

    var STORAGE_KEY = "ujg-dd-teams";
    var teams = [];
    var dashboardId = null;
    var displayNameByKey = {};

    function trimSlash(s) {
        return String(s || "").replace(/\/+$/, "");
    }

    function resolveJiraBaseUrl() {
        var origin = "";
        var protocol = "https:";
        if (typeof window !== "undefined") {
            origin = trimSlash(window.location.origin || "");
            protocol = window.location.protocol || protocol;
            if (window.AJS && window.AJS.params && window.AJS.params.baseURL != null) {
                var b = trimSlash(String(window.AJS.params.baseURL).trim());
                if (!b) return origin;
                if (/^[a-z]+:\/\//i.test(b)) return b;
                if (b.indexOf("//") === 0) return trimSlash(protocol + b);
                if (b.charAt(0) === "/") return trimSlash(origin + b);
                if (/^[^\/]+\.[^\/]+/.test(b) || /^[^\/]+:\d+(\/|$)/.test(b)) {
                    return trimSlash(protocol + "//" + b.replace(/^\/+/, ""));
                }
                return trimSlash(origin + "/" + b.replace(/^\/+/, ""));
            }
        }
        return origin;
    }

    function apiUrl(path) {
        var base = trimSlash(resolveJiraBaseUrl() || "");
        if (!path) return base;
        if (path.charAt(0) !== "/") path = "/" + path;
        return base + path;
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

    function readStoredState() {
        try {
            if (typeof localStorage === "undefined") {
                return { teams: [], displayNameByKey: {} };
            }
            var raw = localStorage.getItem(STORAGE_KEY);
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
                    STORAGE_KEY,
                    JSON.stringify({
                        teams: list,
                        displayNameByKey: displayNameByKey
                    })
                );
            }
        } catch (e) {}
    }

    function augmentDisplayNamesFromLocalCache() {
        var st = readStoredState();
        var loc = st.displayNameByKey && typeof st.displayNameByKey === "object" ? st.displayNameByKey : {};
        var i;
        var j;
        var k;
        var mks;
        for (i = 0; i < teams.length; i++) {
            mks = teams[i].memberKeys || [];
            for (j = 0; j < mks.length; j++) {
                k = mks[j];
                if (k && !displayNameByKey[k] && loc[k]) {
                    displayNameByKey[k] = loc[k];
                }
            }
        }
    }

    function normalizeUserRow(u) {
        if (!u || typeof u !== "object") return null;
        var key = u.accountId || u.key || u.name || u.username || "";
        var displayName = u.displayName || u.name || key || "";
        return { key: String(key), displayName: String(displayName) };
    }

    function fetchUserDisplayName(key) {
        var d = $.Deferred();
        $.ajax({
            url: apiUrl("/rest/api/2/user"),
            type: "GET",
            dataType: "json",
            data: { key: key }
        })
            .done(function(u) {
                var row = normalizeUserRow(u);
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
                    .done(function(u) {
                        var row = normalizeUserRow(u);
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
        var k;
        var mks;
        var dEmpty;
        for (i = 0; i < teams.length; i++) {
            mks = teams[i].memberKeys || [];
            for (j = 0; j < mks.length; j++) {
                k = mks[j];
                if (!k || displayNameByKey[k]) {
                    continue;
                }
                if (seen[k]) {
                    continue;
                }
                seen[k] = true;
                needed.push(k);
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

    function loadTeams() {
        var d = $.Deferred();
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
                    encodeURIComponent(STORAGE_KEY)
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
                    var st = readStoredState();
                    teams = st.teams;
                    displayNameByKey = Object.assign({}, st.displayNameByKey || {});
                }
                finishLoadTeams(d);
            })
            .fail(function() {
                var stFail = readStoredState();
                teams = stFail.teams;
                displayNameByKey = Object.assign({}, stFail.displayNameByKey || {});
                finishLoadTeams(d);
            });
        return d.promise();
    }

    function saveTeams(teamsList) {
        var list = normalizeTeams(teamsList);
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
                "/rest/api/2/dashboard/" + encodeURIComponent(id) + "/properties/" + encodeURIComponent(STORAGE_KEY)
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

    return {
        normalizeTeams: normalizeTeams,
        loadTeams: loadTeams,
        saveTeams: saveTeams,
        detectDashboardId: detectDashboardId,
        getDisplayNameByKey: function() {
            return Object.assign({}, displayNameByKey);
        }
    };
});
