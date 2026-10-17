<!-- Objective: Define the durable content/audio data model and its song, sentence, and frame relationships. -->
# Schema Handoff

## Purpose

This document describes the schema actually created by the SQL migrations in
`supabase/migrations/`. The migrations are the source of truth if this handoff
and the database differ. It covers both reusable content/audio data and the
persisted radio-engine session and frame-delivery state.

The goal is to give any developer working on the project a clear reference for:

- What each table represents.
- What each field means.
- How `episodes`, `songs`, `sentences`, and `frames` relate to each other.
- How `radio_sessions` and `radio_session_frames` persist playback state.
- Which fields are required and why.
- How sentence-level audio is represented as a linked list of smaller frame audio files.
- What the database functions do when starting/stopping sessions and claiming frames.
- Which design decisions are intentional and should not be changed casually.

This is a migration-level reference. It does not claim that every relationship
or business rule described in prose is enforced by a database constraint.

---

# 1. Core Mental Model

The system has three levels:

```text
SONG
  │
  │ optional reference
  ▼
SENTENCE
  │
  │ first_frame_id
  ▼
FRAME
  │
  │ next_frame_id
  ▼
FRAME
  │
  │ next_frame_id
  ▼
FRAME
  │
  ▼
NULL
```

There is also an independent `episodes` metadata table and a playback ledger:

```text
RADIO_SESSION
  │
  └── RADIO_SESSION_FRAME (ordered per-session frame delivery/playback record)
          └── FRAME
```

### Song

A song is a complete playable audio track stored in Supabase Storage.

### Sentence

A sentence is a logical piece of radio narration.

A sentence may be associated with a song depending on its type.

A sentence can consist of multiple small audio frames.

### Frame

A frame is the smallest generated audio unit.

A sentence may contain many frames because the generated/synthesized sentence is split into smaller audio pieces.

Frames form a singly linked list:

```text
frame A → frame B → frame C → NULL
```

Frames also carry generation status. The radio engine uses them as its
claim/delivery units and records each selected frame in a session-specific
ledger.

The sentence stores only the ID of its first frame.

---

# 2. `public.songs`

## Purpose

Stores metadata about songs available to the radio system.

The actual audio file is stored in Supabase Storage. The database stores the path needed to locate that file.

## Schema

```json
{
  "schema": "public",
  "table": "songs",
  "columns": [
    {
      "name": "id",
      "type": "bigint",
      "identity": true,
      "primaryKey": true
    },
    {
      "name": "external_id",
      "type": "text",
      "notNull": true,
      "unique": true
    },
    {
      "name": "title",
      "type": "text",
      "notNull": true
    },
    {
      "name": "artist",
      "type": "text"
    },
    {
      "name": "album",
      "type": "text"
    },
    {
      "name": "audio_path",
      "type": "text",
      "notNull": true
    },
    {
      "name": "duration_seconds",
      "type": "integer"
    },
    {
      "name": "tone",
      "type": "integer",
      "notNull": true
    },
    {
      "name": "language",
      "type": "text",
      "default": "'en'"
    },
    {
      "name": "genre",
      "type": "text"
    },
    {
      "name": "mood",
      "type": "text"
    },
    {
      "name": "tags",
      "type": "jsonb",
      "notNull": true,
      "default": "'[]'"
    },
    {
      "name": "relationship_tags",
      "type": "jsonb",
      "notNull": true,
      "default": "'[]'"
    },
    {
      "name": "times_played",
      "type": "integer",
      "notNull": true,
      "default": "0"
    },
    {
      "name": "last_played_at",
      "type": "timestamptz"
    },
    {
      "name": "enabled",
      "type": "boolean",
      "notNull": true,
      "default": "true"
    },
    {
      "name": "created_at",
      "type": "timestamptz",
      "notNull": true,
      "default": "now()"
    },
    {
      "name": "updated_at",
      "type": "timestamptz",
      "notNull": true,
      "default": "now()"
    }
  ],
  "indexes": [
    {
      "columns": ["tone"]
    },
    {
      "columns": ["enabled"]
    },
    {
      "columns": ["last_played_at"]
    }
  ],
  "rls": true
}
```

