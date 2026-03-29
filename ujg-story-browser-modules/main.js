define("_ujgSB_main", [
    "jquery",
    "_ujgSB_config",
    "_ujgSB_utils",
    "_ujgSB_storage",
    "_ujgSB_api",
    "_ujgSB_data",
    "_ujgSB_rendering",
    "_ujgSB_create-story"
], function($, _config, _utils, storage, api, data, rendering, createStory) {
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
        var state = {
            projects: [],
            project: null,
            tree: [],
            filteredTree: [],
            filters: {
                status: persisted.statusFilter != null ? String(persisted.statusFilter) : "",
                epic: persisted.epicFilter != null ? String(persisted.epicFilter) : "",
                sprint: persisted.sprintFilter != null ? String(persisted.sprintFilter) : "",
                search: ""
            },
            filterOptions: emptyFilterOptions(),
            viewMode: normalizeViewMode(persisted.viewMode),
            expanded: {},
            loading: false,
            createStory: {
                isOpen: false,
                draft: null,
                context: null
            }
        };

        function persistUiState() {
            storage.save({
                project: state.project,
                viewMode: state.viewMode,
                epicFilter: state.filters.epic,
                statusFilter: state.filters.status,
                sprintFilter: state.filters.sprint
            });
        }

        function rerenderTree() {
            state.filteredTree = data.filterTree(state.tree, state.filters);
            rendering.renderTree(state.filteredTree, state.viewMode, state.expanded);
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

        function clearFilters() {
            state.filters.status = "";
            state.filters.epic = "";
            state.filters.sprint = "";
            state.filters.search = "";
        }

        function applyLoadedIssues(issues, keepLoading) {
            state.tree = data.buildTree(issues || []);
            state.filterOptions = data.collectFilters(state.tree);
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

        function loadProject(projectKey, resetFilters) {
            if (!projectKey) {
                return;
            }
            var previousProject = state.project;
            if (
                state.createStory.isOpen ||
                (previousProject != null && String(previousProject) !== String(projectKey))
            ) {
                state.createStory.isOpen = false;
                state.createStory.draft = null;
                state.createStory.context = null;
                rendering.clearCreateStoryModal();
            }
            activeLoadToken += 1;
            var loadToken = activeLoadToken;
            state.loading = true;
            state.project = projectKey;
            if (resetFilters || (previousProject != null && String(previousProject) !== String(projectKey))) {
                clearFilters();
            }
            state.expanded = {};
            state.tree = [];
            state.filterOptions = emptyFilterOptions();
            clearProgress();
            rerenderHeader();
            rerenderTree();
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
            api: api,
            onProjectChange: function(key) {
                loadProject(key);
            },
            onStatusChange: function(v) {
                state.filters.status = v != null ? String(v) : "";
                onFilterChange();
            },
            onEpicChange: function(v) {
                state.filters.epic = v != null ? String(v) : "";
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
            },
            onOpenCreateStory: function() {
                state.createStory.isOpen = true;
                state.createStory.context = null;
                state.createStory.draft = createStory.makeDefaultDraft(state.project);
                rendering.renderCreateStoryModal(state.createStory.draft);
            },
            onCloseCreateStory: function() {
                state.createStory.isOpen = false;
                state.createStory.draft = null;
                state.createStory.context = null;
                rendering.clearCreateStoryModal();
            },
            onSubmitCreateStory: function() {
                var draft = state.createStory.draft;
                if (!draft) {
                    return;
                }
                createStory.validateDraft(draft, { purpose: "submit" });
                if (createStory.hasSubmitValidationErrors(draft)) {
                    rendering.renderCreateStoryModal(draft);
                    return;
                }
                createStory.submitCreateDraft(api, draft).then(
                    function(result) {
                        if (result && result.skipped) {
                            return;
                        }
                        if (!result || !result.ok) {
                            if (state.createStory.isOpen && state.createStory.draft === draft) {
                                rendering.renderCreateStoryModal(draft);
                            }
                            return;
                        }
                        var currentDraft = state.createStory.draft;
                        if (currentDraft === draft) {
                            if (state.createStory.isOpen) {
                                state.createStory.isOpen = false;
                                state.createStory.draft = null;
                                state.createStory.context = null;
                                rendering.clearCreateStoryModal();
                            }
                            loadProject(state.project, false);
                        } else if (!state.createStory.isOpen) {
                            loadProject(state.project, false);
                        }
                    },
                    function() {
                        if (state.createStory.isOpen && state.createStory.draft === draft) {
                            rendering.renderCreateStoryModal(draft);
                        }
                    }
                );
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
