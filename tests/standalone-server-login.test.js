const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");

const serverPath = path.join(__dirname, "..", "standalone", "server.js");

function createTransport(plans) {
  return {
    request: function(_opts, callback) {
      const req = new EventEmitter();

      req.write = function() {};
      req.destroy = function() {};
      req.end = function() {
        const plan = plans.shift();
        if (!plan) {
          throw new Error("Unexpected proxy request");
        }
        if (plan.error) {
          setImmediate(function() {
            req.emit("error", plan.error);
          });
          return;
        }

        const res = new EventEmitter();
        res.statusCode = plan.status;
        res.headers = plan.headers || {};

        setImmediate(function() {
          callback(res);
          if (plan.body !== undefined && plan.body !== null) {
            res.emit("data", Buffer.from(String(plan.body)));
          }
          res.emit("end");
        });
      };

      return req;
    }
  };
}

function loadServerRoutes(plans, env) {
  const code = fs.readFileSync(serverPath, "utf8");
  const routes = {
    get: {},
    post: {},
    all: {}
  };
  const transport = createTransport(plans.slice());
  const app = {
    use: function() {},
    get: function(route, handler) {
      routes.get[route] = handler;
    },
    post: function(route, handler) {
      routes.post[route] = handler;
    },
    all: function(route) {
      routes.all[route] = arguments[arguments.length - 1];
    },
    listen: function() {}
  };

  function express() {
    return app;
  }

  express.json = function() {
    return function(_req, _res, next) {
      if (typeof next === "function") next();
    };
  };
  express.raw = function() {
    return function(_req, _res, next) {
      if (typeof next === "function") next();
    };
  };

  vm.runInNewContext(code, {
    require: function(name) {
      if (name === "express") return express;
      if (name === "express-session") {
        return function() {
          return function(_req, _res, next) {
            if (typeof next === "function") next();
          };
        };
      }
      if (name === "crypto") {
        return {
          randomBytes: function() {
            return {
              toString: function() {
                return "secret";
              }
            };
          }
        };
      }
      if (name === "path") return path;
      if (name === "node:http") return transport;
      if (name === "node:https") return transport;
      throw new Error("Unexpected require: " + name);
    },
    __dirname: path.join(__dirname, "..", "standalone"),
    console: console,
    process: { env: env || {} },
    Buffer: Buffer,
    URL: URL,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    module: { exports: {} },
    exports: {}
  }, { filename: serverPath });

  return routes;
}

function loadLoginHandler(plans) {
  return loadServerRoutes(plans).post["/login"];
}

function createRequest() {
  return {
    body: {
      jiraUrl: "https://jira.example.test",
      username: "alice",
      password: "secret"
    },
    session: {}
  };
}

function createResponse() {
  const result = {
    statusCode: 200,
    jsonBody: null
  };

  return {
    status: function(code) {
      result.statusCode = code;
      return this;
    },
    json: function(body) {
      result.jsonBody = body;
      return this;
    },
    getResult: function() {
      return result;
    }
  };
}

test("standalone login reports invalid /myself JSON clearly", async function() {
  const login = loadLoginHandler([{
    status: 200,
    headers: { "content-type": "text/html" },
    body: "<html>not json</html>"
  }]);
  const req = createRequest();
  const res = createResponse();

  await login(req, res);

  assert.equal(res.getResult().statusCode, 502);
  assert.match(res.getResult().jsonBody.error, /JSON|некоррект/i);
  assert.doesNotMatch(res.getResult().jsonBody.error, /Не удалось подключиться к Jira/);
  assert.equal(req.session.jiraUrl, undefined);
});

test("standalone login keeps network failures as connection errors", async function() {
  const login = loadLoginHandler([{
    error: new Error("socket hang up")
  }]);
  const req = createRequest();
  const res = createResponse();

  await login(req, res);

  assert.equal(res.getResult().statusCode, 502);
  assert.equal(res.getResult().jsonBody.error, "Не удалось подключиться к Jira: socket hang up");
});

test("standalone TEST_MODE mocks /rest/api/2/user/search locally", async function() {
  const routes = loadServerRoutes([], { TEST_MODE: "true" });
  const search = routes.get["/rest/api/2/user/search"];
  const req = {
    query: {
      username: "di",
      maxResults: "1"
    },
    session: {}
  };
  const res = createResponse();

  assert.equal(typeof search, "function");

  await search(req, res);

  assert.deepEqual(JSON.parse(JSON.stringify(res.getResult().jsonBody)), [{
    name: "dtorzok",
    displayName: "Dima Torzok",
    emailAddress: "dtorzok@example.com"
  }]);
});
