// Objective: Persist broadcast manifests and continuity through transaction-safe Supabase RPCs.
const { getSupabase } = require("../db");

function throwIfError(error, operation) {
  if (error) {
    error.message = `${operation}: ${error.message}`;
    throw error;
  }
}

async function singleRpc(query, operation) {
  const { data, error } = await query.single();
  throwIfError(error, operation);
  return data;
}

class BroadcastRepository {
  constructor({ db = getSupabase } = {}) {
    this.db = db;
  }

  async createIteration({ generationKey, songIds, memoryIds }) {
    return singleRpc(
      this.db().rpc("create_broadcast_iteration", {
        p_generation_key: generationKey,
        p_song_ids: songIds,
        p_memory_ids: memoryIds,
      }),
      "Creating broadcast iteration failed",
    );
  }

  async getContext(iterationId, historyLimit = 5) {
    const { data, error } = await this.db().rpc("get_broadcast_context", {
      p_iteration_id: iterationId,
      p_history_limit: historyLimit,
    });
    throwIfError(error, "Reading broadcast context failed");
    return Array.isArray(data) ? data[0] || null : data;
  }

  async completeIteration({ iterationId, title, language, rawContent, summary, closingSentence, responseHash }) {
    return singleRpc(
      this.db().rpc("complete_broadcast_iteration", {
        p_iteration_id: iterationId,
        p_title: title,
        p_language: language,
        p_raw_content: rawContent,
        p_summary: summary,
        p_closing_sentence: closingSentence,
        p_response_hash: responseHash,
      }),
      "Completing broadcast iteration failed",
    );
  }

  async markIterationPlayed(iterationId) {
    return singleRpc(
      this.db().rpc("mark_broadcast_iteration_played", { p_iteration_id: iterationId }),
      "Marking broadcast iteration played failed",
    );
  }
}

module.exports = BroadcastRepository;
