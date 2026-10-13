// Objective: Turn a persisted private-storage path into a short-lived playable audio URL.
const { DependencyError } = require("../radio/errors");

class AudioUrlService {
  constructor({ db, config }) {
    this.db = db;
    this.config = config;
  }

  async createUrl(frame) {
    const bucket = frame.metadata?.storage_bucket || this.config.audioBucket;
    const { data, error } = await this.db()
      .storage
      .from(bucket)
      .createSignedUrl(frame.audio_path, this.config.signedUrlExpirationSeconds);

    if (error || !data?.signedUrl) {
      throw new DependencyError("Unable to prepare the audio URL.", error);
    }

    return {
      url: data.signedUrl,
      expiresInSeconds: this.config.signedUrlExpirationSeconds,
    };
  }
}

module.exports = AudioUrlService;
