define("_ujgESI_activityMarkdown", ["jquery", "_ujgESI_marked"], function($, marked) {
  "use strict";

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  }
  function trim(value) { return String(value == null ? "" : value).trim(); }
  function safeUrl(value, httpsOnly) {
    try {
      var input = trim(value), url;
      if (!/^https?:\/\//i.test(input) || /[\u0000-\u001f\u007f\\]/.test(input)) return "";
      url = new URL(input);
      if ((httpsOnly && url.protocol !== "https:") || (!httpsOnly && !/^https?:$/.test(url.protocol)) || url.username || url.password) return "";
      return url.href;
    } catch (ignore) { return ""; }
  }
  function issueUrl(baseUrl, key) {
    var url = safeUrl(baseUrl, false), base;
    if (!url) return "";
    base = new URL(url);
    base.search = "";
    base.hash = "";
    return base.href.replace(/\/+$/, "") + "/browse/" + encodeURIComponent(key);
  }

  // Isolate these renderers from shared Marked configuration. Never emit model HTML or image elements.
  var parser = new marked.Marked({
    async:false,
    gfm:true,
    walkTokens:function(token) {
      // This pass sees source tokens before rendering creates trusted list/checkbox HTML.
      // Raw-block source text must be escaped even when the lexer marks it escaped.
      if (token.type === "text") token.escaped = false;
    },
    renderer:{
      html:function(token) { return escapeHtml(token.text); },
      image:function(token) { return escapeHtml(token.text); },
      link:function(token) {
        var label = this.parser.parseInline(token.tokens), url = safeUrl(token.href, true);
        if (!url) return label;
        return '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + label + "</a>";
      }
    }
  });
  function teamColor(teams, role) {
    var i, team, color;
    for (i = 0; i < (Array.isArray(teams) ? teams.length : 0); i++) {
      team = teams[i]; color = team && team.color;
      if (team && Array.isArray(team.roles) && team.roles.some(function(item) { return String(item).toUpperCase() === role; }) && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(color || "")) return color;
    }
    return "";
  }
  function decorate($root, options) {
    var doc = $root[0].ownerDocument, walker = doc.createTreeWalker($root[0], 4), nodes = [], node;
    while ((node = walker.nextNode())) {
      if (!$(node.parentNode).closest("a,code,pre").length && /\b[A-Z][A-Z0-9_]*-\d+\b|\[(?:BE|QA|FE|DE|BF)\]/.test(node.nodeValue)) nodes.push(node);
    }
    nodes.forEach(function(textNode) {
      var fragment = doc.createDocumentFragment(), pieces = textNode.nodeValue.split(/(\b[A-Z][A-Z0-9_]*-\d+\b|\[(?:BE|QA|FE|DE|BF)\])/g);
      pieces.forEach(function(piece) {
        var role, color, href, element;
        if (/^[A-Z][A-Z0-9_]*-\d+$/.test(piece)) {
          href = issueUrl(options.baseUrl, piece);
          element = doc.createElement(href ? "a" : "span");
          if (href) { element.setAttribute("href",href); element.setAttribute("target","_blank"); element.setAttribute("rel","noopener noreferrer"); }
          element.textContent = piece; fragment.appendChild(element);
        } else if (/^\[(BE|QA|FE|DE|BF)\]$/.test(piece)) {
          role = piece.slice(1,-1); color = teamColor(options.teams,role);
          element = doc.createElement("span"); element.className = "ujg-esi-management-role role-" + role.toLowerCase();
          if (color) element.style.borderColor = color;
          element.textContent = piece; fragment.appendChild(element);
        } else fragment.appendChild(doc.createTextNode(piece));
      });
      textNode.parentNode.replaceChild(fragment,textNode);
    });
  }
  function render(text, options) {
    var $root = $("<div/>").addClass("ujg-esi-activity-markdown");
    $root.html(parser.parse(String(text == null ? "" : text)));
    $root.find("table").wrap('<div class="ujg-esi-activity-markdown-table-wrap"></div>');
    decorate($root, options || {});
    return $root;
  }
  return {render:render};
});
