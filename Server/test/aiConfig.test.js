const assert = require("node:assert/strict");
const test = require("node:test");

const { createChatCompletion, getNvidiaConfig } = require("../src/ai/azure-openai");

const ENV_NAMES = [
  "NVIDIA_API_KEY",
  "NVIDIA_MODEL",
];

async function withEnv(values, run) {
  const original = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
  Object.assign(process.env, values);
  try {
    return await run();
  } finally {
    for (const name of ENV_NAMES) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  }
}

test("NVIDIA client uses the Chat Completions endpoint and configured default model", async () => {
  await withEnv({
    NVIDIA_API_KEY: "test-key",
    NVIDIA_MODEL: "meta/llama-3.3-70b-instruct",
  }, () => {
    const config = getNvidiaConfig();
    assert.equal(config.endpoint, "https://integrate.api.nvidia.com/v1/chat/completions");
    assert.equal(config.defaultModel, "meta/llama-3.3-70b-instruct");
  });
});

test("NVIDIA client sends a model on every Chat Completions request", async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      headers: new Headers(),
      json: async () => ({ choices: [{ message: { content: "hello" } }] }),
    };
  };

  try {
    await withEnv({
      NVIDIA_API_KEY: "test-key",
      NVIDIA_MODEL: "default-model",
    }, async () => {
      await createChatCompletion({
        model: "call-specific-model",
        messages: [{ role: "user", content: "First request" }],
      });

      process.env.NVIDIA_MODEL = "new-default-model";
      await createChatCompletion({
        messages: [{ role: "user", content: "Second request" }],
      });
    });
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://integrate.api.nvidia.com/v1/chat/completions");
  assert.equal(requests[0].options.headers.Authorization, "Bearer test-key");
  assert.equal(JSON.parse(requests[0].options.body).model, "call-specific-model");
  assert.equal(JSON.parse(requests[1].options.body).model, "new-default-model");
});
