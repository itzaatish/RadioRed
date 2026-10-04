/**
 * The single allow-list for server files that may call the model.
 *
 * Key: path relative to Server/
 * Value: prompt name from src/prompts/index.js and optional Azure deployment settings.
 *
 * Add a file here before it can use generateText({ caller: __filename, ... }).
 */
module.exports = {
  "scripts/generate-radio-copy.js": {
    prompt: "radio-announcement",
    defaults: { language: "English" },
  },
  "scripts/generate-song-intro.js": {
    prompt: "song-intro",
    defaults: { language: "English", maxWords: 45 },
    maxOutputTokens: 160,
  },
};
