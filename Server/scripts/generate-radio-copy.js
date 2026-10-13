// Objective: Offer a CLI entry point for generating short radio copy through the shared AI client.
const { generateText, renderTemplate } = require("../src/ai");
const radioAnnouncement = require("../src/prompts/radio-announcement");

async function main() {
  const input = process.argv.slice(2).join(" ");
  const result = await generateText({
    input,
    instructions: renderTemplate(radioAnnouncement.system, {
      language: process.env.RADIO_COPY_LANGUAGE || "English",
    }),
  });
  process.stdout.write(`${result.text}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
