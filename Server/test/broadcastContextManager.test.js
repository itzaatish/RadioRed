// Objective: Verify universal broadcast context, exact closing anchors, persistence, and idempotency without touching producer/frame behavior.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { BroadcastContextManager, extractClosingSentence } = require("../src/services/BroadcastContextManager");

class InMemoryBroadcastRepository {
  constructor() {
    this.iterations = [];
    this.episodes = [];
    this.continuity = null;
    this.completeCalls = 0;
    this.failCompletion = false;
    this.songs = new Map([
      [1, { id: 1, external_id: "song-1", title: "First Song", artist: "Artist One", enabled: true }],
      [2, { id: 2, external_id: "song-2", title: "Second Song", artist: "Artist Two", enabled: true }],
      [3, { id: 3, external_id: "song-3", title: "Third Song", artist: "Artist Three", enabled: true }],
    ]);
    this.memories = new Map([
      [9, { id: 9, external_id: "memory-9", content: "They danced in the rain.", category: "memory", active: true }],
      [10, { id: 10, external_id: "memory-10", content: "The old record player still works.", category: "home", active: true }],
    ]);
  }

  async createIteration({ generationKey, songIds, memoryIds }) {
    const existing = this.iterations.find((iteration) => iteration.generation_key === generationKey);
    if (existing) {
      assert.deepEqual(existing.song_ids, songIds);
      assert.deepEqual(existing.memory_ids, memoryIds);
      return existing;
    }
    for (const id of songIds) assert.equal(this.songs.get(id)?.enabled, true, "selected song must be enabled");
    for (const id of memoryIds) assert.equal(this.memories.get(id)?.active, true, "selected memory must be active");

    const predecessor = [...this.iterations].reverse().find((iteration) => iteration.generation_status === "COMPLETED") || null;
    const iteration = {
      id: `iteration-${this.iterations.length + 1}`,
      generation_key: generationKey,
      sequence_number: this.iterations.length + 1,
      predecessor_iteration_id: predecessor?.id || null,
      generation_status: "PENDING",
      playback_status: "NOT_PLAYED",
      song_ids: [...songIds],
      memory_ids: [...memoryIds],
      episode: null,
      response_hash: null,
    };
    this.iterations.push(iteration);
    return iteration;
  }

  async getContext(iterationId, historyLimit) {
    const current = this.iterations.find((iteration) => iteration.id === iterationId);
    if (!current) return null;
    const predecessor = this.iterations.find((iteration) => iteration.id === current.predecessor_iteration_id) || null;
    const history = this.iterations
      .filter((iteration) => iteration.generation_status === "COMPLETED" && (!predecessor || iteration.sequence_number <= predecessor.sequence_number))
      .slice(-historyLimit)
      .map((iteration) => this.#history(iteration));

    return {
      iteration_id: current.id,
      generation_key: current.generation_key,
      sequence_number: current.sequence_number,
      generation_status: current.generation_status,
      playback_status: current.playback_status,
      previous_episode: predecessor ? this.#previous(predecessor) : null,
      recent_episodes: history,
      selected_songs: current.song_ids.map((id) => this.#song(this.songs.get(id))),
      curated_memories: current.memory_ids.map((id) => this.#memory(this.memories.get(id))),
      continuity_state: this.continuity || {
        rolling_summary: null,
        last_completed_iteration_id: null,
        last_played_iteration_id: null,
        last_closing_sentence: null,
      },
    };
  }

  async completeIteration(payload) {
    this.completeCalls += 1;
    if (this.failCompletion) throw new Error("simulated database failure");
    const iteration = this.iterations.find((item) => item.id === payload.iterationId);
    if (iteration.generation_status === "COMPLETED") {
      if (iteration.response_hash === payload.responseHash) return iteration;
      throw new Error("response differs from completed iteration");
    }

    const episode = {
      id: this.episodes.length + 1,
      title: payload.title,
      language: payload.language,
      raw_content: payload.rawContent,
      summary: payload.summary,
      closing_sentence: payload.closingSentence,
    };
    this.episodes.push(episode);
    iteration.episode = episode;
    iteration.generation_status = "COMPLETED";
    iteration.response_hash = payload.responseHash;
    this.continuity = {
      rolling_summary: payload.summary,
      last_completed_iteration_id: iteration.id,
      last_played_iteration_id: this.continuity?.last_played_iteration_id || null,
      last_closing_sentence: payload.closingSentence,
    };
    return iteration;
  }

  async markIterationPlayed(iterationId) {
    const iteration = this.iterations.find((item) => item.id === iterationId);
    iteration.playback_status = "PLAYED";
    this.continuity.last_played_iteration_id = iteration.id;
    return iteration;
  }

  #song(song) {
    return { id: song.id, external_id: song.external_id, title: song.title, artist: song.artist };
  }

  #memory(memory) {
    return { id: memory.id, external_id: memory.external_id, content: memory.content, category: memory.category };
  }

  #previous(iteration) {
    return {
      iteration_id: iteration.id,
      sequence_number: iteration.sequence_number,
      episode_id: iteration.episode.id,
      summary: iteration.episode.summary,
      closing_sentence: iteration.episode.closing_sentence,
      generation_status: iteration.generation_status,
      playback_status: iteration.playback_status,
    };
  }

