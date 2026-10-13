// Objective: Expose the shared AI client and prompt utilities through one stable server-side API.
const { createChatCompletion, createResponse } = require("./azure-openai");

function renderTemplate(template, variables = {}) {
  if (typeof template !== "string") {
    throw new Error("renderTemplate requires a string template.");
  }

  return template.replace(/{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g, (_, name) => {
    const value = variables[name];
    if (value === undefined || value === null || value === "") {
      throw new Error(`Missing prompt variable: ${name}.`);
    }
    return String(value);
  });
}

/**
 * Generate text from any server file using the Responses API.
 *
 * const { generateText } = require("../src/ai");
 * const result = await generateText({ instructions: "You are helpful.", input: "..." });
 */
async function generateText({ instructions, input, ...options } = {}) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("generateText requires a non-empty input string.");
  }

  return createResponse({ instructions, input, ...options });
}

module.exports = {
  createChatCompletion,
  createResponse,
  generateText,
  renderTemplate,
};
