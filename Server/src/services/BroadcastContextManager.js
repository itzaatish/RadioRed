// Objective: Assemble bounded universal broadcast context and persist validated AI episode output without generating narration.
const crypto = require("node:crypto");

function requireText(value, name, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function optionalText(value, name) {
  if (value === undefined || value === null) return null;
  return requireText(value, name);
}

function requireIdList(value, name) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array of positive integer IDs.`);
  const normalized = value.map((id) => Number(id));
  if (normalized.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    throw new Error(`${name} must contain only positive integer IDs.`);
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${name} must not contain duplicate IDs.`);
  }
  return normalized;
}

/**
 * Extract the literal final sentence from the raw generated content. Segmenter
 * preserves the segment's original wording and punctuation; only surrounding
 * whitespace is trimmed. Content without terminal sentence punctuation has no
 * reliable closing anchor and returns null.
 */
function extractClosingSentence(content, language = "en") {
  if (typeof content !== "string" || !content.trim()) return null;
  const locale = typeof language === "string" && language.trim() ? language : "en";
  let segments;

  if (typeof Intl.Segmenter === "function") {
    segments = [...new Intl.Segmenter(locale, { granularity: "sentence" }).segment(content)]
      .map(({ segment }) => segment.trim())
      .filter(Boolean);
  } else {
    // Node versions supported by this project provide Intl.Segmenter. This is
    // only a deterministic compatibility fallback, not a semantic rewrite.
    segments = content.match(/[^.!?]+[.!?]+(?:["'”’\)\]]*)/g)?.map((segment) => segment.trim()) || [];
  }

  const candidate = segments.at(-1);
  return candidate && /[.!?]+(?:["'”’\)\]]*)$/u.test(candidate) ? candidate : null;
}

function responseHash({ title, language, content, summary }) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ title, language, content, summary }))
    .digest("hex");
}

function validateEpisodeResponse(response) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("episodeResponse must be an object.");
  }

  const title = requireText(response.title, "episodeResponse.title");
  const language = response.language === undefined ? "en" : requireText(response.language, "episodeResponse.language");
  const content = requireText(response.content, "episodeResponse.content");
  const summary = optionalText(response.summary, "episodeResponse.summary");

  return {
    title,
    language,
    content,
    summary,
    closingSentence: extractClosingSentence(content, language),
    hash: responseHash({ title, language, content, summary }),
  };
}

class BroadcastContextManager {
  constructor({ repository, historyLimit = 5 } = {}) {
    if (!repository) throw new Error("BroadcastContextManager requires a repository.");
    if (!Number.isSafeInteger(historyLimit) || historyLimit < 1 || historyLimit > 20) {
      throw new Error("historyLimit must be an integer between 1 and 20.");
    }
    this.repository = repository;
    this.historyLimit = historyLimit;
  }

  async beginIteration({ generationKey, selectedSongIds = [], selectedMemoryIds = [] } = {}) {
    const iteration = await this.repository.createIteration({
      generationKey: requireText(generationKey, "generationKey"),
      songIds: requireIdList(selectedSongIds, "selectedSongIds"),
      memoryIds: requireIdList(selectedMemoryIds, "selectedMemoryIds"),
    });
    return {
      iteration,
      context: await this.buildBroadcastContext({ iterationId: iteration.id }),
    };
  }

  async buildBroadcastContext({ iterationId } = {}) {
    requireText(iterationId, "iterationId");
    const context = await this.repository.getContext(iterationId, this.historyLimit);
    if (!context) throw new Error("Broadcast iteration context was not found.");

    return {
      broadcast_context: {
        ...context,
        // This is intentionally separate from summaries/history so a future
        // generator can use the literal continuity anchor without parsing.
        previous_closing_sentence: context.previous_episode?.closing_sentence || null,
      },
    };
  }

  async persistCompletedEpisode({ iterationId, episodeResponse } = {}) {
    requireText(iterationId, "iterationId");
    const response = validateEpisodeResponse(episodeResponse);
    return this.repository.completeIteration({
      iterationId,
      title: response.title,
      language: response.language,
      rawContent: response.content,
      summary: response.summary,
      closingSentence: response.closingSentence,
      responseHash: response.hash,
    });
  }

  async recordEpisodePlayed({ iterationId } = {}) {
    requireText(iterationId, "iterationId");
    return this.repository.markIterationPlayed(iterationId);
  }
}

module.exports = {
  BroadcastContextManager,
  extractClosingSentence,
  validateEpisodeResponse,
};
