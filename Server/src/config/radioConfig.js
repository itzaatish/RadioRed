// Objective: Parse and validate the radio engine's scheduling, heartbeat, and URL configuration.
function readInteger(name, defaultValue, { min, max }) {
  const rawValue = process.env[name];
  const value = rawValue === undefined || rawValue === "" ? defaultValue : Number(rawValue);

  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }

  return value;
}

function readRadioConfig() {
  const config = {
    frameDeliveryLeadSeconds: readInteger("FRAME_DELIVERY_LEAD_SECONDS", 10, { min: 0, max: 3600 }),
    heartbeatIntervalSeconds: readInteger("HEARTBEAT_INTERVAL_SECONDS", 20, { min: 5, max: 3600 }),
    heartbeatTimeoutSeconds: readInteger("SESSION_HEARTBEAT_TIMEOUT_SECONDS", 90, { min: 10, max: 86400 }),
    heartbeatSweepSeconds: readInteger("SESSION_HEARTBEAT_SWEEP_SECONDS", 15, { min: 5, max: 3600 }),
    framePollRetrySeconds: readInteger("FRAME_POLL_RETRY_SECONDS", 5, { min: 1, max: 3600 }),
    signedUrlExpirationSeconds: readInteger("SIGNED_URL_EXPIRATION_SECONDS", 3600, { min: 60, max: 604800 }),
    maxPendingDeliveryOperations: readInteger("MAX_PENDING_DELIVERY_OPERATIONS_PER_SESSION", 1, { min: 1, max: 10 }),
    audioBucket: process.env.RADIO_AUDIO_BUCKET || "radio-audio",
  };

  if (config.heartbeatTimeoutSeconds <= config.heartbeatIntervalSeconds) {
    throw new Error("SESSION_HEARTBEAT_TIMEOUT_SECONDS must exceed HEARTBEAT_INTERVAL_SECONDS.");
  }

  if (config.heartbeatSweepSeconds > config.heartbeatTimeoutSeconds) {
    throw new Error("SESSION_HEARTBEAT_SWEEP_SECONDS cannot exceed SESSION_HEARTBEAT_TIMEOUT_SECONDS.");
  }

  return Object.freeze(config);
}

module.exports = { readRadioConfig };