The migration creates these named indexes: `songs_tone_idx`,
`songs_enabled_idx`, and `songs_last_played_at_idx`.

## Field significance

| Field | Significance |
|---|---|
| `id` | Internal database identifier for the song. Other tables can reference this value. |
| `external_id` | Stable application-level identifier. Useful when exposing or referring to songs outside the database's internal numeric ID. |
| `title` | Song title. |
| `artist` | Artist/performer of the song. |
| `album` | Album containing the song, when applicable. |
| `audio_path` | Path of the song audio inside Supabase Storage. Store the path rather than a temporary/signed URL. |
| `duration_seconds` | Duration of the complete song in seconds. Useful for queue-duration calculations. |
| `tone` | Integer representing the song's current tone classification. The application will define the meaning/mapping of the integer values. |
| `language` | Language of the song. Defaults to English. |
| `genre` | Musical genre. |
| `mood` | General mood classification. |
| `tags` | Flexible collection of additional song tags. |
| `relationship_tags` | Tags describing relationship/personal relevance of the song. |
| `times_played` | Number of times the radio has played the song. |
| `last_played_at` | Timestamp of the most recent playback. Useful for avoiding excessive repetition. |
| `enabled` | Whether the song is currently eligible for selection/playback. |
| `created_at` | Time when the database record was created. |
| `updated_at` | Time when the database record was last updated. |

---

# 3. `public.frames`

## Purpose

A frame is the smallest physical audio unit generated by the system.

A frame contains an audio file representing only a portion of a sentence.

For example:

```text
Sentence:
"I remember the first time we went there together."

Frames:

Frame 101 → "I remember the"
Frame 102 → "first time we"
Frame 103 → "went there"
Frame 104 → "together."
```

Frames are connected using `next_frame_id`.

## Schema

```json
{
  "schema": "public",
  "table": "frames",
  "columns": [
    {
      "name": "id",
      "type": "bigint",
      "identity": true,
      "primaryKey": true
    },
    {
      "name": "external_id",
      "type": "text",
      "notNull": true,
      "unique": true
    },
    {
      "name": "audio_path",
      "type": "text",
      "notNull": true
    },
    {
      "name": "duration_seconds",
      "type": "integer",
      "notNull": true
    },
    {
      "name": "transcript",
      "type": "text"
    },
    {
      "name": "next_frame_id",
      "type": "bigint",
      "references": "public.frames(id)"
    },
    {
      "name": "metadata",
      "type": "jsonb",
      "notNull": true,
      "default": "'{}'"
    },
    {
      "name": "created_at",
      "type": "timestamptz",
      "notNull": true,
      "default": "now()"
    }
  ],
  "indexes": [
    {
      "columns": ["next_frame_id"]
    },
    {
      "columns": ["created_at"]
    }
  ],
  "rls": true
}
```

The migration creates these named indexes: `frames_next_frame_id_idx` and
`frames_created_at_idx`. `external_id UNIQUE` also creates a PostgreSQL
unique index.

## Field significance

| Field | Significance |
|---|---|
| `id` | Internal identifier for the individual audio frame. |
| `external_id` | Stable application-level identifier for the frame. |
| `audio_path` | Path to the frame's audio file in Supabase Storage. |
| `duration_seconds` | Duration of this individual frame. |
| `transcript` | Text represented by this frame's audio. Useful for debugging, regeneration, inspection, and generation workflows. |
| `next_frame_id` | Points to the next frame belonging to the same sentence. `NULL` means this is the final frame of the sentence. |
| `metadata` | Flexible information about generation or audio processing that does not deserve its own column yet. |
| `created_at` | Time when the frame record was created. |

