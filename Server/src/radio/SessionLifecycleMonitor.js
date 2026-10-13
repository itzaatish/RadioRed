// Objective: Reconcile persisted active sessions, recover schedules after restart, and expire missing heartbeats.
const { SessionState } = require("./RadioState");

class SessionLifecycleMonitor {
  constructor({ sessionRepository, frameRepository, stopEngine, scheduler, config, logger, clock = globalThis }) {
    this.sessionRepository = sessionRepository;
    this.frameRepository = frameRepository;
    this.stopEngine = stopEngine;
    this.scheduler = scheduler;
    this.config = config;
    this.logger = logger;
    this.clock = clock;
    this.timer = null;
    this.running = false;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    await this.reconcile({ restoreSchedules: true });
    this.#scheduleTick();
  }

  stop() {
    this.running = false;
    if (this.timer) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  async reconcile({ restoreSchedules = false } = {}) {
    const sessions = await this.sessionRepository.listActive();
    const cutoff = new Date(this.clock.Date.now() - this.config.heartbeatTimeoutSeconds * 1000).toISOString();

    for (const session of sessions) {
      if (session.last_seen < cutoff) {
        await this.stopEngine.execute({
          sessionId: session.id,
          reason: "heartbeat_expired",
          status: SessionState.EXPIRED,
        });
        continue;
      }

      if (!restoreSchedules) continue;
      const playing = await this.sessionRepository.latestPlayingFrame(session.id, session.session_version);
      if (!playing?.playback_started_at) continue;
      const frame = await this.frameRepository.getFrame(playing.frame_id);
      if (frame) {
        this.scheduler.scheduleForPlayback({
          session,
          frame,
          playbackStartedAt: playing.playback_started_at,
        });
      }
    }
  }

  #scheduleTick() {
    if (!this.running) return;
    this.timer = this.clock.setTimeout(async () => {
      try {
        await this.reconcile();
      } catch (error) {
        this.logger.error("heartbeat_reconciliation_failed", { message: error.message });
      } finally {
        this.#scheduleTick();
      }
    }, this.config.heartbeatSweepSeconds * 1000);
  }
}

module.exports = SessionLifecycleMonitor;
