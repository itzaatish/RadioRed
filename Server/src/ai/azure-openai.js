// Objective: Centralize authenticated Azure OpenAI Responses and Chat Completions requests.
const { requiredEnv } = require("../config/env");

function getAzureOpenAIConfig() {
  const rawEndpoint = requiredEnv("AZURE_OPENAI_ENDPOINT").replace(/\/+$/, "");
  let endpoint;

  try {
    endpoint = new URL(rawEndpoint);
  } catch {
    throw new Error("AZURE_OPENAI_ENDPOINT must be a valid HTTPS URL.");
  }

  if (endpoint.protocol !== "https:") {
    throw new Error("AZURE_OPENAI_ENDPOINT must use HTTPS.");
  }

  // Azure OpenAI v1 is OpenAI-compatible and uses implicit API versioning.
  if (!endpoint.pathname.endsWith("/openai/v1")) {
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/openai/v1`;
  }

  return {
    endpoint: endpoint.toString().replace(/\/$/, ""),
    apiKey: requiredEnv("AZURE_OPENAI_API_KEY"),
    deployment: requiredEnv("AZURE_OPENAI_DEPLOYMENT"),
  };
}

function extractOutputText(response) {
  if (typeof response.output_text === "string") return response.output_text;

  return (response.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === "output_text")
    .map((content) => content.text)
    .join("");
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

async function post(path, payload, signal) {
  const config = getAzureOpenAIConfig();
  const response = await fetch(`${config.endpoint}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": config.apiKey,
    },
    body: JSON.stringify(payload),
    signal,
  });

  const responseBody = await response.json().catch(() => null);
  if (!response.ok) {
    const message = responseBody?.error?.message || responseBody?.message || `Azure OpenAI returned HTTP ${response.status}.`;
    throw new Error(`Azure OpenAI request failed: ${message}`);
  }

  return { body: responseBody, rateLimit: rateLimitHeaders(response.headers) };
}

function extraRequestFields(request) {
  if (request === undefined) return {};
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("request must be an object of API-specific request fields.");
  }
  return request;
}

/**
 * Call Azure OpenAI's Responses API.
 *
 * This is intentionally independent of a prompt or caller file, so any code
 * inside Server/ can use it. Pass API-specific fields such as `tools` or
 * `text` through `request` when the convenience parameters do not cover them.
 */
async function createResponse({
  instructions,
  input,
  model,
  maxOutputTokens,
  temperature,
  topP,
  metadata,
  previousResponseId,
  request,
  signal,
} = {}) {
  if (input === undefined || input === null || input === "") {
    throw new Error("createResponse requires input.");
  }

  const config = getAzureOpenAIConfig();
  const extra = extraRequestFields(request);
  const { body, rateLimit } = await post(
    "/responses",
    {
      ...extra,
      model: model || extra.model || config.deployment,
      ...(instructions !== undefined ? { instructions } : {}),
      input,
      ...(maxOutputTokens !== undefined ? { max_output_tokens: maxOutputTokens } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(topP !== undefined ? { top_p: topP } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
      ...(previousResponseId !== undefined ? { previous_response_id: previousResponseId } : {}),
    },
    signal,
  );

  return {
    id: body.id,
    model: body.model,
    text: extractOutputText(body),
    usage: body.usage,
    rateLimit,
    response: body,
  };
}

/**
 * Call Azure OpenAI's OpenAI-compatible Chat Completions API. This mirrors
 * the messages-based shape used by @azure-rest/ai-inference examples.
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

  const config = getAzureOpenAIConfig();
  const extra = extraRequestFields(request);
  const { body, rateLimit } = await post(
    "/chat/completions",
    {
      ...extra,
      model: model || extra.model || config.deployment,
      messages,
      ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(topP !== undefined ? { top_p: topP } : {}),
      ...(responseFormat !== undefined ? { response_format: responseFormat } : {}),
    },
    signal,
  );

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

module.exports = {
  createResponse,
  createChatCompletion,
  getAzureOpenAIConfig,
};
