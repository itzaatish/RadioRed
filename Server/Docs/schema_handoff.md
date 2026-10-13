<!-- Objective: Define the durable content/audio data model and its song, sentence, and frame relationships. -->
# Schema Handoff

## Purpose

This document defines the currently agreed database schemas for the radio audio-generation system.

The goal is to give any developer working on the project a clear reference for:

- What each table represents.
- What each field means.
- How `songs`, `sentences`, and `frames` relate to each other.
- Which fields are required and why.
- How sentence-level audio is represented as a linked list of smaller frame audio files.
- Which design decisions are intentional and should not be changed casually.

This document covers the current content/audio schema only. The radio playback queue will be designed separately.

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

### Rule 2 — Sentences are logical audio units

The sentence represents the complete narration unit.

The queue will eventually operate at this higher logical level.

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

# 11. What Is Not Defined Yet

The following are intentionally outside this schema handoff:

- Radio queue table.
- Queue ordering implementation.
- Queue status/lifecycle.
- Queue concurrency/locking.
- Producer worker implementation.
- Consumer implementation.
- Playback session management.
- Audio streaming implementation.
- Sentence generation pipeline.
- LLM/TTS provider implementation.

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

The next architectural layer can therefore treat a **sentence as one playable logical unit**, while the sentence internally resolves to its sequence of frame audio files.
