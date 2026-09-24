define("_ujgESI_statisticsUi", ["jquery", "_ujgESI_statistics"], function($, statistics) {
  "use strict";
  function table(title, columns, rows) {
    var $section = $("<section/>").addClass("ujg-esi-stats-section").append($("<h3/>").text(title));
    var $table = $("<table/>").attr("aria-label",title), $head = $("<tr/>"), $body = $("<tbody/>");
    columns.forEach(function(column) { $head.append($("<th/>").attr("scope","col").text(column[1])); });
    rows.forEach(function(row) {
      var $row = $("<tr/>");
      columns.forEach(function(column,index) {
        var $cell = $(index ? "<td/>" : "<th/>").text(row[column[0]] == null ? "" : row[column[0]]);
        if (!index) $cell.attr("scope","row");
        $row.append($cell);
      });
      $body.append($row);
    });
    if (!rows.length) $body.append($("<tr/>").append($("<td/>").attr("colspan",columns.length).text("Нет данных")));
    return $section.append($table.append($("<thead/>").append($head),$body));
  }
  function render($parent,state) {
    var data = statistics.summarize(state.rows || [],state.teams);
    var $root = $("<div/>").addClass("ujg-esi-statistics");
    $root.append($("<p/>").addClass("ujg-esi-stats-scope").text("Все загруженные · Замечаний: " + data.total + " · Строк: " + data.sourceRows));
    var $tables = $("<div/>").addClass("ujg-esi-stats-tables");
    $tables.append(table("Итог по замечаниям",[["label","Состояние"],["count","Замечания"]],data.outcomes));
    $tables.append(table("Текущие направления",[["label","Направление"],["remarks","Замечания"],["tasks","Задачи"]],data.directions));
    $tables.append(table("На командах",[["label","Команда"],["remarks","Замечания"],["open","Открыто"],["progress","В работе"],["testing","Тест"],["waiting","Ожидают"]],data.teams));
    $tables.append(table("Задачи по ролям",[["label","Роль"],["open","Открыто"],["testing","Тест"],["done","Готово"],["cancelled","Отмена"],["unknown","Нет данных"]],data.roles));
    $root.append($tables,$("<p/>").addClass("ujg-esi-stats-note").text("Итог: каждое замечание учтено один раз. Направления и команды пересекаются. На командах: открытые задачи по участникам; без известной команды исполнителя учитывается роль задачи."));
    $parent.append($root);
  }
  return {render:render};
});
