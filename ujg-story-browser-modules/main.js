define("_ujgSB_main", [
    "jquery",
    "_ujgSB_config",
    "_ujgSB_utils",
    "_ujgSB_storage",
    "_ujgSB_api",
    "_ujgSB_data",
    "_ujgSB_rendering"
], function($, _config, _utils, storage, api, data, rendering) {
    "use strict";

    function normalizeViewMode(mode) {
        if (mode === "accordion" || mode === "rows" || mode === "table") {
            return mode;
        }
        return "table";
    }

    function emptyFilterOptions() {
        return { statuses: [], sprints: [], epics: [] };
    }

    function resolvedPromise(value) {
        return {
            then: function(onFulfilled) {
                try {
                    var out = onFulfilled ? onFulfilled(value) : value;
                    return out && typeof out.then === "function" ? out : resolvedPromise(out);
                } catch (err) {
                    return rejectedPromise(err);
                }
            },
            catch: function(onRejected) {
                return this.then(null, onRejected);
            }
        };
    }

    function rejectedPromise(reason) {
        return {
            then: function(onFulfilled, onRejected) {
                if (!onRejected) {
                    return rejectedPromise(reason);
                }
                try {
                    var out = onRejected(reason);
                    return out && typeof out.then === "function" ? out : resolvedPromise(out);
                } catch (err) {
                    return rejectedPromise(err);
                }
            },
            catch: function(onRejected) {
                return this.then(null, onRejected);
            }
        };
    }

    function normalizeSelectedEpicKeys(value) {
        var list = Array.isArray(value) ? value : value != null && String(value).trim() !== "" ? [value] : [];
        return list
            .map(function(item) {
                return item != null ? String(item) : "";
            })
            .filter(function(item) {
                return item !== "";
            });
    }

    function hasStagedApi(apiClient) {
        return !!(
            apiClient &&
            typeof apiClient.getProjectEpics === "function" &&
            typeof apiClient.getStoriesForEpicKeys === "function" &&
            typeof apiClient.getIssuesByKeys === "function"
        );
    }

    function normalizeLinkName(name) {
        return String(name || "").trim().toLowerCase().replace(/\s+/g, "_");
    }

    function isChildLinkName(name) {
        return (_config.CHILD_LINK_NAMES || []).some(function(linkName) {
            return normalizeLinkName(linkName) === normalizeLinkName(name);
        });
    }

    function collectChildIssueKeys(stories) {
        var seen = {};
        var out = [];

        function pushKey(linkName, linkedIssue) {
            var key = linkedIssue && linkedIssue.key != null ? String(linkedIssue.key) : "";
            var normKey = key.toLowerCase();
            if (!isChildLinkName(linkName) || !key || seen[normKey]) {
                return;
            }
            seen[normKey] = true;
            out.push(key);
        }

        (stories || []).forEach(function(issue) {
            var links = issue && issue.fields && Array.isArray(issue.fields.issuelinks) ? issue.fields.issuelinks : [];
            links.forEach(function(link) {
                var type = link && link.type ? link.type : {};
                pushKey(type.outward, link && link.outwardIssue);
                pushKey(type.inward, link && link.inwardIssue);
            });
        });
        return out;
    }

    function isOpenEpicIssue(issue) {
        return !(_utils && typeof _utils.isDone === "function" && _utils.isDone(issue && issue.fields && issue.fields.status));
    }

    function shouldRenderPartialSnapshot(loaded, total, issues) {
        var ld = Number(loaded);
        var tt = Number(total);
        if (!issues || !issues.length || !isFinite(ld) || ld <= 0) {
            return false;
        }
        if (isFinite(tt) && tt > 0 && ld >= tt) {
            return false;
        }
        // Show an early preview fast, then refresh in larger chunks for big projects.
        return ld <= 200 || ld % 500 === 0;
    }

    function defaultFieldConfig() {
        return {
            epicLinkField: _config.EPIC_LINK_FIELD,
            sprintField: _config.SPRINT_FIELD
        };
    }

    function StoryBrowserGadget(API) {
        if (!API) {
            console.error("[UJG-StoryBrowser] API object is missing!");
            return;
        }
        var $content = API.getGadgetContentEl();
        if (!$content || $content.length === 0) {
            console.error("[UJG-StoryBrowser] No content element");
            return;
        }

        var $container = $content.find(".ujg-story-browser");
        if ($container.length === 0) {
            if (typeof $content.hasClass === "function" && $content.hasClass("ujg-story-browser")) {
                $container = $content;
            } else {
                $container = $('<div class="ujg-story-browser"></div>');
                $content.append($container);
            }
        }
        if (typeof $container.removeAttr === "function") {
            $container.removeAttr("style");
        }

        var persisted = storage.load();
        var activeLoadToken = 0;
        var stagedApiAvailable = hasStagedApi(api);
        var fieldConfigPromise = null;
        var initialSelectedEpicKeys = normalizeSelectedEpicKeys(
            persisted.selectedEpicKeys != null ? persisted.selectedEpicKeys : persisted.epicFilter
        );
        var state = {
            projects: [],
            project: null,
            epicCatalog: [],
            loadedEpics: [],
            loadedStories: [],
            loadedChildren: [],
            selectedEpicKeys: initialSelectedEpicKeys,
            tree: [],
            filteredTree: [],
            filters: {
                status: persisted.statusFilter != null ? String(persisted.statusFilter) : "",
                epic:
                    initialSelectedEpicKeys[0] != null
                        ? String(initialSelectedEpicKeys[0])
                        : persisted.epicFilter != null
                          ? String(persisted.epicFilter)
                          : "",
                sprint: persisted.sprintFilter != null ? String(persisted.sprintFilter) : "",
                search: ""
            },
            filterOptions: emptyFilterOptions(),
            viewMode: normalizeViewMode(persisted.viewMode),
            expanded: {},
            loading: false,
            fieldConfig: defaultFieldConfig(),
            fieldConfigReady: false
        };

        function persistUiState() {
            storage.save({
                project: state.project,
                viewMode: state.viewMode,
                selectedEpicKeys: state.selectedEpicKeys,
                epicFilter: state.filters.epic,
                statusFilter: state.filters.status,
                sprintFilter: state.filters.sprint
            });
        }

        function currentFilterState() {
            return {
                status: state.filters.status,
                epic: state.filters.epic,
                selectedEpicKeys: state.selectedEpicKeys,
                sprint: state.filters.sprint,
                search: state.filters.search
            };
        }

        function rerenderTree() {
            state.filteredTree = data.filterTree(state.tree, currentFilterState());
            rendering.renderTree(state.filteredTree, state.viewMode, state.expanded);
        }

        function refreshFilterOptions() {
            if (!state.tree || !state.tree.length) {
                state.filterOptions = stagedApiAvailable ? data.collectFilters([], state.epicCatalog) : emptyFilterOptions();
                return;
            }
            state.filterOptions = data.collectFilters(state.tree, stagedApiAvailable ? state.epicCatalog : null);
        }

        function syncLegacyEpicFilter() {
            state.filters.epic = state.selectedEpicKeys[0] != null ? String(state.selectedEpicKeys[0]) : "";
        }

        function syncSelectedEpicKeysWithCatalog() {
            var available = {};
            state.epicCatalog.forEach(function(issue) {
                if (issue && issue.key != null) {
                    available[String(issue.key).toLowerCase()] = String(issue.key);
                }
            });
            state.selectedEpicKeys = normalizeSelectedEpicKeys(state.selectedEpicKeys)
                .map(function(key) {
                    return available[String(key).toLowerCase()] || "";
                })
                .filter(Boolean)
                .filter(function(key, index, list) {
                    return list.indexOf(key) === index;
                });
            syncLegacyEpicFilter();
        }

        function fillHeaderFromState() {
            var $ps = $container.find(".ujg-sb-project-select");
            if ($ps.length) {
                $ps.empty();
                (state.projects || []).forEach(function(p) {
                    var key = p && p.key != null ? String(p.key) : "";
                    var name = p && p.name != null ? String(p.name) : key;
                    $ps.append($("<option/>").attr("value", key).text(name));
                });
                if (state.project) {
                    $ps.val(state.project);
                }
            }

            var $st = $container.find(".ujg-sb-status-select");
            if ($st.length) {
                $st.empty();
                $st.append($("<option/>").attr("value", "").text("Все статусы"));
                (state.filterOptions.statuses || []).forEach(function(s) {
                    $st.append($("<option/>").attr("value", s).text(s));
                });
                if (state.filters.status) {
                    $st.val(state.filters.status);
                }
            }

            var $ep = $container.find(".ujg-sb-epic-select");
            if ($ep.length) {
                $ep.empty();
                $ep.append($("<option/>").attr("value", "").text("Все эпики"));
                (state.filterOptions.epics || []).forEach(function(e) {
                    var ek = e && e.key != null ? String(e.key) : "";
                    var lab = e && e.summary != null ? String(e.summary) : ek;
                    $ep.append(
                        $("<option/>")
                            .attr("value", ek)
                            .text(ek + (lab && lab !== ek ? " — " + lab : ""))
                    );
                });
                if (state.filters.epic) {
                    $ep.val(state.filters.epic);
                }
            }

            var $sp = $container.find(".ujg-sb-sprint-select");
            if ($sp.length) {
                $sp.empty();
                $sp.append($("<option/>").attr("value", "").text("Все спринты"));
                (state.filterOptions.sprints || []).forEach(function(s) {
                    $sp.append($("<option/>").attr("value", s).text(s));
                });
                if (state.filters.sprint) {
                    $sp.val(state.filters.sprint);
                }
            }

            var $search = $container.find(".ujg-sb-search");
            if ($search.length) {
                $search.val(state.filters.search);
            }
        }

        function rerenderHeader() {
            rendering.renderHeader();
            fillHeaderFromState();
        }

        function clearProgress() {
            rendering.renderProgress(0, 0);
        }

        function ensureFieldConfig() {
            if (
                !stagedApiAvailable ||
                typeof api.getFieldMetadata !== "function" ||
                typeof api.detectFieldConfig !== "function"
            ) {
                return resolvedPromise(state.fieldConfig);
            }
            if (state.fieldConfigReady) {
                return resolvedPromise(state.fieldConfig);
            }
            if (fieldConfigPromise) {
                return fieldConfigPromise;
            }
            fieldConfigPromise = api.getFieldMetadata().then(
                function(fields) {
                    var detected = api.detectFieldConfig(fields || []);
                    state.fieldConfig = {
                        epicLinkField:
                            detected && detected.epicLinkField
                                ? String(detected.epicLinkField)
                                : state.fieldConfig.epicLinkField,
                        sprintField:
                            detected && detected.sprintField
                                ? String(detected.sprintField)
                                : state.fieldConfig.sprintField
                    };
                    state.fieldConfigReady = true;
                    fieldConfigPromise = null;
                    return state.fieldConfig;
                },
                function() {
                    fieldConfigPromise = null;
                    return state.fieldConfig;
                }
            );
            return fieldConfigPromise;
        }

        function clearFilters() {
            state.filters.status = "";
            state.filters.epic = "";
            state.filters.sprint = "";
            state.filters.search = "";
            state.selectedEpicKeys = [];
        }

        function clearLoadedData() {
            state.loadedEpics = [];
            state.loadedStories = [];
            state.loadedChildren = [];
            state.tree = [];
            state.filteredTree = [];
            refreshFilterOptions();
        }

        function applyLoadedIssues(issues, keepLoading) {
            state.loadedEpics = [];
            state.loadedStories = issues || [];
            state.loadedChildren = [];
            state.tree = data.buildTree(issues || [], state.fieldConfig);
            refreshFilterOptions();
            state.loading = !!keepLoading;
            rerenderHeader();
            rerenderTree();
        }

        function applyLoadedPayload(epics, stories, children, keepLoading) {
            state.loadedEpics = epics || [];
            state.loadedStories = stories || [];
            state.loadedChildren = children || [];
            state.tree = data.buildTree({
                epics: state.loadedEpics,
                stories: state.loadedStories,
                children: state.loadedChildren
            }, state.fieldConfig);
            refreshFilterOptions();
            state.loading = !!keepLoading;
            rerenderHeader();
            rerenderTree();
        }

        function expandAllInFiltered() {
            state.expanded = {};
            function walk(nodes) {
                (nodes || []).forEach(function(n) {
                    var kids = n.children && n.children.length;
                    if (kids && (n.type === "Epic" || n.key === "__orphans__")) {
                        state.expanded[n.key] = true;
                        walk(n.children);
                    }
                });
            }
            walk(state.filteredTree);
        }

        function toggleExpandedKey(key) {
            if (!key) {
                return;
            }
            if (state.expanded[key]) {
                delete state.expanded[key];
            } else {
                state.expanded[key] = true;
            }
            rerenderTree();
        }

        function loadDisplayData(projectKey, loadToken) {
            var selectedKeys = state.selectedEpicKeys.length
                ? state.selectedEpicKeys.slice()
                : state.epicCatalog.map(function(issue) {
                      return issue && issue.key != null ? String(issue.key) : "";
                  }).filter(Boolean);
            var selectedEpics = (state.epicCatalog || []).filter(function(issue) {
                var key = issue && issue.key != null ? String(issue.key) : "";
                return key && selectedKeys.some(function(selectedKey) {
                    return String(selectedKey).toLowerCase() === key.toLowerCase();
                });
            });
            var openEpics = selectedEpics.filter(isOpenEpicIssue);

            if (!openEpics.length) {
                applyLoadedPayload([], [], [], false);
                clearProgress();
                persistUiState();
                return;
            }

            rendering.renderProgress(0, 1);
            api.getStoriesForEpicKeys(
                String(projectKey),
                openEpics.map(function(issue) {
                    return issue.key;
                }),
                function(loaded, total) {
                    if (loadToken !== activeLoadToken) {
                        return;
                    }
                    rendering.renderProgress(loaded, total);
                },
                state.fieldConfig
            ).then(
                function(stories) {
                    var safeStories = stories || [];
                    var childKeys;
                    if (loadToken !== activeLoadToken) {
                        return;
                    }
                    childKeys = collectChildIssueKeys(safeStories);
                    rendering.renderProgress(0, 1);
                    api.getIssuesByKeys(
                        childKeys,
                        function(loaded, total) {
                            if (loadToken !== activeLoadToken) {
                                return;
                            }
                            rendering.renderProgress(loaded, total);
                        },
                        state.fieldConfig
                    ).then(
                        function(children) {
                            if (loadToken !== activeLoadToken) {
                                return;
                            }
                            applyLoadedPayload(openEpics, safeStories, children || [], false);
                            clearProgress();
                            persistUiState();
                        },
                        function() {
                            if (loadToken !== activeLoadToken) {
                                return;
                            }
                            applyLoadedPayload(openEpics, safeStories, [], false);
                            clearProgress();
                            persistUiState();
                        }
                    );
                },
                function() {
                    if (loadToken !== activeLoadToken) {
                        return;
                    }
                    state.loading = false;
                    clearLoadedData();
                    rerenderHeader();
                    rerenderTree();
                    clearProgress();
                    persistUiState();
                }
            );
        }

        function loadProject(projectKey, resetFilters) {
            if (!projectKey) {
                return;
            }
            var previousProject = state.project;
            activeLoadToken += 1;
            var loadToken = activeLoadToken;
            state.loading = true;
            state.project = projectKey;
            if (resetFilters || (previousProject != null && String(previousProject) !== String(projectKey))) {
                clearFilters();
            }
            state.expanded = {};
            state.epicCatalog = [];
            clearLoadedData();
            clearProgress();
            rerenderHeader();
            rerenderTree();
            if (stagedApiAvailable) {
                rendering.renderProgress(0, 1);
                ensureFieldConfig().then(function() {
                    if (loadToken !== activeLoadToken) {
                        return;
                    }
                    rendering.renderProgress(0, 1);
                    api.getProjectEpics(
                        String(projectKey),
                        function(loaded, total) {
                            if (loadToken !== activeLoadToken) {
                                return;
                            }
                            rendering.renderProgress(loaded, total);
                        }
                    ).then(
                        function(epics) {
                            if (loadToken !== activeLoadToken) {
                                return;
                            }
                            state.epicCatalog = epics || [];
                            syncSelectedEpicKeysWithCatalog();
                            refreshFilterOptions();
                            rerenderHeader();
                            rerenderTree();
                            loadDisplayData(projectKey, loadToken);
                        },
                        function() {
                            if (loadToken !== activeLoadToken) {
                                return;
                            }
                            state.loading = false;
                            state.epicCatalog = [];
                            clearLoadedData();
                            rerenderHeader();
                            rerenderTree();
                            clearProgress();
                            persistUiState();
                        }
                    );
                });
                return;
            }
            api
                .getProjectIssues(String(projectKey), function(loaded, total, partialIssues) {
                    if (loadToken !== activeLoadToken) {
                        return;
                    }
                    rendering.renderProgress(loaded, total);
                    if (shouldRenderPartialSnapshot(loaded, total, partialIssues)) {
                        applyLoadedIssues(partialIssues, true);
                    }
                })
                .then(
                    function(issues) {
                        if (loadToken !== activeLoadToken) {
                            return;
                        }
                        applyLoadedIssues(issues, false);
                        clearProgress();
                        persistUiState();
                    },
                    function() {
                        if (loadToken !== activeLoadToken) {
                            return;
                        }
                        state.loading = false;
                        state.tree = [];
                        state.filterOptions = emptyFilterOptions();
                        rerenderHeader();
                        rerenderTree();
                        clearProgress();
                        persistUiState();
                    }
                );
        }

        function onFilterChange() {
            persistUiState();
            rerenderTree();
        }

        var services = {
            state: state,
            onProjectChange: function(key) {
                loadProject(key);
            },
            onStatusChange: function(v) {
                state.filters.status = v != null ? String(v) : "";
                onFilterChange();
            },
            onEpicChange: function(v) {
                state.selectedEpicKeys = normalizeSelectedEpicKeys(v);
                syncLegacyEpicFilter();
                if (stagedApiAvailable) {
                    persistUiState();
                    activeLoadToken += 1;
                    var loadToken = activeLoadToken;
                    state.loading = true;
                    state.expanded = {};
                    clearLoadedData();
                    clearProgress();
                    rerenderHeader();
                    rerenderTree();
                    loadDisplayData(state.project, loadToken);
                    return;
                }
                onFilterChange();
            },
            onSprintChange: function(v) {
                state.filters.sprint = v != null ? String(v) : "";
                onFilterChange();
            },
            onSearchInput: function(v) {
                state.filters.search = v != null ? String(v) : "";
                rerenderTree();
            },
            onSearchChange: function(v) {
                state.filters.search = v != null ? String(v) : "";
                rerenderTree();
            },
            onViewMode: function(mode) {
                state.viewMode = normalizeViewMode(mode) || "table";
                persistUiState();
                rerenderTree();
            },
            onExpandAll: function() {
                expandAllInFiltered();
                rerenderTree();
            },
            onCollapseAll: function() {
                state.expanded = {};
                rerenderTree();
            },
            onToggleExpandedKey: function(key) {
                toggleExpandedKey(key);
            },
            onToggleEpic: function(key) {
                toggleExpandedKey(key);
            }
        };

        rendering.init($container, services);

        api.getProjects().then(
            function(projects) {
                state.projects = projects || [];
                rerenderHeader();
                var keyToLoad = persisted.project != null ? String(persisted.project) : "";
                var exists =
                    keyToLoad &&
                    state.projects.some(function(p) {
                        return p && String(p.key) === keyToLoad;
                    });
                var resetFiltersForFallback = !exists;
                if (!exists) {
                    keyToLoad =
                        state.projects[0] && state.projects[0].key != null
                            ? String(state.projects[0].key)
                            : "";
                }
                if (keyToLoad) {
                    loadProject(keyToLoad, resetFiltersForFallback);
                }
            },
            function() {
                state.projects = [];
                rerenderHeader();
            }
        );
    }

    return StoryBrowserGadget;
});
