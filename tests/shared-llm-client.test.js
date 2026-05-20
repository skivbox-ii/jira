const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const loadAmdModule = require("./helpers/load-amd-module");

function loadLlmClient(extraGlobals) {
  return loadAmdModule(path.join(__dirname, "..", "ujg-shared-modules", "llm-client.js"), {}, extraGlobals || {});
}

test("shared llm client calls chat completions and extracts text", async function () {
  const llm = loadLlmClient();
  const calls = [];
  const result = await llm.requestText({
    apiBase: "https://llm.example/v1",
    model: "model-a",
    apiKey: "sk-test",
  }, {
    systemPrompt: "Сократи название.",
    userPrompt: "Очень длинное замечание",
  }, function (url, options) {
    calls.push({ url: url, body: JSON.parse(options.body), headers: options.headers });
    return Promise.resolve({
      ok: true,
      status: 200,
      text: function () {
        return Promise.resolve(JSON.stringify({ choices: [{ message: { content: "Короткое название" } }] }));
      },
    });
  });

  assert.equal(result.text, "Короткое название");
  assert.equal(calls[0].url, "https://llm.example/v1/chat/completions");
  assert.equal(calls[0].headers.Authorization, "Bearer sk-test");
  assert.equal(calls[0].body.messages[0].content, "Сократи название.");
  assert.equal(calls[0].body.messages[1].content, "Очень длинное замечание");
});

test("shared llm client falls back to legacy completions on chat 404", async function () {
  const llm = loadLlmClient();
  const calls = [];
  const result = await llm.requestText({
    apiBase: "https://llm.example/v1",
    model: "model-a",
    apiKey: "sk-test",
  }, {
    systemPrompt: "Сократи название.",
    userPrompt: "Очень длинное замечание",
  }, function (url, options) {
    calls.push({ url: url, body: JSON.parse(options.body) });
    if (calls.length === 1) {
      return Promise.resolve({
        ok: false,
        status: 404,
        text: function () {
          return Promise.resolve("{}");
        },
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      text: function () {
        return Promise.resolve(JSON.stringify({ choices: [{ text: "Legacy title" }] }));
      },
    });
  });

  assert.equal(result.text, "Legacy title");
  assert.equal(calls[0].url, "https://llm.example/v1/chat/completions");
  assert.equal(calls[1].url, "https://llm.example/v1/completions");
  assert.match(calls[1].body.prompt, /^Сократи название\./);
});
