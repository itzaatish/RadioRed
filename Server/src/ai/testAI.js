// Manual smoke test. Run from Server/: node src/ai/testAI.js [model-id]
const { generateText, modelList } = require("./index");

const defaultModelId = "stepfun-ai/step-5-preview";
const modelId = process.argv[2] || defaultModelId;
const modelConfig = modelList[modelId];

async function main() {
  if (!modelConfig) {
    throw new Error(`Unknown model "${modelId}". Available models: ${Object.keys(modelList).join(", ")}`);
  }

  const output = await generateText({
    instructions: "Give the correct answer, concisely.",
    input: "What is the capital of France?",
    ...modelConfig,
  });
  console.log(`Model: ${output.model || modelConfig.model}\n${JSON.stringify(output.response)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
