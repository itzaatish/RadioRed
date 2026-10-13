// Objective: Start or switch a listener session while delegating delivery and generation demand to collaborators.
const IEngine = require("./IEngine");
const { AsyncKeyLock } = require("../radio/AsyncKeyLock");
const { SessionState } = require("../radio/RadioState");

class StartEngine extends IEngine {
  constructor({ sessionRepository, playEngine, stopEngine, logger, lock = new AsyncKeyLock() }) {
    super();
    this.sessionRepository = sessionRepository;
    this.playEngine = playEngine;
    this.stopEngine = stopEngine;
    this.logger = logger;
    this.lock = lock;
  }

  async execute({ tone, sessionId, requestId }) {
    // The database's one-active-session index protects multi-process use; this
    // lock additionally avoids needless stop/start churn in this Node process.
    return this.lock.run("private-listener", async () => {
      const requestedSession = sessionId ? await this.sessionRepository.get(sessionId) : null;
      const activeSession = await this.sessionRepository.findActive();
      let session;

      if (requestedSession?.status === SessionState.ACTIVE && requestedSession.tone === tone) {
        session = requestedSession;
      } else if (!requestedSession && activeSession?.tone === tone) {
        session = activeSession;
      } else {
        if (activeSession && activeSession.id !== requestedSession?.id) {
          await this.stopEngine.execute({
            sessionId: activeSession.id,
            reason: "channel_changed",
            status: SessionState.STOPPED,
          });
        }

        if (requestedSession?.status === SessionState.ACTIVE) {
          await this.stopEngine.execute({
            sessionId: requestedSession.id,
            reason: "channel_changed",
            status: SessionState.STOPPED,
          });
        }

        if (requestedSession) {
          session = await this.sessionRepository.activate({ sessionId: requestedSession.id, tone });
        } else {
          session = await this.sessionRepository.create({ tone });
        }
      }

      // PlayEngine is the single producer coordination point. That keeps a
      // repeated start request from signalling generation twice.
      const playback = await this.playEngine.getCurrentOrNext({ session, requestId });
      this.logger.info("session_started", {
        sessionId: session.id,
        sessionVersion: session.session_version,
        tone: session.tone,
        frameReady: Boolean(playback.frame),
      });

      return { session, ...playback };
    });
  }
}

module.exports = StartEngine;
