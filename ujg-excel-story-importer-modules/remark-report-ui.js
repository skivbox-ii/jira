define("_ujgESI_remarkReportUi", ["jquery","_ujgESI_remarkReport","_ujgESI_activityMarkdown","_ujgESI_icons"], function($, engine, markdown, icon) {
  "use strict";
  function scope(state) {
    return JSON.stringify([state.baseUrl,state.projectKey,state.epicKey,state.preferencesStorageKey,state.userScope,state.viewMode]);
  }
  function stamp(value) {
    var ms = Date.parse(value);
    if (!isFinite(ms)) return "время неизвестно";
    var text=new Date(ms+10800000).toISOString();
    return text.slice(8,10)+"."+text.slice(5,7)+"."+text.slice(0,4)+" "+text.slice(11,19)+" МСК";
  }
  function create() {
    var $dialog, $meta, $coverage, $budget, $context, $errors, $warnings, $progress, $answer, $generate, $refresh;
    var serial = 0, plan = null, busy = false, anchor, previousOverflow, currentScope, sourceRows, state, services, group, destroyed = false;
    function button(name,text,className,action) {
      return $("<button/>").attr({type:"button",title:text,"aria-label":text}).addClass(className).append(icon(name),$("<span/>").text(text)).on("click",action);
    }
    function dismiss() {
      serial++; busy=false; plan=null;
      if (!$dialog) return;
      $dialog.remove();$dialog=null;document.body.style.overflow=previousOverflow;
      if (anchor && document.contains(anchor)) { $(anchor).attr("aria-expanded","false");anchor.focus(); }
      anchor=null;
    }
    function controls() {
      $generate.prop("disabled",busy || !plan || !plan.canGenerate);
      $refresh.prop("disabled",busy);
      $dialog.attr("aria-busy",String(busy));
    }
    function read() {
      var active=++serial;busy=true;plan=null;
      $errors.empty();$warnings.empty();$coverage.empty();$budget.empty();$context.empty();$answer.empty();
      $meta.text("Весь жизненный путь · чтение актуальных данных Jira");
      $progress.text("Чтение исходной истории");controls();
      function cancelled() { return active!==serial || !$dialog || destroyed; }
      Promise.resolve().then(function() {
        if (cancelled()) return;
        if (!services || typeof services.onLoadRemarkReport!=="function") throw new Error("Загрузка разбора недоступна.");
        return services.onLoadRemarkReport(group.key,{isCancelled:cancelled,onProgress:function(value) {
          if (cancelled()) return;
          var labels={story:"История",tasks:"Связанные задачи",comments:"Комментарии",worklogs:"Трудозатраты",verify:"Проверка актуальности"};
          $progress.text((labels[value.phase] || "Чтение") + " · " + value.key + (value.total != null ? " · " + value.completed + " / " + value.total : ""));
        }});
      }).then(function(result) {
        if (cancelled()) return;
        plan=engine.prepare(result.row,state.teams || [],{asOf:result.asOf,startedAt:result.startedAt,scopeKey:currentScope,sourceWarnings:result.sourceWarnings || []});
        var c=plan.coverage,m=plan.meta;
        $meta.text("Весь жизненный путь · загружено " + stamp(plan.asOf));
        if (result.startedAt) $meta.append($("<span/>").text(" · Чтение начато " + stamp(result.startedAt)));
        $coverage.text("История задач: " + c.completeTasks + " / " + c.totalTasks + " · Комментарии: " + c.commentsComplete + " / " + c.totalComments + " · Значимых изменений: " + c.eventCount + (c.isComplete ? " · Полнота подтверждена для доступного снимка" : " · Данные неполны"));
        $budget.text("1 запрос LLM · Контекст: " + m.userBytes + " / " + m.userLimit + " байт · Инструкции: " + m.systemBytes + " / " + m.systemLimit + " байт");
        $context.text(plan.request.systemPrompt + "\n\n" + plan.request.userPrompt);
        (plan.blockers || []).forEach(function(text) { $errors.append($("<p/>").text(text)); });
        (plan.warnings || []).forEach(function(text) { $warnings.append($("<p/>").text(text)); });
        busy=false;$progress.empty();controls();
      }).catch(function(error) {
        if (cancelled()) return;
        busy=false;plan=null;$progress.empty();$errors.text(String(error && error.message || "Не удалось загрузить данные."));controls();
      });
    }
    function generate() {
      if (busy || !plan || !plan.canGenerate || !services || typeof services.onActivityLlmRequest!=="function") return;
      busy=true;var active=++serial, snapshot=plan;
      $errors.empty();$progress.text("LLM анализирует замечание · 1 запрос");controls();
      function cancelled() { return active!==serial || !$dialog || destroyed; }
      Promise.resolve().then(function() {
        if (cancelled()) return;
        return engine.run(snapshot,services.onActivityLlmRequest,{isCancelled:cancelled});
      }).then(function(result) {
        if (cancelled()) return;
        busy=false;$progress.empty();
        $answer.empty().append(markdown.render(result.markdown,{baseUrl:state.baseUrl,teams:state.teams}));
        $dialog.find(".ujg-esi-ai-disclosure").prop("open",false);
        $dialog.find(".ujg-esi-ai-content").scrollTop(0);controls();
      }).catch(function(error) {
        if (cancelled()) return;
        busy=false;$progress.empty();$errors.text(String(error && error.message || "Не удалось получить ответ LLM."));controls();
      });
    }
    function open(nextGroup,nextState,nextServices,control) {
      if (destroyed) return;
      dismiss(); group=nextGroup;services=nextServices;currentScope=scope(nextState);sourceRows=nextState.rows;
      state={baseUrl:nextState.baseUrl,teams:JSON.parse(JSON.stringify(nextState.teams || []))};
      anchor=control || document.activeElement;previousOverflow=document.body.style.overflow;document.body.style.overflow="hidden";
      if (anchor) $(anchor).attr("aria-expanded","true");
      $dialog=$("<section/>").addClass("ujg-esi-activity-ai-dialog ujg-esi-remark-report-dialog").attr({role:"dialog","aria-modal":"true","aria-label":"AI-разбор замечания",tabindex:"-1"}).appendTo(document.body);
      var $header=$("<header/>").addClass("ujg-esi-ai-header").append($("<h2/>").text("AI-разбор замечания #" + (group.remarkId || group.key)),
        button("X","Закрыть разбор","ujg-esi-remark-close",dismiss));
      var $identity=$("<div/>").addClass("ujg-esi-remark-identity").append(markdown.render(group.key,{baseUrl:state.baseUrl,teams:state.teams}),$("<p/>").text(group.summary || ""));
      $meta=$("<div/>").addClass("ujg-esi-ai-meta ujg-esi-remark-meta");
      $coverage=$("<p/>").addClass("ujg-esi-remark-coverage");
      $budget=$("<p/>").addClass("ujg-esi-ai-budget");
      $context=$("<pre/>").addClass("ujg-esi-ai-context ujg-esi-remark-context");
      $errors=$("<div/>").addClass("ujg-esi-ai-error ujg-esi-remark-errors").attr("role","alert");
      $warnings=$("<div/>").addClass("ujg-esi-remark-warnings");
      $progress=$("<p/>").addClass("ujg-esi-ai-progress").attr({role:"status","aria-live":"polite"});
      $answer=$("<article/>").addClass("ujg-esi-remark-answer");
      $generate=button("WandSparkles","Сформировать","ujg-esi-remark-generate",generate);
      $refresh=button("RefreshCw","Обновить данные","ujg-esi-remark-refresh",read);
      var $content=$("<div/>").addClass("ujg-esi-ai-content").append($identity,$coverage,$budget,$errors,$warnings,
        $("<details/>").addClass("ujg-esi-ai-disclosure").append($("<summary/>").text("Контекст запроса"),$context),$answer);
      $dialog.append($header,$meta,$("<div/>").addClass("ujg-esi-ai-actions").append($generate,$refresh,$progress),$content);
      $dialog.on("keydown",function(event) {
        if (event.key==="Escape") {event.preventDefault();event.stopPropagation();dismiss();return;}
        if(event.key!=="Tab")return;
        var $items=$dialog.find('button:not(:disabled),a[href],summary').filter(function(){return !$(this).parents("details:not([open])").length || this.tagName==="SUMMARY";});
        var first=$items[0],last=$items[$items.length-1];
        if(event.shiftKey && (document.activeElement===first || document.activeElement===$dialog[0])) {event.preventDefault();last.focus();}
        else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
      });
      read();$dialog.find(".ujg-esi-remark-close").trigger("focus");
    }
    function rebindAnchor(controls) {
      if (!$dialog) return;
      var replacement=(controls || []).filter(function(control) {return $(control).attr("data-remark-key")===group.key;})[0];
      if (!replacement) return;
      if (anchor) $(anchor).attr("aria-expanded","false");
      anchor=replacement;$(anchor).attr("aria-expanded","true");
    }
    return {open:open,dismiss:dismiss,rebindAnchor:rebindAnchor,updateScope:function(nextState) {if($dialog && (scope(nextState)!==currentScope || nextState.rows!==sourceRows))dismiss();},destroy:function(){dismiss();destroyed=true;}};
  }
  return {create:create};
});
