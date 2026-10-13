// Objective: Define the persisted session and delivery state names used consistently across the radio layer.
const SessionState = Object.freeze({
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  STOPPED: "STOPPED",
  EXPIRED: "EXPIRED",
});

const FrameState = Object.freeze({
  GENERATING: "GENERATING",
  READY: "READY",
  DELIVERED: "DELIVERED",
  PLAYING: "PLAYING",
  PLAYED: "PLAYED",
  FAILED: "FAILED",
});

module.exports = { SessionState, FrameState };
