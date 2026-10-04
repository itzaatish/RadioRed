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

async function createResponse({ instructions, input, model, maxOutputTokens }) {
  const config = getAzureOpenAIConfig();
  const response = await fetch(`${config.endpoint}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": config.apiKey,
    },
    body: JSON.stringify({
      model: model || config.deployment,
      instructions,
      input,
      ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}),
    }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.error?.message || body?.message || `Azure OpenAI returned HTTP ${response.status}.`;
    throw new Error(`Azure OpenAI request failed: ${message}`);
  }

  return {
    id: body.id,
    model: body.model,
    text: extractOutputText(body),
    usage: body.usage,
    response: body,
  };
}

module.exports = { createResponse, getAzureOpenAIConfig };
