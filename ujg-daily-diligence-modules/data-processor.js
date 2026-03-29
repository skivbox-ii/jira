define("_ujgDD_dataProcessor", ["_ujgDD_utils"], function(utils) {
    "use strict";

    function pad2(n) {
        return n < 10 ? "0" + n : "" + n;
    }

    function dayFromIsoString(iso) {
        if (!iso) return "";
        var m = String(iso).match(/^(\d{4}-\d{2}-\d{2})/);
        if (m) return m[1];
        var d = new Date(iso);
        return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
    }

    function parseDate(v) {
        if (!v) return null;
        if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
        var d = new Date(v);
        return isNaN(d.getTime()) ? null : d;
    }

    function hhmmUtc(d) {
        if (!d) return "";
        return pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes());
    }

    function dayUtcMs(ms) {
        return new Date(ms).toISOString().slice(0, 10);
    }

    function buildKeySet(keys) {
        var set = {};
        (keys || []).forEach(function(k) {
            if (k) set[String(k)] = true;
        });
        return set;
    }

    function unwrapUser(p) {
        return p && p.user ? p.user : p;
    }

    function personFieldValues(person) {
        var u = unwrapUser(person);
        if (!u) return [];
        var f = [u.accountId, u.key, u.slug, u.name, u.id, u.emailAddress, u.displayName];
        var out = [];
        var i;
        for (i = 0; i < f.length; i++) {
            if (f[i] != null && f[i] !== "") out.push(String(f[i]));
        }
        return out;
    }

    function matchesTeamKey(person, key) {
        var vals = personFieldValues(person);
        var k = String(key);
        var i;
        for (i = 0; i < vals.length; i++) {
            if (vals[i] === k) return true;
        }
        return false;
    }

    function resolvePersonTeamKey(person, userKeys) {
        var i;
        for (i = 0; i < userKeys.length; i++) {
            if (matchesTeamKey(person, userKeys[i])) return userKeys[i];
        }
        var vals = personFieldValues(person);
        return vals[0] || "";
    }

    function worklogIsLate(w, workedDate) {
        var created = w.created;
        if (!created) return false;
        var worked = workedDate;
        var logDay = dayFromIsoString(created);
        var dc = parseDate(created);
        if (dc) {
            if (dc.getUTCHours() >= 20) return true;
        }
        if (logDay && worked && logDay > worked) return true;
        return false;
    }

    function collectCommentText(value, out) {
        var i;
        if (value == null) return;
        if (typeof value === "string") {
            if (value) out.push(value);
            return;
        }
        if (Array.isArray(value)) {
            for (i = 0; i < value.length; i++) {
                collectCommentText(value[i], out);
            }
            return;
        }
        if (typeof value !== "object") return;
        if (typeof value.text === "string" && value.text) {
            out.push(value.text);
        }
        if (Array.isArray(value.content)) {
            collectCommentText(value.content, out);
        }
    }

    function normalizeWorklogComment(comment) {
        var parts;
        var text;
        if (comment == null) return undefined;
        if (typeof comment === "string") return comment;
        parts = [];
        collectCommentText(comment, parts);
        text = parts.join(" ").replace(/\s+/g, " ").trim();
        return text || undefined;
    }

    function emptyDay(date) {
        return {
            date: date,
            worklogs: [],
            changes: [],
            commits: [],
            confluence: [],
            pullRequests: [],
            totalHours: 0,
            issueKeys: [],
            worklogLoggedLate: false,
            hasEveningCommit: false,
            jiraActivity: []
        };
    }

    function pushIssueKey(day, key) {
        if (!key || day.issueKeys.indexOf(key) >= 0) return;
        day.issueKeys.push(key);
    }

    function ensureIssue(map, issue, meta) {
        if (!issue || !issue.key || map[issue.key]) return;
        map[issue.key] = meta;
    }

    function issueRow(issue) {
        var f = issue.fields || {};
        var st = f.status || {};
        var it = f.issuetype || {};
        var proj = f.project || {};
        return {
            key: issue.key,
            summary: f.summary != null ? String(f.summary) : "",
            status: st.name != null ? String(st.name) : "",
            type: it.name != null ? String(it.name) : "",
            project: proj.key != null ? String(proj.key) : "",
            projectName: proj.name != null ? String(proj.name) : ""
        };
    }

    function refreshCommitMetrics(day) {
        var list = day.commits;
        var i;
        var t;
        var maxT = "";
        day.hasEveningCommit = false;
        for (i = 0; i < list.length; i++) {
            t = list[i].time || "";
            if (t > maxT) maxT = t;
            var parts = t.split(":");
            var h = parseInt(parts[0], 10);
            if (h >= 17) day.hasEveningCommit = true;
        }
        day.lastCommitTime = maxT || undefined;
    }

    function collectPrActivityRows(pr) {
        var rows = [];
        if (pr.activities && Array.isArray(pr.activities)) {
            pr.activities.forEach(function(a) {
                var t = a.createdDate;
                if (typeof t !== "number") return;
                rows.push({ ts: t, person: a.user || a.author });
            });
        }
        (pr.reviewers || []).forEach(function(r) {
            var t = r.lastReviewedDate;
            if (typeof t !== "number") t = r.lastReviewedTimestamp;
            if (typeof t === "number") rows.push({ ts: t, person: r.user || r });
        });
        rows.sort(function(a, b) {
            return a.ts - b.ts;
        });
        return rows;
    }

    function firstReviewTsForUser(pr, subjectKey, authorKey) {
        var rows = collectPrActivityRows(pr);
        var i;
        var row;
        if (subjectKey === authorKey) {
            for (i = 0; i < rows.length; i++) {
                row = rows[i];
                if (!matchesTeamKey(row.person, authorKey)) return row.ts;
            }
            return undefined;
        }
        for (i = 0; i < rows.length; i++) {
            row = rows[i];
            if (matchesTeamKey(row.person, subjectKey)) return row.ts;
        }
        return undefined;
    }

    function prRepoString(pr) {
        var repo = (pr.fromRef && pr.fromRef.repository) || (pr.toRef && pr.toRef.repository) || {};
        var pk = (repo.project && repo.project.key) || "";
        var slug = repo.slug || "";
        return pk && slug ? pk + "/" + slug : slug || pk || "";
    }

    function normalizePrState(pr) {
        var s = pr.state;
        if (s == null && pr.open) s = "OPEN";
        s = String(s || "").toUpperCase();
        if (s === "MERGED") return "merged";
        if (s === "DECLINED") return "declined";
        return "open";
    }

    function prActivityDay(pr, startStr, endStr) {
        var c = typeof pr.createdDate === "number" ? dayUtcMs(pr.createdDate) : "";
        var u = typeof pr.updatedDate === "number" ? dayUtcMs(pr.updatedDate) : "";
        if (c >= startStr && c <= endStr) return c;
        if (u >= startStr && u <= endStr) return u;
        return c || u || "";
    }

    function userTouchesPr(pr, key) {
        if (matchesTeamKey(pr.author, key)) return true;
        var i;
        var reviewers = pr.reviewers || [];
        for (i = 0; i < reviewers.length; i++) {
            if (matchesTeamKey(reviewers[i], key)) return true;
        }
        var participants = pr.participants || [];
        for (i = 0; i < participants.length; i++) {
            if (matchesTeamKey(participants[i], key)) return true;
        }
        return false;
    }

    function processTeamData(jiraData, bitbucketData, confluenceData, userKeys, startDate, endDate) {
        var keys = (userKeys || []).filter(Boolean).map(String);
        var keySet = buildKeySet(keys);
        var dates = utils.getDatesInRange(startDate, endDate);
        var out = {};
        var ki;
        var di;
        var uk;
        var dayMap;

        for (ki = 0; ki < keys.length; ki++) {
            uk = keys[ki];
            dayMap = {};
            for (di = 0; di < dates.length; di++) {
                dayMap[dates[di]] = emptyDay(dates[di]);
            }
            out[uk] = { userKey: uk, dayMap: dayMap, issueMap: {} };
        }

        var issues = (jiraData && jiraData.issues) || [];
        var ii;
        var issue;
        var meta;
        var wls;
        var wi;
        var w;
        var uid;
        var workedDate;
        var logDate;
        var day;
        var hist;
        var hi;
        var items;
        var ji;
        var it;
        var commits = (bitbucketData && bitbucketData.commits) || [];
        var ci;
        var commit;
        var ts;
        var commitDay;
        var cuid;
        var prs = (bitbucketData && bitbucketData.pullRequests) || [];
        var pi;
        var pr;
        var prDay;
        var authorKey;
        var createdMs;
        var reviewTs;
        var entry;
        var rows;
        var ri;
        var chHist;
        var profileEvents;
        var pei;
        var profEvt;
        var seenJiraActivity;
        var dedupeKey;
        var cj;
        var skipTransitionDup;
        var profDay;
        var profEt;

        for (ii = 0; ii < issues.length; ii++) {
            issue = issues[ii];
            meta = issueRow(issue);
            wls = (issue.fields && issue.fields.worklog && issue.fields.worklog.worklogs) || [];
            for (wi = 0; wi < wls.length; wi++) {
                w = wls[wi];
                uid = resolvePersonTeamKey(w.author, keys);
                if (!uid || !keySet[uid]) continue;
                workedDate = dayFromIsoString(w.started || "");
                if (!workedDate || !out[uid] || !out[uid].dayMap[workedDate]) continue;
                day = out[uid].dayMap[workedDate];
                logDate = parseDate(w.created || w.started);
                ensureIssue(out[uid].issueMap, issue, meta);
                day.worklogs.push({
                    issueKey: issue.key,
                    date: workedDate,
                    timeSpentHours: (Number(w.timeSpentSeconds) || 0) / 3600,
                    comment: normalizeWorklogComment(w.comment),
                    loggedAt: hhmmUtc(logDate),
                    workedDate: workedDate
                });
                day.totalHours += (Number(w.timeSpentSeconds) || 0) / 3600;
                if (worklogIsLate(w, workedDate)) day.worklogLoggedLate = true;
                pushIssueKey(day, issue.key);
            }

            hist = (issue.changelog && issue.changelog.histories) || [];
            for (hi = 0; hi < hist.length; hi++) {
                chHist = hist[hi];
                uid = resolvePersonTeamKey(chHist.author, keys);
                if (!uid || !keySet[uid]) continue;
                var chDayKey = dayFromIsoString(chHist.created || "");
                if (!chDayKey || !out[uid] || !out[uid].dayMap[chDayKey]) continue;
                day = out[uid].dayMap[chDayKey];
                items = chHist.items || [];
                ensureIssue(out[uid].issueMap, issue, meta);
                for (ji = 0; ji < items.length; ji++) {
                    it = items[ji];
                    if (it.field !== "status") continue;
                    day.changes.push({
                        issueKey: issue.key,
                        date: chDayKey,
                        field: "status",
                        fromString: it.fromString != null ? it.fromString : null,
                        toString: it.toString != null ? it.toString : null
                    });
                    pushIssueKey(day, issue.key);
                }
            }
        }

        profileEvents = (jiraData && jiraData.profileEvents) || [];
        seenJiraActivity = {};
        for (pei = 0; pei < profileEvents.length; pei++) {
            profEvt = profileEvents[pei];
            uid = profEvt && profEvt.userKey;
            if (!uid || !keySet[uid]) continue;
            profDay = profEvt && profEvt.date;
            if (!profDay || !out[uid] || !out[uid].dayMap[profDay]) continue;
            day = out[uid].dayMap[profDay];
            profEt = String((profEvt && profEvt.eventType) || "").toLowerCase();
            if (profEt === "worklogged" || profEt === "worklog") continue;
            if (profEt === "transitioned") {
                skipTransitionDup = false;
                for (cj = 0; cj < day.changes.length; cj++) {
                    if (day.changes[cj].issueKey === profEvt.issueKey && day.changes[cj].field === "status") {
                        skipTransitionDup = true;
                        break;
                    }
                }
                if (skipTransitionDup) continue;
            }
            dedupeKey = [uid, profDay, profEvt.issueKey || "", profEvt.eventType || "", profEvt.rawTitle || ""].join("|");
            if (seenJiraActivity[dedupeKey]) continue;
            seenJiraActivity[dedupeKey] = true;
            if (profEvt.issueKey && !out[uid].issueMap[profEvt.issueKey]) {
                out[uid].issueMap[profEvt.issueKey] = {
                    key: profEvt.issueKey,
                    summary: profEvt.issueSummary != null ? String(profEvt.issueSummary) : "",
                    status: "",
                    type: "",
                    project: "",
                    projectName: ""
                };
            }
            day.jiraActivity.push({
                date: profDay,
                time: profEvt.time != null ? String(profEvt.time) : "",
                issueKey: profEvt.issueKey != null ? String(profEvt.issueKey) : "",
                eventType: profEvt.eventType != null ? String(profEvt.eventType) : "other",
                text: profEvt.text != null ? String(profEvt.text) : "",
                rawTitle: profEvt.rawTitle != null ? String(profEvt.rawTitle) : ""
            });
            if (profEvt.issueKey) pushIssueKey(day, profEvt.issueKey);
        }

        for (ci = 0; ci < commits.length; ci++) {
            commit = commits[ci];
            cuid = "";
            for (ki = 0; ki < keys.length; ki++) {
                if (matchesTeamKey(commit.author, keys[ki])) {
                    cuid = keys[ki];
                    break;
                }
            }
            if (!cuid) continue;
            ts = commit.authorTimestamp;
            if (typeof ts !== "number") ts = commit.committerTimestamp;
            if (typeof ts !== "number") continue;
            commitDay = dayUtcMs(ts);
            if (!out[cuid] || !out[cuid].dayMap[commitDay]) continue;
            day = out[cuid].dayMap[commitDay];
            var add = 0;
            var rem = 0;
            if (commit.linesAdded != null) add = Number(commit.linesAdded) || 0;
            if (commit.linesRemoved != null) rem = Number(commit.linesRemoved) || 0;
            day.commits.push({
                date: commitDay,
                repo: (commit._ujgProjectKey && commit._ujgRepoSlug
                    ? commit._ujgProjectKey + "/" + commit._ujgRepoSlug
                    : ""),
                message: commit.message != null ? String(commit.message) : "",
                linesAdded: add,
                linesRemoved: rem,
                time: hhmmUtc(new Date(ts))
            });
            refreshCommitMetrics(day);
        }

        rows = confluenceData || [];
        for (ri = 0; ri < rows.length; ri++) {
            var row = rows[ri];
            if (!row || !row.userKey || !keySet[row.userKey]) continue;
            var cd = row.date;
            if (!cd || !out[row.userKey].dayMap[cd]) continue;
            out[row.userKey].dayMap[cd].confluence.push({
                date: cd,
                pageTitle: row.pageTitle != null ? String(row.pageTitle) : "",
                space: row.space != null ? String(row.space) : "",
                action: row.action
            });
        }

        for (pi = 0; pi < prs.length; pi++) {
            pr = prs[pi];
            authorKey = resolvePersonTeamKey(pr.author, keys);
            prDay = prActivityDay(pr, dates[0], dates[dates.length - 1]);
            if (!prDay || dates.indexOf(prDay) < 0) continue;
            createdMs = typeof pr.createdDate === "number" ? pr.createdDate : undefined;

            for (ki = 0; ki < keys.length; ki++) {
                uk = keys[ki];
                if (!userTouchesPr(pr, uk)) continue;
                day = out[uk].dayMap[prDay];
                if (!day) continue;
                reviewTs = firstReviewTsForUser(pr, uk, authorKey);
                entry = {
                    date: prDay,
                    repo: prRepoString(pr),
                    title: pr.title != null ? String(pr.title) : "",
                    author: authorKey,
                    state: normalizePrState(pr),
                    createdAt: createdMs != null ? new Date(createdMs).toISOString() : ""
                };
                if (reviewTs != null && createdMs != null) {
                    entry.firstReviewAt = new Date(reviewTs).toISOString();
                    entry.reactionMinutes = Math.round((reviewTs - createdMs) / 60000);
                }
                day.pullRequests.push(entry);
            }
        }

        return out;
    }

    return {
        processTeamData: processTeamData
    };
});