## Frame linked-list semantics

A sentence might have:

```text
Sentence 50
first_frame_id = 101

101 → 102 → 103 → 104 → NULL
```

The consumer starts at `101` and repeatedly follows `next_frame_id`.

When it reaches `NULL`, the sentence is complete.

### Important

`next_frame_id` is deliberately on `frames`.

There is no `previous_frame_id`.

The structure is a **singly linked list** because playback only needs to move forward.

---

# 4. `public.sentences`

## Purpose

A sentence is the logical narration unit used by the radio.

A sentence may be:

- A sentence before a song.
- A sentence after a song.
- A transition.
- An advertisement.
- A general narration/message.

A sentence can contain multiple frames.

The sentence stores the first frame and the total duration, while the frames contain the actual audio pieces.

## Schema

```json
{
  "schema": "public",
  "table": "sentences",
  "columns": [
    {
      "name": "id",
      "type": "bigint",
      "identity": true,
      "primaryKey": true
    },
    {
      "name": "external_id",
      "type": "text",
      "notNull": true,
      "unique": true
    },
    {
      "name": "type",
      "type": "text",
      "notNull": true
    },
    {
      "name": "song_id",
      "type": "bigint",
      "references": "public.songs(id)"
    },
    {
      "name": "first_frame_id",
      "type": "bigint",
      "notNull": true,
      "references": "public.frames(id)"
    },
    {
      "name": "duration_seconds",
      "type": "integer",
      "notNull": true
    },
    {
      "name": "transcript",
      "type": "text"
    },
    {
      "name": "tone",
      "type": "integer"
    },
    {
      "name": "metadata",
      "type": "jsonb",
      "notNull": true,
      "default": "'{}'"
    },
    {
      "name": "created_at",
      "type": "timestamptz",
      "notNull": true,
      "default": "now()"
    }
  ],
  "indexes": [
    {
      "columns": ["type"]
    },
    {
      "columns": ["song_id"]
    },
    {
      "columns": ["first_frame_id"]
    },
    {
      "columns": ["tone"]
    },
    {
      "columns": ["created_at"]
    }
  ],
  "rls": true
}
```

The migration creates these named indexes: `sentences_type_idx`,
`sentences_song_id_idx`, `sentences_first_frame_id_idx`,
`sentences_tone_idx`, and `sentences_created_at_idx`.

## Field significance

| Field | Significance |
|---|---|
| `id` | Internal identifier for the logical sentence. |
| `external_id` | Stable application-level identifier for the sentence. |
| `type` | Defines the semantic role of the sentence in the radio flow. This is intentionally `text` for now; PostgreSQL enums are **not being implemented at this stage**. |
| `song_id` | Optional reference to the song associated with this sentence. Relevant for sentence types such as `pre_song` and `post_song`. It is `NULL` for sentence types that do not refer to a song, such as transitions or ads. |
| `first_frame_id` | Entry point into the sentence's frame linked list. |
| `duration_seconds` | Total duration of the sentence's audio. This should represent the combined duration of all frames in the sentence and is used later for calculating the amount of audio available in the queue. |
| `transcript` | Complete text represented by the sentence. |
| `tone` | Integer representing the desired/generated tone of the sentence. The application will define the meaning of the integer values. |
| `metadata` | Flexible additional sentence-level generation/context information. |
| `created_at` | Time when the sentence record was created. |

---

# 5. Sentence Types

`sentences.type` is currently a `text` field.

We are **not implementing PostgreSQL enums right now**.

The currently expected values are:

```text
pre_song
post_song
transition
ad
general
```

### `pre_song`

Narration intended to occur before a song.

Example:

```text
"And this next song always reminds me of you..."
```

Expected relationship:

```text
type = "pre_song"
song_id = <song>
```

### `post_song`

Narration intended to occur after a song.

Example:

```text
"Every time I hear that song, I think about that evening..."
```

Expected relationship:

