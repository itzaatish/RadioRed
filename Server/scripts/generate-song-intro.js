// Objective: Offer a CLI entry point for generating a song introduction through the shared AI client.
const { generateText, renderTemplate } = require("../src/ai");
const songIntro = require("../src/prompts/song-intro");

async function main() {
  const input = process.argv.slice(2).join(" ");
  const result = await generateText({
    input,
    instructions: renderTemplate(songIntro.system, {
      language: process.env.RADIO_COPY_LANGUAGE || "English",
      maxWords: Number(process.env.SONG_INTRO_MAX_WORDS || 45),
    }),
    maxOutputTokens: 160,
  });
  process.stdout.write(`${result.text}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
