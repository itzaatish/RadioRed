<!-- Objective: Describe the universal broadcast context manager, its persistence model, and its intentionally separate producer boundary. -->
# Broadcast Memory and Context Manager

## Purpose and boundary

`BroadcastContextManager` prepares durable, bounded context for a future AI
episode generator and persists a validated generator response. It does not
generate narration, build prompts, call the AI client, create audio, write
`sentences`/`frames`, or call `ProducerAdapter`.

The application composes it in `src/radio/createRadioApplication.js` as
`broadcastContextManager`, alongside the existing radio repositories. A future
generation coordinator can call this service before/after its AI request; the
current delivery engines remain unchanged.

## Existing model and new broadcast layer

The current content and delivery model is retained:

```text
songs ──optional──> sentences ──first_frame_id──> frames ──next_frame_id──> frames

radio_sessions ──> radio_session_frames ──> frames
```

`songs`, `sentences`, `frames`, `radio_sessions`, and
`radio_session_frames` remain the source of truth for reusable audio content
and listener delivery. A frame is not an episode and is not used as broadcast
history.

Migration `20261017120000_create_broadcast_context_manager.sql` reuses and
extends `episodes`, then adds only the relationships absent from the current
schema:

| Table | Role |
| --- | --- |
| `episodes` (extended) | Stores raw generated content, optional supplied summary, exact derived closing sentence, and generation timestamp. It remains the reusable high-level episode record. |
| `broadcast_memories` | The first curated universal-memory source. The prior schema contained no relationship-memory equivalent. It is deliberately separate from generated narration. |
| `broadcast_iterations` | Stable `generation_key`, deterministic identity sequence, predecessor, episode link, and independent generation/playback statuses. |
| `broadcast_iteration_songs` | Ordered manifest of backend-selected songs. Foreign keys and uniqueness protect song and position integrity. |
| `broadcast_iteration_memories` | Ordered manifest of curated memory references used for an iteration. |
| `broadcast_continuity_state` | A singleton, compact universal continuity pointer and optional rolling summary. Relationship history remains normalized in the manifest tables. |

Every new table has RLS enabled, matching the repository convention. No broad
policies are added; the server-only Supabase secret client continues to bypass
RLS.

## Service interface

Import the boundary from `src/broadcast` or use the composed application
instance:

```js
const { createBroadcastContextManager } = require("../src/broadcast");

const manager = createBroadcastContextManager();
const { iteration, context } = await manager.beginIteration({
  generationKey: "stable-job-or-request-id",
  selectedSongIds: [42, 84],
  selectedMemoryIds: [7],
});
```

`selectedSongIds` and `selectedMemoryIds` are already-curated backend inputs;
the service never selects or reorders them. Creation validates enabled songs,
active memories, uniqueness, and preserves array order as manifest positions.
Reusing a generation key with the same inputs returns the original iteration;
different inputs are rejected.

Because this is one universal broadcast timeline, only one pending manifest is
allowed at a time. Completed episodes may still await playback, so this does
not conflate generation and playback status.

The returned object is data for a future generator, not a prompt:

```json
{
  "broadcast_context": {
    "iteration_id": "uuid",
    "generation_key": "stable-job-or-request-id",
    "sequence_number": 12,
    "generation_status": "PENDING",
    "playback_status": "NOT_PLAYED",
    "previous_closing_sentence": "Literal sentence from the predecessor.",
    "previous_episode": {},
    "recent_episodes": [],
    "selected_songs": [],
    "curated_memories": [],
    "continuity_state": {
      "rolling_summary": null,
      "last_completed_iteration_id": null,
      "last_played_iteration_id": null,
      "last_closing_sentence": null
    }
  }
}
```

`recent_episodes` is limited to five completed predecessors by default and is
returned oldest-to-newest. Each entry carries its iteration/episode IDs,
summary when available, closing sentence, generation/playback statuses, songs,
and memory IDs. The service records the predecessor at iteration creation, so
the context is not changed by a later insert.

## Closing-sentence continuity

`persistCompletedEpisode` stores raw content unchanged in `episodes.raw_content`
and deterministically derives `episodes.closing_sentence`. It uses
`Intl.Segmenter` sentence segmentation and returns the final segment only when
it has terminal sentence punctuation; otherwise it stores `null`. It does not
paraphrase, summarize, or invent a fallback.

The next iteration reads its recorded predecessor, not merely the newest row,
and exposes the exact persisted string twice: in `previous_episode` and the
dedicated `previous_closing_sentence` field. The continuity singleton keeps a
copy for quick state inspection, but the episode row remains the source of the
literal generated content.

## Episode response and persistence

The current explicit response contract is:

```js
{
  title: "Required episode title",
  language: "en", // optional; defaults to en
  content: "Required raw generated narration.",
  summary: "Optional generator-supplied summary." // optional/null
}
```

The manager validates this shape but does not prompt an AI to produce it. A
missing summary remains `null`; no second model call or semantic summary is
invented. To commit it:

```js
await manager.persistCompletedEpisode({
  iterationId: iteration.id,
  episodeResponse,
});
```

The `complete_broadcast_iteration` PostgreSQL function atomically locks the
iteration and continuity state, inserts the episode, links it to the existing
manifest, writes the closing sentence, marks generation complete, and advances
the continuity singleton. It uses a SHA-256 hash of the validated response:
repeating the same response is idempotent, while a different response for a
completed iteration is rejected. Earlier pending iterations must complete
first, so a stale parallel completion cannot advance continuity out of order.
Any failure rolls back the whole function transaction and does not claim that
continuity advanced.

## Generation versus playback

Generation continuity uses the latest completed predecessor because it avoids
reusing inputs while ahead-of-playback generation is occurring. Playback is
independent: `recordEpisodePlayed({ iterationId })` calls
`mark_broadcast_iteration_played`, updates `playback_status`, and advances only
`last_played_iteration_id` when ordering permits. This does not infer playback
from a frame ledger and does not alter the current radio session or frame API.

There is presently no episode-to-sentence/frame production coordinator in the
repository, so calling `recordEpisodePlayed` from such a coordinator is a
future integration step. It must occur from actual high-level episode playback
knowledge, not from an arbitrary frame completion.

## Running and verifying

Apply the migration using the existing server command:

```bash
cd Server
npm run supabase -- db push
npm test
```

The test suite includes `test/broadcastContextManager.test.js`, which covers
first iteration behavior, ordered inputs, five-item chronological history,
exact closing-sentence preservation, generation/playback distinction,
idempotent response processing, invalid closing anchors, and failed-persistence
continuity safety. These are service tests with an in-memory repository; the
actual SQL functions should also be exercised against a linked Supabase test
project after migration deployment.

## Intentionally deferred

- AI system/user prompts and episode-generation orchestration.
- Selecting songs or curated memories.
- Producing sentences, frames, TTS, or audio files.
- Connecting high-level episode playback to the existing frame-delivery ledger.
- Semantic rolling-summary generation when the response omits `summary`.