```text
type = "post_song"
song_id = <song>
```

### `transition`

A narration unit used to move between radio content.

Expected relationship:

```text
type = "transition"
song_id = NULL
```

### `ad`

An advertisement/sponsor-style narration unit.

Expected relationship:

```text
type = "ad"
song_id = NULL
```

### `general`

General radio narration that does not belong specifically before/after a song.

Expected relationship:

```text
type = "general"
song_id = NULL
```

The application should validate these rules for now. Database-level constraints can be added later if required.

---

# 6. Relationships

## Song → Sentence

A sentence may optionally reference a song:

```text
sentences.song_id → songs.id
```

This is intentionally optional because not every sentence is song-specific.

Example:

```text
Pre-song sentence
        │
        └──── song_id ────→ Song #42
```

---

## Sentence → First Frame

Every sentence must have a first frame:

```text
sentences.first_frame_id → frames.id
```

This gives the sentence its entry point.

---

## Frame → Next Frame

A frame may point to another frame:

```text
frames.next_frame_id → frames.id
```

The final frame has:

```text
next_frame_id = NULL
```

Example:

```text
Sentence #50
       │
       │ first_frame_id
       ▼
Frame #101
       │
       │ next_frame_id
       ▼
Frame #102
       │
       │ next_frame_id
       ▼
Frame #103
       │
       ▼
     NULL
```

---

# 7. Duration Model

There are two levels of duration.

## Frame duration

Each frame stores its own duration:

```text
frames.duration_seconds
```

Example:

```text
Frame 101 = 2 sec
Frame 102 = 3 sec
Frame 103 = 2 sec
```

## Sentence duration

The sentence stores the aggregate duration:

```text
sentences.duration_seconds = 7
```

Conceptually:

```text
sentence.duration
=
sum(all frame durations in its linked list)
```

The sentence-level value exists so the system does not need to traverse every frame simply to determine how much audio the sentence contributes to the queue.

---

# 8. Storage Model

The database stores metadata and storage paths.

The actual audio files live in Supabase Storage.

For example:

```text
songs/
  song-42.mp3

frames/
  frame-101.mp3
  frame-102.mp3
  frame-103.mp3
```

The database stores:

```text
audio_path = "frames/frame-101.mp3"
```

rather than storing a permanent signed URL.

A signed/public URL can be generated when the backend needs to provide access to the audio.

---

# 9. Example Complete Sentence

Suppose the AI generates:

> "I remember the first time we went to that cafe together."

The system splits the generated audio into four frames.

### Frames

```text
Frame 101
transcript = "I remember the"
audio_path = "frames/101.mp3"
duration_seconds = 2

next_frame_id = 102
```

```text
Frame 102
transcript = "first time we"
audio_path = "frames/102.mp3"
duration_seconds = 2

next_frame_id = 103
```

```text
Frame 103
transcript = "went to that cafe"
audio_path = "frames/103.mp3"
duration_seconds = 3

next_frame_id = 104
```

```text
Frame 104
transcript = "together."
audio_path = "frames/104.mp3"
duration_seconds = 1

next_frame_id = NULL
```

### Sentence

```text
Sentence 50

type = "pre_song"
song_id = 42
first_frame_id = 101
duration_seconds = 8
```

The logical structure is:

```text
Sentence #50
     │
     │ first_frame_id
     ▼
Frame #101
     │
     ▼
Frame #102
     │
     ▼
Frame #103
     │
     ▼
Frame #104
     │
     ▼
    NULL
```

---

# 10. Important Design Rules

### Rule 1 — Frames are physical audio fragments

Do not use frames as the high-level radio queue items.

A frame only represents a small piece of audio.

### Rule 2 — Sentences are logical audio units; the engine ledger records frames

The sentence represents the complete narration unit.
The sentence points to its first frame, but the radio-engine migration does
not create a sentence-level queue table: `radio_session_frames` records frame
delivery and playback state.

