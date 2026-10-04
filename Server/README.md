# Shared Azure OpenAI access

All server code calls the shared client in `src/ai`; no individual file stores an API key or endpoint.

1. Add the Azure endpoint, key, and deployment name to `Server/.env` using the names in `.env.example`.
2. Put every reusable instruction in `src/prompts/` and export it from `src/prompts/index.js`.
3. Add the file-to-prompt mapping in `src/config/ai-callers.js`.
4. Use `generateText({ caller: __filename, input, variables })` from that registered file.

Examples:

```bash
npm run ai:radio-copy -- "Welcome listeners to tonight's love song hour"
npm run ai:song-intro -- "Introduce the next track as a relaxed late-night selection"
```

The integration calls Azure OpenAI's `/openai/v1/responses` endpoint using the `api-key` header. `AZURE_OPENAI_DEPLOYMENT` must be the Azure deployment name.
