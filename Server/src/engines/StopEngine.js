// Objective: Stop or pause a session idempotently and invalidate its future scheduling work.
const IEngine = require("./IEngine");
const { SessionState } = require("../radio/RadioState");

class StopEngine extends IEngine {
  constructor({ sessionRepository, scheduler, producer, logger }) {
    super();
    this.sessionRepository = sessionRepository;
    this.scheduler = scheduler;
    this.producer = producer;
    this.logger = logger;
  }

  async execute({ sessionId, reason = "stopped_by_listener", status = SessionState.STOPPED }) {
    this.scheduler.cancel(sessionId);
    const { session, transitioned } = await this.sessionRepository.deactivate({ sessionId, status, reason });

    if (transitioned) {
      try {
        await this.producer.stopSession({
          sessionId,
          sessionVersion: session.session_version,
          reason,
        });
      } catch (error) {
        // Stop state has already been persisted; producer cleanup can be retried independently.
        this.logger.warn("producer_stop_request_failed", { sessionId, message: error.message });
      }
      this.logger.info("session_stopped", { sessionId, status, reason });
    }

    return { session, alreadyInactive: !transitioned };
  }
}

module.exports = StopEngine;