  #history(iteration) {
    return {
      ...this.#previous(iteration),
      songs: iteration.song_ids.map((id) => this.#song(this.songs.get(id))),
      memory_ids: [...iteration.memory_ids],
    };
  }
}

async function beginAndComplete(manager, key, number) {
  const started = await manager.beginIteration({ generationKey: key, selectedSongIds: [1], selectedMemoryIds: [9] });
  await manager.persistCompletedEpisode({
    iterationId: started.iteration.id,
    episodeResponse: {
      title: `Episode ${number}`,
      content: `Opening ${number}. Closing ${number}!`,
      summary: `Summary ${number}`,
    },
  });
  return started;
}

test("first broadcast iteration has no predecessor and records ordered curated inputs", async () => {
  const repository = new InMemoryBroadcastRepository();
  const manager = new BroadcastContextManager({ repository });
  const first = await manager.beginIteration({ generationKey: "generation-1", selectedSongIds: [2, 1], selectedMemoryIds: [10, 9] });

  assert.equal(first.context.broadcast_context.previous_episode, null);
  assert.equal(first.context.broadcast_context.previous_closing_sentence, null);
  assert.deepEqual(first.context.broadcast_context.selected_songs.map((song) => song.id), [2, 1]);
  assert.deepEqual(first.context.broadcast_context.curated_memories.map((memory) => memory.id), [10, 9]);
  assert.deepEqual(repository.iterations[0].song_ids, [2, 1]);
  assert.deepEqual(repository.iterations[0].memory_ids, [10, 9]);
});

test("completed episode preserves its exact closing sentence for the next generation", async () => {
  const repository = new InMemoryBroadcastRepository();
  const manager = new BroadcastContextManager({ repository });
  const first = await manager.beginIteration({ generationKey: "generation-1", selectedSongIds: [1], selectedMemoryIds: [9] });
  const response = {
    title: "Tonight",
    content: "Welcome back. And sometimes, the smallest moments are the ones we carry with us the longest.",
    summary: "A quiet reflection.",
  };
  await manager.persistCompletedEpisode({ iterationId: first.iteration.id, episodeResponse: response });

  const second = await manager.beginIteration({ generationKey: "generation-2", selectedSongIds: [2, 1], selectedMemoryIds: [10] });
  const context = second.context.broadcast_context;
  assert.equal(context.previous_closing_sentence, "And sometimes, the smallest moments are the ones we carry with us the longest.");
  assert.equal(context.previous_episode.closing_sentence, context.previous_closing_sentence);
  assert.equal(repository.episodes[0].raw_content, response.content);
  assert.equal(repository.episodes[0].summary, "A quiet reflection.");
  assert.equal(context.continuity_state.last_closing_sentence, context.previous_closing_sentence);
});

