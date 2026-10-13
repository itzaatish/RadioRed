// Objective: Persist session lifecycle, heartbeat, activation, and inactive-state transitions through Supabase.
const { getSupabase } = require("../db");
const { FrameState, SessionState } = require("../radio/RadioState");
const { NotFoundError } = require("../radio/errors");

function throwIfError(error, operation) {
  if (error) {
    error.message = `${operation}: ${error.message}`;
    throw error;
  }
}

class SessionRepository {
  constructor({ db = getSupabase } = {}) {
    this.db = db;
  }

  async create({ tone }) {
    const { data, error } = await this.db()
      .from("radio_sessions")
      .insert({ tone, status: SessionState.ACTIVE, last_seen: new Date().toISOString() })
      .select()
      .single();
    throwIfError(error, "Creating radio session failed");
    return data;
  }

  async get(sessionId, { required = true } = {}) {
    const { data, error } = await this.db()
      .from("radio_sessions")
      .select("*")
      .eq("id", sessionId)
      .maybeSingle();
    throwIfError(error, "Reading radio session failed");
    if (!data && required) {
      throw new NotFoundError("Radio session was not found.");
    }
    return data;
  }

  async findActive() {
    const { data, error } = await this.db()
      .from("radio_sessions")
      .select("*")
      .eq("status", SessionState.ACTIVE)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    throwIfError(error, "Reading active radio session failed");
    return data;
  }

  async listActive() {
    const { data, error } = await this.db()
      .from("radio_sessions")
      .select("*")
      .eq("status", SessionState.ACTIVE);
    throwIfError(error, "Reading active radio sessions failed");
    return data || [];
  }

  async activate({ sessionId, tone }) {
    const { data, error } = await this.db()
      .rpc("activate_radio_session", { p_session_id: sessionId, p_tone: tone })
      .single();
    throwIfError(error, "Activating radio session failed");
    if (!data) {
      throw new NotFoundError("Radio session was not found.");
    }
    return data;
  }

  async deactivate({ sessionId, status, reason }) {
    const before = await this.get(sessionId);
    const { data, error } = await this.db()
      .rpc("stop_radio_session", {
        p_session_id: sessionId,
        p_status: status,
        p_reason: reason,
      })
      .maybeSingle();
    throwIfError(error, "Stopping radio session failed");
    if (!data) {
      throw new NotFoundError("Radio session was not found.");
    }
    return { session: data, transitioned: before.status !== data.status && data.status === status };
  }

  async heartbeat(sessionId) {
    const timestamp = new Date().toISOString();
    const { data, error } = await this.db()
      .from("radio_sessions")
      .update({ last_seen: timestamp })
      .eq("id", sessionId)
      .eq("status", SessionState.ACTIVE)
      .select()
      .maybeSingle();
    throwIfError(error, "Updating radio heartbeat failed");

    if (data) {
      return { session: data, accepted: true };
    }

    return { session: await this.get(sessionId), accepted: false };
  }

  async findExpiredActive(cutoffIso) {
    const { data, error } = await this.db()
      .from("radio_sessions")
      .select("*")
      .eq("status", SessionState.ACTIVE)
      .lt("last_seen", cutoffIso);
    throwIfError(error, "Finding expired radio sessions failed");
    return data || [];
  }

  async latestPlayingFrame(sessionId, sessionVersion) {
    const { data, error } = await this.db()
      .from("radio_session_frames")
      .select("*")
      .eq("session_id", sessionId)
      .eq("session_version", sessionVersion)
      .eq("status", FrameState.PLAYING)
      .order("sequence_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    throwIfError(error, "Reading current playback frame failed");
    return data;
  }
}

module.exports = SessionRepository;
