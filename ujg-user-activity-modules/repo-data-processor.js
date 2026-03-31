define("_ujgUA_repoDataProcessor", ["_ujgUA_config", "_ujgUA_utils"], function(config, utils) {
    "use strict";

    function normalizeUserValue(value) {
        if (value === undefined || value === null) return "";
        return String(value).trim().toLowerCase();
    }

    function collectUserValues(userLike) {
        var values = [];

        function push(value) {
            value = normalizeUserValue(value);
            if (!value || values.indexOf(value) >= 0) return;
            values.push(value);
        }

        if (!userLike) return values;
        push(userLike.name);
        push(userLike.displayName);
        push(userLike.key);
        push(userLike.accountId);
        push(userLike.userName);
        if (userLike.user) {
            push(userLike.user.name);
            push(userLike.user.displayName);
            push(userLike.user.key);
            push(userLike.user.accountId);
            push(userLike.user.userName);
        }

        return values;
    }

    function matchesSelectedUser(userLike, selectedUser) {
        var selectedValues = collectUserValues(selectedUser);
        var userValues = collectUserValues(userLike);

        if (!selectedValues.length || !userValues.length) return false;

        return userValues.some(function(value) {
            return selectedValues.indexOf(value) >= 0;
        });
    }

    function matchesRequestUsers(userLike, requestUsers) {
        if (!requestUsers || !requestUsers.length) return false;
        var userValues = collectUserValues(userLike);
        if (!userValues.length) return false;
        return userValues.some(function(value) {
            return requestUsers.indexOf(value) >= 0;
        });
    }

    function matchesStateUser(userLike, state) {
        void userLike;
        void state;
        return true;
    }

    function getUserLabel(userLike) {
        if (!userLike) return "";
        if (userLike.user) return getUserLabel(userLike.user);
        return userLike.displayName || userLike.name || userLike.userName || userLike.key || userLike.accountId || "";
    }

    function getReviewerLabels(reviewers) {
        return normalizeArray(reviewers).map(function(reviewer) {
            return getUserLabel(reviewer);
        }).filter(function(name) {
            return !!name;
        });
    }

    function getReviewerDetails(reviewers) {
        return normalizeArray(reviewers).map(function(reviewer) {
            return {
                name: getUserLabel(reviewer),
                status: reviewer && (reviewer.status || reviewer.approvalStatus || "")
            };
        }).filter(function(item) {
            return !!item.name;
        });
    }

    function normalizeTimestamp(value) {
        if (value === undefined || value === null || value === "") return null;
        if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
        if (typeof value === "number") {
            return new Date(value > 1e12 ? value : value * 1000);
        }
        return utils.parseDate ? utils.parseDate(value) : new Date(value);
    }

    function extractSourceDateKey(value, normalizedDate) {
        if (typeof value === "string") {
            var match = /^\s*(\d{4}-\d{2}-\d{2})/.exec(value);
            if (match) return match[1];
        }
        return normalizedDate ? utils.getDayKey(normalizedDate) : "";
    }

    function pickSourceDateKey() {
        var i;
        var value;
        var normalized;
        var key;

        for (i = 0; i < arguments.length; i++) {
            value = arguments[i];
            if (typeof value !== "string") continue;
            normalized = normalizeTimestamp(value);
            key = extractSourceDateKey(value, normalized);
            if (key) return key;
        }

        for (i = 0; i < arguments.length; i++) {
            value = arguments[i];
            normalized = normalizeTimestamp(value);
            key = extractSourceDateKey(value, normalized);
            if (key) return key;
        }

        return "";
    }

    function isDateKeyInRange(state, dateKey) {
        return !!dateKey && dateKey >= state.startDate && dateKey <= state.endDate;
    }

    function isTimestampInRange(state, value) {
        var timestamp = normalizeTimestamp(value);
        var dateKey = extractSourceDateKey(value, timestamp);
        if (dateKey) return isDateKeyInRange(state, dateKey);
        if (!timestamp) return false;
        return timestamp.getTime() >= state.startMs && timestamp.getTime() <= state.endMs;
    }

    function ensureDay(dayMap, dateKey) {
        if (!dayMap[dateKey]) {
            dayMap[dateKey] = {
                date: dateKey,
                items: [],
                totalEvents: 0,
                countsByType: {},
                countsByRepo: {}
            };
        }
        return dayMap[dateKey];
    }

    function ensureRepo(repoMap, repoName, repoUrl) {
        var key = repoName || "(unknown)";
        if (!repoMap[key]) {
            repoMap[key] = {
                repoName: key,
                repoUrl: repoUrl || "",
                totalEvents: 0,
                branches: [],
                issues: [],
                countsByType: {}
            };
        } else if (!repoMap[key].repoUrl && repoUrl) {
            repoMap[key].repoUrl = repoUrl;
        }
        return repoMap[key];
    }

    function pushUnique(list, value) {
        if (!value || list.indexOf(value) >= 0) return;
        list.push(value);
    }

    function isCommitType(type) {
        return type === "commit" || type === "branch_commit";
    }

    function isPullRequestType(type) {
        return type.indexOf("pull_request_") === 0;
    }

    function pushEvent(state, item) {
        var rawTimestamp = item && item.timestamp;
        var timestamp = normalizeTimestamp(rawTimestamp);
        var dateKey;
        var day;
        var repo;
        var authorLike;

        if (!timestamp) return;
        dateKey = item.sourceDateKey || extractSourceDateKey(rawTimestamp, timestamp);
        if (dateKey) {
            if (!isDateKeyInRange(state, dateKey)) return;
        } else if (timestamp.getTime() < state.startMs || timestamp.getTime() > state.endMs) {
            return;
        }

        item.timestamp = timestamp.toISOString();
        item.date = dateKey;
        item.repoName = item.repoName || "(unknown)";
        item.repoUrl = item.repoUrl || "";
        item.issueKey = item.issueKey || "";
        item.issueSummary = item.issueSummary || "";
        item.issueStatus = item.issueStatus || "";
        item.branchName = item.branchName || "";
        item.type = item.type || "unknown_dev_event";
        item.title = item.title || "";
        item.message = item.message || "";
        item.status = item.status || "";
        item.hash = item.hash || "";
        item.commitUrl = item.commitUrl || "";
        item.pullRequestId = item.pullRequestId || "";
        item.pullRequestUrl = item.pullRequestUrl || "";
        item.pullRequestAuthor = item.pullRequestAuthor || "";
        authorLike = item.authorMeta || item.userLike || item.raw && (item.raw.author || item.raw.user || item.raw.actor || item.raw.updatedBy) || null;
        item.authorMeta = authorLike;
        item.author = item.author || getUserLabel(authorLike) || "";
        item.authorName = item.authorName || item.author || getUserLabel(authorLike) || "";
        item.reviewers = item.reviewers || getReviewerLabels(item.raw && item.raw.reviewers);
        item.reviewerDetails = item.reviewerDetails || getReviewerDetails(item.raw && item.raw.reviewers);
        item.raw = item.raw || null;

        state.items.push(item);

        day = ensureDay(state.dayMap, dateKey);
        day.items.push(item);
        day.totalEvents += 1;
        day.countsByType[item.type] = (day.countsByType[item.type] || 0) + 1;
        day.countsByRepo[item.repoName] = (day.countsByRepo[item.repoName] || 0) + 1;

        repo = ensureRepo(state.repoMap, item.repoName, item.repoUrl);
        repo.totalEvents += 1;
        repo.countsByType[item.type] = (repo.countsByType[item.type] || 0) + 1;
        pushUnique(repo.issues, item.issueKey);
        pushUnique(repo.branches, item.branchName);

        state.stats.totalEvents += 1;
        if (isCommitType(item.type)) state.stats.totalCommits += 1;
        if (isPullRequestType(item.type)) state.stats.totalPullRequests += 1;
    }

    function extractCommitEvents(state, issueKey, issueInfo, repo) {
        (repo.commits || []).forEach(function(commit) {
            if (!matchesStateUser(commit.author, state)) return;
            var commitHash = commit.id || commit.hash || commit.commitId || "";
            pushEvent(state, {
                type: "commit",
                timestamp: commit.authorTimestamp || commit.commitTimestamp || commit.date,
                sourceDateKey: pickSourceDateKey(commit.date, commit.authorTimestamp, commit.commitTimestamp),
                issueKey: issueKey,
                issueSummary: issueInfo.summary || "",
                issueStatus: issueInfo.status || "",
                repoName: repo.name || repo.slug || "(unknown)",
                repoUrl: repo.url || "",
                branchName: commit.branchName || "",
                message: commit.message || "",
                hash: commitHash,
                commitUrl: utils.buildBitbucketCommitUrl(repo.url || "", commitHash, commit.url || commit.links),
                title: commit.message || "",
                userLike: commit.author,
                raw: commit
            });
        });
    }

    function extractReviewerTimestamp(reviewer) {
        return reviewer.lastReviewedDate || reviewer.approvedDate || reviewer.updatedDate || reviewer.reviewedDate;
    }

    function normalizeArray(value) {
        if (!value) return [];
        return Array.isArray(value) ? value : [value];
    }

    function getPullRequests(container) {
        return normalizeArray(
            container && (
                container.pullRequests ||
                container.pullrequests ||
                container.pullRequest ||
                container.pullrequest
            )
        );
    }

    function getActor(item) {
        return item && (item.author || item.user || item.actor || item.updatedBy);
    }

    function getActivityTimestamp(item) {
        return item && (
            item.updatedDate ||
            item.lastUpdated ||
            item.lastUpdatedDate ||
            item.date ||
            item.createdDate ||
            item.timestamp
        );
    }

    function buildRequestUsers(selectedUser) {
        var values = [];

        function pushValue(value) {
            value = normalizeUserValue(value);
            if (!value || values.indexOf(value) >= 0) return;
            values.push(value);
        }

        function pushUserLike(userLike) {
            if (!userLike) return;
            if (typeof userLike === "string" || typeof userLike === "number") {
                pushValue(userLike);
                return;
            }
            collectUserValues(userLike).forEach(pushValue);
        }

        if (Array.isArray(selectedUser)) {
            selectedUser.forEach(pushUserLike);
        } else {
            pushUserLike(selectedUser);
        }

        return values;
    }

    function hasConcretePullRequestActivity(state, pullRequests) {
        return getPullRequests({ pullRequests: pullRequests }).some(function(pr) {
            if (matchesStateUser(pr.author, state)) {
                if (isTimestampInRange(state, pr.createdDate || pr.created || pr.openedDate)) return true;
                if (isTimestampInRange(state, pr.mergedDate || pr.completedDate || pr.closedDate)) return true;
                if (isTimestampInRange(state, pr.declinedDate || pr.closedDate)) return true;
                if (isTimestampInRange(state, pr.updatedDate || pr.updated || pr.lastUpdated)) return true;
            }

            return normalizeArray(pr.reviewers).some(function(reviewer) {
                return matchesStateUser(reviewer, state) &&
                    isTimestampInRange(state, extractReviewerTimestamp(reviewer));
            });
        });
    }

    function hasConcreteBranchActivity(state, repo) {
        return normalizeArray(repo && repo.branches).some(function(branch) {
            if ((branch.commits || []).some(function(commit) {
                return matchesStateUser(commit.author, state) &&
                    isTimestampInRange(state, commit.authorTimestamp || commit.commitTimestamp || commit.date);
            })) {
                return true;
            }

            return matchesStateUser(branch.author, state) &&
                isTimestampInRange(state, branch.lastUpdated || branch.lastUpdatedDate || branch.createdDate || branch.date);
        });
    }

    function hasConcreteRepoActivity(state, repo) {
        if ((repo.commits || []).some(function(commit) {
            return matchesStateUser(commit.author, state) &&
                isTimestampInRange(state, commit.authorTimestamp || commit.commitTimestamp || commit.date);
        })) {
            return true;
        }

        if (hasConcretePullRequestActivity(state, getPullRequests(repo))) return true;
        if (hasConcreteBranchActivity(state, repo)) return true;

        return false;
    }

    function extractRepositoryEvents(state, issueKey, issueInfo, repo) {
        if (!matchesStateUser(getActor(repo), state)) return;
        if (hasConcreteRepoActivity(state, repo)) return;
        pushEvent(state, {
            type: "repository_update",
            timestamp: getActivityTimestamp(repo),
            sourceDateKey: pickSourceDateKey(repo.updatedDate, repo.lastUpdated, repo.lastUpdatedDate, repo.createdDate, repo.date, repo.timestamp),
            issueKey: issueKey,
            issueSummary: issueInfo.summary || "",
            issueStatus: issueInfo.status || "",
            repoName: repo.name || repo.slug || "(unknown)",
            repoUrl: repo.url || "",
            title: repo.name || repo.slug || "(unknown)",
            userLike: getActor(repo),
            raw: repo
        });
    }

    function extractUnknownEvents(state, issueKey, issueInfo, container, repoName, repoUrl) {
        var skipKeys = {
            id: true,
            key: true,
            name: true,
            slug: true,
            url: true,
            type: true,
            commits: true,
            branches: true,
            repositories: true,
            pullRequests: true,
            pullrequests: true,
            pullRequest: true,
            pullrequest: true,
            author: true,
            user: true,
            actor: true,
            updatedBy: true,
            updatedDate: true,
            lastUpdated: true,
            lastUpdatedDate: true,
            createdDate: true,
            date: true,
            timestamp: true
        };

        Object.keys(container || {}).forEach(function(key) {
            if (skipKeys[key]) return;

            normalizeArray(container[key]).forEach(function(item) {
                if (!item || typeof item !== "object") return;
                if (!matchesStateUser(getActor(item), state)) return;
                pushEvent(state, {
                    type: "unknown_dev_event",
                    timestamp: getActivityTimestamp(item),
                    sourceDateKey: pickSourceDateKey(item.updatedDate, item.lastUpdated, item.lastUpdatedDate, item.createdDate, item.date, item.timestamp),
                    issueKey: issueKey,
                    issueSummary: issueInfo.summary || "",
                    issueStatus: issueInfo.status || "",
                    repoName: repoName || container.name || "(unknown)",
                    repoUrl: repoUrl || container.url || "",
                    title: item.title || item.name || item.id || key,
                    userLike: getActor(item),
                    raw: item
                });
            });
        });
    }

    function extractPullRequestEvents(state, issueKey, issueInfo, repo, pullRequests) {
        (pullRequests || []).forEach(function(pr) {
            var repoName = repo.name || repo.slug || "(unknown)";
            var repoUrl = repo.url || "";
            var prTitle = pr.name || pr.title || pr.id || "";
            var prStatus = normalizeUserValue(pr.status);
            var prAuthor = getUserLabel(pr.author);
            var hasTypedAuthorEvent = false;

            if (matchesStateUser(pr.author, state)) {
                pushEvent(state, {
                    type: "pull_request_opened",
                    timestamp: pr.createdDate || pr.created || pr.openedDate,
                    sourceDateKey: pickSourceDateKey(pr.createdDate, pr.created, pr.openedDate),
                    issueKey: issueKey,
                    issueSummary: issueInfo.summary || "",
                    issueStatus: issueInfo.status || "",
                    repoName: repoName,
                    repoUrl: repoUrl,
                    branchName: pr.source && pr.source.branch || pr.fromRef && pr.fromRef.displayId || "",
                    pullRequestId: pr.id || pr.key || "",
                    pullRequestUrl: utils.buildBitbucketPullRequestUrl(repoUrl, pr.id || pr.key || "", pr.url || pr.links),
                    pullRequestAuthor: prAuthor,
                    title: prTitle,
                    status: pr.status || "",
                    userLike: pr.author,
                    raw: pr
                });
                hasTypedAuthorEvent = hasTypedAuthorEvent || isTimestampInRange(state, pr.createdDate || pr.created || pr.openedDate);

                if (prStatus === "merged" || prStatus === "completed") {
                    pushEvent(state, {
                        type: "pull_request_merged",
                        timestamp: pr.mergedDate || pr.completedDate || pr.closedDate,
                        sourceDateKey: pickSourceDateKey(pr.mergedDate, pr.completedDate, pr.closedDate),
                        issueKey: issueKey,
                        issueSummary: issueInfo.summary || "",
                        issueStatus: issueInfo.status || "",
                        repoName: repoName,
                        repoUrl: repoUrl,
                        branchName: pr.source && pr.source.branch || pr.fromRef && pr.fromRef.displayId || "",
                        pullRequestId: pr.id || pr.key || "",
                        pullRequestUrl: utils.buildBitbucketPullRequestUrl(repoUrl, pr.id || pr.key || "", pr.url || pr.links),
                        pullRequestAuthor: prAuthor,
                        title: prTitle,
                        status: pr.status || "",
                        userLike: pr.author,
                        raw: pr
                    });
                    hasTypedAuthorEvent = hasTypedAuthorEvent || isTimestampInRange(state, pr.mergedDate || pr.completedDate || pr.closedDate);
                } else if (prStatus === "declined" || prStatus === "rejected") {
                    pushEvent(state, {
                        type: "pull_request_declined",
                        timestamp: pr.closedDate || pr.declinedDate || pr.updatedDate,
                        sourceDateKey: pickSourceDateKey(pr.closedDate, pr.declinedDate, pr.updatedDate, pr.updated, pr.lastUpdated),
                        issueKey: issueKey,
                        issueSummary: issueInfo.summary || "",
                        issueStatus: issueInfo.status || "",
                        repoName: repoName,
                        repoUrl: repoUrl,
                        branchName: pr.source && pr.source.branch || pr.fromRef && pr.fromRef.displayId || "",
                        pullRequestId: pr.id || pr.key || "",
                        pullRequestUrl: utils.buildBitbucketPullRequestUrl(repoUrl, pr.id || pr.key || "", pr.url || pr.links),
                        pullRequestAuthor: prAuthor,
                        title: prTitle,
                        status: pr.status || "",
                        userLike: pr.author,
                        raw: pr
                    });
                    hasTypedAuthorEvent = hasTypedAuthorEvent || isTimestampInRange(state, pr.closedDate || pr.declinedDate || pr.updatedDate);
                }

                if (!hasTypedAuthorEvent) {
                    pushEvent(state, {
                        type: "repository_update",
                        timestamp: pr.updatedDate || pr.updated || pr.lastUpdated,
                        sourceDateKey: pickSourceDateKey(pr.updatedDate, pr.updated, pr.lastUpdated, pr.createdDate, pr.created),
                        issueKey: issueKey,
                        issueSummary: issueInfo.summary || "",
                        issueStatus: issueInfo.status || "",
                        repoName: repoName,
                        repoUrl: repoUrl,
                        branchName: pr.source && pr.source.branch || pr.fromRef && pr.fromRef.displayId || "",
                        pullRequestId: pr.id || pr.key || "",
                        pullRequestUrl: utils.buildBitbucketPullRequestUrl(repoUrl, pr.id || pr.key || "", pr.url || pr.links),
                        pullRequestAuthor: prAuthor,
                        title: prTitle,
                        status: pr.status || "",
                        userLike: pr.author,
                        raw: pr
                    });
                }
            }

            (pr.reviewers || []).forEach(function(reviewer) {
                var reviewerStatus;

                if (!matchesStateUser(reviewer, state)) return;

                reviewerStatus = normalizeUserValue(reviewer.status || reviewer.approvalStatus);
                pushEvent(state, {
                    type: reviewerStatus.indexOf("needs") >= 0 || reviewerStatus.indexOf("work") >= 0
                        ? "pull_request_needs_work"
                        : "pull_request_reviewed",
                    timestamp: extractReviewerTimestamp(reviewer),
                    sourceDateKey: pickSourceDateKey(
                        reviewer.lastReviewedDate,
                        reviewer.approvedDate,
                        reviewer.updatedDate,
                        reviewer.reviewedDate
                    ),
                    issueKey: issueKey,
                    issueSummary: issueInfo.summary || "",
                    issueStatus: issueInfo.status || "",
                    repoName: repoName,
                    repoUrl: repoUrl,
                    branchName: pr.source && pr.source.branch || pr.fromRef && pr.fromRef.displayId || "",
                    pullRequestId: pr.id || pr.key || "",
                    pullRequestUrl: utils.buildBitbucketPullRequestUrl(repoUrl, pr.id || pr.key || "", pr.url || pr.links),
                    pullRequestAuthor: prAuthor,
                    title: prTitle,
                    status: reviewer.status || reviewer.approvalStatus || "",
                    userLike: reviewer,
                    reviewers: getReviewerLabels(pr.reviewers),
                    reviewerDetails: getReviewerDetails(pr.reviewers),
                    raw: pr
                });
            });
        });
    }

    function extractBranchEvents(state, issueKey, issueInfo, repo) {
        (repo.branches || []).forEach(function(branch) {
            var branchName = branch.name || branch.id || "";
            var hasBranchCommitInRange = (branch.commits || []).some(function(commit) {
                return matchesStateUser(commit.author, state) &&
                    isTimestampInRange(state, commit.authorTimestamp || commit.commitTimestamp || commit.date);
            });

            if (!hasBranchCommitInRange && matchesStateUser(branch.author, state)) {
                pushEvent(state, {
                    type: "branch_update",
                    timestamp: branch.lastUpdated || branch.lastUpdatedDate || branch.createdDate || branch.date,
                    sourceDateKey: pickSourceDateKey(branch.lastUpdated, branch.lastUpdatedDate, branch.createdDate, branch.date),
                    issueKey: issueKey,
                    issueSummary: issueInfo.summary || "",
                    issueStatus: issueInfo.status || "",
                    repoName: repo.name || repo.slug || "(unknown)",
                    repoUrl: repo.url || "",
                    branchName: branchName,
                    title: branchName,
                    userLike: branch.author,
                    raw: branch
                });
            }

            (branch.commits || []).forEach(function(commit) {
                if (!matchesStateUser(commit.author, state)) return;
                var commitHash = commit.id || commit.hash || commit.commitId || "";
                pushEvent(state, {
                    type: "branch_commit",
                    timestamp: commit.authorTimestamp || commit.commitTimestamp || commit.date,
                    sourceDateKey: pickSourceDateKey(commit.date, commit.authorTimestamp, commit.commitTimestamp),
                    issueKey: issueKey,
                    issueSummary: issueInfo.summary || "",
                    issueStatus: issueInfo.status || "",
                    repoName: repo.name || repo.slug || "(unknown)",
                    repoUrl: repo.url || "",
                    branchName: branchName,
                    message: commit.message || "",
                    hash: commitHash,
                    commitUrl: utils.buildBitbucketCommitUrl(repo.url || "", commitHash, commit.url || commit.links),
                    title: commit.message || "",
                    userLike: commit.author,
                    raw: commit
                });
            });
        });
    }

    function processRepoActivity(issueMap, issueDevStatusMap, selectedUser, startDate, endDate) {
        var useStringUserFilter = typeof selectedUser === "string" || Array.isArray(selectedUser);
        var requestUsers = useStringUserFilter
            ? buildRequestUsers(selectedUser)
            : null;
        var state = {
            useStringUserFilter: useStringUserFilter,
            requestUsers: requestUsers,
            selectedUser: useStringUserFilter ? {} : (selectedUser || {}),
            startDate: startDate,
            endDate: endDate,
            startMs: new Date(startDate + "T00:00:00").getTime(),
            endMs: new Date(endDate + "T23:59:59").getTime(),
            items: [],
            dayMap: {},
            repoMap: {},
            stats: {
                totalEvents: 0,
                totalCommits: 0,
                totalPullRequests: 0,
                totalBranchesTouched: 0,
                totalRepositories: 0,
                activeRepoDays: 0
            }
        };

        Object.keys(issueDevStatusMap || {}).forEach(function(issueKey) {
            var issueInfo = issueMap && issueMap[issueKey] ? issueMap[issueKey] : { key: issueKey, summary: "" };
            var devStatus = issueDevStatusMap[issueKey] || {};

            (devStatus.detail || []).forEach(function(detail) {
                var detailRepo = {
                    name: detail.name || "(unknown)",
                    url: detail.url || "",
                    pullRequests: getPullRequests(detail)
                };

                extractPullRequestEvents(state, issueKey, issueInfo, detailRepo, detailRepo.pullRequests);
                extractUnknownEvents(state, issueKey, issueInfo, detail, detailRepo.name, detailRepo.url);

                (detail.repositories || []).forEach(function(repo) {
                    extractCommitEvents(state, issueKey, issueInfo, repo || {});
                    extractPullRequestEvents(state, issueKey, issueInfo, repo || {}, getPullRequests(repo));
                    extractBranchEvents(state, issueKey, issueInfo, repo || {});
                    extractRepositoryEvents(state, issueKey, issueInfo, repo || {});
                    extractUnknownEvents(
                        state,
                        issueKey,
                        issueInfo,
                        repo,
                        repo && (repo.name || repo.slug || "(unknown)"),
                        repo && repo.url || ""
                    );
                });
            });
        });

        state.items.sort(function(a, b) {
            return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        });

        state.stats.totalRepositories = Object.keys(state.repoMap).length;
        state.stats.activeRepoDays = Object.keys(state.dayMap).length;
        state.stats.totalBranchesTouched = Object.keys(state.repoMap).reduce(function(total, repoName) {
            return total + state.repoMap[repoName].branches.length;
        }, 0);

        return {
            items: state.items,
            dayMap: state.dayMap,
            repoMap: state.repoMap,
            stats: state.stats
        };
    }

    return {
        processRepoActivity: processRepoActivity
    };
});
