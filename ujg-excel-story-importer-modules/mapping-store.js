define("_ujgESI_mappingStore", ["jquery", "_ujgESI_config"], function($, config) {
  "use strict";

  var DEFAULT_STORAGE_KEY = "ujg-esi-mapping-settings";

  function storageKey(options) {
    var key = options && options.storageKey != null ? String(options.storageKey).trim() : "";
    return key || config.MAPPING_STORAGE_KEY || DEFAULT_STORAGE_KEY;
  }

  function copyMap(map) {
    var out = {};
    Object.keys(map || {}).forEach(function(key) {
      var source = key != null ? String(key).trim() : "";
      var target = map[key] != null ? String(map[key]).trim() : "";
      if (source || target) out[source] = target;
    });
    return out;
  }

  function copyAssignee(user) {
    var source = user && typeof user === "object" ? user : null;
    var out = {};
    if (!source) return null;
    ["accountId", "name", "key", "displayName"].forEach(function(field) {
      if (source[field] != null && String(source[field]).trim()) out[field] = String(source[field]).trim();
    });
    return Object.keys(out).length ? out : null;
  }

  function copyRoles(roles) {
    return (Array.isArray(roles) ? roles : []).map(function(role) {
      return {
        role: role && role.role != null ? String(role.role).trim() : "",
        issueType: role && role.issueType != null ? String(role.issueType).trim() : "",
        originalEstimate: role && role.originalEstimate != null ? String(role.originalEstimate).trim() : "1h",
        remainingEstimate: role && role.remainingEstimate != null ? String(role.remainingEstimate).trim() : "1h",
        enabled: !(role && role.enabled === false),
        assigneeId: role && role.assigneeId != null ? String(role.assigneeId).trim() : "",
        assigneeLabel: role && role.assigneeLabel != null ? String(role.assigneeLabel).trim() : "",
        assignee: copyAssignee(role && role.assignee),
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

  function copySheetName(value) {
    return value != null ? String(value).trim() : "";
  }

  function defaultSettings() {
    return {
      moduleComponentMap: copyMap(config.MODULE_COMPONENT_MAP),
      priorityMap: copyMap(config.PRIORITY_MAP),
      columnMap: copyColumnMap(config.COLUMN_MAP),
      tableStart: copyTableStart(config.TABLE_START),
      sheetName: copySheetName(config.SHEET_NAME),
      storyAssigneeId: "",
      storyAssigneeLabel: "",
      storyAssignee: null,
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
      sheetName: hasInput ? copySheetName(input.sheetName) : defaults.sheetName,
      storyAssigneeId: hasInput && input.storyAssigneeId != null ? String(input.storyAssigneeId).trim() : defaults.storyAssigneeId,
      storyAssigneeLabel: hasInput && input.storyAssigneeLabel != null ? String(input.storyAssigneeLabel).trim() : defaults.storyAssigneeLabel,
      storyAssignee: hasInput ? copyAssignee(input.storyAssignee) : defaults.storyAssignee,
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

  function create(options) {
    var opts = options || {};

    function load() {
      return Promise.resolve(normalizeSettings(readLocal(opts)));
    }

    function save(settings) {
      var normalized = normalizeSettings(settings);
      writeLocal(opts, normalized);
      return Promise.resolve(normalized);
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
  };
});
