const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const loadAmdModule = require("./helpers/load-amd-module");

function createEmptyCollection() {
  return {
    length: 0,
    hasClass: function() { return false; },
    removeAttr: function() {},
    append: function() {},
    find: function() { return createEmptyCollection(); }
  };
}

function createElement(className) {
  return {
    length: 1,
    className: className || "",
    attrs: {},
    children: [],
    hasClass: function(name) {
      return this.className.split(/\s+/).indexOf(name) !== -1;
    },
    removeAttr: function(name) {
      delete this.attrs[name];
    },
    append: function(child) {
      this.children.push(child);
    },
    find: function(selector) {
      var i;
      if (selector !== ".ujg-daily-diligence") {
        return createEmptyCollection();
      }
      for (i = 0; i < this.children.length; i += 1) {
        if (this.children[i].hasClass("ujg-daily-diligence")) {
          return this.children[i];
        }
      }
      return createEmptyCollection();
    }
  };
}

function createJQuery() {
  return function(html) {
    if (html === '<div class="ujg-daily-diligence"></div>') {
      return createElement("ujg-daily-diligence");
    }
    throw new Error("Unexpected jQuery call: " + html);
  };
}

function loadMain(rendering) {
  return loadAmdModule(
    path.join(__dirname, "..", "ujg-daily-diligence-modules", "main.js"),
    {
      jquery: createJQuery(),
      _ujgCommon: { id: "common" },
      _ujgDD_config: { id: "config" },
      _ujgDD_utils: { id: "utils" },
      _ujgDD_apiJira: { id: "apiJira" },
      _ujgDD_apiBitbucket: { id: "apiBitbucket" },
      _ujgDD_apiConfluence: { id: "apiConfluence" },
      _ujgDD_dataProcessor: { id: "dataProcessor" },
      _ujgDD_teamManager: { id: "teamManager" },
      _ujgDD_rendering: rendering
    }
  );
}

function withMockedConsoleError(run) {
  var original = console.error;
  var messages = [];

  console.error = function() {
    messages.push(Array.prototype.join.call(arguments, " "));
  };

  try {
    run(messages);
  } finally {
    console.error = original;
  }
}

test("daily diligence main reuses the content element when it is already the widget container", function() {
  var calls = [];
  var resizeCalls = 0;
  var content = createElement("ujg-daily-diligence");
  var Gadget = loadMain({
    init: function(container, modules) {
      calls.push({ container: container, modules: modules });
    }
  });

  content.attrs.style = "min-height: 100vh";

  new Gadget({
    getGadgetContentEl: function() {
      return content;
    },
    resize: function() {
      resizeCalls += 1;
    }
  });

  assert.equal(calls.length, 1);
  assert.strictEqual(calls[0].container, content);
  assert.equal(content.children.length, 0);
  assert.equal("style" in content.attrs, false);
  assert.strictEqual(calls[0].modules.common.id, "common");

  calls[0].modules.resize();
  assert.equal(resizeCalls, 1);
});

test("daily diligence main appends a widget container when wrapper content is plain", function() {
  var calls = [];
  var content = createElement("page-shell");
  var Gadget = loadMain({
    init: function(container) {
      calls.push(container);
    }
  });

  new Gadget({
    getGadgetContentEl: function() {
      return content;
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(content.children.length, 1);
  assert.strictEqual(calls[0], content.children[0]);
  assert.equal(content.children[0].hasClass("ujg-daily-diligence"), true);
});

test("daily diligence main logs and stops when API is missing", function() {
  var calls = 0;
  var Gadget = loadMain({
    init: function() {
      calls += 1;
    }
  });

  withMockedConsoleError(function(messages) {
    new Gadget();

    assert.equal(calls, 0);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /API object is missing/);
  });
});

test("daily diligence main logs and stops when content element is missing", function() {
  var calls = 0;
  var Gadget = loadMain({
    init: function() {
      calls += 1;
    }
  });

  withMockedConsoleError(function(messages) {
    new Gadget({
      getGadgetContentEl: function() {
        return null;
      }
    });

    assert.equal(calls, 0);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /No content element/);
  });
});

test("daily diligence main logs and stops when content collection is empty", function() {
  var calls = 0;
  var Gadget = loadMain({
    init: function() {
      calls += 1;
    }
  });

  withMockedConsoleError(function(messages) {
    new Gadget({
      getGadgetContentEl: function() {
        return createEmptyCollection();
      }
    });

    assert.equal(calls, 0);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /No content element/);
  });
});

test("daily diligence main resize hook is optional", function() {
  var call;
  var Gadget = loadMain({
    init: function(_container, modules) {
      call = modules;
    }
  });

  new Gadget({
    getGadgetContentEl: function() {
      return createElement("page-shell");
    }
  });

  assert.ok(call);
  assert.doesNotThrow(function() {
    call.resize();
  });
});
