define("_ujgESI_statusTransitionUi", ["jquery", "_ujgESI_icons"], function($, icon) {
  "use strict";
  function jiraUrl(base,key) {
    if (!/^[A-Za-z][A-Za-z0-9_]*-[1-9][0-9]*$/.test(key || "")) return null;
    try { var url=new URL(base); return /^https?:$/.test(url.protocol) ? url.origin + url.pathname.replace(/\/+$/,"") + "/browse/" + encodeURIComponent(key) : null; } catch (_) { return null; }
  }
  function create() {
    var host=null, services=null, state=null, open=false, anchor=null, overflow=null;
    function button(className,label,action,iconName) {
      var el=$("<button type='button'/>").addClass(className).attr({"aria-label":label,title:label,"data-status-focus":className}).on("click",action);
      return iconName ? el.append(icon(iconName)) : el.text(label);
    }
    function close() { if (state && !state.running) services.onCloseStatusTransition(); }
    function keydown(e) {
      if (!open) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
      var items=host.find("button:not(:disabled),a[href]").toArray();
      if (e.key === "Tab" && items.length) {
        var first=items[0], last=items[items.length-1], active=document.activeElement;
        if (e.shiftKey && (active === first || !host[0].contains(active))) { last.focus(); e.preventDefault(); }
        else if (!e.shiftKey && (active === last || !host[0].contains(active))) { first.focus(); e.preventDefault(); }
      }
      if (/^(ArrowDown|ArrowUp|ArrowLeft|ArrowRight)$/.test(e.key) && $(e.target).is("[data-transition-id]")) {
        var choices=host.find("[data-transition-id]:not(:disabled)").toArray(), index=choices.indexOf(e.target);
        if (choices.length) { choices[(index + (/^(ArrowDown|ArrowRight)$/.test(e.key) ? 1 : choices.length-1)) % choices.length].focus(); e.preventDefault(); }
      }
    }
    function destroy() {
      $(document).off("keydown.ujgStatusTransition");
      if (open) document.body.style.overflow=overflow;
      open=false;
      if (host) host.empty();
    }
    function render(target, data, svc) {
      host=target; services=svc; state=data.statusTransition || {};
      if (!state.open) {
        if (open) {
          destroy();
          var restored=anchor && anchor.isConnected ? anchor : $(document).find(".ujg-esi-status-trigger[data-issue-key]").filter(function() {
            return $(this).attr("data-issue-key") === state.key && !this.disabled;
          })[0];
          if (restored) restored.focus();
        }
        return;
      }
      var focus=host[0].contains(document.activeElement) ? $(document.activeElement).attr("data-status-focus") : null;
      var oldScroll=host.find(".ujg-esi-status-body").scrollTop() || 0;
      if (!open) {
        anchor=document.activeElement; overflow=document.body.style.overflow; document.body.style.overflow="hidden";
        open=true; $(document).on("keydown.ujgStatusTransition",keydown);
      }
      host.empty();
      host.append($("<div/>").addClass("ujg-esi-status-overlay").attr("aria-hidden","true"));
      var dialog=$("<section/>").addClass("ujg-esi-status-dialog").attr({role:"dialog","aria-modal":"true","aria-label":"Статус Jira: " + state.key,"data-issue-key":state.key,tabindex:"-1"});
      var head=$("<header/>").addClass("ujg-esi-status-head").append($("<h2/>").text("Статус Jira · " + state.key));
      head.append(button("ujg-esi-status-close","Закрыть",close,"X").prop("disabled",!!state.running)); dialog.append(head);
      var body=$("<div/>").addClass("ujg-esi-status-body"), blocked=!!(state.loading || state.running);
      if (state.message) body.append($("<p/>").addClass("ujg-esi-status-message").attr({role:/failed|rejected|unconfirmed/.test(state.outcome || "") ? "alert" : "status","aria-live":"polite"}).text(state.message));
      if (state.outcome === "load-failed") body.append(button("ujg-esi-status-retry","Повторить чтение",services.onRetryStatusTransition).prop("disabled",blocked));
      var recovery=/^(refresh-failed|unconfirmed)$/.test(state.outcome || "");
      if (recovery) body.append(button("ujg-esi-status-refresh","Обновить данные",services.onRefreshStatusTransition).prop("disabled",blocked));
      var choices=$("<div/>").addClass("ujg-esi-status-choices").attr({role:"radiogroup","aria-label":"Доступные переходы"});
      (state.transitions || []).forEach(function(t) {
        var choice=button("ujg-esi-status-choice",t.name + " → " + t.target,function() { services.onSelectStatusTransition(t.id); })
          .attr({role:"radio","aria-checked":String(state.selectedId === t.id),"data-transition-id":t.id,"data-status-focus":"transition-"+t.id})
          .prop("disabled",blocked || recovery || state.outcome === "success");
        choice.append($("<small/>").text(t.hint)); choices.append(choice);
      });
      body.append(choices);
      var selected=(state.transitions || []).find(function(t) { return t.id === state.selectedId; });
      if (selected && !selected.simple) {
        var fields=$("<div/>").addClass("ujg-esi-status-fields");
        fields.append($("<p/>").text("Этот переход выполняется в карточке Jira"));
        (selected.fields || []).forEach(function(field) { fields.append($("<p/>").text(field.name + (field.required ? " (обязательное)" : ""))); });
        body.append(fields);
      }
      dialog.append(body);
      var footer=$("<footer/>").addClass("ujg-esi-status-footer"), url=jiraUrl(data.baseUrl,state.key);
      if (url) footer.append($("<a/>").addClass("ujg-esi-status-jira").attr({href:url,target:"_blank",rel:"noopener noreferrer","data-status-focus":"jira"}).text("Открыть Jira"));
      footer.append(button("ujg-esi-status-apply","Применить",services.onApplyStatusTransition)
        .prop("disabled",blocked || recovery || state.outcome === "success" || !selected || !selected.simple));
      dialog.append(footer); host.append(dialog); body.scrollTop(oldScroll);
      var next=focus ? host.find("[data-status-focus]").filter(function() { return $(this).attr("data-status-focus") === focus && !this.disabled; })[0] : null;
      (next || head.find("button:not(:disabled)")[0] || dialog[0]).focus();
    }
    return {render:render,destroy:destroy};
  }
  return {create:create};
});