### Rule 3 — Do not store `song_id` on frames

Frames belong to a sentence.

The sentence can reference the relevant song.

This avoids duplicating song relationships across every frame in the same sentence.

### Rule 4 — `next_frame_id` is only for frames within the same sentence

Do not use the frame linked list to connect different sentences.

For example:

```text
Sentence A:
101 → 102 → 103 → NULL

Sentence B:
201 → 202 → NULL
```

Never:

```text
103 → 201
```

The boundary between sentences must remain explicit.

### Rule 5 — `first_frame_id` is the sentence entry point

To play a sentence:

1. Fetch the sentence.
2. Read `first_frame_id`.
3. Fetch that frame.
4. Play its audio.
5. Read `next_frame_id`.
6. Continue until `next_frame_id IS NULL`.
7. The sentence is now complete.

### Rule 6 — Duration is maintained at both levels

Frame duration helps understand individual audio pieces.

Sentence duration lets the queue understand the amount of playable audio without traversing the frame chain.

### Rule 7 — `type` remains text for now

Do not implement PostgreSQL enums yet.

The application currently treats the following as the expected values:

```text
pre_song
post_song
transition
ad
general
```

Validation can be handled in application code initially.

---

# 11. What Is Not Defined by These Migrations

The migrations provide session lifecycle state and a per-session frame
delivery ledger, but they do not define:

- A separate queue table, sentence-level queue entries, or a queue of songs.
- A producer worker, consumer, audio streaming protocol, or generation pipeline.
- Automatic frame/sentence relationship validation (for example, that every
  linked frame belongs to exactly one sentence).
- Validation that a sentence's stored duration equals the sum of its frames.
- Validation that sentence types, tones, or metadata values are meaningful to
  the application.
- Automatic `updated_at` maintenance through triggers.
- RLS policies or explicit database grants for the tables/RPC functions.

The database functions implement the specific session and frame-claim
operations described below; they are not a general queue implementation.

These should be designed on top of the current `songs → sentences → frames` content model.

---

# 12. Current Architecture Summary

```text
                    ┌───────────────┐
                    │     SONGS     │
                    │               │
                    │ id            │
                    │ title         │
                    │ artist        │
                    │ audio_path    │
                    │ tone          │
                    └───────┬───────┘
                            │
                            │ optional song_id
                            ▼
                    ┌───────────────┐
                    │   SENTENCES   │
                    │               │
                    │ id            │
                    │ type          │
                    │ song_id       │
                    │ first_frame   │
                    │ duration      │
                    │ tone          │
                    └───────┬───────┘
                            │
                            │ first_frame_id
                            ▼
                    ┌───────────────┐
                    │    FRAME      │
                    │               │
                    │ id            │
                    │ audio_path    │
                    │ duration      │
                    │ transcript    │
                    │ next_frame_id │──────┐
                    └───────────────┘      │
                                           ▼
                                    ┌───────────────┐
                                    │    FRAME      │
                                    │               │
                                    │ next_frame_id │──────┐
                                    └───────────────┘      │
                                                           ▼
                                                    ┌───────────────┐
                                                    │    FRAME      │
                                                    │               │
                                                    │ next_frame_id │
                                                    │     = NULL    │
                                                    └───────────────┘
```

The content model treats a **sentence as one logical narration unit**. The
radio-engine migration, however, claims and tracks individual frames and
exposes them through `radio_session_frames`.

---

# 13. Migration History and Scope

The migrations are applied in timestamp order:

| Migration | Effect |
|---|---|
| `20261003214712_create_public_episodes.sql` | Creates `public.episodes`, its `published_at` index, and enables RLS. |
| `20261003225031_create_public_sentences.sql` | Historical no-op retained for remote migration-history compatibility. It explicitly notes that `sentences` is created in the following audio-schema migration. |
| `20261004120000_create_public_radio_audio_tables.sql` | Creates `songs`, `frames`, and `sentences`, their indexes, and enables RLS on each. |
| `20261010100000_create_radio_engine_tables.sql` | Adds `frames.status`; creates `radio_sessions` and `radio_session_frames`; enables RLS on both; defines `stop_radio_session`, `activate_radio_session`, and `claim_radio_frame`. |

