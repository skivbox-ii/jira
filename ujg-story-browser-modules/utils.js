define("_ujgSB_utils", ["_ujgSB_config"], function(config) {
    "use strict";

    var ICONS = config.ICONS;
    var TYPE_BADGES = config.TYPE_BADGES;
    var TYPE_COLORS = config.TYPE_COLORS;
    var STATUS_COLORS = config.STATUS_COLORS;
    var STATUS_DONE = config.STATUS_DONE;
    var PRIORITY_COLORS = config.PRIORITY_COLORS;

    function escapeHtml(t) {
        if (!t) return "";
        return String(t)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function icon(name, cls) {
        var svg = ICONS[name] || "";
        if (!svg) return "";
        if (cls) {
            return svg.replace("<svg ", '<svg class="' + escapeHtml(cls) + '" ');
        }
        return svg;
    }

    function formatDate(v) {
        if (v == null || v === "") return "";
        var d = v instanceof Date ? v : new Date(v);
        if (isNaN(d.getTime())) return "";
        return d.toISOString().slice(0, 10);
    }

    function formatHours(seconds) {
        var s = Number(seconds);
        if (!isFinite(s) || s <= 0) return "—";
        var h = Math.floor(s / 3600);
        var m = Math.floor((s % 3600) / 60);
        return h > 0 ? h + "ч" + (m > 0 ? m + "м" : "") : m + "м";
    }

    function formatSP(v) {
        if (v == null || v === "" || (typeof v === "number" && !isFinite(v))) return "—";
        var n = Number(v);
        if (!isFinite(n)) return "—";
        return String(n);
    }

    function initialsFromTypeName(name) {
        var s = String(name || "").trim();
        if (!s) return "";
        var parts = s.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) {
            return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
        }
        var one = parts[0];
        if (one.length <= 1) return one.toUpperCase();
        return (one.charAt(0) + one.charAt(1)).toUpperCase();
    }

    function typeNameValue(typeName) {
        if (typeName && typeof typeName === "object" && typeName.name != null) {
            return String(typeName.name);
        }
        return typeName != null ? String(typeName) : "";
    }

    function getTypeBadge(typeName) {
        var name = typeNameValue(typeName);
        if (name && Object.prototype.hasOwnProperty.call(TYPE_BADGES, name)) {
            return TYPE_BADGES[name];
        }
        return initialsFromTypeName(name);
    }

    function getTypeColor(typeName) {
        var key = typeName != null ? String(typeName) : "";
        if (key && Object.prototype.hasOwnProperty.call(TYPE_COLORS, key)) {
            return TYPE_COLORS[key];
        }
        return "ujg-sb-type-unknown";
    }

    function statusKey(name) {
        var n = String(name || "").trim();
        if (!n) return "";
        var lower = n.toLowerCase();
        var k;
        for (k in STATUS_COLORS) {
            if (Object.prototype.hasOwnProperty.call(STATUS_COLORS, k) && k.toLowerCase() === lower) {
                return k;
            }
        }
        return n;
    }

    function getStatusClass(status) {
        var name = getStatusName(status);
        var key = statusKey(name);
        if (key && Object.prototype.hasOwnProperty.call(STATUS_COLORS, key)) {
            return STATUS_COLORS[key];
        }
        return "ujg-sb-status-default";
    }

    function getStatusName(status) {
        if (!status) return "";
        if (typeof status === "string") return status;
        return status.name != null ? String(status.name) : "";
    }

    function isDone(status) {
        var n = getStatusName(status);
        if (!n) return false;
        if (STATUS_DONE.has(n)) return true;
        var lower = String(n).toLowerCase();
        var found = false;
        STATUS_DONE.forEach(function(doneName) {
            if (!found && String(doneName).toLowerCase() === lower) {
                found = true;
            }
        });
        return found;
    }

    function priorityKey(name) {
        var n = String(name || "").trim();
        if (!n) return "";
        var lower = n.toLowerCase();
        var k;
        for (k in PRIORITY_COLORS) {
            if (Object.prototype.hasOwnProperty.call(PRIORITY_COLORS, k) && k.toLowerCase() === lower) {
                return k;
            }
        }
        return n;
    }

    function getPriorityClass(priority) {
        var name = getPriorityName(priority);
        var key = priorityKey(name);
        if (key && Object.prototype.hasOwnProperty.call(PRIORITY_COLORS, key)) {
            return PRIORITY_COLORS[key];
        }
        return "ujg-sb-priority-default";
    }

    function getPriorityName(priority) {
        if (!priority) return "";
        if (typeof priority === "string") return priority;
        return priority.name != null ? String(priority.name) : "";
    }

    function sprintNameFromString(s) {
        var str = String(s);
        var nameIndex = str.indexOf("name=");
        if (nameIndex !== -1) {
            var start = nameIndex + 5;
            var markers = [
                ",startDate=",
                ",endDate=",
                ",completeDate=",
                ",activatedDate=",
                ",goal=",
                ",sequence=",
                ",originBoardId=",
                ",rapidViewId=",
                ",state=",
                ",id=",
                ",synced=",
                "]"
            ];
            var end = str.length;
            var i;
            for (i = 0; i < markers.length; i += 1) {
                var markerIndex = str.indexOf(markers[i], start);
                if (markerIndex !== -1 && markerIndex < end) {
                    end = markerIndex;
                }
            }
            return str.slice(start, end);
        }
        return str;
    }

    function getSprintNameOne(item) {
        if (item == null || item === "") return "";
        if (Array.isArray(item)) return getSprintName(item);
        if (typeof item === "string") return sprintNameFromString(item);
        if (typeof item === "object" && item.name != null) return String(item.name);
        return "";
    }

    function getSprintName(value) {
        if (value == null || value === "") return "";
        if (Array.isArray(value)) {
            return value
                .map(getSprintNameOne)
                .filter(function(x) {
                    return Boolean(x);
                })
                .join(", ");
        }
        return getSprintNameOne(value);
    }

    return {
        escapeHtml: escapeHtml,
        icon: icon,
        formatDate: formatDate,
        formatHours: formatHours,
        formatSP: formatSP,
        getTypeBadge: getTypeBadge,
        getTypeColor: getTypeColor,
        getStatusClass: getStatusClass,
        getStatusName: getStatusName,
        isDone: isDone,
        getPriorityClass: getPriorityClass,
        getPriorityName: getPriorityName,
        getSprintName: getSprintName
    };
});
