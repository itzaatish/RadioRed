// Objective: Centralize authenticated NVIDIA NIM Chat Completions requests.
const { requiredEnv } = require("../config/env");

const NVIDIA_CHAT_COMPLETIONS_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

function getNvidiaConfig() {
  return {
    endpoint: NVIDIA_CHAT_COMPLETIONS_URL,
    apiKey: requiredEnv("NVIDIA_API_KEY"),
    defaultModel: requiredEnv("NVIDIA_MODEL"),
  };
}

function extractChatText(response) {
  return (response.choices || [])
    .map((choice) => choice.message?.content)
    .filter((content) => typeof content === "string")
    .join("");
}

function rateLimitHeaders(headers) {
  const firstHeader = (...names) => names.map((name) => headers.get(name)).find(Boolean) || null;
  const values = {
    limit: firstHeader("x-ratelimit-limit-requests", "x-ratelimit-limit"),
    remaining: firstHeader("x-ratelimit-remaining-requests", "x-ratelimit-remaining"),
    reset: firstHeader("x-ratelimit-reset-requests", "x-ratelimit-reset"),
  };

  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== null),
  );
}

function extraRequestFields(request) {
  if (request === undefined) return {};
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("request must be an object of API-specific request fields.");
  }
  return request;
}

function resolveModel({ model, extra, defaultModel }) {
  const selectedModel = model || extra.model || defaultModel;
  if (typeof selectedModel !== "string" || !selectedModel.trim()) {
    throw new Error("A non-empty NVIDIA model is required.");
  }
  return selectedModel;
}

async function postChatCompletion(payload, signal) {
  const config = getNvidiaConfig();
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal,
  });

  const responseBody = await response.json().catch(() => null);
  if (!response.ok) {
    const message = responseBody?.error?.message || responseBody?.message || `NVIDIA API returned HTTP ${response.status}.`;
    throw new Error(`NVIDIA API request failed: ${message}`);
  }

  return { body: responseBody, rateLimit: rateLimitHeaders(response.headers) };
}

function formatChatCompletion(body, rateLimit) {
  return {
    id: body.id,
    model: body.model,
    text: extractChatText(body),
    choices: body.choices || [],
    usage: body.usage,
    rateLimit,
    response: body,
  };
}

/**
 * Generate text through NVIDIA's Chat Completions API using Responses-style
 * convenience parameters. Every request includes the resolved model name.
 */
async function createResponse({
  instructions,
  input,
  model,
  maxOutputTokens,
  temperature,
  topP,
  request,
  signal,
} = {}) {
  if (input === undefined || input === null || input === "") {
    throw new Error("createResponse requires input.");
  }

  const extra = extraRequestFields(request);
  const { defaultModel } = getNvidiaConfig();
  const selectedModel = resolveModel({ model, extra, defaultModel });
  const messages = [
    ...(instructions !== undefined ? [{ role: "system", content: instructions }] : []),
    { role: "user", content: typeof input === "string" ? input : JSON.stringify(input) },
  ];
  const { body, rateLimit } = await postChatCompletion(
    {
      ...extra,
      model: selectedModel,
      messages,
      ...(maxOutputTokens !== undefined ? { max_tokens: maxOutputTokens } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(topP !== undefined ? { top_p: topP } : {}),
    },
    signal,
  );

  return formatChatCompletion(body, rateLimit);
}

/**
 * Call NVIDIA's OpenAI-compatible Chat Completions API. The model is resolved
 * and included in each request, using the call-specific model before NVIDIA_MODEL.
 */
async function createChatCompletion({
  messages,
  model,
  maxTokens,
  temperature,
  topP,
  responseFormat,
  request,
  signal,
} = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("createChatCompletion requires a non-empty messages array.");
  }

  const extra = extraRequestFields(request);
  const { defaultModel } = getNvidiaConfig();
  const selectedModel = resolveModel({ model, extra, defaultModel });
  const { body, rateLimit } = await postChatCompletion(
    {
      ...extra,
      model: selectedModel,
      messages,
      ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(topP !== undefined ? { top_p: topP } : {}),
      ...(responseFormat !== undefined ? { response_format: responseFormat } : {}),
    },
    signal,
  );

  return formatChatCompletion(body, rateLimit);
}

module.exports = {
  createResponse,
  createChatCompletion,
  getNvidiaConfig,
};
