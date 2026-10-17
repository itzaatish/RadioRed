<!-- Objective: Document server setup, shared AI access, and the public radio engine API contract. -->
# Shared NVIDIA NIM access

All code in `Server/` can import the shared client from `src/ai`; no route,
script, service, or job needs to register itself before calling the model. Keep
the NVIDIA API key and default model in `Server/.env`, using the names in `.env.example`.

For generated text (the default choice for new code):

```js
const { generateText } = require("../src/ai");

const result = await generateText({
  instructions: "You are a concise, friendly radio copywriter.",
  input: "Welcome listeners to tonight's love-song hour.",
  temperature: 0.7,
  maxOutputTokens: 160,
});

console.log(result.text);
```

For messages, use Chat Completions:

```js
const { createChatCompletion } = require("../src/ai");

const result = await createChatCompletion({
  messages: [
    { role: "system", content: "You are helpful and concise." },
    { role: "user", content: "Write a one-line station greeting." },
  ],
  temperature: 0.7,
});

console.log(result.text);
```

`createResponse` is also exported as a Responses-style convenience helper; it
converts `instructions` and `input` to Chat Completions messages. All methods
send a `model` value on every request: the per-call `model` option takes
priority over `request.model`, then `NVIDIA_MODEL`. Methods return generated
`text`, token `usage`, rate-limit headers when supplied, and the raw API
`response`.

Reusable prompt text can live in `src/prompts/`; use `renderTemplate` to fill
its `{{variables}}` before passing it as `instructions`. Prompts are optional
and no file-to-prompt allow-list is required.

Examples:

```bash
npm run ai:radio-copy -- "Welcome listeners to tonight's love song hour"
npm run ai:song-intro -- "Introduce the next track as a relaxed late-night selection"
```

The integration calls NVIDIA's
`https://integrate.api.nvidia.com/v1/chat/completions` endpoint using a Bearer
token. Set `NVIDIA_API_KEY` and `NVIDIA_MODEL`; for example,
`meta/llama-3.3-70b-instruct`.

## Broadcast context manager

The universal broadcast-memory and context layer is documented in
[Docs/broadcast-memory-context-manager.md](Docs/broadcast-memory-context-manager.md).
It assembles backend-curated context and persists completed high-level episodes;
it does not generate narration or participate in the frame producer boundary.

## Radio engine

The Express server exposes a small orchestration layer at `/api/radio`. It does
not generate audio: `src/producer/ProducerAdapter.js` is the boundary where a
future producer can accept demand and cancellation notifications. Apply the
radio migration before using these endpoints:

```bash
npm run supabase -- db push
```

Audio remains in the private `RADIO_AUDIO_BUCKET` (default `radio-audio`), and
the server creates signed URLs only for ready frames. The remaining radio
settings and their defaults are listed in `.env.example`.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/radio/start` | Body: `{ "tone": 1 }`; creates/reuses an active session and returns its first ready frame, or `waiting: true`. Include `sessionId` to resume/change that session and `requestId` to make a delivery retry idempotent. |
| `POST /api/radio/pause` | Body: `{ "sessionId": "uuid" }`; persists `PAUSED` and cancels its schedule. |
| `POST /api/radio/stop` | Body: `{ "sessionId": "uuid" }`; persists `STOPPED` and cancels its schedule. |
| `POST /api/radio/heartbeat` | Body: `{ "sessionId": "uuid" }`; refreshes activity for an active session only. |
| `GET /api/radio/next?sessionId=uuid&requestId=...` | Returns the next reserved/ready frame or `waiting: true`. |
| `POST /api/radio/frame/:frameId/started` | Body: `{ "sessionId": "uuid", "sessionVersion": 1, "playedAt": "..." }`; records real playback start and schedules preloading from that timestamp. |
| `POST /api/radio/frame/:frameId/played` | Same body; records completion. |

The returned `session.version` must be included in playback acknowledgements.
This makes acknowledgements from a previous channel/session generation harmless.
For an active frame, the client should call `started` only after its audio
element actually begins playback, rather than when it receives the URL.

Run the focused engine tests with:

```bash
npm test
```
