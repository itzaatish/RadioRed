# Broadcast Context Manager Integration Notes

This repository has a new server-side broadcast context manager. It serves a
future episode generator but does not implement an AI prompt, call an AI model,
or replace the existing producer.

## Architecture boundary

Use `Server/src/broadcast` or the `broadcastContextManager` exposed by
`createRadioApplication`. The manager persists and reads universal broadcast
state using Supabase. It must not be called from `ProducerAdapter`, the frame
scheduler, or the radio delivery engines as a shortcut for audio generation.

The current audio architecture stays intact:

- `songs` are reusable full tracks.
- `sentences` are logical narration units.
- `frames` are physical audio fragments chained through `next_frame_id`.
- `radio_sessions` and `radio_session_frames` are listener delivery state.
- `episodes` plus `broadcast_*` tables are high-level universal broadcast
  history and context; they are not frame queues.

## Future generator flow

1. The backend selects song and curated-memory IDs outside this manager.
2. Call `beginIteration` with a stable generation key and those IDs.
3. Pass its structured `context.broadcast_context` to the future generator in
   whichever prompt format that feature defines.
4. Validate the generator's response at that boundary, then call
   `persistCompletedEpisode` with `{ title, language?, content, summary? }`.
5. When a separate high-level playback coordinator knows an episode actually
   played, call `recordEpisodePlayed`.

The generator is never allowed to supply database IDs, selected songs,
selected memories, lifecycle statuses, or timestamps. Those are backend-owned.

## Persistence rules

`broadcast_iterations` captures the stable generation key, ordered input
manifest, and predecessor. `broadcast_iteration_songs` and
`broadcast_iteration_memories` are normalized references. `episodes` stores raw
content, optional summary, and a deterministic exact closing sentence.

The preceding literal closing sentence is returned separately as
`previous_closing_sentence`. Do not replace it with a summary or rewrite it.
Content without a deterministically detectable terminal sentence stores a null
closing anchor.

The completion RPC is transactional and idempotent for the same response hash.
Do not pre-advance continuity in application code. If persistence fails, let the
error surface and retry with the same generation key/response when appropriate.

## Out of scope

AI-generator prompt engineering, AI provider changes, content generation, TTS,
sentence/frame creation, producer implementation, and changes to the public
radio playback routes are intentionally out of scope.
