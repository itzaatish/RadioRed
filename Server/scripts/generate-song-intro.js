const { generateText } = require("../src/ai");

async function main() {
  const input = process.argv.slice(2).join(" ");
  const result = await generateText({
    caller: __filename,
    input,
    variables: {
      language: process.env.RADIO_COPY_LANGUAGE || "English",
      maxWords: Number(process.env.SONG_INTRO_MAX_WORDS || 45),
    },
  });
  process.stdout.write(`${result.text}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