The migrations use `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
and `ADD COLUMN IF NOT EXISTS` for their main objects. The frame status check
constraint is added in a `DO` block only when no constraint with the name
`frames_status_check` is found in `pg_constraint`.

All objects described below are in the `public` schema. Unless stated
otherwise, foreign keys use PostgreSQL's default `NO ACTION` behavior; no
`ON DELETE CASCADE` or `ON UPDATE CASCADE` is specified.

---

# 14. `public.episodes`

`episodes` stores reusable episode metadata. None of the migrations adds a
foreign key between this table and `songs`, `sentences`, frames, or radio
sessions.

| Column | Type | Null/default/constraint |
|---|---|---|
| `id` | `bigint` | Primary key; `GENERATED BY DEFAULT AS IDENTITY`. |
| `external_id` | `text` | `NOT NULL UNIQUE`. |
| `title` | `text` | `NOT NULL`. |
| `language` | `text` | `NOT NULL DEFAULT 'en'`. |
| `metadata` | `jsonb` | `NOT NULL DEFAULT '{}'`. |
| `published_at` | `timestamptz` | Nullable. |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()`. |

Index: `episodes_published_at_idx` on `published_at`.

RLS is enabled. The migration creates no policies.

---

# 15. `public.frames.status`

The engine migration adds this column to the `frames` table created by the
audio-content migration:

| Column | Type | Null/default/constraint |
|---|---|---|
| `status` | `text` | `NOT NULL DEFAULT 'READY'`; checked against `GENERATING`, `READY`, `FAILED`. |

Existing rows receive the default `READY` when the column is added. The check
constraint is named `frames_status_check`. There is no status index and no
database rule that automatically changes a frame's status as audio generation
progresses.

---

# 16. `public.radio_sessions`

One row represents a radio playback session. The partial unique index permits
at most one row with `status = 'ACTIVE'` across the entire table; this is a
global single-active-session rule, not a per-user or per-device limit.

| Column | Type | Null/default/constraint |
|---|---|---|
| `id` | `uuid` | Primary key; `DEFAULT gen_random_uuid()`. |
| `tone` | `integer` | `NOT NULL`. |
| `status` | `text` | `NOT NULL DEFAULT 'ACTIVE'`; check allows `ACTIVE`, `PAUSED`, `STOPPED`, `EXPIRED`. |
| `session_version` | `bigint` | `NOT NULL DEFAULT 1`; must be greater than zero. |
| `last_seen` | `timestamptz` | `NOT NULL DEFAULT now()`. |
| `playback_started_at` | `timestamptz` | Nullable. |
| `current_frame_id` | `bigint` | Nullable FK to `frames.id`. |
| `stop_reason` | `text` | Nullable. |
| `stopped_at` | `timestamptz` | Nullable. |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()`. |
| `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()`. |

Indexes:

- `radio_sessions_one_active_idx`: unique expression index on the constant
  `(true)`, partial predicate `status = 'ACTIVE'`. It allows only one active
  session globally.
- `radio_sessions_status_last_seen_idx`: composite index on `(status,
  last_seen)`, useful for status/heartbeat-time lookups.

RLS is enabled; no policy is created by the migration.

`session_version` is a lifecycle generation/version value. The lifecycle
functions increment it when changing a session between active and inactive
states, allowing callers to reject stale frame claims using an expected
version.

---

# 17. `public.radio_session_frames`

This is the session-specific frame ledger. It records ordering and delivery /
playback lifecycle for frames selected for a session. It is not a separate
queue of sentence records.

| Column | Type | Null/default/constraint |
|---|---|---|
| `id` | `bigint` | Primary key; `GENERATED BY DEFAULT AS IDENTITY`. |
| `session_id` | `uuid` | `NOT NULL` FK to `radio_sessions.id`. |
| `frame_id` | `bigint` | `NOT NULL` FK to `frames.id`. |
| `session_version` | `bigint` | `NOT NULL`; no positivity check is declared. |
| `sequence_number` | `integer` | `NOT NULL`; must be greater than zero. |
| `status` | `text` | `NOT NULL`; check allows `READY`, `DELIVERED`, `PLAYING`, `PLAYED`, `FAILED`. |
| `delivery_key` | `text` | Nullable; no default. |
| `delivered_at` | `timestamptz` | Nullable. |
| `playback_started_at` | `timestamptz` | Nullable. |
| `playback_completed_at` | `timestamptz` | Nullable. |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()`. |

