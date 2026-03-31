define("_ujgUA_requestCache", ["jquery"], function($) {
    "use strict";

    var store = Object.create(null);

    function noop() {}

    function stableStringify(value) {
        if (value === null || value === undefined) return "";
        if (typeof value !== "object") return JSON.stringify(value);
        if (Array.isArray(value)) {
            return "[" + value.map(stableStringify).join(",") + "]";
        }
        var keys = Object.keys(value).sort();
        return "{" + keys.map(function(k) {
            return JSON.stringify(k) + ":" + stableStringify(value[k]);
        }).join(",") + "}";
    }

    function methodUsesQueryDataKey(method) {
        return method === "GET" || method === "HEAD";
    }

    function bodyOrNonQueryDataKey(data) {
        if (data === undefined || data === null) return "";
        if (typeof data === "string") return data;
        if (typeof data === "object") return stableStringify(data);
        return String(data);
    }

    function queryStyleDataKey(data) {
        var dataKey = "";
        if (data && typeof data === "object" && !Array.isArray(data)) {
            dataKey = stableStringify(data);
        } else if (data !== undefined && data !== null && data !== "") {
            dataKey = typeof data === "string" ? data : stableStringify(data);
        }
        return dataKey;
    }

    function cacheKey(options) {
        options = options || {};
        var method = String(options.type || options.method || "GET").toUpperCase();
        var url = String(options.url || "");
        var dataKey = methodUsesQueryDataKey(method)
            ? queryStyleDataKey(options.data)
            : bodyOrNonQueryDataKey(options.data);
        return method + "\0" + url + "\0" + dataKey;
    }

    function clearCache() {
        store = Object.create(null);
    }

    function wrapPromise(p, abortFn) {
        p.abort = abortFn;
        return p;
    }

    function cachedAjax(options) {
        var key = cacheKey(options);
        var outer = $.Deferred();
        var p = outer.promise();

        if (Object.prototype.hasOwnProperty.call(store, key)) {
            outer.resolve.apply(outer, store[key]);
            return wrapPromise(p, noop);
        }

        var xhr = $.ajax(options);
        xhr.done(function() {
            store[key] = Array.prototype.slice.call(arguments);
            outer.resolve.apply(outer, arguments);
        });
        xhr.fail(function() {
            outer.reject.apply(outer, arguments);
        });

        return wrapPromise(p, function() {
            if (xhr && typeof xhr.abort === "function") {
                xhr.abort();
            }
        });
    }

    return {
        cachedAjax: cachedAjax,
        clearCache: clearCache,
        cacheKey: cacheKey
    };
});
