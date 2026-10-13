// Objective: Own one cancellable lead-time or retry timer per active radio session.
const { SessionState } = require("./RadioState");

class FrameScheduler {
  constructor({ config, onPrepare, logger, clock = globalThis }) {
    this.config = config;
    this.onPrepare = onPrepare;
    this.logger = logger;
    this.clock = clock;
    this.schedules = new Map();
    this.generations = new Map();
  }

  scheduleForPlayback({ session, frame, playbackStartedAt }) {
    if (session.status !== SessionState.ACTIVE || !frame?.duration_seconds) return;

    const startsAt = new Date(playbackStartedAt).getTime();
    if (Number.isNaN(startsAt)) return;

    const dueAt = startsAt + Number(frame.duration_seconds) * 1000 - this.config.frameDeliveryLeadSeconds * 1000;
    this.#schedule({
      sessionId: session.id,
      sessionVersion: session.session_version,
      delayMs: Math.max(0, dueAt - this.clock.Date.now()),
      type: "lead_time",
    });
  }

  scheduleRetry({ sessionId, sessionVersion }) {
    this.#schedule({
      sessionId,
      sessionVersion,
      delayMs: this.config.framePollRetrySeconds * 1000,
      type: "retry",
    });
  }

  cancel(sessionId) {
    this.generations.set(sessionId, (this.generations.get(sessionId) || 0) + 1);
    const existing = this.schedules.get(sessionId);
    if (!existing) return false;
    this.clock.clearTimeout(existing.timer);
    this.schedules.delete(sessionId);
    this.logger.info("frame_schedule_cancelled", { sessionId, sessionVersion: existing.sessionVersion });
    return true;
  }

  hasSchedule(sessionId) {
    return this.schedules.has(sessionId);
  }

  #schedule({ sessionId, sessionVersion, delayMs, type }) {
    this.cancel(sessionId);
    const generation = this.generations.get(sessionId);
    const token = Symbol(`${sessionId}:${sessionVersion}`);
    const timer = this.clock.setTimeout(async () => {
      const scheduled = this.schedules.get(sessionId);
      if (!scheduled || scheduled.token !== token) return;
      this.schedules.delete(sessionId);

      try {
        const result = await this.onPrepare({ sessionId, sessionVersion });
        // A stop or channel change may have occurred while the producer was
        // awaited. Never recreate a timer after that invalidation.
        if (this.generations.get(sessionId) !== generation || result?.stale) return;
        this.logger.info("frame_prepare_requested", { sessionId, sessionVersion, type, prepared: Boolean(result?.frame) });
        if (!result?.frame && !this.schedules.has(sessionId)) {
          this.scheduleRetry({ sessionId, sessionVersion });
        }
      } catch (error) {
        this.logger.error("frame_prepare_failed", { sessionId, sessionVersion, type, message: error.message });
        if (!this.schedules.has(sessionId)) {
          this.scheduleRetry({ sessionId, sessionVersion });
        }
      }
    }, delayMs);

    this.schedules.set(sessionId, { timer, token, sessionVersion, type });
    this.logger.info("frame_schedule_created", { sessionId, sessionVersion, type, delayMs: Math.round(delayMs) });
  }
}

module.exports = FrameScheduler;
