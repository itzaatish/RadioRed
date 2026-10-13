// Objective: Reserve, deliver, and acknowledge playable frames without implementing audio generation.
const IEngine = require("./IEngine");
const { SessionState } = require("../radio/RadioState");
const { ConflictError, NotFoundError } = require("../radio/errors");

class PlayEngine extends IEngine {
  constructor({ sessionRepository, frameRepository, audioUrlService, producer, scheduler, logger, config = {} }) {
    super();
    this.sessionRepository = sessionRepository;
    this.frameRepository = frameRepository;
    this.audioUrlService = audioUrlService;
    this.producer = producer;
    this.scheduler = scheduler;
    this.logger = logger;
    this.config = config;
  }

  async execute({ sessionId, requestId }) {
    const session = await this.sessionRepository.get(sessionId);
    if (session.status !== SessionState.ACTIVE) {
      throw new ConflictError("Radio session is not active.");
    }
    return this.deliverNext({ session, requestId });
  }

  async getCurrentOrNext({ session, requestId }) {
    const current = await this.frameRepository.getCurrentUndone({
      sessionId: session.id,
      sessionVersion: session.session_version,
    });
    if (current) return this.#asPlayable(current, session);
    return this.deliverNext({ session, requestId });
  }

  async prepareNext({ sessionId, sessionVersion }) {
    const session = await this.sessionRepository.get(sessionId, { required: false });
    if (!session || session.status !== SessionState.ACTIVE || session.session_version !== sessionVersion) {
      return { frame: null, stale: true };
    }

    await this.#askProducer(session);
    const frame = await this.frameRepository.claim({
      sessionId,
      sessionVersion,
      deliver: false,
      maxPendingDeliveryOperations: this.config.maxPendingDeliveryOperations || 1,
    });
    if (!frame) {
      const current = await this.sessionRepository.get(sessionId, { required: false });
      if (!current || current.status !== SessionState.ACTIVE || current.session_version !== sessionVersion) {
        return { frame: null, stale: true };
      }
    }
    return { frame, stale: false };
  }

  async deliverNext({ session, requestId }) {
    await this.#askProducer(session);
    const frame = await this.frameRepository.claim({
      sessionId: session.id,
      sessionVersion: session.session_version,
      deliver: true,
      deliveryKey: requestId || null,
    });

    if (!frame) {
      this.logger.info("frame_not_ready", { sessionId: session.id, sessionVersion: session.session_version });
      return { waiting: true, frame: null };
    }

    const playable = await this.#asPlayable(frame, session);
    this.logger.info("frame_delivered", {
      sessionId: session.id,
      sessionVersion: session.session_version,
      frameId: playable.frame.id,
      sequenceNumber: playable.frame.sequenceNumber,
    });
    return playable;
  }

  async recordStarted({ sessionId, sessionVersion, frameId, startedAt }) {
    const updated = await this.frameRepository.markStarted({ sessionId, sessionVersion, frameId, startedAt });
    if (!updated) {
      throw new ConflictError("Frame cannot be marked as playing for this session version.");
    }

    const session = await this.sessionRepository.get(sessionId);
    if (session.status === SessionState.ACTIVE && session.session_version === sessionVersion) {
      const frame = await this.frameRepository.getFrame(frameId);
      if (!frame) throw new NotFoundError("Audio frame was not found.");
      this.scheduler.scheduleForPlayback({ session, frame, playbackStartedAt: startedAt });
    }

    this.logger.info("frame_playback_started", { sessionId, sessionVersion, frameId });
    return updated;
  }

  async recordPlayed({ sessionId, sessionVersion, frameId, playedAt }) {
    const updated = await this.frameRepository.markPlayed({ sessionId, sessionVersion, frameId, playedAt });
    if (!updated) {
      throw new ConflictError("Frame cannot be marked as played for this session version.");
    }
    this.logger.info("frame_playback_completed", { sessionId, sessionVersion, frameId });
    return updated;
  }

  async #askProducer(session) {
    try {
      return await this.producer.ensureFrame({
        sessionId: session.id,
        sessionVersion: session.session_version,
        tone: session.tone,
      });
    } catch (error) {
      // Existing ready frames remain usable even if the producer is temporarily down.
      this.logger.warn("producer_frame_request_failed", { sessionId: session.id, message: error.message });
      return { requested: false, available: false, error };
    }
  }

  async #asPlayable(frame, session) {
    const signed = await this.audioUrlService.createUrl(frame);
    return {
      waiting: false,
      frame: {
        id: String(frame.frame_id || frame.id),
        externalId: frame.external_id,
        sequenceNumber: frame.sequence_number,
        durationSeconds: frame.duration_seconds,
        transcript: frame.transcript,
        status: frame.delivery_status || frame.status,
        audioUrl: signed.url,
        urlExpiresInSeconds: signed.expiresInSeconds,
      },
      sessionVersion: session.session_version,
    };
  }
}

module.exports = PlayEngine;
