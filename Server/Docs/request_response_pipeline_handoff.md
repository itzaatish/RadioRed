<!-- Objective: Hand off the radio request/response audio-frame delivery pipeline and its independent producer boundary. -->
# Radio Request/Response Pipeline Handoff

## Status

The backend request/response pipeline for delivering already-generated audio
frames is implemented. It creates and manages a listener session, reserves
frames safely, returns short-lived audio URLs, records playback acknowledgements,
and prepares later frames ahead of playback.

Audio generation is deliberately outside this service. `ProducerAdapter` is a
placeholder for a future independent asynchronous producer service; it is not a
missing responsibility of the request/response API itself.

## Scope and boundary

The radio API owns:

- listener session lifecycle;
- selecting, reserving, and delivering persisted `READY` frames;
- creating signed URLs for private audio in Supabase Storage;
- tracking delivered, playing, and completed frames;
- retry-safe frame delivery, scheduling, and heartbeat expiry.

The future producer service owns:

- generating audio and uploading it to the configured storage bucket;
- creating or updating `frames` rows, including `audio_path`, duration, and
  `status` (`GENERATING`, `READY`, or `FAILED`);
- associating frames with the appropriate sentence/frame chain;
- accepting demand (`ensureFrame`) and cancellation (`stopSession`) requests
  from this API, or obtaining those signals through a queue/event mechanism.

The API must never wait for generation before responding. If no persisted,
eligible `READY` frame exists, it responds with `waiting: true` and the client
retries `GET /api/radio/next`.

## Delivery flow

```text
Client
  │ POST /start or GET /next
  ▼
Radio controller → StartEngine / PlayEngine
  │                    │
  │                    ├─ ProducerAdapter.ensureFrame(...) [non-blocking demand]
  │                    └─ claim_radio_frame(...) [atomic database claim]
  ▼
Supabase: radio_sessions + radio_session_frames + frames
  │
  ├─ no READY frame → { waiting: true, frame: null }
  └─ READY frame    → server creates Storage signed URL
                           │
                           ▼
                     Client receives frame and plays it
                           │
              POST /frame/:frameId/started
                           │
                    scheduler preloads the next frame
                           │
              POST /frame/:frameId/played
```

## HTTP contract

All routes are mounted under `/api/radio`.

| Route | Purpose | Key response behavior |
| --- | --- | --- |
| `POST /start` | Create or reuse the single active listener session for a tone. | Returns the current/first frame or `waiting: true`. Accepts optional `sessionId` and idempotency `requestId`. |
| `GET /next` | Deliver the next frame for an active session. | Returns a signed `audioUrl`, or `waiting: true` while no frame is ready. |
| `POST /frame/:frameId/started` | Acknowledge actual browser/audio-element playback start. | Persists `PLAYING` and schedules preparation at the configured lead time. |
| `POST /frame/:frameId/played` | Acknowledge completion. | Persists `PLAYED`. |
| `POST /heartbeat` | Keep an active session alive. | Rejects inactive sessions with `409`. |
| `POST /pause` | Pause the session and cancel in-process schedules. | Persists `PAUSED`. |
| `POST /stop` | Stop the session and cancel in-process schedules. | Persists `STOPPED`. |

Client rules:

- Preserve `session.id` returned by `start`.
- Include the returned `session.version` as `sessionVersion` in both playback
  acknowledgement calls.
- Call `started` only when the audio element has truly begun playing, not when
  the signed URL arrives.
- Reuse a `requestId` when retrying the same delivery request.
- Treat `waiting: true` as a normal asynchronous state and retry `/next`.

## Persistence and concurrency guarantees

The migration `20261010100000_create_radio_engine_tables.sql` provides the
delivery-state guarantees.

- `radio_sessions` stores tone, lifecycle state, version, heartbeat, and the
  current frame reference.
- Its partial unique index permits only one `ACTIVE` session at a time.
- `radio_session_frames` stores the per-session delivery history and playback
  status.
- Unique `(session_id, sequence_number)` preserves ordering; unique
  `(session_id, frame_id)` prevents duplicate delivery of a frame to a session.
- The `claim_radio_frame` database function locks the session row, so concurrent
  API requests cannot claim the same next frame twice.
- `session_version` makes acknowledgements and scheduled work from an old
  session/tone harmless after a pause, stop, or tone change.
- A delivery key makes a retry return the same delivered frame rather than
  skip ahead.

## Current implementation map

| Responsibility | Location |
| --- | --- |
| HTTP validation and JSON responses | `src/controllers/radioController.js` |
| HTTP routes | `src/routes/radioRoutes.js` |
| Start/switch lifecycle | `src/engines/StartEngine.js` |
| Claim, deliver, acknowledge, and prepare frames | `src/engines/PlayEngine.js` |
| Pause/stop lifecycle | `src/engines/StopEngine.js` |
| Session and frame persistence | `src/repositories/` |
| Atomic database claim | `supabase/migrations/20261010100000_create_radio_engine_tables.sql` |
| URL signing for private Storage audio | `src/services/AudioUrlService.js` |
| Lead-time scheduling and retry | `src/radio/FrameScheduler.js` |
| Restart recovery and heartbeat expiry | `src/radio/SessionLifecycleMonitor.js` |
| Future independent producer boundary | `src/producer/ProducerAdapter.js` |

## Intentionally incomplete work

1. **Independent producer implementation:** `ProducerAdapter` currently returns
   `producer_not_configured`. Replace it with a transport client to the future
   asynchronous producer service. The transport can be HTTP, a queue, or an
   event bus without changing the radio engines.
2. **Producer contract:** define the demand and cancellation payloads, service
   authentication, retry policy, deduplication key, and completion/failure
   reporting. The producer must write valid `frames` rows and mark an audio
   file `READY` only after it is uploaded and readable.
3. **Production integration tests:** the current test suite exercises the
   engines with fakes. Add end-to-end tests using a Supabase test project (or
   local Supabase), a private Storage bucket, the actual RPC function, and a
   producer test double.
4. **Client implementation:** the browser/player must implement polling,
   playback acknowledgements, heartbeats, pause/stop, and signed-URL expiry
   handling according to the HTTP contract above.
5. **Operations:** add authentication/authorization appropriate for listeners,
   producer observability, alerting for failed frames, and a deployment plan
   for the independent producer.

## Verification completed

`npm test` passes all 13 focused radio-engine tests. Those tests cover session
reuse and tone changes, waiting behavior, lead-time scheduling, cancellation,
stale-version protection, producer-failure tolerance when a frame is already
ready, heartbeat expiry, startup schedule restoration, and key database
concurrency constraints.
