// Objective: Persist and atomically claim per-session audio-frame delivery state through Supabase.
const { getSupabase } = require("../db");
const { FrameState } = require("../radio/RadioState");

function throwIfError(error, operation) {
  if (error) {
    error.message = `${operation}: ${error.message}`;
    throw error;
  }
}

class FrameRepository {
  constructor({ db = getSupabase } = {}) {
    this.db = db;
  }

  async claim({ sessionId, sessionVersion, deliver, deliveryKey = null, maxPendingDeliveryOperations = 1 }) {
    const { data, error } = await this.db().rpc("claim_radio_frame", {
      p_session_id: sessionId,
      p_expected_version: sessionVersion,
      p_deliver: deliver,
      p_delivery_key: deliveryKey,
      p_max_pending: maxPendingDeliveryOperations,
    });
    throwIfError(error, "Claiming radio frame failed");
    return data?.[0] || null;
  }

  async getFrame(frameId) {
    const { data, error } = await this.db()
      .from("frames")
      .select("id, external_id, audio_path, duration_seconds, transcript, metadata, next_frame_id, status")
      .eq("id", frameId)
      .maybeSingle();
    throwIfError(error, "Reading audio frame failed");
    return data;
  }

  async getCurrentUndone({ sessionId, sessionVersion }) {
    const { data, error } = await this.db()
      .from("radio_session_frames")
      .select("frame_id, sequence_number, status, session_version")
      .eq("session_id", sessionId)
      .eq("session_version", sessionVersion)
      // READY means a scheduler reservation only. It must go through the
      // atomic claim function before a URL is sent to a client.
      .in("status", [FrameState.DELIVERED, FrameState.PLAYING])
      .order("sequence_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    throwIfError(error, "Reading current radio frame failed");
    if (!data) return null;

    const frame = await this.getFrame(data.frame_id);
    return frame ? { ...frame, sequence_number: data.sequence_number, delivery_status: data.status } : null;
  }

  async getForScheduling({ sessionId, sessionVersion, frameId }) {
    const { data, error } = await this.db()
      .from("radio_session_frames")
      .select("frame_id, sequence_number, status, playback_started_at")
      .eq("session_id", sessionId)
      .eq("session_version", sessionVersion)
      .eq("frame_id", frameId)
      .maybeSingle();
    throwIfError(error, "Reading scheduled radio frame failed");
    if (!data) return null;
    const frame = await this.getFrame(data.frame_id);
    return frame ? { ...frame, ...data } : null;
  }

  async markStarted({ sessionId, sessionVersion, frameId, startedAt }) {
    const { data, error } = await this.db()
      .from("radio_session_frames")
      .update({ status: FrameState.PLAYING, playback_started_at: startedAt })
      .eq("session_id", sessionId)
      .eq("session_version", sessionVersion)
      .eq("frame_id", frameId)
      .in("status", [FrameState.DELIVERED, FrameState.PLAYING])
      .select("frame_id, sequence_number, status, playback_started_at")
      .maybeSingle();
    throwIfError(error, "Recording frame start failed");
    if (data) {
      const { error: sessionError } = await this.db()
        .from("radio_sessions")
        .update({ playback_started_at: startedAt, updated_at: new Date().toISOString() })
        .eq("id", sessionId)
        .eq("session_version", sessionVersion)
        .eq("status", "ACTIVE");
      throwIfError(sessionError, "Updating playback reference failed");
    }
    return data;
  }

  async markPlayed({ sessionId, sessionVersion, frameId, playedAt }) {
    const { data, error } = await this.db()
      .from("radio_session_frames")
      .update({ status: FrameState.PLAYED, playback_completed_at: playedAt })
      .eq("session_id", sessionId)
      .eq("session_version", sessionVersion)
      .eq("frame_id", frameId)
      .in("status", [FrameState.DELIVERED, FrameState.PLAYING, FrameState.PLAYED])
      .select("frame_id, sequence_number, status, playback_completed_at")
      .maybeSingle();
    throwIfError(error, "Recording frame completion failed");
    return data;
  }
}

module.exports = FrameRepository;