Table-level uniqueness:

- `(session_id, sequence_number)` — a sequence position can occur once per
  session, across all session versions.
- `(session_id, frame_id)` — the same frame can occur only once in a given
  session, across all versions.

Indexes:

- `radio_session_frames_delivery_key_idx`: unique on
  `(session_id, session_version, delivery_key)` where `delivery_key IS NOT
  NULL`, making a non-null delivery key idempotent within one session version.
- `radio_session_frames_lookup_idx`: composite
  `(session_id, session_version, status, sequence_number)` for version/status
  ordered lookups.

RLS is enabled; no policy is created by the migration.

The migration declares no check tying status to timestamp columns; for
example, it does not require `delivered_at` when status is `DELIVERED`, or
`playback_completed_at` when status is `PLAYED`.

---

# 18. Database Functions

All three functions are `LANGUAGE plpgsql`. The migration does not mark them
`SECURITY DEFINER`, set a custom `search_path`, or add explicit grants.

## `stop_radio_session`

```text
public.stop_radio_session(
  p_session_id uuid,
  p_status text,
  p_reason text DEFAULT NULL
) RETURNS public.radio_sessions
```

Allowed target statuses are `PAUSED`, `STOPPED`, and `EXPIRED`; another
non-null value raises `Invalid inactive session status`. The function updates
the target row if it is currently `ACTIVE`, or if the target status is
`STOPPED` and the current status is `PAUSED`. An update:

- sets the requested status and `stop_reason`;
- increments `session_version`;
- sets `stopped_at` and `updated_at` to `now()`.

If no update occurs, it returns the existing row for that ID. For a missing
ID, the returned composite value is null. A repeated stop/expire/pause request
does not increment the version unless it meets the update conditions.

## `activate_radio_session`

```text
public.activate_radio_session(
  p_session_id uuid,
  p_tone integer
) RETURNS public.radio_sessions
```

For an existing non-`ACTIVE` session, it sets `tone`, switches status to
`ACTIVE`, increments `session_version`, refreshes `last_seen` and
`updated_at`, and clears `playback_started_at`, `current_frame_id`,
`stop_reason`, and `stopped_at`. If the row is already active, it returns the
current row without changing it. A missing ID yields a null composite value.
Activating while another session is active can fail the global unique partial
index.

## `claim_radio_frame`

```text
public.claim_radio_frame(
  p_session_id uuid,
  p_expected_version bigint,
  p_deliver boolean,
  p_delivery_key text DEFAULT NULL,
  p_max_pending integer DEFAULT 1
)
RETURNS TABLE (
  frame_id bigint,
  external_id text,
  audio_path text,
  duration_seconds integer,
  transcript text,
  metadata jsonb,
  sequence_number integer,
  delivery_status text,
  session_version bigint
)
```

Behavior:

1. Raises an exception if `p_max_pending < 1`.
2. Locks the requested session row with `FOR UPDATE`. Returns no row unless the
   session exists, is `ACTIVE`, and its `session_version` equals
   `p_expected_version`.