test("context returns the latest five completed episodes in chronological order", async () => {
  const repository = new InMemoryBroadcastRepository();
  const manager = new BroadcastContextManager({ repository });
  for (let number = 1; number <= 6; number += 1) {
    await beginAndComplete(manager, `generation-${number}`, number);
  }

  const next = await manager.beginIteration({ generationKey: "generation-7", selectedSongIds: [1], selectedMemoryIds: [] });
  assert.deepEqual(
    next.context.broadcast_context.recent_episodes.map((episode) => episode.sequence_number),
    [2, 3, 4, 5, 6],
  );
  assert.equal(next.context.broadcast_context.previous_episode.sequence_number, 6);
});

test("generation continuity uses the latest completed episode even when playback status differs", async () => {
  const repository = new InMemoryBroadcastRepository();
  const manager = new BroadcastContextManager({ repository });
  const first = await beginAndComplete(manager, "generation-1", 1);
  await manager.recordEpisodePlayed({ iterationId: first.iteration.id });
  const second = await beginAndComplete(manager, "generation-2", 2);

  const third = await manager.beginIteration({ generationKey: "generation-3", selectedSongIds: [3], selectedMemoryIds: [] });
  assert.equal(third.context.broadcast_context.previous_episode.iteration_id, second.iteration.id);
  assert.equal(third.context.broadcast_context.previous_episode.playback_status, "NOT_PLAYED");
  assert.equal(third.context.broadcast_context.continuity_state.last_played_iteration_id, first.iteration.id);
});

test("processing the same episode response twice is idempotent and does not repeat continuity", async () => {
  const repository = new InMemoryBroadcastRepository();
  const manager = new BroadcastContextManager({ repository });
  const started = await manager.beginIteration({ generationKey: "generation-1", selectedSongIds: [], selectedMemoryIds: [] });
  const input = {
    iterationId: started.iteration.id,
    episodeResponse: { title: "Idempotent", content: "One response. One ending!", summary: "Only once." },
  };
  const first = await manager.persistCompletedEpisode(input);
  const second = await manager.persistCompletedEpisode(input);

  assert.equal(first.id, second.id);
  assert.equal(repository.episodes.length, 1);
  assert.equal(repository.continuity.last_completed_iteration_id, started.iteration.id);
  assert.equal(repository.completeCalls, 2);
});

test("invalid or unterminated content does not fabricate a closing sentence, and failures do not advance continuity", async () => {
  assert.equal(extractClosingSentence("An unfinished ending"), null);
  const unterminatedRepository = new InMemoryBroadcastRepository();
  const unterminatedManager = new BroadcastContextManager({ repository: unterminatedRepository });
  const unterminated = await unterminatedManager.beginIteration({ generationKey: "unterminated", selectedSongIds: [], selectedMemoryIds: [] });
  await unterminatedManager.persistCompletedEpisode({
    iterationId: unterminated.iteration.id,
    episodeResponse: { title: "No anchor", content: "An unfinished ending" },
  });
  assert.equal(unterminatedRepository.episodes[0].closing_sentence, null);

  const repository = new InMemoryBroadcastRepository();
  repository.failCompletion = true;
  const manager = new BroadcastContextManager({ repository });
  const started = await manager.beginIteration({ generationKey: "generation-1", selectedSongIds: [], selectedMemoryIds: [] });

  await assert.rejects(
    manager.persistCompletedEpisode({
      iterationId: started.iteration.id,
      episodeResponse: { title: "Failure", content: "This is valid.", summary: "Will not persist." },
    }),
    /simulated database failure/,
  );
  assert.equal(repository.continuity, null);
  assert.equal(repository.iterations[0].generation_status, "PENDING");
});

test("broadcast migration leaves frame and radio-session schema untouched", () => {
  const migration = fs.readFileSync(
    path.join(__dirname, "../supabase/migrations/20261017120000_create_broadcast_context_manager.sql"),
    "utf8",
  );
  assert.match(migration, /create table if not exists "public"\."broadcast_iterations"/);
  assert.match(migration, /create table if not exists "public"\."broadcast_iteration_songs"/);
  assert.match(migration, /create table if not exists "public"\."broadcast_iteration_memories"/);
  assert.doesNotMatch(migration, /alter table "public"\."frames"/);
  assert.doesNotMatch(migration, /alter table "public"\."sentences"/);
  assert.doesNotMatch(migration, /alter table "public"\."radio_sessions"/);
  assert.doesNotMatch(migration, /alter table "public"\."radio_session_frames"/);
});
