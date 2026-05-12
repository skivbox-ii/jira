define("_ujgESI_rendering", ["jquery"], function($) {
  "use strict";

  var $root;
  var services;

  function init(container, svc) {
    $root = container;
    services = svc || {};
  }

  function render(state) {
    if (!$root || !$root.length) return;
    $root.empty();
    var s = state || {};
    var $wrap = $("<div/>").addClass("ujg-excel-story-importer");
    $wrap.append($("<h2/>").text("Импорт замечаний из Excel"));
    if (s.error) $wrap.append($("<div/>").addClass("ujg-esi-error").text(s.error));
    $wrap.append($("<div/>").addClass("ujg-esi-toolbar"));
    $root.append($wrap);
  }

  return {
    init: init,
    render: render,
  };
});
