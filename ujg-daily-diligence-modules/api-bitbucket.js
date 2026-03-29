define("_ujgDD_apiBitbucket", ["jquery", "_ujgDD_config"], function($, config) {
    "use strict";

    var prLimit = 100;
    var repoLimit = 100;
    var commitLimit = 500;
    var maxCommitFetches = 5;
    var prRoles = ["AUTHOR", "REVIEWER"];

    function trimBase(u) {
        return String(u || "").replace(/\/+$/, "");
    }

    function buildKeySet(userKeys) {
        var set = {};
        (userKeys || []).forEach(function(k) {
            if (k) set[String(k)] = true;
        });
        return set;
    }

    function dayBoundsMs(startDate, endDate) {
        var s = new Date(String(startDate) + "T00:00:00.000Z").getTime();
        var e = new Date(String(endDate) + "T23:59:59.999Z").getTime();
        return { start: s, end: e };
    }

    function formatAjaxError(xhr, status, fallback) {
        return status === "abort" ? "cancelled" : (xhr && xhr.statusText) || fallback;
    }

    function unwrapPerson(u) {
        return u && u.user ? u.user : u;
    }

    function personMatchesKeys(person, keySet) {
        if (!person || !keySet) return false;
        var p = unwrapPerson(person);
        var fields = [p.slug, p.name, p.id, p.emailAddress, p.displayName];
        var i;
        for (i = 0; i < fields.length; i++) {
            if (fields[i] != null && fields[i] !== "" && keySet[String(fields[i])]) return true;
        }
        return false;
    }

    function prDedupeKey(pr) {
        var repo = (pr.fromRef && pr.fromRef.repository) || (pr.toRef && pr.toRef.repository) || {};
        var proj = (repo.project && repo.project.key) || "";
        var slug = repo.slug || "";
        return proj + "/" + slug + "#" + String(pr.id != null ? pr.id : "");
    }

    function dedupePullRequests(lists) {
        var seen = {};
        var out = [];
        var i;
        var j;
        var pr;
        var k;
        for (i = 0; i < lists.length; i++) {
            var chunk = lists[i] || [];
            for (j = 0; j < chunk.length; j++) {
                pr = chunk[j];
                k = prDedupeKey(pr);
                if (!k || k.indexOf("#") < 0) {
                    out.push(pr);
                    continue;
                }
                if (seen[k]) continue;
                seen[k] = true;
                out.push(pr);
            }
        }
        return out;
    }

    function prTouchesTeam(pr, keySet) {
        if (personMatchesKeys(pr.author, keySet)) return true;
        var reviewers = pr.reviewers || [];
        var i;
        for (i = 0; i < reviewers.length; i++) {
            if (personMatchesKeys(reviewers[i], keySet)) return true;
        }
        var participants = pr.participants || [];
        for (i = 0; i < participants.length; i++) {
            if (personMatchesKeys(participants[i], keySet)) return true;
        }
        return false;
    }

    function prInDateRange(pr, startMs, endMs) {
        var c = pr.createdDate;
        var u = pr.updatedDate;
        var inCreated = typeof c === "number" && c >= startMs && c <= endMs;
        var inUpdated = typeof u === "number" && u >= startMs && u <= endMs;
        return inCreated || inUpdated;
    }

    function commitAuthorMatches(commit, keySet) {
        return personMatchesKeys(commit.author, keySet);
    }

    function commitInDateRange(commit, startMs, endMs) {
        var t = commit.authorTimestamp;
        if (typeof t !== "number") t = commit.committerTimestamp;
        return typeof t === "number" && t >= startMs && t <= endMs;
    }

    function repoIdentity(r) {
        var proj = (r.project && r.project.key) || r.projectKey || "";
        var slug = r.slug || r.name || "";
        return proj && slug ? proj + "/" + slug : "";
    }

    function fetchPagedAjax(url, baseParams, limit, extractValues) {
        var d = $.Deferred();
        var all = [];

        function page(start) {
            var params = $.extend({}, baseParams, { limit: limit, start: start });
            $.ajax({
                url: url,
                type: "GET",
                dataType: "json",
                data: params
            }).done(function(resp) {
                var values = extractValues(resp) || [];
                all = all.concat(values);
                var last = resp && resp.isLastPage;
                var shortPage = values.length < limit;
                if (values.length === 0 || last || shortPage) {
                    d.resolve(all);
                } else {
                    page(start + values.length);
                }
            }).fail(function(xhr, status) {
                d.reject(status === "abort" ? "cancelled" : (xhr && xhr.statusText) || "request failed");
            });
        }

        page(0);
        return d.promise();
    }

    function fetchDashboardPullRequests(base, userKey, role) {
        return fetchPagedAjax(
            base + "/rest/api/latest/dashboard/pull-requests",
            { state: "ALL", role: role, user: userKey },
            prLimit,
            function(resp) {
                return resp.values;
            }
        );
    }

    function fetchPullRequests(base, userKeys, onProgress) {
        var d = $.Deferred();
        var requests = [];
        var lists = [];
        var loaded = 0;

        (userKeys || []).forEach(function(userKey) {
            prRoles.forEach(function(role) {
                requests.push({ userKey: userKey, role: role });
            });
        });

        if (onProgress) {
            onProgress({ phase: "bitbucket-pr", loaded: 0, total: requests.length });
        }

        function next() {
            var request = requests.shift();
            if (!request) {
                d.resolve(dedupePullRequests(lists));
                return;
            }

            fetchDashboardPullRequests(base, request.userKey, request.role).done(function(prs) {
                lists.push(prs || []);
                loaded += 1;
                if (onProgress) {
                    onProgress({ phase: "bitbucket-pr", loaded: loaded, total: prRoles.length * userKeys.length });
                }
                next();
            }).fail(function(err) {
                d.reject(err);
            });
        }

        next();
        return d.promise();
    }

    function fetchUserRepos(base, userKey) {
        return fetchPagedAjax(
            base + "/rest/api/1.0/users/" + encodeURIComponent(userKey) + "/repos",
            {},
            repoLimit,
            function(resp) {
                return resp.values;
            }
        );
    }

    function fetchRepoCommits(base, projectKey, repoSlug, startMs, endMs, keySet, onProgressOne) {
        var d = $.Deferred();
        var collected = [];
        var start = 0;

        function doneOk() {
            if (onProgressOne) onProgressOne();
            d.resolve(collected);
        }

        function nextPage() {
            $.ajax({
                url: base + "/rest/api/latest/projects/" + encodeURIComponent(projectKey) +
                    "/repos/" + encodeURIComponent(repoSlug) + "/commits",
                type: "GET",
                dataType: "json",
                data: {
                    limit: commitLimit,
                    start: start
                }
            }).done(function(resp) {
                var values = (resp && resp.values) || [];
                var i;
                var commit;
                var oldest = Infinity;
                for (i = 0; i < values.length; i++) {
                    commit = values[i];
                    var ts = commit.authorTimestamp;
                    if (typeof ts !== "number") ts = commit.committerTimestamp;
                    if (typeof ts === "number" && ts < oldest) oldest = ts;

                    if (commitAuthorMatches(commit, keySet) && commitInDateRange(commit, startMs, endMs)) {
                        collected.push($.extend({}, commit, {
                            _ujgProjectKey: projectKey,
                            _ujgRepoSlug: repoSlug
                        }));
                    }
                }

                var last = resp && resp.isLastPage;
                var shortPage = values.length < commitLimit;
                var pastRange = values.length > 0 && oldest !== Infinity && oldest < startMs;
                var empty = values.length === 0;

                if (empty || last || shortPage || pastRange) {
                    doneOk();
                } else {
                    start += values.length;
                    nextPage();
                }
            }).fail(function(xhr, status) {
                d.reject(projectKey + "/" + repoSlug + ": " + formatAjaxError(xhr, status, "commit fetch failed"));
            });
        }

        nextPage();
        return d.promise();
    }

    function fetchTeamActivity(userKeys, startDate, endDate, onProgress) {
        var d = $.Deferred();
        var keys = (userKeys || []).filter(Boolean);
        if (keys.length === 0) {
            if (onProgress) onProgress({ phase: "bitbucket", loaded: 0, total: 0 });
            d.resolve({ commits: [], pullRequests: [] });
            return d.promise();
        }

        var keySet = buildKeySet(keys);
        var base = trimBase(config.bitbucketBaseUrl);
        var bounds = dayBoundsMs(startDate, endDate);
        var startMs = bounds.start;
        var endMs = bounds.end;

        fetchPullRequests(base, keys, onProgress)
            .done(function(allPrs) {
                var pullRequests = allPrs.filter(function(pr) {
                    return prTouchesTeam(pr, keySet) && prInDateRange(pr, startMs, endMs);
                });

                if (onProgress) {
                    onProgress({ phase: "bitbucket-repos", loaded: 0, total: keys.length });
                }

                var repoById = {};
                var pendingUsers = keys.slice();
                var reposLoaded = 0;

                function afterReposMap() {
                    var ids = Object.keys(repoById);
                    var totalCommits = ids.length;
                    var commitsDone = 0;

                    if (onProgress) {
                        onProgress({ phase: "bitbucket-commits", loaded: 0, total: totalCommits });
                    }

                    if (totalCommits === 0) {
                        d.resolve({ commits: [], pullRequests: pullRequests });
                        return;
                    }

                    var queue = ids.map(function(id) {
                        return repoById[id];
                    });
                    var allCommits = [];
                    var running = 0;
                    var failed = false;

                    function failCommits(err) {
                        if (failed) return;
                        failed = true;
                        d.reject(err);
                    }

                    function pumpCommits() {
                        while (!failed && running < maxCommitFetches && queue.length > 0) {
                            var repo = queue.shift();
                            running += 1;
                            fetchRepoCommits(
                                base,
                                repo.projectKey,
                                repo.repoSlug,
                                startMs,
                                endMs,
                                keySet,
                                function() {
                                    commitsDone += 1;
                                    if (onProgress) {
                                        onProgress({
                                            phase: "bitbucket-commits",
                                            loaded: commitsDone,
                                            total: totalCommits
                                        });
                                    }
                                }
                            ).done(function(batch) {
                                if (failed) {
                                    running -= 1;
                                    return;
                                }
                                allCommits = allCommits.concat(batch);
                                running -= 1;
                                if (queue.length === 0 && running === 0) {
                                    d.resolve({ commits: allCommits, pullRequests: pullRequests });
                                } else {
                                    pumpCommits();
                                }
                            }).fail(function(err) {
                                running -= 1;
                                failCommits(err);
                            });
                        }
                    }

                    pumpCommits();
                }

                function loadNextUserRepos() {
                    var uk = pendingUsers.shift();
                    if (!uk) {
                        afterReposMap();
                        return;
                    }
                    fetchUserRepos(base, uk).done(function(repos) {
                        var i;
                        var r;
                        var id;
                        for (i = 0; i < repos.length; i++) {
                            r = repos[i];
                            id = repoIdentity(r);
                            if (!id) continue;
                            var pk = r.project && r.project.key;
                            var slug = r.slug || r.name;
                            if (!pk || !slug) continue;
                            if (!repoById[id]) {
                                repoById[id] = { projectKey: pk, repoSlug: slug, repo: r };
                            }
                        }
                        reposLoaded += 1;
                        if (onProgress) {
                            onProgress({ phase: "bitbucket-repos", loaded: reposLoaded, total: keys.length });
                        }
                        loadNextUserRepos();
                    }).fail(function() {
                        reposLoaded += 1;
                        if (onProgress) {
                            onProgress({ phase: "bitbucket-repos", loaded: reposLoaded, total: keys.length });
                        }
                        loadNextUserRepos();
                    });
                }

                loadNextUserRepos();
            })
            .fail(function(err) {
                d.reject(err);
            });

        return d.promise();
    }

    return {
        fetchTeamActivity: fetchTeamActivity
    };
});
