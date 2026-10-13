// Objective: Define the replaceable boundary through which engines request or cancel future audio production.
/**
 * Boundary for the future generator. It deliberately has no AI, TTS, or queue
 * implementation: replacing this adapter must not affect the radio engines.
 */
class ProducerAdapter {
  async ensureFrame() {
    return { requested: false, available: false, reason: "producer_not_configured" };
  }

  async stopSession() {
    return { accepted: true };
  }
}

module.exports = ProducerAdapter;
