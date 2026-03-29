define("_ujgDD_apiConfluence", ["jquery", "_ujgDD_config"], function($, config) {
    "use strict";

    var pageLimit = 200;

    function trimBase(u) {
        return String(u || "").replace(/\/+$/, "");
    }

    function cqlQuote(s) {
        return "\"" + String(s).replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"";
    }

    function formatAjaxError(xhr, status, fallback) {
        var j = xhr && xhr.responseJSON;
        var msgs = j && j.errorMessages;
        if (msgs && msgs.join) return msgs.join(", ");
        if (j && typeof j.message === "string") return j.message;
        return status === "abort" ? "cancelled" : (xhr && xhr.statusText) || fallback;
    }

    function dayFromWhen(iso) {
        if (!iso) return "";
        var m = typeof iso === "string" && iso.match(/^(\d{4}-\d{2}-\d{2})/);
        if (m) return m[1];
        var d = new Date(iso);
        if (isNaN(d.getTime())) return "";
        return d.toISOString().slice(0, 10);
    }

    function unwrapContent(item) {
        return item && item.content ? item.content : item;
    }

    function entryMatchesRequestedUser(item, requestedUserKey) {
        var c = unwrapContent(item);
        var by = c && c.version && c.version.by;
        if (!by || requestedUserKey == null || requestedUserKey === "") return false;
        var requested = String(requestedUserKey);
        return by.userKey === requested || by.username === requested || by.accountId === requested;
    }

    function normalizeEntry(item, requestedUserKey) {
        var c = unwrapContent(item);
        if (!c) return null;
        var v = c.version || {};
        var date = dayFromWhen(v.when);
        if (!date) return null;
        var spaceObj = c.space || {};
        var space = spaceObj.key != null && spaceObj.key !== "" ? String(spaceObj.key) : String(spaceObj.name || "");
        var pageTitle = c.title != null ? String(c.title) : "";
        var action;
        if (c.type === "comment") {
            action = "commented";
        } else if (Number(v.number) === 1) {
            action = "created";
        } else {
            action = "updated";
        }
        var by = v.by || {};
        var userKey = "";
        if (requestedUserKey != null && requestedUserKey !== "") userKey = String(requestedUserKey);
        else if (by.userKey != null && by.userKey !== "") userKey = String(by.userKey);
        else if (by.username != null && by.username !== "") userKey = String(by.username);
        else if (by.accountId != null && by.accountId !== "") userKey = String(by.accountId);
        return {
            date: date,
            pageTitle: pageTitle,
            space: space,
            action: action,
            userKey: userKey
        };
    }

    function fetchTeamActivity(userKeys, startDate, endDate, onProgress) {
        var d = $.Deferred();
        var keys = (userKeys || []).filter(Boolean);
        if (keys.length === 0) {
            if (onProgress) onProgress({ loaded: 0, total: 0, phase: "confluence" });
            d.resolve([]);
            return d.promise();
        }

        var base = trimBase(config.confluenceBaseUrl);
        var all = [];
        var keyIndex = 0;
        var grandTotal = 0;

        function runUser() {
            if (keyIndex >= keys.length) {
                if (onProgress) {
                    onProgress({
                        phase: "confluence",
                        loaded: all.length,
                        total: all.length
                    });
                }
                d.resolve(all);
                return;
            }
            var uk = keys[keyIndex];
            var userTotalApplied = false;

            function page(start) {
                var cql = "contributor=" + cqlQuote(uk) + " AND lastModified >= " + cqlQuote(startDate) +
                    " AND lastModified <= " + cqlQuote(endDate);
                $.ajax({
                    url: base + "/rest/api/content/search",
                    type: "GET",
                    dataType: "json",
                    data: {
                        cql: cql,
                        expand: "history,space,version",
                        limit: pageLimit,
                        start: start
                    }
                }).done(function(resp) {
                    var batch = (resp && resp.results) || [];
                    var totalSize = resp && typeof resp.totalSize === "number" ? resp.totalSize : null;
                    if (totalSize != null && !userTotalApplied) {
                        grandTotal += totalSize;
                        userTotalApplied = true;
                    }
                    var i;
                    for (i = 0; i < batch.length; i++) {
                        var n = normalizeEntry(batch[i], uk);
                        if (n && entryMatchesRequestedUser(batch[i], uk)) all.push(n);
                    }
                    if (onProgress) {
                        onProgress({
                            phase: "confluence",
                            loaded: all.length,
                            total: grandTotal > 0 ? grandTotal : all.length
                        });
                    }
                    var nextStart = start + batch.length;
                    var noMore = batch.length === 0;
                    var pastEnd = totalSize != null && nextStart >= totalSize;
                    var shortPageUnknownTotal = totalSize == null && batch.length < pageLimit;
                    if (noMore || pastEnd || shortPageUnknownTotal) {
                        keyIndex += 1;
                        runUser();
                    } else {
                        page(nextStart);
                    }
                }).fail(function(xhr, status) {
                    d.reject(formatAjaxError(xhr, status, "confluence search failed"));
                });
            }

            page(0);
        }

        if (onProgress) onProgress({ loaded: 0, total: 0, phase: "confluence" });
        runUser();
        return d.promise();
    }

    return {
        fetchTeamActivity: fetchTeamActivity
    };
});
