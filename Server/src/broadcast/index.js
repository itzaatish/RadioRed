// Objective: Expose the broadcast context manager without coupling it to the audio producer boundary.
const BroadcastRepository = require("../repositories/BroadcastRepository");
const { BroadcastContextManager, extractClosingSentence, validateEpisodeResponse } = require("../services/BroadcastContextManager");

function createBroadcastContextManager({ repository = new BroadcastRepository(), historyLimit = 5 } = {}) {
  return new BroadcastContextManager({ repository, historyLimit });
}

module.exports = {
  BroadcastRepository,
  BroadcastContextManager,
  createBroadcastContextManager,
  extractClosingSentence,
  validateEpisodeResponse,
};
