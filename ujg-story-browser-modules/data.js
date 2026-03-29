define("_ujgSB_data", ["_ujgSB_config", "_ujgSB_utils"], function(config, utils) {
    "use strict";

    var CONFIG = config;

    function readEpicLink(fields) {
        var v = fields[CONFIG.EPIC_LINK_FIELD];
        if (v == null || v === "") {
            return "";
        }
        if (typeof v === "string") {
            return v;
        }
        if (typeof v === "object" && v.key != null) {
            return String(v.key);
        }
        return "";
    }

    function extractTransitions(changelog) {
        var out = [];
        if (!changelog || !changelog.histories) {
            return out;
        }
        changelog.histories.forEach(function(h) {
            var created = h.created != null ? String(h.created) : "";
            (h.items || []).forEach(function(item) {
                if (item.field === "status") {
                    out.push({
                        from: item.fromString != null ? String(item.fromString) : "",
                        to: item.toString != null ? String(item.toString) : "",
                        at: created
                    });
                }
            });
        });
        return out;
    }

    function hasAnyToken(text, tokens) {
        var hay = normalizeText(text);
        var i;
        if (!hay) {
            return false;
        }
        for (i = 0; i < (tokens || []).length; i += 1) {
            if (hay.indexOf(tokens[i]) >= 0) {
                return true;
            }
        }
        return false;
    }

    function isProblemCandidate(node) {
        var labelBlob;
        if (!node || node.key === "__orphans__" || node.isDone) {
            return false;
        }
        if (
            hasAnyToken(node.status, ["block", "blocked", "wait", "waiting", "заблок", "ожидан"]) ||
            hasAnyToken(node.summary, ["block", "blocked", "blocker", "waiting", "awaiting", "dependency", "risk", "блок", "ожидани", "нужен", "нужна", "нужны", "нужно", "зависим", "риск"])
        ) {
            return true;
        }
        labelBlob = []
            .concat(node.labels || [])
            .concat(node.components || [])
            .join(" ");
        return hasAnyToken(labelBlob, ["block", "blocked", "blocker", "risk", "problem", "dependency", "блок", "риск", "проблем"]);
    }

    function collectProblemItemsFromDescendants(nodes, out) {
        (nodes || []).forEach(function(node) {
            if (isProblemCandidate(node)) {
                out.push({
                    badge: node.badge != null ? String(node.badge) : utils.getTypeBadge(node.type),
                    key: node.key != null ? String(node.key) : "",
                    text: node.summary != null ? String(node.summary) : ""
                });
            }
            collectProblemItemsFromDescendants(node.children, out);
        });
    }

    function assignProblemItems(node) {
        var items;
        if (!node) {
            return;
        }
        if (node.type === "Epic" || node.key === "__orphans__") {
            items = [];
            collectProblemItemsFromDescendants(node.children, items);
            node.problemItems = items;
        }
        (node.children || []).forEach(assignProblemItems);
    }

    function normalizeIssue(issue) {
        var f = issue.fields || {};
        var st = f.status || {};
        var typeName = f.issuetype && f.issuetype.name != null ? String(f.issuetype.name) : "";
        var est =
            f.timeoriginalestimate != null
                ? Number(f.timeoriginalestimate)
                : f.timetracking && f.timetracking.originalEstimateSeconds != null
                  ? Number(f.timetracking.originalEstimateSeconds)
                  : 0;
        var spent =
            f.timespent != null
                ? Number(f.timespent)
                : f.timetracking && f.timetracking.timeSpentSeconds != null
                  ? Number(f.timetracking.timeSpentSeconds)
                  : 0;
        var assignee = "";
        if (f.assignee && typeof f.assignee === "object") {
            assignee =
                f.assignee.displayName != null
                    ? String(f.assignee.displayName)
                    : f.assignee.name != null
                      ? String(f.assignee.name)
                      : "";
        }
        return {
            key: issue.key,
            summary: f.summary != null ? String(f.summary) : "",
            status: utils.getStatusName(st),
            statusCat:
                st.statusCategory && st.statusCategory.name != null
                    ? String(st.statusCategory.name)
                    : st.statusCategory && st.statusCategory.key != null
                      ? String(st.statusCategory.key)
                      : "",
            type: typeName,
            badge: utils.getTypeBadge(f.issuetype),
            priority: utils.getPriorityName(f.priority),
            assignee: assignee,
            sprint: utils.getSprintName(f[CONFIG.SPRINT_FIELD]),
            estimate: isFinite(est) ? est : 0,
            spent: isFinite(spent) ? spent : 0,
            components: (f.components || [])
                .map(function(c) {
                    return c && c.name != null ? String(c.name) : "";
                })
                .filter(Boolean),
            labels: Array.isArray(f.labels) ? f.labels.map(String) : [],
            fixVersions: (f.fixVersions || [])
                .map(function(v) {
                    return v && v.name != null ? String(v.name) : "";
                })
                .filter(Boolean),
            parentKey: f.parent && f.parent.key != null ? String(f.parent.key) : "",
            epicLink: readEpicLink(f),
            created: f.created != null ? String(f.created) : "",
            updated: f.updated != null ? String(f.updated) : "",
            isDone: utils.isDone(st),
            transitions: extractTransitions(issue.changelog),
            children: []
        };
    }

    function resolveParentInMap(node, keyToNode) {
        var pk = node.parentKey;
        if (pk && keyToNode[pk]) {
            return pk;
        }
        var el = node.epicLink;
        if (el && keyToNode[el]) {
            return el;
        }
        return "";
    }

    function makeOrphansHost(children) {
        return {
            key: "__orphans__",
            summary: "Без эпика",
            status: "",
            statusCat: "",
            type: "",
            badge: "",
            priority: "",
            assignee: "",
            sprint: "",
            estimate: 0,
            spent: 0,
            components: [],
            labels: [],
            fixVersions: [],
            parentKey: "",
            epicLink: "",
            created: "",
            updated: "",
            isDone: false,
            transitions: [],
            children: children
        };
    }

    function aggregate(node) {
        var isSynthetic = node.key === "__orphans__";
        var selfEst = isSynthetic ? 0 : node.estimate;
        var selfSpent = isSynthetic ? 0 : node.spent;
        var selfDone = isSynthetic ? 0 : node.isDone ? 1 : 0;
        var selfCount = isSynthetic ? 0 : 1;
        var totalEstimate = selfEst;
        var totalSpent = selfSpent;
        var totalDone = selfDone;
        var totalCount = selfCount;
        (node.children || []).forEach(function(ch) {
            aggregate(ch);
            totalEstimate += ch.totalEstimate;
            totalSpent += ch.totalSpent;
            totalDone += ch.totalDone;
            totalCount += ch.totalCount;
        });
        node.totalEstimate = totalEstimate;
        node.totalSpent = totalSpent;
        node.totalDone = totalDone;
        node.totalCount = totalCount;
        node.progress = totalCount > 0 ? totalDone / totalCount : 0;
    }

    function buildTree(rawIssues) {
        var list = rawIssues || [];
        var keyToNode = {};
        var order = [];
        list.forEach(function(issue) {
            if (!issue || !issue.key) {
                return;
            }
            var n = normalizeIssue(issue);
            keyToNode[issue.key] = n;
            order.push(issue.key);
        });

        var pending = [];
        order.forEach(function(k) {
            var n = keyToNode[k];
            var parentKey = resolveParentInMap(n, keyToNode);
            if (parentKey) {
                pending.push({ child: n, parentKey: parentKey });
            } else {
                pending.push({ child: n, parentKey: "" });
            }
        });

        pending.forEach(function(p) {
            if (p.parentKey) {
                keyToNode[p.parentKey].children.push(p.child);
            }
        });

        var rootEpics = [];
        var orphans = [];
        pending.forEach(function(p) {
            if (p.parentKey) {
                return;
            }
            if (p.child.type === "Epic") {
                rootEpics.push(p.child);
            } else {
                orphans.push(p.child);
            }
        });

        var root = rootEpics.slice();
        if (orphans.length) {
            root.push(makeOrphansHost(orphans));
        }

        root.forEach(function(r) {
            aggregate(r);
            assignProblemItems(r);
        });
        return root;
    }

    function walkTree(nodes, visit) {
        (nodes || []).forEach(function(n) {
            visit(n);
            walkTree(n.children, visit);
        });
    }

    function collectFilters(tree) {
        var statusSet = {};
        var sprintSet = {};
        var epics = [];
        walkTree(tree, function(n) {
            if (n.key === "__orphans__") {
                return;
            }
            if (n.status) {
                statusSet[n.status] = true;
            }
            if (n.sprint) {
                sprintSet[n.sprint] = true;
            }
            if (n.type === "Epic") {
                epics.push({ key: n.key, summary: n.summary });
            }
        });
        return {
            statuses: Object.keys(statusSet),
            sprints: Object.keys(sprintSet),
            epics: epics
        };
    }

    function trimText(s) {
        return String(s || "").trim();
    }

    function normalizeText(s) {
        return trimText(s).toLowerCase();
    }

    function findSubtree(nodes, epicKey) {
        var wanted = normalizeText(epicKey);
        var i;
        for (i = 0; i < (nodes || []).length; i += 1) {
            var n = nodes[i];
            if (normalizeText(n.key) === wanted) {
                return n;
            }
            var found = findSubtree(n.children, epicKey);
            if (found) {
                return found;
            }
        }
        return null;
    }

    function cloneNodeShallow(n) {
        var c = {};
        var k;
        for (k in n) {
            if (Object.prototype.hasOwnProperty.call(n, k) && k !== "children") {
                c[k] = n[k];
            }
        }
        c.children = [];
        return c;
    }

    function matchesActiveFilters(node, filters) {
        var f = filters || {};
        var q = normalizeText(f.search);
        if (q) {
            var hay = (node.key + " " + node.summary).toLowerCase();
            if (hay.indexOf(q) === -1) {
                return false;
            }
        }
        if (normalizeText(f.status)) {
            if (normalizeText(node.status) !== normalizeText(f.status)) {
                return false;
            }
        }
        if (normalizeText(f.sprint)) {
            if (!node.sprint || normalizeText(node.sprint).indexOf(normalizeText(f.sprint)) === -1) {
                return false;
            }
        }
        return true;
    }

    function filterNodePreserveAncestors(node, filters) {
        var kidsIn = node.children || [];
        var kidsOut = [];
        var j;
        for (j = 0; j < kidsIn.length; j += 1) {
            var fc = filterNodePreserveAncestors(kidsIn[j], filters);
            if (fc) {
                kidsOut.push(fc);
            }
        }
        var selfMatch = matchesActiveFilters(node, filters);
        if (selfMatch || kidsOut.length) {
            var out = cloneNodeShallow(node);
            out.children = kidsOut;
            return out;
        }
        return null;
    }

    function filterTree(tree, filters) {
        var f = filters || {};
        var roots = tree || [];
        if (trimText(f.epic)) {
            var sub = findSubtree(roots, f.epic);
            if (!sub) {
                return [];
            }
            roots = [sub];
        }
        var out = [];
        var i;
        for (i = 0; i < roots.length; i += 1) {
            var kept = filterNodePreserveAncestors(roots[i], f);
            if (kept) {
                out.push(kept);
            }
        }
        out.forEach(function(node) {
            aggregate(node);
            assignProblemItems(node);
        });
        return out;
    }

    return {
        buildTree: buildTree,
        collectFilters: collectFilters,
        filterTree: filterTree
    };
});