3. When `p_deliver` is true and a delivery key is supplied, first looks for an
   existing ledger row with the same session, version, and key. If found, it
   returns that frame/ledger status unchanged, making retries with that key
   idempotent.
4. In delivery mode, otherwise returns the earliest `DELIVERED` frame in the
   current session version, assigning the supplied key when provided. This
   lets a retry reuse an unacknowledged delivery. If none exists, it takes
   the earliest `READY` ledger row, marks it `DELIVERED`, stamps
   `delivered_at`, assigns the key, and returns it.
5. In reservation mode (`p_deliver = false`), counts `READY` ledger entries
   in the current session version. If the count is at least
   `p_max_pending`, it returns the earliest already-`READY` row rather than
   adding another reservation.
6. To select the next frame, it examines the highest-sequence ledger frame in
   the current session version. If that frame has a `next_frame_id`, that
   linked frame must be `READY`; if it is not ready (or absent), the function
   returns no row instead of skipping ahead. If there is no linked successor,
   it selects the earliest eligible sentence's first frame.
7. A new sentence start is selected by joining `sentences.first_frame_id` to
   a `READY` frame, matching the session's tone, and excluding frames already
   recorded for that session. The order is sentence `created_at`, then
   sentence `id`, ascending. The query does not filter by `sentences.type`,
   `songs.enabled`, or song playback state.
8. If no eligible frame is found, returns no row. Otherwise it assigns
   `max(sequence_number) + 1` for the session, inserts a ledger row with the
   current version and status `DELIVERED` (and `delivered_at = now()`) in
   delivery mode or `READY` in reservation mode, updates the session's
   `current_frame_id` and `updated_at`, and returns frame plus ledger details.

The function locks the session row to serialize claims for that session. It
does not automatically update a ledger entry to `PLAYING`, `PLAYED`, or
`FAILED`. It also does not update the ledger's `playback_started_at` or
`playback_completed_at`, or the session's `last_seen` or
`playback_started_at`. Those state changes, and acknowledgements after
delivery, must be handled elsewhere.

### Claim-function boundaries and implications

- `p_max_pending` counts only ledger rows whose status is `READY` in the
  current version. It does not count `DELIVERED`, `PLAYING`, or other states.
- Sequence allocation uses the maximum for the session across versions, while
  the previous-frame chain lookup is restricted to the current version.
- The “already used” exclusion for a new sentence's first frame checks all
  ledger versions for that session.
- Linked successors are followed through `frames.next_frame_id`; the function
  does not independently confirm that the successor belongs to the same
  sentence or matches the session tone.
- The function chooses sentence starts by `sentences.tone` and frame
  readiness; it does not enforce the narrative `sentences.type`/`song_id`
  conventions described earlier.

---

# 19. Database-Enforced Rules vs. Application Conventions

The migrations enforce the following directly:

- Primary keys and the declared unique keys/indexes.
- Non-null columns and declared defaults.
- The listed status values and positive checks for
  `radio_sessions.session_version`, `radio_session_frames.sequence_number`,
  and `p_max_pending` inside the claim function.
- Declared foreign-key existence for sentence/song/frame, frame/frame,
  session/current-frame, and session-ledger relationships.
- At most one active radio session globally.
- At most one ledger row per session/sequence and per session/frame.

The migrations do **not** enforce:

- `sentences.type` values or the expected mapping from sentence type to
  `song_id`.
- Non-negative song/frame/sentence durations or song play counts.
- That a sentence's first frame and all successors form one complete,
  acyclic chain belonging only to that sentence.
- That frame/sentence/session tones fall within any range or agree across
  records.
- A specific shape for JSON metadata/tags beyond their declared `jsonb` type.
- Timestamp/status consistency, heartbeat expiry, or automatic session
  expiration.
- Automatic `updated_at`, `last_seen`, frame-generation, or playback-state
  updates except for the explicit assignments in the functions above.
- Any row-level access policy; RLS is enabled without policies in these
  migrations.
