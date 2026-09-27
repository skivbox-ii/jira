define("_ujgESI_activityAiUi", ["jquery", "_ujgESI_activityAi", "_ujgESI_activityMarkdown", "_ujgESI_icons"], function($, activityAi, markdown, icon) {
  "use strict";
  function create() {
    var $dialog, $report, $partial, $history, $question, $ask, $generate, $stop, $progress, $error, $stale, $meta;
    var anchor, previousOverflow, currentPlan, currentState, services, session, serial = 0, destroyed = false;
    var scopeKey = "", fingerprint = "", preparationError = "", renderContextKey, renderedReport, renderedPartial, renderedHistory;
    var pendingReport, selectionKey = "", days = 7, $budget, $context, $modes, $facts;
    function compact() { return services && typeof services.onPrepareActivityBrief === "function"; }
    function conversation() { return session ? [{question:"Исходный отчёт по этому срезу",answer:session.markdown}].concat(session.history) : []; }
    function preview(question) {
      if (!compact() || !currentPlan) return null;
      return services.onPreviewActivityBrief(question ? session.plan : currentPlan,{question:question || undefined,history:question ? conversation() : []});
    }
    function button(className, label, iconName, action) {
      return $("<button/>").attr({type:"button","aria-label":label}).addClass(className).append(icon(iconName),$("<span/>").text(label)).on("click",action);
    }
    function formatDate(date) {
      return /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date.slice(8,10) + "." + date.slice(5,7) + "." + date.slice(0,4) : String(date || "");
    }
    function cutoff(asOf,date) {
      var time = Date.parse(asOf || "");
      if (isFinite(time) && time === Date.parse(date + "T00:00:00+03:00") + 86400000) return "24:00 МСК";
      return isFinite(time) ? new Date(time + 10800000).toISOString().slice(11,16) + " МСК" : "время среза неизвестно";
    }
    function textError(error) { return String(error && error.message || error || "Ошибка запроса"); }
    function renderAnswer($target,value) {
      $target.empty().append(markdown.render(value || "", {baseUrl:currentState && currentState.baseUrl,teams:currentState && currentState.teams}));
    }
    function refresh() {
      if (!$dialog) return;
      var coverage = currentPlan && currentPlan.coverage || {};
      $meta.text(currentPlan ? (currentPlan.fromDate && currentPlan.fromDate !== currentPlan.date ? formatDate(currentPlan.fromDate) + " — " : "") + formatDate(currentPlan.date) + " · на " + cutoff(currentPlan.asOf,currentPlan.date) + " · история: " + (coverage.complete == null ? "?" : coverage.complete) + " / " + (coverage.total == null ? "?" : coverage.total) + (coverage.isComplete === false ? " · неполная" : "") + " · событий: " + (currentPlan.eventCount == null ? "?" : currentPlan.eventCount) : "Контекст недоступен");
      $stale.text(session && session.markdown && session.fingerprint !== fingerprint ? "Отчёт устарел: данные обновились. Сформируйте новый отчёт для этого среза." : "");
      var reportText = session && session.markdown || "", partialText = session && session.partial || "";
      $facts.empty();
      if (!reportText && currentPlan && currentPlan.factsMarkdown) $facts.append($("<h3/>").text("Сводка расчётов"),$("<p/>").text(currentPlan.factsMarkdown));
      var history = session && session.history || [], historyKey = JSON.stringify(history);
      if (renderedReport !== reportText) { $report.empty(); if (reportText) renderAnswer($report,reportText); renderedReport = reportText; }
      if (renderedPartial !== partialText) {
        $partial.empty();
        if (partialText) {
          $partial.append($("<strong/>").text("Неполный ответ, использовать как итог нельзя"));
          renderAnswer($("<div/>").appendTo($partial),partialText);
        }
        renderedPartial = partialText;
      }
      if (renderedHistory !== historyKey) {
        $history.empty();
        history.forEach(function(item) {
          var $item = $("<section/>").addClass("ujg-esi-ai-exchange");
          $item.append($("<strong/>").text(item.question));
          renderAnswer($("<div/>").appendTo($item),item.answer);
          $history.append($item);
        });
        renderedHistory = historyKey;
      }
      var busy = !!(session && session.busy);
      var previewError = "", prepared;
      if (compact() && currentPlan) {
        try { prepared = preview(session && session.markdown && session.fingerprint === fingerprint ? String($question.val() || "").trim() : ""); }
        catch (error) { previewError = textError(error); }
        var budget = prepared && prepared.meta || currentPlan.meta;
        $budget.text("1 запрос · контекст: " + budget.userBytes + " / " + budget.userLimit + " байт · инструкции: " + budget.systemBytes + " / " + budget.systemLimit + " байт. Сводные расчёты: " + budget.totalRemarks + " замечаний. Подробно: " + budget.detailedRemarks + " из " + budget.totalRemarks + "; без деталей: " + budget.omittedRemarks + ". Сокращённых полей: " + budget.truncatedFields + "." + (budget.conversationOmitted || budget.conversationClipped ? " В истории диалога пропущено: " + (budget.conversationOmitted || 0) + "; сокращено: " + (budget.conversationClipped || 0) + "." : ""));
        $context.text(prepared ? prepared.request.systemPrompt + "\n\n" + prepared.request.userPrompt : previewError);
      } else { $budget.empty(); $context.empty(); }
      $modes.find("button").prop("disabled",busy).each(function() { $(this).attr("aria-pressed",Number($(this).attr("data-ai-days")) === days ? "true" : "false"); });
      $generate.prop("disabled",busy || !currentPlan || !currentPlan.asOf);
      $stop.prop("hidden",!busy);
      $ask.prop("disabled",busy || !!previewError || !session || !session.markdown || session.fingerprint !== fingerprint || !$question.val().trim());
      $question.prop("disabled",busy || !session || !session.markdown || session.fingerprint !== fingerprint);
      $progress.text(busy ? session.progress || "Подготовка запроса…" : "");
      $error.text(preparationError || previewError || (!currentPlan || !currentPlan.asOf ? "Нет достоверного времени среза; сформировать отчёт нельзя." : session && session.error || ""));
    }
    function request(question) {
      if (!currentPlan || !currentPlan.asOf || !services || typeof services.onActivityLlmRequest !== "function" || session && session.busy) return;
      if (question && (!session || !session.markdown || session.fingerprint !== fingerprint)) return;
      try { preview(question); } catch (error) { if (session) session.error = textError(error); refresh(); return; }
      var plan = question ? session.plan : currentPlan;
      var requestText = services.onActivityLlmRequest;
      var active = ++serial;
      if (!question) session = {plan:session && session.plan || plan,fingerprint:session && session.fingerprint || "",markdown:session && session.markdown || "",history:session && session.history || [],draft:session && session.draft || "",error:"",busy:true,progress:"",partial:""};
      else { session.busy = true; session.error = ""; session.progress = ""; session.partial = ""; }
      refresh();
      var options = {
        question:question || undefined,
        history:question ? conversation() : [],
        onProgress:function(value) {
          if (active !== serial || !session) return;
          session.progress = (compact() ? "Запрос: " : value.phase === "context" ? "Подготовка контекста: " : "Обработано частей: ") + value.completed + " / " + value.total;
          if ($dialog) $progress.text(session.progress);
        },
        isCancelled:function() { return destroyed || active !== serial; }
      };
      var run = compact() ? services.onRunActivityBrief : activityAi.run;
      Promise.resolve().then(function() { return run(plan,function(part) { return requestText(part); },options); }).then(function(result) {
        if (active !== serial || !session) return;
        var answered = false;
        session.busy = false;
        if (result.completedParts != null && result.totalParts != null && result.completedParts < result.totalParts) {
          session.error = "Отчёт неполный: обработано " + result.completedParts + " / " + result.totalParts + " частей.";
          if (result.markdown) session.partial = result.markdown;
        } else if (question) {
          session.history.push({question:question,answer:result.markdown || ""});
          session.draft = "";
          $question.val("");
          answered = true;
        } else {
          session.plan = plan;
          session.fingerprint = plan.fingerprint;
          session.markdown = result.markdown || "";
          session.history = [];
          session.error = "";
        }
        refresh();
        if (answered && $dialog) {
          var $content = $dialog.find(".ujg-esi-ai-content");
          $content.scrollTop($content[0].scrollHeight);
        }
      }).catch(function(error) {
        if (active !== serial || !session) return;
        session.busy = false;
        session.error = textError(error);
        session.partial = error && error.markdown || error && error.partialMarkdown || "";
        refresh();
      });
    }
    function dismiss() {
      if (!$dialog) return false;
      if (session) session.draft = String($question.val() || "");
      $dialog.remove(); $dialog = null;
      document.body.style.overflow = previousOverflow;
      if (anchor && document.contains(anchor)) { $(anchor).attr("aria-expanded","false"); anchor.focus(); }
      anchor = null;
      return true;
    }
    function rebindAnchor(control) {
      if (!$dialog || !control) return;
      if (anchor) $(anchor).attr("aria-expanded","false");
      anchor = control;
      $(anchor).attr("aria-expanded","true");
    }
    function open(control) {
      if (destroyed) return;
      if ($dialog) { $dialog.trigger("focus"); return; }
      prepareCurrent();
      anchor = control || document.activeElement;
      if (anchor) $(anchor).attr("aria-expanded","true");
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      $dialog = $("<section/>").addClass("ujg-esi-ai-dialog ujg-esi-activity-ai-dialog").attr({role:"dialog","aria-modal":"true","aria-label":"LLM-отчёт",tabindex:"-1"}).appendTo(document.body);
      renderedReport = renderedPartial = renderedHistory = undefined;
      var $head = $("<header/>").addClass("ujg-esi-ai-header").append($("<h2/>").text("LLM-отчёт"),button("ujg-esi-ai-close","Закрыть","X",dismiss).attr("aria-label","Закрыть LLM-отчёт"));
      $meta = $("<div/>").addClass("ujg-esi-ai-meta");
      $modes = $("<div/>").addClass("ujg-esi-ai-modes").attr({role:"group","aria-label":"Период отчёта"});
      if (compact()) [7,1].forEach(function(value) {
        $modes.append($("<button/>").attr({type:"button","data-ai-days":value}).text(value === 7 ? "Общий за 7 дней" : "За день").on("click",function() {
          if (session && session.busy || days === value) return;
          days = value; serial++; session = null; $question.val(""); prepareCurrent();
        }));
      });
      $budget = $("<p/>").addClass("ujg-esi-ai-budget");
      $context = $("<pre/>").addClass("ujg-esi-ai-context");
      var $contextDisclosure = $("<details/>").addClass("ujg-esi-ai-disclosure").append($("<summary/>").text("Контекст запроса"),$context);
      $generate = button("ujg-esi-ai-generate","Сформировать отчёт","WandSparkles",function() { request(""); });
      $stop = button("ujg-esi-ai-stop","Остановить","X",function() {
        serial++;
        if (session) { session.busy = false; session.progress = ""; session.error = "Запрос остановлен."; }
        refresh();
      });
      $progress = $("<p/>").addClass("ujg-esi-ai-progress").attr({role:"status","aria-live":"polite"});
      $stale = $("<p/>").addClass("ujg-esi-ai-stale");
      $error = $("<p/>").addClass("ujg-esi-ai-error").attr({role:"alert"});
      $report = $("<article/>").addClass("ujg-esi-ai-report");
      $facts = $("<section/>").addClass("ujg-esi-ai-facts");
      $partial = $("<div/>").addClass("ujg-esi-ai-partial");
      $history = $("<div/>").addClass("ujg-esi-ai-history");
      $question = $("<textarea/>").addClass("ujg-esi-ai-question").attr({"aria-label":"Вопрос по отчёту",rows:2,placeholder:"Вопрос по этому срезу"}).val(session && session.draft || "");
      $ask = button("ujg-esi-ai-ask","Отправить вопрос","ArrowUp",function() { var question = String($question.val() || "").trim(); if (question) request(question); });
      $question.on("input",function() { if (session) session.draft = this.value; refresh(); });
      var $content = $("<div/>").addClass("ujg-esi-ai-content").append($budget,compact() ? $contextDisclosure : [],$stale,$error,$facts,$report,$partial,$history);
      $dialog.append($head,$meta,$modes,$("<div/>").addClass("ujg-esi-ai-actions").append($generate,$stop,$progress),$content,$("<div/>").addClass("ujg-esi-ai-compose").append($question,$ask));
      $dialog.on("keydown",function(event) {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(); return; }
        if (event.key !== "Tab") return;
        var $items = $dialog.find('button:not(:disabled):not([hidden]),textarea:not(:disabled),a[href],summary,[tabindex="0"]');
        var first = $items[0], last = $items[$items.length-1];
        if (!first) { event.preventDefault(); $dialog.trigger("focus"); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === $dialog[0])) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      });
      refresh();
      $dialog.find("button").first().trigger("focus");
    }
    function update(report,state,nextServices) {
      if (destroyed) return;
      currentState = state || {}; services = nextServices || {};
      pendingReport = report;
      var nextSelection = JSON.stringify([currentState.baseUrl,currentState.preferencesStorageKey,currentState.userScope,
        currentState.projectKey,currentState.epicKey,currentState.viewMode,report && report.date,
        report && report.componentScope ? report.componentScope.map(function(item) { return item.id; }).sort() : null]);
      if (selectionKey !== nextSelection) {
        selectionKey = nextSelection; serial++; session = null;
        if ($dialog) $question.val("");
      }
      var nextRenderContext = JSON.stringify([currentState.baseUrl || "",currentState.teams || []]);
      if (nextRenderContext !== renderContextKey) {
        renderedReport = renderedPartial = renderedHistory = undefined;
        renderContextKey = nextRenderContext;
      }
      if (!$dialog && !(session && session.busy)) { currentPlan = null; return; }
      prepareCurrent();
    }
    function prepareCurrent() {
      var plan = null;
      preparationError = "";
      try { plan = compact() ? services.onPrepareActivityBrief(pendingReport,currentState,days) : activityAi.prepare(pendingReport,{projectKey:currentState.projectKey,epicKey:currentState.epicKey,
        baseUrl:currentState.baseUrl,preferencesStorageKey:currentState.preferencesStorageKey,userScope:currentState.userScope,viewMode:currentState.viewMode}); }
      catch (error) { preparationError = textError(error); }
      var nextScope = plan ? plan.scopeKey : selectionKey;
      var nextFingerprint = plan && plan.fingerprint || "";
      if (nextScope !== scopeKey) {
        serial++; session = null; scopeKey = nextScope;
        if ($dialog) $question.val("");
      }
      else if (nextFingerprint !== fingerprint) { serial++; if (session) session.busy = false; }
      fingerprint = nextFingerprint; currentPlan = plan;
      refresh();
    }
    function suspend() { serial++; if (session) session.busy = false; dismiss(); }
    function destroy() { suspend(); destroyed = true; session = null; currentPlan = null; pendingReport = null; }
    return {update:update,open:open,dismiss:dismiss,rebindAnchor:rebindAnchor,suspend:suspend,destroy:destroy};
  }
  return {create:create};
});
