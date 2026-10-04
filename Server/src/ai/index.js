const path = require("node:path");

const callers = require("../config/ai-callers");
const prompts = require("../prompts");
const { createResponse } = require("./azure-openai");

const serverRoot = path.resolve(__dirname, "..", "..");

function callerId(caller) {
  if (!caller) throw new Error("generateText requires caller: __filename.");
  const absolutePath = path.resolve(caller);
  const relativePath = path.relative(serverRoot, absolutePath).split(path.sep).join("/");
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("AI callers must be files inside Server/.");
  }
  return relativePath;
}

function getCallerConfig(caller) {
  const id = callerId(caller);
  const config = callers[id];
  if (!config) {
    throw new Error(`No AI configuration exists for ${id}. Add it to src/config/ai-callers.js.`);
  }
  if (!prompts[config.prompt]) {
    throw new Error(`AI caller ${id} references unknown prompt: ${config.prompt}.`);
  }
  return { id, ...config };
}

function render(template, variables) {
  return template.replace(/{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g, (_, name) => {
    const value = variables[name];
    if (value === undefined || value === null || value === "") {
      throw new Error(`Missing prompt variable: ${name}.`);
    }
    return String(value);
  });
}

/**
 * Generate text for an approved server file.
 *
 * const { generateText } = require("../src/ai");
 * const result = await generateText({ caller: __filename, input: "...", variables: {} });
 */
async function generateText({ caller, input, variables = {} }) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("generateText requires a non-empty input string.");
  }

  const config = getCallerConfig(caller);
  const prompt = prompts[config.prompt];
  const allVariables = { ...(config.defaults || {}), ...variables };

  return createResponse({
    instructions: render(prompt.system, allVariables),
    input,
    model: config.deployment,
    maxOutputTokens: config.maxOutputTokens,
  });
}

module.exports = { generateText, getCallerConfig, render };
