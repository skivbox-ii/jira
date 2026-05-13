define("_ujgESI_mappingStore", ["jquery", "_ujgESI_config"], function($, config) {
  "use strict";

  var DEFAULT_STORAGE_KEY = "ujg-esi-mapping-settings";

  function trimSlash(s) {
    return String(s || "").replace(/\/+$/, "");
  }

  function storageKey(options) {
    var key = options && options.storageKey != null ? String(options.storageKey).trim() : "";
    return key || config.MAPPING_STORAGE_KEY || DEFAULT_STORAGE_KEY;
  }

  function jiraBaseUrl(options) {
    var base = options && options.jiraBaseUrl != null ? String(options.jiraBaseUrl).trim() : "";
    return trimSlash(base || config.baseUrl || "");
  }

  function apiUrl(options, path) {
    var base = jiraBaseUrl(options);
    if (!path) return base;
    if (path.charAt(0) !== "/") path = "/" + path;
    return base + path;
  }

  function detectDashboardId() {
    if (typeof window === "undefined") return "";
    var search = window.location && window.location.search != null ? String(window.location.search) : "";
    var match = /[?&]selectPageId=(\d+)/.exec(search);
    if (match) return match[1];
    if (window.AJS && window.AJS.params) {
      if (window.AJS.params.selectPageId != null) return String(window.AJS.params.selectPageId);
      if (window.AJS.params.pageId != null) return String(window.AJS.params.pageId);
    }
    return "";
  }

  function copyMap(map) {
    var out = {};
    Object.keys(map || {}).forEach(function(key) {
      var source = key != null ? String(key).trim() : "";
      var target = map[key] != null ? String(map[key]).trim() : "";
      if (source && target) out[source] = target;
    });
    return out;
  }

  function copyRoles(roles) {
    return (Array.isArray(roles) ? roles : []).map(function(role) {
      return {
        role: role && role.role != null ? String(role.role).trim() : "",
        issueType: role && role.issueType != null ? String(role.issueType).trim() : "",
        originalEstimate: role && role.originalEstimate != null ? String(role.originalEstimate).trim() : "1h",
        remainingEstimate: role && role.remainingEstimate != null ? String(role.remainingEstimate).trim() : "1h",
        enabled: !(role && role.enabled === false),
      };
    }).filter(function(role) {
      return role.role || role.issueType;
    });
  }

  function copyColumnMap(map) {
    var defaults = config.COLUMN_MAP || {};
    var source = map && typeof map === "object" ? map : {};
    var out = {};
    Object.keys(defaults).forEach(function(key) {
      var value = source[key] != null ? String(source[key]).trim() : "";
      out[key] = value || String(defaults[key] || "").trim();
    });
    Object.keys(source).forEach(function(key) {
      if (!Object.prototype.hasOwnProperty.call(out, key)) {
        out[key] = source[key] != null ? String(source[key]).trim() : "";
      }
    });
    return out;
  }

  function copyTableStart(input) {
    var defaults = config.TABLE_START || {};
    var source = input && typeof input === "object" ? input : {};
    return {
      headerMarker: source.headerMarker != null && String(source.headerMarker).trim()
        ? String(source.headerMarker).trim()
        : String(defaults.headerMarker || config.SUMMARY_COLUMN || "Замечание").trim(),
    };
  }

  function defaultSettings() {
    return {
      moduleComponentMap: copyMap(config.MODULE_COMPONENT_MAP),
      priorityMap: copyMap(config.PRIORITY_MAP),
      columnMap: copyColumnMap(config.COLUMN_MAP),
      tableStart: copyTableStart(config.TABLE_START),
      roles: copyRoles(config.CREATE_TEMPLATE_ROLES),
    };
  }

  function normalizeSettings(input) {
    var defaults = defaultSettings();
    var hasInput = !!(input && typeof input === "object");
    return {
      moduleComponentMap: hasInput && input.moduleComponentMap && typeof input.moduleComponentMap === "object"
        ? copyMap(input.moduleComponentMap)
        : defaults.moduleComponentMap,
      priorityMap: hasInput && input.priorityMap && typeof input.priorityMap === "object"
        ? copyMap(input.priorityMap)
        : defaults.priorityMap,
      columnMap: hasInput && input.columnMap && typeof input.columnMap === "object"
        ? copyColumnMap(input.columnMap)
        : defaults.columnMap,
      tableStart: hasInput && input.tableStart && typeof input.tableStart === "object"
        ? copyTableStart(input.tableStart)
        : defaults.tableStart,
      roles: hasInput && Array.isArray(input.roles)
        ? copyRoles(input.roles)
        : defaults.roles,
    };
  }

  function readLocal(options) {
    try {
      if (typeof localStorage === "undefined") return null;
      var raw = localStorage.getItem(storageKey(options));
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && parsed.mappings ? parsed.mappings : parsed;
    } catch (e) {
      return null;
    }
  }

  function writeLocal(options, settings) {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(storageKey(options), JSON.stringify({ mappings: normalizeSettings(settings) }));
      }
    } catch (e) {}
  }

  function ajaxPromise(options) {
    if (!$ || typeof $.ajax !== "function") return Promise.reject(new Error("Jira AJAX is not available"));
    return Promise.resolve($.ajax(options));
  }

  function create(options) {
    var opts = options || {};
    var dashboardId = "";

    function load() {
      dashboardId = detectDashboardId();
      if (!dashboardId) return Promise.resolve(normalizeSettings(readLocal(opts)));
      return ajaxPromise({
        url: apiUrl(opts, "/rest/api/2/dashboard/" + encodeURIComponent(dashboardId) + "/properties/" + encodeURIComponent(storageKey(opts))),
        type: "GET",
        dataType: "json",
      }).then(
        function(data) {
          var mappings = data && data.value && data.value.mappings ? data.value.mappings : data && data.value ? data.value : readLocal(opts);
          var normalized = normalizeSettings(mappings);
          writeLocal(opts, normalized);
          return normalized;
        },
        function() {
          return normalizeSettings(readLocal(opts));
        }
      );
    }

    function save(settings) {
      var normalized = normalizeSettings(settings);
      var id = dashboardId || detectDashboardId();
      dashboardId = id;
      writeLocal(opts, normalized);
      if (!id) return Promise.resolve(normalized);
      return ajaxPromise({
        url: apiUrl(opts, "/rest/api/2/dashboard/" + encodeURIComponent(id) + "/properties/" + encodeURIComponent(storageKey(opts))),
        type: "PUT",
        contentType: "application/json",
        dataType: "json",
        data: JSON.stringify({ mappings: normalized }),
      }).then(function() {
        return normalized;
      });
    }

    return {
      load: load,
      save: save,
    };
  }

  return {
    create: create,
    defaultSettings: defaultSettings,
    normalizeSettings: normalizeSettings,
    detectDashboardId: detectDashboardId,
  };
});
