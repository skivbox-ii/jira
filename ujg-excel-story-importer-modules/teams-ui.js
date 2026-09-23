define("_ujgESI_teamsUi", ["jquery", "_ujgESI_teams", "_ujgESI_icons"], function($, teamsModule, icon) {
  "use strict";

  function button(className, label, iconName, action) {
    return $("<button/>", { type: "button", "class": className, "aria-label": label, title: label })
      .append(icon(iconName)).on("click", action);
  }
  function sameUser(a, b) {
    var left = a && Array.isArray(a.identifiers) ? a.identifiers : [];
    var right = b && Array.isArray(b.identifiers) ? b.identifiers : [];
    return !!(a && b && ((a.id && b.id && a.id === b.id) || left.some(function(id) { return right.indexOf(id) >= 0; })));
  }
  function renderPicker(row, team, state, hooks) {
    var selected = Array.isArray(team.members) ? team.members : [];
    var picker = $("<div/>").addClass("ujg-esi-team-picker");
    var chips = $("<div/>").addClass("ujg-esi-team-chips");
    selected.forEach(function(user) {
      chips.append(button("ujg-esi-team-chip", "Удалить участника " + user.label, "X", function() {
        hooks.onTeamMemberToggle(team.id, user);
      }).attr("data-user-id", user.id).append($("<span/>").text(user.label)));
    });
    picker.append(chips);
    var query = state.teamMemberPicker && state.teamMemberPicker.query || "";
    picker.append($("<input/>", { type: "search", "class": "ujg-esi-team-search", "aria-label": "Поиск участников команды", placeholder: "Поиск пользователей" })
      .val(query).on("input", function() { hooks.onTeamMembersSearch(team.id, $(this).val()); }));
    if (state.teamUsersLoading) picker.append($("<div/>").addClass("ujg-esi-team-loading").text("Загрузка пользователей..."));
    if (state.teamUsersError) picker.append($("<div/>").addClass("ujg-esi-team-error").text(state.teamUsersError));
    var users = selected.slice();
    (Array.isArray(state.teamUsers) ? state.teamUsers : []).forEach(function(user) {
      if (!users.some(function(existing) { return sameUser(existing, user); })) users.push(user);
    });
    var needle = String(query).trim().toLowerCase();
    users.forEach(function(user) {
      var isSelected = selected.some(function(existing) { return sameUser(existing, user); });
      var searchable = [user.label, user.id].concat(Array.isArray(user.identifiers) ? user.identifiers : []).join(" ").toLowerCase();
      if (!isSelected && needle && searchable.indexOf(needle) < 0) return;
      picker.append($("<button/>", { type: "button", "class": "ujg-esi-team-member-row" + (isSelected ? " is-selected" : ""), "data-user-id": user.id, "aria-pressed": String(isSelected), "aria-label": (isSelected ? "Удалить участника " : "Добавить участника ") + user.label })
        .text(user.label).on("click", function() { hooks.onTeamMemberToggle(team.id, user); }));
    });
    row.append(picker);
  }
  function render($parent, state, hooks) {
    state = state || {};
    hooks = hooks || {};
    $parent.empty();
    var root = $("<div/>").addClass("ujg-esi-team-editor");
    var header = $("<div/>").addClass("ujg-esi-team-header");
    header.append($("<span/>").addClass("ujg-esi-team-local").text("Локально · " + (state.projectKey || "")));
    header.append(button("ujg-esi-team-add", "Добавить команду", "Plus", function() { hooks.onTeamAdd(); }));
    root.append(header);
    if (state.teamsError) root.append($("<div/>").addClass("ujg-esi-team-error").attr("role", "alert").text(state.teamsError));
    var columns = $("<div/>").addClass("ujg-esi-team-columns");
    ["Название", "Направление", "Роли", "Цвет", "Участники"].forEach(function(label) {
      columns.append($("<span/>").text(label));
    });
    root.append(columns);
    (Array.isArray(state.teams) ? state.teams : []).forEach(function(team) {
      var row = $("<div/>").addClass("ujg-esi-team-row").attr("data-team-id", team.id);
      row.append($("<input/>", { type: "text", "class": "ujg-esi-team-name", "aria-label": "Название команды", maxlength: 80 })
        .val(team.name).on("change", function() { hooks.onTeamChange(team.id, "name", $(this).val()); }));
      var direction = $("<select/>", { "class": "ujg-esi-team-direction", "aria-label": "Направление команды" });
      teamsModule.directions.forEach(function(option) { direction.append($("<option/>").val(option.id).text(option.label)); });
      direction.val(team.direction).on("change", function() { hooks.onTeamChange(team.id, "direction", $(this).val()); });
      row.append(direction);
      row.append($("<input/>", { type: "text", "class": "ujg-esi-team-roles", "aria-label": "Роли команды через запятую" })
        .val((team.roles || []).join(", ")).on("change", function() {
          hooks.onTeamChange(team.id, "roles", $(this).val().split(",").map(function(role) { return role.trim(); }).filter(Boolean));
        }));
      var palette = $("<div/>").addClass("ujg-esi-team-palette").attr("role", "group").attr("aria-label", "Цвет команды");
      teamsModule.colors.forEach(function(color) {
        palette.append($("<button/>", { type: "button", "class": "ujg-esi-team-color", "aria-label": "Цвет " + color, title: "Цвет " + color, "aria-pressed": String(team.color === color) })
          .css("background-color", color).on("click", function() { hooks.onTeamChange(team.id, "color", color); }));
      });
      row.append(palette);
      row.append(button("ujg-esi-team-members-button", "Участники команды " + team.name + ": " + (team.members || []).length, "ChevronDown", function() {
        hooks.onTeamMembersOpen(team.id);
      }).append($("<span/>").text((team.members || []).length)));
      row.append(button("ujg-esi-team-remove", "Удалить команду " + team.name, "Trash2", function() { hooks.onTeamRemove(team.id); }));
      if (state.teamMemberPicker && state.teamMemberPicker.teamId === team.id) renderPicker(row, team, state, hooks);
      root.append(row);
    });
    $parent.append(root);
  }
  return { render: render };
});
