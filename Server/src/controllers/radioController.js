// Objective: Translate radio HTTP requests into validated engine calls and safe JSON responses.
const { ValidationError, RadioError } = require("../radio/errors");
const { SessionState } = require("../radio/RadioState");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireSessionId(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ValidationError("sessionId must be a UUID.");
  }
  return value;
}

function requireFrameId(value) {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || !Number.isSafeInteger(Number(value))) {
    throw new ValidationError("frameId must be a positive integer.");
  }
  return String(value);
}

function requireSessionVersion(value) {
  if (!Number.isSafeInteger(Number(value)) || Number(value) < 1) {
    throw new ValidationError("sessionVersion must be a positive integer.");
  }
  return Number(value);
}

function parseTone(value) {
  if (typeof value === "string" && value.trim() === "") {
    throw new ValidationError("tone is required and must be an integer.");
  }
  const tone = Number(value);
  if (!Number.isSafeInteger(tone) || tone < 0 || tone > 1000000) {
    throw new ValidationError("tone must be an integer between 0 and 1000000.");
  }
  return tone;
}

function optionalRequestId(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ValidationError("requestId must contain only letters, numbers, underscores, or hyphens.");
  }
  return value;
}

function optionalPlaybackTime(value) {
  if (value === undefined) return new Date().toISOString();
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) throw new ValidationError("playedAt must be an ISO-8601 timestamp.");
  return time.toISOString();
}

function presentSession(session) {
  return {
    id: session.id,
    tone: session.tone,
    status: session.status,
    version: session.session_version,
    lastSeen: session.last_seen,
  };
}

function createRadioController({ startEngine, stopEngine, playEngine, sessionRepository, frameRepository, scheduler }) {
  return {
    start: async (req, res, next) => {
      try {
        const result = await startEngine.execute({
          tone: parseTone(req.body?.tone),
          sessionId: req.body?.sessionId === undefined ? undefined : requireSessionId(req.body.sessionId),
          requestId: optionalRequestId(req.body?.requestId),
        });
        res.status(200).json({ ok: true, session: presentSession(result.session), waiting: result.waiting, frame: result.frame || null });
      } catch (error) {
        next(error);
      }
    },

    pause: async (req, res, next) => {
      try {
        const result = await stopEngine.execute({
          sessionId: requireSessionId(req.body?.sessionId),
          reason: "paused_by_listener",
          status: SessionState.PAUSED,
        });
        res.status(200).json({ ok: true, session: presentSession(result.session), alreadyInactive: result.alreadyInactive });
      } catch (error) {
        next(error);
      }
    },

    stop: async (req, res, next) => {
      try {
        const result = await stopEngine.execute({
          sessionId: requireSessionId(req.body?.sessionId),
          reason: "stopped_by_listener",
          status: SessionState.STOPPED,
        });
        res.status(200).json({ ok: true, session: presentSession(result.session), alreadyInactive: result.alreadyInactive });
      } catch (error) {
        next(error);
      }
    },

    heartbeat: async (req, res, next) => {
      try {
        const { session, accepted } = await sessionRepository.heartbeat(requireSessionId(req.body?.sessionId));
        if (!accepted) {
          res.status(409).json({ ok: false, error: { code: "SESSION_INACTIVE", message: "Radio session is not active." }, session: presentSession(session) });
          return;
        }

        const current = await sessionRepository.latestPlayingFrame(session.id, session.session_version);
        if (current?.playback_started_at) {
          const frame = await frameRepository.getFrame(current.frame_id);
          if (frame) scheduler.scheduleForPlayback({ session, frame, playbackStartedAt: current.playback_started_at });
        }
        res.status(200).json({ ok: true, session: presentSession(session) });
      } catch (error) {
        next(error);
      }
    },

    next: async (req, res, next) => {
      try {
        const result = await playEngine.execute({
          sessionId: requireSessionId(req.query.sessionId),
          requestId: optionalRequestId(req.query.requestId),
        });
        res.status(200).json({ ok: true, waiting: result.waiting, frame: result.frame || null, sessionVersion: result.sessionVersion || null });
      } catch (error) {
        next(error);
      }
    },

    started: async (req, res, next) => {
      try {
        const frame = await playEngine.recordStarted({
          sessionId: requireSessionId(req.body?.sessionId),
          sessionVersion: requireSessionVersion(req.body?.sessionVersion),
          frameId: requireFrameId(req.params.frameId),
          startedAt: optionalPlaybackTime(req.body?.playedAt),
        });
        res.status(200).json({ ok: true, frame: { id: String(frame.frame_id), sequenceNumber: frame.sequence_number, status: frame.status } });
      } catch (error) {
        next(error);
      }
    },

    played: async (req, res, next) => {
      try {
        const frame = await playEngine.recordPlayed({
          sessionId: requireSessionId(req.body?.sessionId),
          sessionVersion: requireSessionVersion(req.body?.sessionVersion),
          frameId: requireFrameId(req.params.frameId),
          playedAt: optionalPlaybackTime(req.body?.playedAt),
        });
        res.status(200).json({ ok: true, frame: { id: String(frame.frame_id), sequenceNumber: frame.sequence_number, status: frame.status } });
      } catch (error) {
        next(error);
      }
    },
  };
}

function radioErrorHandler(error, req, res, next) { // eslint-disable-line no-unused-vars
  const status = error instanceof RadioError ? error.statusCode : 500;
  const code = error instanceof RadioError ? error.code : "INTERNAL_ERROR";
  if (status >= 500) {
    console.error("[radio] request_failed", { path: req.path, message: error.message });
  }
  res.status(status).json({ ok: false, error: { code, message: status >= 500 ? "Radio service is temporarily unavailable." : error.message } });
}

module.exports = { createRadioController, radioErrorHandler };
