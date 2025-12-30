/**
 * UJG Project Analytics Dashboard — Глубинная аналитика проекта
 * MVP по ujg-project-analytics-spec.md
 *
 * Модуль в стиле остальных UJG виджетов (AMD + jQuery).
 */
define("_ujgProjectAnalytics", ["jquery", "_ujgCommon"], function($, Common) {
  "use strict";

  var baseUrl = Common && Common.baseUrl ? Common.baseUrl : ((typeof AJS !== "undefined" && AJS.contextPath) ? AJS.contextPath() : "");
  var U = (Common && Common.utils) ? Common.utils : {
    parseDate: function(v) { var d = v ? new Date(v) : null; return d && !isNaN(d.getTime()) ? d : null; },
    escapeHtml: function(t) { if (!t) return ""; var d = document.createElement("div"); d.textContent = String(t); return d.innerHTML; },
    getDayKey: function(d) { if (!d || !(d instanceof Date) || isNaN(d.getTime())) return ""; var yyyy = d.getFullYear(); var mm = d.getMonth() + 1; var dd = d.getDate(); return yyyy + "-" + (mm < 10 ? "0" : "") + mm + "-" + (dd < 10 ? "0" : "") + dd; }
  };

  var CONFIG = {
    MAX_PERIOD_DAYS: 365,
    DEFAULT_PERIOD_DAYS: 30,
    version: "1.0.0",
    debug: true
  };

  var STORAGE_KEY = "ujg_project_analytics";

  var DEFAULT_THRESHOLDS = {
    ageRisk: 30,
    noProgressRisk: 7,
    longReviewRisk: 5,
    longTestingRisk: 3,
    prIterationsRisk: 3,
    wipLimit: 5,
    sprintChangesRisk: 2,
    assigneeChangesRisk: 3
  };

  var DEFAULT_RISK_WEIGHTS = {
    age: 30,
    sprintChanges: 20,
    assigneeChanges: 15,
    noProgress: 25,
    reopens: 20,
    longReview: 15,
    longTesting: 15,
    prIterations: 20
  };

  var STATUS_CATEGORIES = {
    queue: { name: "Очередь", icon: "📥", description: "Задача ждёт начала работы", color: "#e0e0e0" },
    work: { name: "В работе", icon: "📋", description: "Активная разработка", color: "#4a90d9" },
    review: { name: "Ревью", icon: "🔍", description: "Code Review, проверка", color: "#f5a623" },
    testing: { name: "Тестирование", icon: "🧪", description: "QA, тестирование", color: "#7ed321" },
    waiting: { name: "Ожидание", icon: "⏸️", description: "Blocked, On Hold", color: "#d0021b" },
    done: { name: "Завершено", icon: "✅", description: "Закрыто, готово", color: "#417505" }
  };

  var STATUS_PATTERNS = {
    queue: [/to\s*do/i, /backlog/i, /open/i, /new/i, /создан/i, /открыт/i, /очередь/i],
    work: [/in\s*progress/i, /progress/i, /develop/i, /в\s*работе/i, /разработка/i, /working/i],
    review: [/review/i, /ревью/i, /проверк/i, /code\s*review/i],
    testing: [/test/i, /qa/i, /тест/i, /quality/i, /验证/],
    waiting: [/block/i, /hold/i, /wait/i, /pending/i, /ожидан/i, /заблок/i],
    done: [/done/i, /close/i, /resolve/i, /complete/i, /готово/i, /закрыт/i, /выполнен/i, /завершен/i]
  };

  function autoSuggestCategory(statusName) {
    for (var category in STATUS_PATTERNS) {
      if (!Object.prototype.hasOwnProperty.call(STATUS_PATTERNS, category)) continue;
      for (var i = 0; i < STATUS_PATTERNS[category].length; i++) {
        if (STATUS_PATTERNS[category][i].test(statusName)) return category;
      }
    }
    return null;
  }

  function log() {
    if (!CONFIG.debug || typeof console === "undefined") return;
    try { console.log.apply(console, ["[UJG-PA]"].concat([].slice.call(arguments))); } catch (e) {}
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function msDay() { return 24 * 60 * 60 * 1000; }

  function startOfDay(d) { if (!d) return null; var nd = new Date(d); nd.setHours(0, 0, 0, 0); return nd; }
  function endOfDay(d) { if (!d) return null; var nd = new Date(d); nd.setHours(23, 59, 59, 999); return nd; }

  function diffDays(a, b) {
    if (!a || !b) return null;
    var ms = b.getTime() - a.getTime();
    return ms / msDay();
  }

  function fmtDays(v) {
    if (v == null || !isFinite(v)) return "—";
    var d = Math.round(v * 10) / 10;
    return d + " д";
  }

  function fmtPct(v) {
    if (v == null || !isFinite(v)) return "—";
    return Math.round(v) + "%";
  }

  function toISO(d) {
    try { return d.toISOString().slice(0, 10); } catch (e) { return ""; }
  }

  function loadSettings() {
    try {
      var s = localStorage.getItem(STORAGE_KEY);
      return s ? JSON.parse(s) : {};
    } catch (e) { return {}; }
  }

  function saveSettings(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s || {})); } catch (e) {}
  }

  function mergeDefaults(settings) {
    var out = settings || {};
    out.thresholds = $.extend({}, DEFAULT_THRESHOLDS, out.thresholds || {});
    out.riskWeights = $.extend({}, DEFAULT_RISK_WEIGHTS, out.riskWeights || {});
    out.customFields = $.extend({
      storyPoints: null,
      epicLink: null,
      sprint: null,
      components: true,
      labels: true
    }, out.customFields || {});
    return out;
  }

  function getDefaultPeriod() {
    var now = startOfDay(new Date());
    var end = now;
    var start = new Date(now);
    start.setDate(start.getDate() - (CONFIG.DEFAULT_PERIOD_DAYS - 1));
    return { start: toISO(start), end: toISO(end) };
  }

  function parseProjectKeyFromJql(jql) {
    if (!jql) return null;
    var m = jql.match(/\bproject\s*=\s*([A-Z][A-Z0-9_]+)\b/i);
    if (m && m[1]) return String(m[1]).toUpperCase();
    var m2 = jql.match(/\bproject\s+in\s*\(\s*([^)]+)\)/i);
    if (m2 && m2[1]) {
      var first = m2[1].split(",")[0].trim().replace(/^["']|["']$/g, "");
      if (first) return String(first).toUpperCase();
    }
    return null;
  }

  function wfStorageKey(projectKey) {
    return "ujg_pa_workflow_" + (projectKey || "default");
  }

  function loadWorkflow(projectKey) {
    try {
      var s = localStorage.getItem(wfStorageKey(projectKey));
      return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
  }

  function saveWorkflow(projectKey, cfg) {
    try { localStorage.setItem(wfStorageKey(projectKey), JSON.stringify(cfg || {})); } catch (e) {}
  }

  function normalizeWorkflow(cfg, allStatuses) {
    var c = cfg || {};
    c.projectKey = c.projectKey || "";
    c.lastUpdated = new Date().toISOString();
    c.allStatuses = allStatuses ? allStatuses.slice().sort() : (c.allStatuses || []);
    c.statusCategories = c.statusCategories || {};
    c.categoryStatuses = {};

    Object.keys(STATUS_CATEGORIES).forEach(function(cat) { c.categoryStatuses[cat] = []; });
    Object.keys(c.statusCategories).forEach(function(st) {
      var cats = c.statusCategories[st] || [];
      cats.forEach(function(cat) {
        if (!c.categoryStatuses[cat]) c.categoryStatuses[cat] = [];
        if (c.categoryStatuses[cat].indexOf(st) < 0) c.categoryStatuses[cat].push(st);
      });
    });
    Object.keys(c.categoryStatuses).forEach(function(cat) { c.categoryStatuses[cat].sort(); });

    // миграция: новые статусы
    if (allStatuses && allStatuses.length) {
      allStatuses.forEach(function(st) {
        if (!Object.prototype.hasOwnProperty.call(c.statusCategories, st)) {
          var sug = autoSuggestCategory(st);
          if (sug) c.statusCategories[st] = [sug];
        }
      });
      // пересоберём индекс
      c.categoryStatuses = {};
      Object.keys(STATUS_CATEGORIES).forEach(function(cat) { c.categoryStatuses[cat] = []; });
      Object.keys(c.statusCategories).forEach(function(st2) {
        (c.statusCategories[st2] || []).forEach(function(cat2) {
          if (!c.categoryStatuses[cat2]) c.categoryStatuses[cat2] = [];
          if (c.categoryStatuses[cat2].indexOf(st2) < 0) c.categoryStatuses[cat2].push(st2);
        });
      });
      Object.keys(c.categoryStatuses).forEach(function(cat3) { c.categoryStatuses[cat3].sort(); });
    }

    return c;
  }

  // ---------------- API tracker + safe ajax ----------------
  function createApiTracker() {
    return {
      endpoints: {
        search: { calls: 0, done: 0, errors: 0, totalMs: 0 },
        changelog: { calls: 0, done: 0, errors: 0, totalMs: 0 },
        worklog: { calls: 0, done: 0, errors: 0, totalMs: 0 },
        "dev-status": { calls: 0, done: 0, errors: 0, totalMs: 0 },
        field: { calls: 0, done: 0, errors: 0, totalMs: 0 }
      },
      issues: { total: 0, processed: 0 },
      startTime: null,
      expectedCalls: 0,
      track: function(endpoint, ok, ms) {
        if (!this.endpoints[endpoint]) this.endpoints[endpoint] = { calls: 0, done: 0, errors: 0, totalMs: 0 };
        var e = this.endpoints[endpoint];
        e.calls++;
        if (ok) e.done++; else e.errors++;
        e.totalMs += ms || 0;
      },
      getAvgMs: function(endpoint) {
        var e = this.endpoints[endpoint];
        if (!e || e.done <= 0) return null;
        return Math.round(e.totalMs / e.done);
      },
      getElapsedSec: function() {
        if (!this.startTime) return 0;
        return Math.round((Date.now() - this.startTime) / 1000);
      },
      getProgress: function() {
        var done = 0;
        var expected = this.expectedCalls || 0;
        Object.keys(this.endpoints).forEach(function(k) {
          var e = this.endpoints[k];
          done += (e.done + e.errors);
        }, this);
        if (expected <= 0) {
          // фоллбек: по обработанным задачам
          if (this.issues.total > 0) return Math.round((this.issues.processed / this.issues.total) * 100);
          return 0;
        }
        return Math.min(100, Math.round((done / expected) * 100));
      },
      getETA: function() {
        var p = this.getProgress();
        if (!p || p <= 0) return null;
        var elapsed = this.getElapsedSec();
        var total = Math.round((elapsed / p) * 100);
        return Math.max(0, total - elapsed);
      }
    };
  }

  function apiReq(state, tracker, endpointName, ajaxOpts) {
    var t0 = Date.now();
    var xhr = $.ajax(ajaxOpts);
    if (state && state._activeXhrs) state._activeXhrs.push(xhr);
    return xhr.then(function(res) {
      tracker.track(endpointName, true, Date.now() - t0);
      return res;
    }, function(err) {
      tracker.track(endpointName, false, Date.now() - t0);
      return $.Deferred().reject(err).promise();
    });
  }

  function abortAll(state) {
    state._abort = true;
    var list = state._activeXhrs || [];
    list.forEach(function(x) { try { if (x && x.abort) x.abort(); } catch (e) {} });
    state._activeXhrs = [];
  }

  // ---------------- Jira API calls ----------------
  function jiraGetFields(state, tracker) {
    return apiReq(state, tracker, "field", { url: baseUrl + "/rest/api/2/field", type: "GET" });
  }

  function jiraSearch(state, tracker, payload) {
    return apiReq(state, tracker, "search", {
      url: baseUrl + "/rest/api/2/search",
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify(payload)
    });
  }

  function jiraIssueWorklog(state, tracker, key) {
    return apiReq(state, tracker, "worklog", {
      url: baseUrl + "/rest/api/2/issue/" + encodeURIComponent(key) + "/worklog",
      type: "GET",
      data: { maxResults: 1000, startAt: 0 }
    });
  }

  function jiraDevStatus(state, tracker, issueId) {
    return apiReq(state, tracker, "dev-status", {
      url: baseUrl + "/rest/dev-status/1.0/issue/detail",
      type: "GET",
      data: { issueId: issueId, applicationType: "stash", dataType: "repository" }
    });
  }

  // ---------------- Data parsing + analytics ----------------
  function detectCustomFields(fields) {
    var detected = {};
    (fields || []).forEach(function(field) {
      var name = (field && field.name ? field.name : "").toLowerCase();
      var id = field && field.id;
      if (!id) return;
      if (name.indexOf("story point") >= 0 || name.indexOf("стори поинт") >= 0) detected.storyPoints = id;
      if (name.indexOf("epic link") >= 0 || name.indexOf("эпик") >= 0) detected.epicLink = id;
      if (name.indexOf("sprint") >= 0 || name.indexOf("спринт") >= 0) detected.sprint = id;
    });
    return detected;
  }

  function parseSprintNames(val) {
    if (!val) return [];
    if (!Array.isArray(val)) return [];
    return val.map(function(s) {
      if (!s) return "";
      if (typeof s === "string") {
        var m = s.match(/name=([^,}]+)/);
        return m ? m[1] : s;
      }
      if (s.name) return s.name;
      return String(s);
    }).filter(Boolean);
  }

  function collectAllStatuses(issues) {
    var set = {};
    (issues || []).forEach(function(iss) {
      var st = iss && iss.fields && iss.fields.status && iss.fields.status.name;
      if (st) set[st] = true;
      var histories = iss && iss.changelog && iss.changelog.histories;
      (histories || []).forEach(function(h) {
        (h.items || []).forEach(function(it) {
          if (it.field === "status") {
            if (it.fromString) set[it.fromString] = true;
            if (it.toString) set[it.toString] = true;
          }
        });
      });
    });
    return Object.keys(set).sort();
  }

  function parseChangelog(issue) {
    var res = {
      statusChanges: [],
      assigneeChanges: [],
      sprintChanges: [],
      priorityChanges: [],
      fixVersionChanges: [],
      resolutionChanges: []
    };
    var histories = issue && issue.changelog && issue.changelog.histories ? issue.changelog.histories : [];
    histories.forEach(function(h) {
      var at = U.parseDate(h.created);
      var by = (h.author && (h.author.displayName || h.author.name || h.author.key)) || "";
      (h.items || []).forEach(function(it) {
        var field = it.field;
        if (field === "status") {
          res.statusChanges.push({ from: it.fromString || "", to: it.toString || "", by: by, at: at });
        } else if (field === "assignee") {
          res.assigneeChanges.push({ from: it.fromString || "", to: it.toString || "", by: by, at: at });
        } else if (field === "Sprint") {
          res.sprintChanges.push({ from: it.fromString || "", to: it.toString || "", by: by, at: at });
        } else if (field === "priority") {
          res.priorityChanges.push({ from: it.fromString || "", to: it.toString || "", by: by, at: at });
        } else if (field === "Fix Version" || field === "fixVersions") {
          res.fixVersionChanges.push({ from: it.fromString || "", to: it.toString || "", by: by, at: at });
        } else if (field === "resolution") {
          res.resolutionChanges.push({ from: it.fromString || "", to: it.toString || "", by: by, at: at });
        }
      });
    });
    // sort by time
    Object.keys(res).forEach(function(k) {
      res[k].sort(function(a, b) { return (a.at ? a.at.getTime() : 0) - (b.at ? b.at.getTime() : 0); });
    });
    return res;
  }

  function categoriesForStatus(wf, statusName) {
    if (!wf || !wf.statusCategories) return [];
    return wf.statusCategories[statusName] || [];
  }

  function firstTransitionToCategory(changes, wf, cat) {
    if (!changes || !changes.length) return null;
    var sts = (wf && wf.categoryStatuses && wf.categoryStatuses[cat]) ? wf.categoryStatuses[cat] : [];
    if (!sts || !sts.length) return null;
    for (var i = 0; i < changes.length; i++) {
      if (sts.indexOf(changes[i].to) >= 0) return changes[i].at;
    }
    return null;
  }

  function detectReopen(changes, wf) {
    var doneSt = (wf && wf.categoryStatuses && wf.categoryStatuses.done) ? wf.categoryStatuses.done : [];
    if (!doneSt || !doneSt.length) return { wasDone: false, reopens: 0 };
    var workSt = (wf && wf.categoryStatuses && wf.categoryStatuses.work) ? wf.categoryStatuses.work : [];
    var wasDone = false;
    var reopens = 0;
    (changes || []).forEach(function(ch) {
      if (!ch) return;
      if (doneSt.indexOf(ch.from) >= 0 && doneSt.indexOf(ch.to) < 0) {
        // из done в не-done
        reopens++;
      }
      if (doneSt.indexOf(ch.to) >= 0) wasDone = true;
      // workSt тут не обязателен — но оставим совместимость со спекой
      if (doneSt.indexOf(ch.from) >= 0 && workSt.length && workSt.indexOf(ch.to) >= 0) {
        // уже посчитано выше, отдельно не дублируем
      }
    });
    return { wasDone: wasDone, reopens: reopens };
  }

  function buildStatusTimeline(issue, parsed, periodStart, periodEnd) {
    // timeline по статусам: от created до (periodEnd) либо updated (если меньше)
    var created = U.parseDate(issue && issue.fields && issue.fields.created);
    var updated = U.parseDate(issue && issue.fields && issue.fields.updated);
    // Важно: если задача не обновлялась внутри периода, всё равно считаем время в текущем статусе до конца периода.
    var end = periodEnd ? new Date(periodEnd) : new Date();
    var start = periodStart ? new Date(periodStart) : created;
    if (!created) return [];

    var changes = (parsed && parsed.statusChanges) ? parsed.statusChanges.slice() : [];
    changes.sort(function(a, b) { return (a.at ? a.at.getTime() : 0) - (b.at ? b.at.getTime() : 0); });

    var segs = [];
    // начальный статус (берём текущий и откатываемся по истории, если есть)
    var curStatus = (issue && issue.fields && issue.fields.status && issue.fields.status.name) || "";
    if (changes.length) curStatus = changes[0].from || curStatus;
    var curStart = created;
    for (var i = 0; i < changes.length; i++) {
      var ch = changes[i];
      if (!ch.at) continue;
      segs.push({ status: curStatus, from: curStart, to: ch.at });
      curStatus = ch.to || curStatus;
      curStart = ch.at;
    }
    segs.push({ status: curStatus, from: curStart, to: end });

    // trim to [start,end] for aggregation
    var out = [];
    segs.forEach(function(s) {
      var a = s.from, b = s.to;
      if (!a || !b) return;
      var aa = a.getTime(), bb = b.getTime();
      var ps = start ? start.getTime() : aa;
      var pe = end ? end.getTime() : bb;
      var from = new Date(Math.max(aa, ps));
      var to = new Date(Math.min(bb, pe));
      if (to.getTime() <= from.getTime()) return;
      out.push({ status: s.status, from: from, to: to });
    });
    return out;
  }

  function aggregateTimeInStatuses(timeline, wf) {
    var byStatus = {};
    timeline.forEach(function(seg) {
      var st = seg.status || "(без статуса)";
      var days = diffDays(seg.from, seg.to);
      if (!byStatus[st]) byStatus[st] = { totalDays: 0, category: null };
      byStatus[st].totalDays += days;
      var cats = categoriesForStatus(wf, st);
      byStatus[st].category = cats && cats.length ? cats[0] : null;
    });
    // categories
    var byCat = {};
    Object.keys(byStatus).forEach(function(st) {
      var cat = byStatus[st].category;
      if (!cat) return;
      if (!byCat[cat]) byCat[cat] = 0;
      byCat[cat] += byStatus[st].totalDays;
    });
    return { byStatus: byStatus, byCategory: byCat };
  }

  function activityInPeriod(parsed, periodStart, periodEnd) {
    var ps = periodStart ? periodStart.getTime() : null;
    var pe = periodEnd ? periodEnd.getTime() : null;

    function inRange(d) {
      if (!d) return false;
      var t = d.getTime();
      if (ps != null && t < ps) return false;
      if (pe != null && t > pe) return false;
      return true;
    }

    var status = (parsed.statusChanges || []).filter(function(x) { return inRange(x.at); });
    var asg = (parsed.assigneeChanges || []).filter(function(x) { return inRange(x.at); });
    var spr = (parsed.sprintChanges || []).filter(function(x) { return inRange(x.at); });
    var prio = (parsed.priorityChanges || []).filter(function(x) { return inRange(x.at); });
    var fix = (parsed.fixVersionChanges || []).filter(function(x) { return inRange(x.at); });
    var res = (parsed.resolutionChanges || []).filter(function(x) { return inRange(x.at); });
    var reopen = detectReopen(parsed.statusChanges || [], null); // wf применяется снаружи при необходимости

    return {
      statusChanges: status,
      assigneeChanges: asg,
      sprintChanges: spr,
      priorityChanges: prio,
      fixVersionChanges: fix,
      resolutionChanges: res,
      totalChanges: status.length + asg.length + spr.length + prio.length + fix.length + res.length,
      reopens: reopen.reopens
    };
  }

  function computeIssueMetrics(issue, parsed, wf, settings, periodStart, periodEnd) {
    var created = U.parseDate(issue && issue.fields && issue.fields.created);
    var updated = U.parseDate(issue && issue.fields && issue.fields.updated);
    var resolved = U.parseDate(issue && issue.fields && (issue.fields.resolutiondate || issue.fields.resolved));
    var now = new Date();

    var ps = periodStart || startOfDay(created) || startOfDay(now);
    var pe = periodEnd || endOfDay(now);

    var tl = buildStatusTimeline(issue, parsed, ps, pe);
    var tAgg = aggregateTimeInStatuses(tl, wf);

    var doneAt = firstTransitionToCategory(parsed.statusChanges || [], wf, "done");
    var workAt = firstTransitionToCategory(parsed.statusChanges || [], wf, "work");
    var leadEnd = doneAt || resolved || updated || now;
    var lead = (created && leadEnd) ? diffDays(created, leadEnd) : null;
    var cycle = (workAt && doneAt) ? diffDays(workAt, doneAt) : null;
    var wait = (lead != null && cycle != null) ? Math.max(0, lead - cycle) : null;

    var re = detectReopen(parsed.statusChanges || [], wf);
    var pingpong = 0;
    // review ↔ work, считаем review->work возвраты
    var reviewSt = (wf && wf.categoryStatuses && wf.categoryStatuses.review) ? wf.categoryStatuses.review : [];
    var workSt = (wf && wf.categoryStatuses && wf.categoryStatuses.work) ? wf.categoryStatuses.work : [];
    if (reviewSt.length && workSt.length) {
      (parsed.statusChanges || []).forEach(function(ch) {
        if (reviewSt.indexOf(ch.from) >= 0 && workSt.indexOf(ch.to) >= 0) pingpong++;
      });
    }

    // noProgress: последний change/status update vs now/periodEnd
    var lastAct = updated || created || now;
    (parsed.statusChanges || []).forEach(function(ch) { if (ch.at && ch.at > lastAct) lastAct = ch.at; });
    (parsed.assigneeChanges || []).forEach(function(ch2) { if (ch2.at && ch2.at > lastAct) lastAct = ch2.at; });
    (parsed.sprintChanges || []).forEach(function(ch3) { if (ch3.at && ch3.at > lastAct) lastAct = ch3.at; });

    var thresholds = (settings && settings.thresholds) ? settings.thresholds : DEFAULT_THRESHOLDS;
    var weights = (settings && settings.riskWeights) ? settings.riskWeights : DEFAULT_RISK_WEIGHTS;

    var riskScore = 0;
    var riskFactors = [];

    function addRisk(type, score, message) {
      if (score <= 0) return;
      riskScore += score;
      riskFactors.push({ type: type, score: score, message: message });
    }

    // age risk (если не done)
    var isDoneNow = false;
    var curStatus = (issue && issue.fields && issue.fields.status && issue.fields.status.name) || "";
    var doneSts = (wf && wf.categoryStatuses && wf.categoryStatuses.done) ? wf.categoryStatuses.done : [];
    if (doneSts.length && doneSts.indexOf(curStatus) >= 0) isDoneNow = true;

    var ageDays = (created ? diffDays(created, pe || now) : null);
    if (!isDoneNow && ageDays != null && thresholds.ageRisk && ageDays > thresholds.ageRisk) {
      addRisk("age", weights.age || 0, "Задача создана " + Math.round(ageDays) + " дней назад, не закрыта");
    }

    // sprint changes
    var sprintChCnt = (parsed.sprintChanges || []).length;
    if (thresholds.sprintChangesRisk != null && sprintChCnt > thresholds.sprintChangesRisk) {
      addRisk("sprint_changes", weights.sprintChanges || 0, "Переносилась " + sprintChCnt + " раз(а) между спринтами");
    }

    // assignee changes
    var asgChCnt = (parsed.assigneeChanges || []).length;
    if (thresholds.assigneeChangesRisk != null && asgChCnt > thresholds.assigneeChangesRisk) {
      addRisk("assignee_changes", weights.assigneeChanges || 0, "Менялся исполнитель " + asgChCnt + " раз(а)");
    }

    // no progress
    var noProgDays = (lastAct ? diffDays(lastAct, pe || now) : null);
    var waitingSts = (wf && wf.categoryStatuses && wf.categoryStatuses.waiting) ? wf.categoryStatuses.waiting : [];
    var isWaitingNow = waitingSts.length && waitingSts.indexOf(curStatus) >= 0;
    if (!isDoneNow && !isWaitingNow && thresholds.noProgressRisk != null && noProgDays != null && noProgDays > thresholds.noProgressRisk) {
      addRisk("no_progress", weights.noProgress || 0, "Нет активности " + Math.round(noProgDays) + " дней");
    }

    // reopens
    if (re.reopens && re.reopens > 0 && doneSts.length) {
      addRisk("reopens", weights.reopens || 0, "Reopen: " + re.reopens + " раз(а)");
    }

    // long review/testing (если категории настроены)
    if (wf && wf.categoryStatuses && wf.categoryStatuses.review && wf.categoryStatuses.review.length) {
      var reviewDays = tAgg.byCategory.review || 0;
      if (thresholds.longReviewRisk != null && reviewDays > thresholds.longReviewRisk) {
        addRisk("long_review", weights.longReview || 0, "Долгий review: " + fmtDays(reviewDays));
      }
    }
    if (wf && wf.categoryStatuses && wf.categoryStatuses.testing && wf.categoryStatuses.testing.length) {
      var testDays = tAgg.byCategory.testing || 0;
      if (thresholds.longTestingRisk != null && testDays > thresholds.longTestingRisk) {
        addRisk("long_testing", weights.longTesting || 0, "Долгое тестирование: " + fmtDays(testDays));
      }
    }

    // PR iterations proxy: pingpong
    if (thresholds.prIterationsRisk != null && pingpong > thresholds.prIterationsRisk) {
      addRisk("pr_iterations", weights.prIterations || 0, "Много возвратов review→work: " + pingpong);
    }

    riskScore = clamp(riskScore, 0, 100);
    riskFactors.sort(function(a, b) { return b.score - a.score; });

    return {
      leadTime: lead,
      cycleTime: cycle,
      waitTime: wait,
      timeInStatuses: tAgg.byStatus,
      timeInCategories: tAgg.byCategory,
      reopens: re.reopens,
      pingpong: pingpong,
      lastActivityAt: lastAct,
      riskScore: riskScore,
      riskFactors: riskFactors
    };
  }

  function computeAggregated(data) {
    var issues = data.issues || {};
    var keys = Object.keys(issues);
    var total = keys.length;
    var sumLead = 0, cntLead = 0;
    var sumCycle = 0, cntCycle = 0;
    var reopenCnt = 0, wasDoneCnt = 0;
    var closed = 0;

    keys.forEach(function(k) {
      var it = issues[k];
      var m = it.metrics || {};
      if (m.leadTime != null) { sumLead += m.leadTime; cntLead++; }
      if (m.cycleTime != null) { sumCycle += m.cycleTime; cntCycle++; }
      if (m.reopens != null && m.reopens > 0) reopenCnt++;
      if (it._isDone) { closed++; wasDoneCnt++; }
      // если категории done не настроены — _isDone может быть false, но это ок
    });

    var avgLead = cntLead ? (sumLead / cntLead) : null;
    var avgCycle = cntCycle ? (sumCycle / cntCycle) : null;
    var reopenRate = total ? (reopenCnt / total) : null;
    var throughput = null;
    var periodDays = data.period && data.period.start && data.period.end ? diffDays(startOfDay(new Date(data.period.start)), endOfDay(new Date(data.period.end))) + 1 : null;
    if (periodDays && periodDays > 0) throughput = closed / periodDays;

    return {
      totalIssues: total,
      closedIssues: closed,
      avgLeadTime: avgLead,
      avgCycleTime: avgCycle,
      reopenRate: reopenRate,
      throughput: throughput
    };
  }

  function computeBottlenecks(data, wf, settings) {
    var thresholds = settings.thresholds || DEFAULT_THRESHOLDS;
    var issues = data.issues || {};
    var keys = Object.keys(issues);
    var problems = { critical: [], attention: [], unavailable: [], positive: [] };

    function add(level, title, detail, issueKeys) {
      problems[level].push({ title: title, detail: detail || "", keys: issueKeys || [] });
    }

    // unavailable metrics
    if (!wf || !wf.categoryStatuses || !wf.categoryStatuses.work || !wf.categoryStatuses.work.length) {
      add("unavailable", "Cycle Time", "Не настроена категория \"work\"", []);
    }
    if (!wf || !wf.categoryStatuses || !wf.categoryStatuses.review || !wf.categoryStatuses.review.length) {
      add("unavailable", "Review bottleneck", "Не настроена категория \"review\"", []);
    }
    if (!wf || !wf.categoryStatuses || !wf.categoryStatuses.testing || !wf.categoryStatuses.testing.length) {
      add("unavailable", "Testing bottleneck", "Не настроена категория \"testing\"", []);
    }

    // review queue
    if (wf && wf.categoryStatuses && wf.categoryStatuses.review && wf.categoryStatuses.review.length) {
      var stuck = [];
      keys.forEach(function(k) {
        var it = issues[k];
        if (it._isDone) return;
        var reviewDays = it.metrics && it.metrics.timeInCategories ? (it.metrics.timeInCategories.review || 0) : 0;
        if (reviewDays > thresholds.longReviewRisk) stuck.push(k);
      });
      if (stuck.length) add("critical", "Очередь [review]", stuck.length + " задач(и) в review дольше " + thresholds.longReviewRisk + " дн.", stuck.slice(0, 20));
    }

    // bumerangs
    if (wf && wf.categoryStatuses && wf.categoryStatuses.done && wf.categoryStatuses.done.length) {
      var boom = keys.filter(function(k) { return (issues[k].metrics && issues[k].metrics.reopens) ? issues[k].metrics.reopens > 0 : false; });
      if (boom.length) add("critical", "Задачи-бумеранги", boom.length + " задач(и) вернулись из [done]", boom.slice(0, 20));
    }

    // travelers
    var trav = keys.filter(function(k) { return (issues[k].changelog && issues[k].changelog.sprintChanges ? issues[k].changelog.sprintChanges.length : 0) > thresholds.sprintChangesRisk; });
    if (trav.length) add("attention", "Задачи-путешественники", trav.length + " задач(и) сменили спринт >" + thresholds.sprintChangesRisk + " раз(а)", trav.slice(0, 20));

    // abandoned
    var abandoned = [];
    keys.forEach(function(k) {
      var it = issues[k];
      if (it._isDone) return;
      var stName = it.status || "";
      var isWaiting = wf && wf.categoryStatuses && wf.categoryStatuses.waiting && wf.categoryStatuses.waiting.indexOf(stName) >= 0;
      if (isWaiting) return;
      if (!it.assigneeId) return;
      var la = it.metrics && it.metrics.lastActivityAt ? it.metrics.lastActivityAt : null;
      var days = la ? diffDays(la, endOfDay(new Date(data.period.end))) : null;
      if (days != null && days > thresholds.noProgressRisk) abandoned.push(k);
    });
    if (abandoned.length) add("attention", "«Брошенные» задачи", abandoned.length + " задач(и) без активности >" + thresholds.noProgressRisk + " дн.", abandoned.slice(0, 20));

    // WIP overload
    var wipByAssignee = {};
    keys.forEach(function(k) {
      var it = issues[k];
      if (it._isDone) return;
      var st = it.status || "";
      var isWork = false;
      if (wf && wf.categoryStatuses && wf.categoryStatuses.work && wf.categoryStatuses.work.length) {
        isWork = wf.categoryStatuses.work.indexOf(st) >= 0;
      } else {
        // фоллбек: все не-done
        isWork = true;
        if (wf && wf.categoryStatuses && wf.categoryStatuses.done && wf.categoryStatuses.done.length) {
          isWork = wf.categoryStatuses.done.indexOf(st) < 0;
        }
      }
      if (!isWork) return;
      var uid = it.assigneeId || "unassigned";
      if (!wipByAssignee[uid]) wipByAssignee[uid] = { count: 0, keys: [] };
      wipByAssignee[uid].count++;
      if (wipByAssignee[uid].keys.length < 50) wipByAssignee[uid].keys.push(k);
    });
    Object.keys(wipByAssignee).forEach(function(uid) {
      if (wipByAssignee[uid].count > thresholds.wipLimit) {
        add("attention", "Перегруз WIP", (uid === "unassigned" ? "Не назначено" : uid) + ": " + wipByAssignee[uid].count + " задач(и) в [work] (лимит: " + thresholds.wipLimit + ")", wipByAssignee[uid].keys.slice(0, 20));
      }
    });

    return problems;
  }

  function riskDistribution(data) {
    var issues = data.issues || {};
    var keys = Object.keys(issues);
    var bins = { crit: 0, high: 0, mid: 0, low: 0 };
    var top = [];
    keys.forEach(function(k) {
      var r = issues[k].metrics ? issues[k].metrics.riskScore : 0;
      if (r >= 80) bins.crit++;
      else if (r >= 60) bins.high++;
      else if (r >= 40) bins.mid++;
      else bins.low++;
      top.push({ key: k, score: r, summary: issues[k].summary || "", factors: (issues[k].metrics && issues[k].metrics.riskFactors) ? issues[k].metrics.riskFactors : [] });
    });
    top.sort(function(a, b) { return b.score - a.score; });
    return { bins: bins, top: top.slice(0, 20), total: keys.length };
  }

  function periodKey(period) {
    return (period && period.start && period.end) ? (period.start + "__" + period.end) : "";
  }

  function saveTrendSnapshot(projectKey, period, aggregated) {
    if (!projectKey) projectKey = "default";
    var key = "ujg_pa_trends_" + projectKey;
    try {
      var saved = localStorage.getItem(key);
      var obj = saved ? JSON.parse(saved) : {};
      obj[periodKey(period)] = { period: period, aggregated: aggregated, savedAt: new Date().toISOString() };
      localStorage.setItem(key, JSON.stringify(obj));
    } catch (e) {}
  }

  function loadTrendSnapshot(projectKey, period) {
    if (!projectKey) projectKey = "default";
    var key = "ujg_pa_trends_" + projectKey;
    try {
      var saved = localStorage.getItem(key);
      var obj = saved ? JSON.parse(saved) : {};
      return obj[periodKey(period)] || null;
    } catch (e) { return null; }
  }

  function prevPeriod(period) {
    var s = startOfDay(new Date(period.start));
    var e = endOfDay(new Date(period.end));
    if (!s || !e) return null;
    var days = Math.round(diffDays(s, e)) + 1;
    var prevEnd = new Date(s);
    prevEnd.setDate(prevEnd.getDate() - 1);
    var prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - (days - 1));
    return { start: toISO(prevStart), end: toISO(prevEnd) };
  }

  // ---------------- UI helpers ----------------
  function esc(t) { return U.escapeHtml(t); }

  function mkIssueLink(key) {
    return '<a href="' + esc(baseUrl + "/browse/" + key) + '" target="_blank" rel="noopener noreferrer">' + esc(key) + "</a>";
  }

  function mkBadge(score) {
    if (score == null || !isFinite(score)) return '<span class="ujg-pa-badge muted">—</span>';
    if (score >= 80) return '<span class="ujg-pa-badge bad">🔴 ' + esc(score) + "</span>";
    if (score >= 60) return '<span class="ujg-pa-badge warn">🟠 ' + esc(score) + "</span>";
    if (score >= 40) return '<span class="ujg-pa-badge muted">🟡 ' + esc(score) + "</span>";
    return '<span class="ujg-pa-badge ok">🟢 ' + esc(score) + "</span>";
  }

  function mkDelta(current, prev, betterIsLower) {
    if (current == null || prev == null || !isFinite(current) || !isFinite(prev)) return "";
    var change = ((current - prev) / (prev || 1)) * 100;
    var abs = Math.round(change);
    var up = change > 0;
    var cls = "warn";
    if (betterIsLower) {
      cls = up ? "bad" : "ok";
    } else {
      cls = up ? "ok" : "bad";
    }
    var arrow = up ? "↑" : "↓";
    return '<span class="ujg-pa-delta ' + cls + '">' + arrow + " " + Math.abs(abs) + "%</span>";
  }

  // ---------------- Modals ----------------
  function ensureOverlay($root) {
    var $ov = $root.find(".ujg-pa-overlay");
    if ($ov.length) return $ov;
    $ov = $('<div class="ujg-pa-overlay" role="dialog" aria-modal="true"></div>');
    $ov.append(
      '<div class="ujg-pa-modal">' +
        '<div class="ujg-pa-modal-hdr">' +
          '<div class="ujg-pa-modal-title">...</div>' +
          '<button class="ujg-pa-close" type="button" title="Закрыть">✕</button>' +
        "</div>" +
        '<div class="ujg-pa-modal-body"></div>' +
        '<div class="ujg-pa-modal-ftr"></div>' +
      "</div>"
    );
    $root.append($ov);
    $ov.on("click", function(e) { if (e.target === $ov[0]) $ov.removeClass("ujg-show"); });
    $ov.find(".ujg-pa-close").on("click", function() { $ov.removeClass("ujg-show"); });
    $(document).on("keydown.ujgPa", function(e) { if (e.key === "Escape") $ov.removeClass("ujg-show"); });
    return $ov;
  }

  function showModal($root, title, bodyHtml, footerHtml) {
    var $ov = ensureOverlay($root);
    $ov.find(".ujg-pa-modal-title").text(title || "");
    $ov.find(".ujg-pa-modal-body").html(bodyHtml || "");
    $ov.find(".ujg-pa-modal-ftr").html(footerHtml || "");
    $ov.addClass("ujg-show");
    return $ov;
  }

  function closeModal($root) {
    var $ov = $root.find(".ujg-pa-overlay");
    $ov.removeClass("ujg-show");
  }

  function renderProgressModal($root, tracker, stageText) {
    var body =
      '<div class="ujg-pa-progress">' +
        '<div class="ujg-pa-progress-top">' +
          '<div><b>Этап:</b> <span class="ujg-pa-stage">' + esc(stageText || "—") + "</span></div>" +
          '<div><b class="ujg-pa-pct">0%</b></div>' +
        "</div>" +
        '<div class="ujg-pa-progress-bar"><div class="ujg-pa-progress-fill"></div></div>' +
        '<div class="ujg-pa-progress-meta">' +
          '<div><b>Обработано задач:</b> <span class="ujg-pa-iss">0/0</span></div>' +
          '<div><b>Время:</b> <span class="ujg-pa-time">00:00</span> | <b>Осталось:</b> <span class="ujg-pa-eta">—</span></div>' +
        "</div>" +
        '<div class="ujg-pa-card-body" style="padding-top:0">' +
          '<div class="ujg-pa-tbl-wrap">' +
            '<table class="ujg-pa-mini-tbl">' +
              "<thead><tr><th>Endpoint</th><th>Calls</th><th>Done</th><th>Errors</th><th>Avg ms</th></tr></thead>" +
              "<tbody>" +
                '<tr data-ep="search"><td>/rest/api/2/search</td><td class="c">0</td><td class="d">0</td><td class="e">0</td><td class="m">-</td></tr>' +
                '<tr data-ep="worklog"><td>/rest/api/2/issue/*/worklog</td><td class="c">0</td><td class="d">0</td><td class="e">0</td><td class="m">-</td></tr>' +
                '<tr data-ep="dev-status"><td>/rest/dev-status/.../detail</td><td class="c">0</td><td class="d">0</td><td class="e">0</td><td class="m">-</td></tr>' +
                '<tr data-ep="field"><td>/rest/api/2/field</td><td class="c">0</td><td class="d">0</td><td class="e">0</td><td class="m">-</td></tr>' +
              "</tbody>" +
            "</table>" +
          "</div>" +
        "</div>" +
      "</div>";

    var footer =
      '<div style="display:flex; align-items:center; gap:8px; width:100%;">' +
        '<button class="ujg-pa-btn ujg-pa-btn-danger ujg-pa-cancel" type="button">Прервать</button>' +
        '<div style="margin-left:auto; color:#6b778c; font-size:12px;">v' + esc(CONFIG.version) + "</div>" +
      "</div>";

    var $ov = showModal($root, "🔄 Сбор данных для аналитики", body, footer);
    return $ov;
  }

  function updateProgressModal($ov, tracker, stageText) {
    if (!$ov || !$ov.length) return;
    var pct = tracker.getProgress();
    var elapsed = tracker.getElapsedSec();
    var eta = tracker.getETA();
    $ov.find(".ujg-pa-stage").text(stageText || "");
    $ov.find(".ujg-pa-pct").text(pct + "%");
    $ov.find(".ujg-pa-progress-fill").css("width", pct + "%");
    $ov.find(".ujg-pa-iss").text(tracker.issues.processed + "/" + tracker.issues.total);
    $ov.find(".ujg-pa-time").text(secToClock(elapsed));
    $ov.find(".ujg-pa-eta").text(eta == null ? "—" : secToClock(eta));
    Object.keys(tracker.endpoints).forEach(function(ep) {
      var row = $ov.find('tr[data-ep="' + ep + '"]');
      if (!row.length) return;
      var e = tracker.endpoints[ep];
      row.find(".c").text(e.calls);
      row.find(".d").text(e.done);
      row.find(".e").text(e.errors);
      var avg = tracker.getAvgMs(ep);
      row.find(".m").text(avg == null ? "-" : avg);
    });
  }

  function secToClock(sec) {
    sec = Math.max(0, sec || 0);
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    var mm = m < 10 ? "0" + m : "" + m;
    var ss = s < 10 ? "0" + s : "" + s;
    return mm + ":" + ss;
  }

  // ---------------- Gadget ----------------
  function ProjectAnalyticsGadget(API) {
    var state = {
      isFullscreen: false,
      loading: false,
      _abort: false,
      _activeXhrs: [],
      settings: mergeDefaults(loadSettings()),
      projectKey: null,
      workflow: null,
      analyticsData: null,
      lastError: ""
    };

    var $content = API.getGadgetContentEl();
    var $cont = $content.find(".ujg-project-analytics");
    if ($cont.length === 0) { $cont = $('<div class="ujg-project-analytics"></div>'); $content.append($cont); }

    function ensureFullWidth() {
      var $wrap = $content.closest(".dashboard-item-content, .gadget, .ajs-gadget, .aui-page-panel, .dashboard-item");
      var $targets = $wrap.add($content).add($cont);
      $targets.css({ width: "100%", maxWidth: "none", flex: "1 1 auto" });
      if ($wrap.length) $wrap.addClass("ujg-pa-wide");
    }

    function toggleFullscreen() {
      var $el = $content.closest(".dashboard-item-content, .gadget, .ujg-gadget-wrapper");
      if ($el.length === 0) $el = $content;
      state.isFullscreen = !state.isFullscreen;
      $el.toggleClass("ujg-pa-fullscreen", state.isFullscreen);
      API.resize();
    }

    function getPeriodFromUI() {
      var s = ($content.find(".ujg-pa-from").val() || "").trim();
      var e = ($content.find(".ujg-pa-to").val() || "").trim();
      var sd = startOfDay(new Date(s));
      var ed = endOfDay(new Date(e));
      if (!sd || isNaN(sd.getTime()) || !ed || isNaN(ed.getTime())) return null;
      if (sd.getTime() > ed.getTime()) { var t = sd; sd = startOfDay(ed); ed = endOfDay(t); }
      var days = Math.round(diffDays(sd, ed)) + 1;
      if (days > CONFIG.MAX_PERIOD_DAYS) {
        // clamp end
        ed = endOfDay(new Date(sd));
        ed.setDate(ed.getDate() + (CONFIG.MAX_PERIOD_DAYS - 1));
        e = toISO(ed);
        $content.find(".ujg-pa-to").val(e);
      }
      return { start: toISO(sd), end: toISO(ed), _start: sd, _end: ed };
    }

    function getJqlFromUI() {
      return ($content.find(".ujg-pa-jql").val() || "").trim();
    }

    function buildSearchJql(jql, period) {
      var pj = jql || "";
      var p = period || getPeriodFromUI();
      if (!p) return pj;
      var ds = p.start;
      var de = p.end;
      var periodClause = "updated >= '" + ds + "' AND updated <= '" + de + "'";
      if (!pj) return periodClause;
      return "(" + pj + ") AND " + periodClause;
    }

    function renderEmpty(message) {
      $cont.html(
        '<div class="ujg-pa-page"><div class="ujg-pa-inner">' +
          '<div class="ujg-pa-card"><div class="ujg-pa-card-body">' +
            '<div class="ujg-pa-hint">' + esc(message || "Укажите JQL и период, затем нажмите «Загрузить».") + "</div>" +
          "</div></div>" +
        "</div></div>"
      );
      API.resize();
    }

    function renderDashboard(data, wf, settings, trend) {
      var agg = data.aggregated || {};
      var period = data.period || {};
      var trendPrev = trend && trend.prev ? trend.prev : null;
      var trendCur = trend && trend.cur ? trend.cur : null;

      var deltaCycle = (trendPrev && trendPrev.aggregated) ? mkDelta(agg.avgCycleTime, trendPrev.aggregated.avgCycleTime, true) : "";
      var deltaLead = (trendPrev && trendPrev.aggregated) ? mkDelta(agg.avgLeadTime, trendPrev.aggregated.avgLeadTime, true) : "";
      var deltaReopen = (trendPrev && trendPrev.aggregated) ? mkDelta((agg.reopenRate || 0) * 100, (trendPrev.aggregated.reopenRate || 0) * 100, true) : "";
      var deltaTh = (trendPrev && trendPrev.aggregated) ? mkDelta(agg.throughput, trendPrev.aggregated.throughput, false) : "";

      var risk = riskDistribution(data);
      var bott = data.bottlenecks || { critical: [], attention: [], unavailable: [], positive: [] };

      // shell (с панелью управления)
      var jql = (state.settings && state.settings.jqlFilter) ? state.settings.jqlFilter : "project = PROJ";
      var start = (state.settings && state.settings.periodStart) ? state.settings.periodStart : (period.start || "");
      var end = (state.settings && state.settings.periodEnd) ? state.settings.periodEnd : (period.end || "");
      var html = '<div class="ujg-pa-page"><div class="ujg-pa-inner">' + panelHtml(jql, start, end);

      // KPI row
      html += '<div class="ujg-pa-card" style="margin-bottom:10px;">' +
        '<div class="ujg-pa-card-hdr">' +
          '<div class="ujg-pa-card-title">Обзор</div>' +
          '<div class="ujg-pa-card-sub">Период: <b>' + esc(period.start || "—") + "</b> — <b>" + esc(period.end || "—") + "</b></div>" +
        "</div>" +
        '<div class="ujg-pa-card-body">' +
          '<div class="ujg-pa-kpis">' +
            '<div class="ujg-pa-kpi"><div class="t">Задач</div><div class="v">' + esc(agg.totalIssues || 0) + '</div><div class="s">Закрыто: <b>' + esc(agg.closedIssues || 0) + "</b></div></div>" +
            '<div class="ujg-pa-kpi"><div class="t">Lead Time (avg)</div><div class="v">' + esc(fmtDays(agg.avgLeadTime)) + '</div><div class="s">Сравнение: ' + deltaLead + "</div></div>" +
            '<div class="ujg-pa-kpi"><div class="t">Cycle Time (avg)</div><div class="v">' + esc(fmtDays(agg.avgCycleTime)) + '</div><div class="s">Сравнение: ' + deltaCycle + "</div></div>" +
            '<div class="ujg-pa-kpi"><div class="t">Throughput</div><div class="v">' + (agg.throughput == null ? "—" : (Math.round(agg.throughput * 100) / 100)) + '</div><div class="s">Сравнение: ' + deltaTh + "</div></div>" +
          "</div>" +
          '<div class="ujg-pa-hint" style="margin:10px 0 0;">' +
            'Reopen rate: <b>' + esc(agg.reopenRate == null ? "—" : fmtPct(agg.reopenRate * 100)) + "</b> " + deltaReopen +
            (wf && wf.isManuallyConfigured ? "" : ' <span class="ujg-pa-badge muted" style="margin-left:8px;">workflow auto</span>') +
          "</div>" +
        "</div>" +
      "</div>";

      // Bottlenecks
      html += '<div class="ujg-pa-grid" style="margin-bottom:10px;">';
      html += '<div class="ujg-pa-card" style="grid-column: span 12;">' +
        '<div class="ujg-pa-card-hdr">' +
          '<div class="ujg-pa-card-title">🔄 Узкие места процесса</div>' +
          '<div class="ujg-pa-card-sub">Авто-детекторы по конфигу workflow</div>' +
        "</div>" +
        '<div class="ujg-pa-card-body">';

      function renderProblemList(title, list, badgeClass) {
        if (!list || !list.length) return "";
        var out = '<div style="margin-bottom:10px;"><div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">' +
          '<span class="ujg-pa-badge ' + badgeClass + '">' + esc(title) + "</span>" +
          '<span class="ujg-pa-pill"><b>' + esc(list.length) + "</b> шт.</span>" +
          "</div>";
        out += '<div class="ujg-pa-bars">';
        list.slice(0, 6).forEach(function(p) {
          var keysStr = (p.keys && p.keys.length) ? p.keys.slice(0, 6).join(", ") : "";
          out += '<div class="ujg-pa-bar">' +
            '<div class="ujg-pa-bar-name">' + esc(p.title) + "</div>" +
            '<div class="ujg-pa-bar-track"><div class="ujg-pa-bar-fill" style="width:' + clamp((p.keys ? p.keys.length : 1) * 10, 15, 100) + '%; background: linear-gradient(90deg,#ef4444,#fb7185)"></div></div>' +
            '<div class="ujg-pa-bar-val">' + esc(p.detail || "") + "</div>" +
          "</div>";
          if (keysStr) out += '<div class="ujg-pa-hint" style="margin:4px 0 8px;">' + esc(keysStr) + "</div>";
        });
        out += "</div></div>";
        return out;
      }

      html += renderProblemList("Критично", bott.critical, "bad");
      html += renderProblemList("Внимание", bott.attention, "warn");
      if (bott.unavailable && bott.unavailable.length) {
        html += '<div style="margin-top:8px;">' +
          '<div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">' +
            '<span class="ujg-pa-badge muted">Недоступные метрики</span>' +
          "</div>" +
          '<ul style="margin:0; padding-left:18px; color:#6b778c; font-size:12px;">' +
            bott.unavailable.map(function(x) { return "<li><b>" + esc(x.title) + "</b>: " + esc(x.detail) + "</li>"; }).join("") +
          "</ul>" +
        "</div>";
      }

      html += "</div></div></div>";

      // Risk matrix + Activity table
      html += '<div class="ujg-pa-grid">';

      // Risk card
      html += '<div class="ujg-pa-card" style="grid-column: span 5;">' +
        '<div class="ujg-pa-card-hdr">' +
          '<div class="ujg-pa-card-title">⚠️ Матрица рисков</div>' +
          '<div class="ujg-pa-card-sub">Score 0–100</div>' +
        "</div>" +
        '<div class="ujg-pa-card-body">';

      var total = risk.total || 0;
      function pctCount(c) { return total ? Math.round((c / total) * 100) : 0; }
      html += '<div class="ujg-pa-bars">';
      [
        { k: "crit", label: "🔴 Критический (>80)", c: risk.bins.crit, cls: "bad", col: "linear-gradient(90deg,#ef4444,#fb7185)" },
        { k: "high", label: "🟠 Высокий (60–80)", c: risk.bins.high, cls: "warn", col: "linear-gradient(90deg,#f59e0b,#fdba74)" },
        { k: "mid", label: "🟡 Средний (40–60)", c: risk.bins.mid, cls: "muted", col: "linear-gradient(90deg,#94a3b8,#cbd5e1)" },
        { k: "low", label: "🟢 Низкий (<40)", c: risk.bins.low, cls: "ok", col: "linear-gradient(90deg,#16a34a,#86efac)" }
      ].forEach(function(x) {
        html += '<div class="ujg-pa-bar">' +
          '<div class="ujg-pa-bar-name">' + esc(x.label) + "</div>" +
          '<div class="ujg-pa-bar-track"><div class="ujg-pa-bar-fill" style="width:' + pctCount(x.c) + "%; background:" + x.col + '"></div></div>' +
          '<div class="ujg-pa-bar-val">' + esc(x.c) + " (" + pctCount(x.c) + "%)</div>" +
        "</div>";
      });
      html += "</div>";

      if (risk.top && risk.top.length) {
        html += '<div class="ujg-pa-hint" style="margin-top:10px;"><b>Топ рисков:</b></div>';
        html += '<div class="ujg-pa-tbl-wrap"><table class="ujg-pa-tbl"><thead><tr>' +
          "<th>Задача</th><th>Score</th><th>Факторы</th></tr></thead><tbody>";
        risk.top.slice(0, 8).forEach(function(it) {
          var f = (it.factors || []).slice(0, 3).map(function(x) { return esc(x.message); }).join(" • ");
          html += "<tr>" +
            "<td>" + mkIssueLink(it.key) + '<div class="ujg-pa-hint" style="margin:4px 0 0;">' + esc(it.summary) + "</div></td>" +
            "<td>" + mkBadge(it.score) + "</td>" +
            "<td>" + (f || "—") + "</td>" +
          "</tr>";
        });
        html += "</tbody></table></div>";
      }

      html += "</div></div>";

      // Activity card
      html += '<div class="ujg-pa-card" style="grid-column: span 7;">' +
        '<div class="ujg-pa-card-hdr">' +
          '<div class="ujg-pa-card-title">🔍 Activity Deep Dive</div>' +
          '<div class="ujg-pa-card-sub">Из changelog за период</div>' +
        "</div>" +
        '<div class="ujg-pa-card-body">';

      html += '<div class="ujg-pa-tbl-wrap"><table class="ujg-pa-tbl"><thead><tr>' +
        "<th>Задача</th><th>Summary</th><th>Активность</th><th>Lead</th><th>Cycle</th><th>Risk</th></tr></thead><tbody>";

      var list = Object.keys(data.issues || {}).map(function(k) { return data.issues[k]; });
      list.sort(function(a, b) {
        var ar = a.metrics ? a.metrics.riskScore : 0;
        var br = b.metrics ? b.metrics.riskScore : 0;
        return br - ar;
      });
      list.slice(0, 40).forEach(function(it) {
        var a = it.activityInPeriod || {};
        var act = [];
        act.push("🔄×" + (a.statusChanges ? a.statusChanges.length : 0));
        act.push("👤×" + (a.assigneeChanges ? a.assigneeChanges.length : 0));
        act.push("🏃×" + (a.sprintChanges ? a.sprintChanges.length : 0));
        act.push("⟲×" + (it.metrics && it.metrics.reopens ? it.metrics.reopens : 0));
        html += "<tr>" +
          "<td>" + mkIssueLink(it.key) + "</td>" +
          "<td>" + esc(it.summary || "") + "</td>" +
          '<td><span class="ujg-pa-pill"><b>' + esc(act.join("  ")) + "</b></span></td>" +
          "<td>" + esc(fmtDays(it.metrics ? it.metrics.leadTime : null)) + "</td>" +
          "<td>" + esc(fmtDays(it.metrics ? it.metrics.cycleTime : null)) + "</td>" +
          "<td>" + mkBadge(it.metrics ? it.metrics.riskScore : null) + "</td>" +
        "</tr>";
      });

      html += "</tbody></table></div>";
      html += '<div class="ujg-pa-hint" style="margin-top:8px;">Совет: настройте workflow, чтобы улучшить Cycle/Review/Testing анализ.</div>';
      html += "</div></div>";

      html += "</div>"; // grid
      html += "</div></div>";

      $cont.html(html);
      bindPanel();
      API.resize();
    }

    // ---------------- workflow modal ----------------
    function openWorkflowModal(allStatuses) {
      var pk = state.projectKey || parseProjectKeyFromJql(getJqlFromUI()) || "default";
      var wf0 = loadWorkflow(pk);
      wf0 = normalizeWorkflow(wf0 || { projectKey: pk, isManuallyConfigured: false }, allStatuses || []);
      state.workflow = wf0;

      function renderWfBody() {
        var wf = state.workflow;
        var all = wf.allStatuses || [];
        var mapped = wf.statusCategories || {};
        var unassigned = all.filter(function(st) { return !mapped[st] || !mapped[st].length; });

        var body = '<div class="ujg-pa-hint">' +
          "Проект: <b>" + esc(pk) + "</b> • Найдено <b>" + esc(all.length) + "</b> уникальных статусов. " +
          "Клик по статусу → выбрать категории (можно несколько). " +
          "</div>";

        body += '<div class="ujg-pa-wf-grid">';
        Object.keys(STATUS_CATEGORIES).forEach(function(cat) {
          var meta = STATUS_CATEGORIES[cat];
          var items = (wf.categoryStatuses && wf.categoryStatuses[cat]) ? wf.categoryStatuses[cat] : [];
          body += '<div class="ujg-pa-wf-col">' +
            '<div class="ujg-pa-wf-col-hdr">' +
              '<div class="ujg-pa-wf-col-title">' + esc(meta.icon + " " + meta.name) + ' <small>(' + esc(cat) + ")</small></div>" +
              '<span class="ujg-pa-pill"><b>' + esc(items.length) + "</b></span>" +
            "</div>" +
            '<div class="ujg-pa-wf-list" data-cat="' + esc(cat) + '">' +
              (items.length ? items.map(function(st) { return wfItemHtml(st); }).join("") : '<span class="ujg-pa-hint">Пусто — метрики по этой категории не считаются.</span>') +
            "</div>" +
          "</div>";
        });

        body += '<div class="ujg-pa-wf-col" style="grid-column: 1 / -1;">' +
          '<div class="ujg-pa-wf-col-hdr">' +
            '<div class="ujg-pa-wf-col-title">❓ Не распределены</div>' +
            '<span class="ujg-pa-pill"><b>' + esc(unassigned.length) + "</b></span>" +
          "</div>" +
          '<div class="ujg-pa-wf-list" data-cat="__unassigned">' +
            (unassigned.length ? unassigned.map(function(st) { return wfItemHtml(st); }).join("") : '<span class="ujg-pa-hint">Все статусы распределены.</span>') +
          "</div>" +
        "</div>";

        body += "</div>";
        return body;
      }

      function wfItemHtml(statusName) {
        var cats = (state.workflow.statusCategories && state.workflow.statusCategories[statusName]) ? state.workflow.statusCategories[statusName] : [];
        var label = statusName;
        if (cats.length) label += "  ·  " + cats.map(function(c) { return STATUS_CATEGORIES[c] ? STATUS_CATEGORIES[c].icon : c; }).join("");
        return '<span class="ujg-pa-wf-item" data-status="' + esc(statusName) + '">' +
          "<span>" + esc(label) + "</span>" +
          '<span class="x" title="Очистить категории">×</span>' +
        "</span>";
      }

      var footer =
        '<div style="display:flex; gap:8px; width:100%; align-items:center;">' +
          '<button class="ujg-pa-btn ujg-pa-btn-primary ujg-pa-wf-save" type="button">Сохранить</button>' +
          '<button class="ujg-pa-btn ujg-pa-wf-reset" type="button">Сбросить</button>' +
          '<div style="margin-left:auto; color:#6b778c; font-size:12px;">localStorage: <b>' + esc(wfStorageKey(pk)) + "</b></div>" +
        "</div>";

      var $ov = showModal($content, "⚙️ Настройка workflow", renderWfBody(), footer);

      function rerender() {
        $ov.find(".ujg-pa-modal-body").html(renderWfBody());
        bindWfEvents();
      }

      function closePop() { $ov.find(".ujg-pa-pop").remove(); }

      function bindWfEvents() {
        $ov.find(".ujg-pa-wf-item").off("click").on("click", function(e) {
          var $it = $(this);
          var st = $it.data("status");
          if ($(e.target).hasClass("x")) {
            // clear
            state.workflow.statusCategories[st] = [];
            state.workflow = normalizeWorkflow(state.workflow, state.workflow.allStatuses || []);
            rerender();
            return;
          }
          // open popover
          closePop();
          var cats = (state.workflow.statusCategories && state.workflow.statusCategories[st]) ? state.workflow.statusCategories[st].slice() : [];
          var rect = $it[0].getBoundingClientRect();
          var $pop = $('<div class="ujg-pa-pop"></div>');
          $pop.append("<h4>Категории для: <b>" + esc(st) + "</b></h4>");
          var $row = $('<div class="row"></div>');
          Object.keys(STATUS_CATEGORIES).forEach(function(cat) {
            var meta = STATUS_CATEGORIES[cat];
            var checked = cats.indexOf(cat) >= 0;
            var id = "ujg-pa-wf-" + cat + "-" + Math.random().toString(16).slice(2);
            $row.append(
              '<label for="' + id + '">' +
                '<input id="' + id + '" type="checkbox" ' + (checked ? "checked" : "") + ' data-cat="' + esc(cat) + '">' +
                "<span>" + esc(meta.icon + " " + meta.name) + "</span>" +
              "</label>"
            );
          });
          $pop.append($row);
          $pop.append('<div class="muted">Можно выбрать несколько категорий (редко, но бывает).</div>');
          $ov.find(".ujg-pa-modal").append($pop);
          $pop.css({ left: Math.max(10, rect.left - $ov.find(".ujg-pa-modal")[0].getBoundingClientRect().left) + "px", top: (rect.bottom - $ov.find(".ujg-pa-modal")[0].getBoundingClientRect().top + 6) + "px" });
          $pop.on("click", function(ev) { ev.stopPropagation(); });
          $pop.find("input[type=checkbox]").on("change", function() {
            var cat2 = $(this).data("cat");
            var on = $(this).is(":checked");
            var arr = state.workflow.statusCategories[st] || [];
            if (on) { if (arr.indexOf(cat2) < 0) arr.push(cat2); }
            else { arr = arr.filter(function(x) { return x !== cat2; }); }
            state.workflow.statusCategories[st] = arr;
            state.workflow.isManuallyConfigured = true;
            state.workflow = normalizeWorkflow(state.workflow, state.workflow.allStatuses || []);
            rerender();
          });
        });

        // click outside to close pop
        $ov.find(".ujg-pa-modal-body").off("click.ujgPaPop").on("click.ujgPaPop", function() { closePop(); });

        $ov.find(".ujg-pa-wf-save").off("click").on("click", function() {
          state.workflow.isManuallyConfigured = true;
          saveWorkflow(pk, state.workflow);
          closeModal($content);
          render();
        });
        $ov.find(".ujg-pa-wf-reset").off("click").on("click", function() {
          var fresh = normalizeWorkflow({ projectKey: pk, isManuallyConfigured: false }, state.workflow.allStatuses || []);
          state.workflow = fresh;
          rerender();
        });
      }

      bindWfEvents();
    }

    // ---------------- custom fields/settings modal ----------------
    function openSettingsModal() {
      function body() {
        var th = (state.settings && state.settings.thresholds) ? state.settings.thresholds : DEFAULT_THRESHOLDS;
        var rw = (state.settings && state.settings.riskWeights) ? state.settings.riskWeights : DEFAULT_RISK_WEIGHTS;
        var cf = (state.settings && state.settings.customFields) ? state.settings.customFields : {};
        var html = "";

        html += '<div class="ujg-pa-card" style="margin-bottom:10px;"><div class="ujg-pa-card-hdr"><div class="ujg-pa-card-title">Пороги</div><div class="ujg-pa-card-sub">Используются в bottlenecks и risk score</div></div><div class="ujg-pa-card-body">';
        html += renderSettingsGrid([
          { k: "ageRisk", label: "Возраст задачи (дн)", v: th.ageRisk },
          { k: "noProgressRisk", label: "Нет активности (дн)", v: th.noProgressRisk },
          { k: "longReviewRisk", label: "Долгий review (дн)", v: th.longReviewRisk },
          { k: "longTestingRisk", label: "Долгий testing (дн)", v: th.longTestingRisk },
          { k: "prIterationsRisk", label: "Возвраты review→work", v: th.prIterationsRisk },
          { k: "wipLimit", label: "WIP лимит на человека", v: th.wipLimit },
          { k: "sprintChangesRisk", label: "Переносов спринта", v: th.sprintChangesRisk },
          { k: "assigneeChangesRisk", label: "Смен assignee", v: th.assigneeChangesRisk }
        ], "threshold");
        html += "</div></div>";

        html += '<div class="ujg-pa-card" style="margin-bottom:10px;"><div class="ujg-pa-card-hdr"><div class="ujg-pa-card-title">Веса рисков</div><div class="ujg-pa-card-sub">Сумма ограничена 0–100</div></div><div class="ujg-pa-card-body">';
        html += renderSettingsGrid([
          { k: "age", label: "Age", v: rw.age },
          { k: "sprintChanges", label: "Sprint changes", v: rw.sprintChanges },
          { k: "assigneeChanges", label: "Assignee changes", v: rw.assigneeChanges },
          { k: "noProgress", label: "No progress", v: rw.noProgress },
          { k: "reopens", label: "Reopens", v: rw.reopens },
          { k: "longReview", label: "Long review", v: rw.longReview },
          { k: "longTesting", label: "Long testing", v: rw.longTesting },
          { k: "prIterations", label: "PR iterations (proxy)", v: rw.prIterations }
        ], "weight");
        html += "</div></div>";

        html += '<div class="ujg-pa-card"><div class="ujg-pa-card-hdr"><div class="ujg-pa-card-title">Кастомные поля</div><div class="ujg-pa-card-sub">Auto-detect через /rest/api/2/field</div></div><div class="ujg-pa-card-body">';
        html += '<div class="ujg-pa-hint" style="margin-top:0;">Story Points / Epic Link / Sprint отличаются по проектам. Можно определить автоматически.</div>';
        html += '<div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">' +
          '<label style="display:flex; flex-direction:column; gap:4px; font-size:12px; color:#6b778c;"><span>Story Points</span><input class="ujg-pa-input ujg-pa-cf" data-cf="storyPoints" value="' + esc(cf.storyPoints || "") + '" placeholder="customfield_10004"></label>' +
          '<label style="display:flex; flex-direction:column; gap:4px; font-size:12px; color:#6b778c;"><span>Epic Link</span><input class="ujg-pa-input ujg-pa-cf" data-cf="epicLink" value="' + esc(cf.epicLink || "") + '" placeholder="customfield_10008"></label>' +
          '<label style="display:flex; flex-direction:column; gap:4px; font-size:12px; color:#6b778c;"><span>Sprint</span><input class="ujg-pa-input ujg-pa-cf" data-cf="sprint" value="' + esc(cf.sprint || "") + '" placeholder="customfield_10007"></label>' +
        "</div>";
        html += "</div></div>";

        return html;
      }

      function renderSettingsGrid(items, type) {
        var html = '<div class="ujg-pa-grid" style="grid-template-columns: repeat(12, minmax(0, 1fr)); gap:10px;">';
        items.forEach(function(it) {
          html += '<div class="ujg-pa-kpi" style="grid-column: span 3;">' +
            '<div class="t">' + esc(it.label) + "</div>" +
            '<div class="d"><input type="number" class="ujg-pa-input ujg-pa-num" data-type="' + esc(type) + '" data-key="' + esc(it.k) + '" value="' + esc(it.v) + '" style="width:100%; min-width:0; font-family: inherit;"></div>' +
          "</div>";
        });
        html += "</div>";
        return html;
      }

      var footer =
        '<div style="display:flex; gap:8px; width:100%; align-items:center;">' +
          '<button class="ujg-pa-btn ujg-pa-btn-primary ujg-pa-set-save" type="button">Сохранить</button>' +
          '<button class="ujg-pa-btn ujg-pa-set-auto" type="button">🔍 Определить поля</button>' +
          '<button class="ujg-pa-btn ujg-pa-set-reset" type="button">Сбросить дефолты</button>' +
          '<div style="margin-left:auto; color:#6b778c; font-size:12px;">localStorage: <b>' + esc(STORAGE_KEY) + "</b></div>" +
        "</div>";

      var $ov = showModal($content, "⚙️ Настройки", body(), footer);

      function syncFromUi() {
        $ov.find(".ujg-pa-num").each(function() {
          var $i = $(this);
          var t = $i.data("type");
          var k = $i.data("key");
          var v = parseFloat($i.val());
          if (!isFinite(v)) v = 0;
          if (t === "threshold") state.settings.thresholds[k] = v;
          if (t === "weight") state.settings.riskWeights[k] = v;
        });
        $ov.find(".ujg-pa-cf").each(function() {
          var $i2 = $(this);
          var k2 = $i2.data("cf");
          var v2 = ($i2.val() || "").trim();
          state.settings.customFields[k2] = v2 || null;
        });
      }

      $ov.find(".ujg-pa-set-save").on("click", function() {
        syncFromUi();
        saveSettings(state.settings);
        closeModal($content);
        if (state.analyticsData) render();
      });

      $ov.find(".ujg-pa-set-reset").on("click", function() {
        state.settings.thresholds = $.extend({}, DEFAULT_THRESHOLDS);
        state.settings.riskWeights = $.extend({}, DEFAULT_RISK_WEIGHTS);
        saveSettings(state.settings);
        $ov.find(".ujg-pa-modal-body").html(body());
      });

      $ov.find(".ujg-pa-set-auto").on("click", function() {
        var tracker = createApiTracker();
        tracker.startTime = Date.now();
        var pOv = renderProgressModal($content, tracker, "Определение кастомных полей");
        pOv.find(".ujg-pa-cancel").hide();
        jiraGetFields(state, tracker).then(function(fields) {
          var det = detectCustomFields(fields);
          state.settings.customFields = $.extend({}, state.settings.customFields, det);
          saveSettings(state.settings);
          closeModal($content);
          openSettingsModal();
        }, function() {
          closeModal($content);
          openSettingsModal();
        });
      });
    }

    // ---------------- Data load + compute ----------------
    function loadAndAnalyze() {
      if (state.loading) return;
      state._abort = false;
      state._activeXhrs = [];
      state.loading = true;
      state.lastError = "";

      var period = getPeriodFromUI();
      var jql = getJqlFromUI();
      if (!period) { state.loading = false; renderEmpty("Укажите корректные даты периода."); return; }
      if (!jql) { state.loading = false; renderEmpty("Укажите JQL фильтр (например: project = PROJ)."); return; }

      var projectKey = parseProjectKeyFromJql(jql) || "default";
      state.projectKey = projectKey;

      var settings = state.settings;
      var tracker = createApiTracker();
      tracker.startTime = Date.now();

      // expected calls: field(1) + search(pages) + worklog(n) + dev(n)
      // pages пока не знаем, заложим 1 + динамически обновим
      tracker.expectedCalls = 1 + 1;
      tracker.issues.total = 0;
      tracker.issues.processed = 0;

      var $pOv = renderProgressModal($content, tracker, "Подготовка");
      $pOv.find(".ujg-pa-cancel").off("click").on("click", function() {
        abortAll(state);
        state.loading = false;
        closeModal($content);
        render();
      });

      function tick(stage) { updateProgressModal($pOv, tracker, stage); }

      var allIssues = [];
      var fieldList = null;

      tick("Загрузка метаданных полей");
      jiraGetFields(state, tracker).then(function(fields) {
        fieldList = fields || [];
        tick("Поиск задач");

        var cf = settings.customFields || {};
        var fieldsToGet = ["summary", "status", "assignee", "created", "updated", "priority", "issuetype", "resolution", "resolutiondate", "components", "labels", "fixVersions"];
        if (cf.storyPoints) fieldsToGet.push(cf.storyPoints);
        if (cf.epicLink) fieldsToGet.push(cf.epicLink);
        if (cf.sprint) fieldsToGet.push(cf.sprint);

        var searchJql = buildSearchJql(jql, period);
        var maxResults = 100;

        function loadPage(startAt) {
          if (state._abort) return $.Deferred().reject({ aborted: true }).promise();
          return jiraSearch(state, tracker, {
            jql: searchJql,
            fields: fieldsToGet,
            expand: ["changelog"],
            maxResults: maxResults,
            startAt: startAt
          }).then(function(r) {
            var issues = (r && r.issues) ? r.issues : [];
            var total = (r && typeof r.total === "number") ? r.total : (issues.length + startAt);
            allIssues = allIssues.concat(issues);
            tracker.issues.total = total;
            // динамически увеличим expectedCalls: worklog+dev на total
            tracker.expectedCalls = 1 /*field*/ + Math.ceil(total / maxResults) /*search pages*/ + total /*worklog*/ + total /*dev-status*/;
            tick("Поиск задач: " + allIssues.length + "/" + total);
            if (allIssues.length < total && issues.length) return loadPage(startAt + issues.length);
            return { issues: allIssues, total: total };
          });
        }

        return loadPage(0);
      }).then(function(res) {
        if (state._abort) return $.Deferred().reject({ aborted: true }).promise();
        var issues = (res && res.issues) ? res.issues : [];
        tracker.issues.total = (res && res.total) ? res.total : issues.length;

        // workflow (auto-suggest + migration)
        var statuses = collectAllStatuses(issues);
        var wf0 = normalizeWorkflow(loadWorkflow(state.projectKey) || { projectKey: state.projectKey, isManuallyConfigured: false }, statuses);
        state.workflow = wf0;
        saveWorkflow(state.projectKey, wf0);

        // build initial analytics structure
        var data = {
          period: { start: period.start, end: period.end },
          issues: {},
          aggregated: {},
          _allStatuses: statuses
        };

        // concurrency queue for per-issue enrichment
        var queue = issues.slice();
        var concurrency = 6;
        var active = 0;
        var done = $.Deferred();

        function next() {
          if (state._abort) { done.reject({ aborted: true }); return; }
          if (!queue.length && active === 0) { done.resolve(); return; }
          while (active < concurrency && queue.length) {
            (function(issue) {
              active++;
              var key = issue && issue.key;
              var id = issue && issue.id;
              var parsed = parseChangelog(issue);
              var act = activityInPeriod(parsed, period._start, period._end);

              // basic issue object
              var f = issue.fields || {};
              var assignee = f.assignee || null;
              var assigneeId = assignee ? (assignee.accountId || assignee.key || assignee.name) : null;
              var assigneeName = assignee ? (assignee.displayName || assignee.name || assigneeId) : null;
              var statusName = f.status && f.status.name ? f.status.name : "";
              var isDone = false;
              if (state.workflow && state.workflow.categoryStatuses && state.workflow.categoryStatuses.done && state.workflow.categoryStatuses.done.length) {
                isDone = state.workflow.categoryStatuses.done.indexOf(statusName) >= 0;
              } else {
                // fallback: resolution set
                isDone = !!f.resolution;
              }

              data.issues[key] = {
                key: key,
                id: id,
                summary: f.summary || "",
                status: statusName,
                assigneeId: assigneeId,
                assigneeName: assigneeName,
                created: f.created || null,
                updated: f.updated || null,
                resolutiondate: f.resolutiondate || null,
                storyPoints: (settings.customFields && settings.customFields.storyPoints) ? (f[settings.customFields.storyPoints] || null) : null,
                epicKey: (settings.customFields && settings.customFields.epicLink) ? (f[settings.customFields.epicLink] || null) : null,
                sprintHistory: (settings.customFields && settings.customFields.sprint) ? parseSprintNames(f[settings.customFields.sprint] || []) : [],
                components: f.components ? f.components.map(function(c) { return c && c.name ? c.name : String(c); }) : [],
                labels: f.labels || [],
                fixVersions: f.fixVersions ? f.fixVersions.map(function(v) { return v && v.name ? v.name : String(v); }) : [],
                changelog: parsed,
                activityInPeriod: act,
                _isDone: isDone,
                metrics: null,
                devActivity: null,
                worklog: null
              };

              // per-issue API calls
              tick("Загрузка worklog/dev данных: " + tracker.issues.processed + "/" + tracker.issues.total);

              $.when(
                jiraIssueWorklog(state, tracker, key).then(function(wl) { data.issues[key].worklog = wl || null; }, function() { data.issues[key].worklog = null; }),
                jiraDevStatus(state, tracker, id).then(function(dev) { data.issues[key].devActivity = dev || null; }, function() { data.issues[key].devActivity = null; })
              ).always(function() {
                // compute metrics after enrichment
                data.issues[key].metrics = computeIssueMetrics(issue, parsed, state.workflow, settings, period._start, period._end);
                tracker.issues.processed++;
                active--;
                updateProgressModal($pOv, tracker, "Обработка задач");
                next();
              });
            })(queue.shift());
          }
        }

        next();
        return done.promise().then(function() {
          if (state._abort) return $.Deferred().reject({ aborted: true }).promise();
          tick("Расчёт агрегатов");
          data.aggregated = computeAggregated(data);
          data.bottlenecks = computeBottlenecks(data, state.workflow, settings);

          // trends
          saveTrendSnapshot(state.projectKey, data.period, data.aggregated);
          var prevP = prevPeriod(data.period);
          var prevSnap = prevP ? loadTrendSnapshot(state.projectKey, prevP) : null;
          var trend = { cur: { period: data.period, aggregated: data.aggregated }, prev: prevSnap ? { period: prevSnap.period, aggregated: prevSnap.aggregated } : null };

          state.analyticsData = data;
          closeModal($content);
          state.loading = false;
          renderDashboard(data, state.workflow, settings, trend);
        });
      }).fail(function(err) {
        state.loading = false;
        closeModal($content);
        if (err && err.aborted) {
          render();
          return;
        }
        state.lastError = "Ошибка загрузки данных. Проверьте JQL и доступ к Jira API.";
        render();
      });
    }

    // ---------------- Render root + panel ----------------
    function panelHtml(jql, start, end) {
      return (
        '<div class="ujg-pa-panel">' +
          '<div class="ujg-pa-left">' +
            '<input class="ujg-pa-input ujg-pa-jql" type="text" placeholder="project = PROJ" value="' + esc(jql || "") + '">' +
            '<input class="ujg-pa-input ujg-pa-date ujg-pa-from" type="date" value="' + esc(start || "") + '">' +
            '<input class="ujg-pa-input ujg-pa-date ujg-pa-to" type="date" value="' + esc(end || "") + '">' +
            '<button class="ujg-pa-btn ujg-pa-btn-primary ujg-pa-load" type="button">Загрузить</button>' +
          "</div>" +
          '<div class="ujg-pa-right">' +
            '<button class="ujg-pa-btn ujg-pa-wf" type="button" title="Настроить workflow">⚙️ Workflow</button>' +
            '<button class="ujg-pa-btn ujg-pa-set" type="button" title="Настройки">⚙️</button>' +
            '<button class="ujg-pa-btn ujg-pa-fs" type="button" title="На весь экран">⛶</button>' +
          "</div>" +
        "</div>"
      );
    }

    function bindPanel() {
      $content.find(".ujg-pa-fs").off("click").on("click", toggleFullscreen);

      $content.find(".ujg-pa-load").off("click").on("click", function() {
        var j = getJqlFromUI();
        var p = getPeriodFromUI();
        if (j) state.settings.jqlFilter = j;
        if (p) { state.settings.periodStart = p.start; state.settings.periodEnd = p.end; }
        saveSettings(state.settings);
        loadAndAnalyze();
      });

      $content.find(".ujg-pa-set").off("click").on("click", function() {
        state.settings = mergeDefaults(loadSettings());
        openSettingsModal();
      });

      $content.find(".ujg-pa-wf").off("click").on("click", function() {
        var list =
          (state.analyticsData && state.analyticsData._allStatuses && state.analyticsData._allStatuses.length) ? state.analyticsData._allStatuses :
          ((state.workflow && state.workflow.allStatuses) ? state.workflow.allStatuses : []);
        openWorkflowModal(list);
      });
    }

    function render() {
      ensureFullWidth();

      var s = state.settings;
      var dp = getDefaultPeriod();
      var jql = s.jqlFilter || "project = PROJ";
      var start = s.periodStart || dp.start;
      var end = s.periodEnd || dp.end;

      var wrapper = '<div class="ujg-pa-page"><div class="ujg-pa-inner">' + panelHtml(jql, start, end);

      if (state.lastError) {
        wrapper += '<div class="ujg-pa-card" style="margin-bottom:10px;"><div class="ujg-pa-card-body">' +
          '<span class="ujg-pa-badge bad">Ошибка</span> ' +
          '<span style="margin-left:8px; color:#b42318; font-weight:700;">' + esc(state.lastError) + "</span>" +
        "</div></div>";
      }

      wrapper += '<div class="ujg-pa-hint">Подсказка: период до <b>' + esc(CONFIG.MAX_PERIOD_DAYS) + "</b> дней. Для лучшего Cycle/Review/Testing анализа настройте категории workflow.</div>";
      wrapper += "</div></div>";

      $cont.html(wrapper);
      API.resize();

      bindPanel();
    }

    // first render
    render();

    // auto-load if settings present
    if (state.settings && state.settings.jqlFilter) {
      // не автозагружаем без явного клика, чтобы не долбить API неожиданно
    }
  }

  return ProjectAnalyticsGadget;
});

