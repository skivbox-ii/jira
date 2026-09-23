(function() {
  var rendering = modules._ujgESI_rendering;
  var originalInit = rendering.init, originalRender = rendering.render;
  var callbacks, currentState, phase = new URLSearchParams(location.search).has("empty") ? "manual" : "waiting";
  rendering.init = function(container, services) {
    callbacks = services;
    return originalInit(container, services);
  };
  rendering.render = function(state) {
    currentState = state;
    if (phase === "loading" && !state.loading && state.rows.length) {
      phase = "syncing";
      state.rows.forEach(function(row) {
        var id = String(row.sourceColumns["№"]);
        if (id === "816") { row.status = "failed"; row.errors = ["Jira не приняла обязательное поле компонента."]; }
        if (id === "817") { row.status = "partial"; row.createdKey = row.jiraKey; row.errors = ["Story и BE созданы, QA не создана: не указан исполнитель."]; }
      });
      Promise.resolve().then(function() { callbacks.onSyncJira(); });
    }
    return originalRender(state);
  };
  new modules._ujgExcelStoryImporter({getGadgetContentEl:function(){return jQuery("#root");},resize:function(){}});
  if (phase === "manual") return;
  fetch("/fixture.xlsx").then(function(response) {
    if (!response.ok) throw new Error("Не удалось загрузить демонстрационный Excel.");
    return response.arrayBuffer();
  }).then(function(buffer) {
    if (!currentState.projectKey) callbacks.onProjectChange("EVOSCADA");
    phase = "loading";
    callbacks.onFileChange(new File([buffer], "График замечаний.xlsx", {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
  }).catch(function(error) {
    document.querySelector("footer").textContent = error.message;
  });
})();
