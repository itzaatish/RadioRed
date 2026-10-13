// Objective: Verify radio engine lifecycle, scheduling, concurrency, and recovery behavior with isolated fakes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const StartEngine = require("../src/engines/StartEngine");
const StopEngine = require("../src/engines/StopEngine");
const PlayEngine = require("../src/engines/PlayEngine");
const FrameScheduler = require("../src/radio/FrameScheduler");
const SessionLifecycleMonitor = require("../src/radio/SessionLifecycleMonitor");
const { SessionState } = require("../src/radio/RadioState");

const logger = { info() {}, warn() {}, error() {} };
const config = {
  frameDeliveryLeadSeconds: 8,
  framePollRetrySeconds: 3,
  heartbeatTimeoutSeconds: 90,
  heartbeatSweepSeconds: 15,
};

function session(overrides = {}) {
  return {
    id: "b014baa9-d096-4e2a-8d34-7f139ba9aa4c",
    tone: 1,
    status: SessionState.ACTIVE,
    session_version: 1,
    last_seen: new Date().toISOString(),
    ...overrides,
  };
}

function frame(overrides = {}) {
  return {
    frame_id: "11",
    id: "11",
    external_id: "frame-11",
    audio_path: "frames/11.mp3",
    duration_seconds: 30,
    transcript: "hello",
    metadata: {},
    sequence_number: 1,
    delivery_status: "DELIVERED",
    ...overrides,
  };
}

function makePlayEngine({ current = null, claimed = frame(), sessionValue = session(), claimError } = {}) {
  const calls = { ensure: 0, claim: 0 };
  const frameRepository = {
    getCurrentUndone: async () => current,
    claim: async () => {
      calls.claim += 1;
      if (claimError) throw claimError;
      return claimed;
    },
    getFrame: async () => frame(),
    markStarted: async () => ({ frame_id: "11", sequence_number: 1, status: "PLAYING" }),
    markPlayed: async () => ({ frame_id: "11", sequence_number: 1, status: "PLAYED" }),
  };
  const scheduler = { scheduleForPlayback() {} };
  const engine = new PlayEngine({
    sessionRepository: { get: async () => sessionValue },
    frameRepository,
    audioUrlService: { createUrl: async () => ({ url: "https://signed.example/11", expiresInSeconds: 3600 }) },
    producer: { ensureFrame: async () => { calls.ensure += 1; }, stopSession: async () => {} },
    scheduler,
    logger,
  });
  return { engine, calls, frameRepository, scheduler };
}

test("StartEngine persists the requested tone and returns the first signed frame", async () => {
  const created = [];
  const active = session();
  const { engine: playEngine, calls } = makePlayEngine({ sessionValue: active });
  const startEngine = new StartEngine({
    sessionRepository: {
      get: async () => null,
      findActive: async () => null,
      create: async ({ tone }) => {
        created.push(tone);
        return { ...active, tone };
      },
      activate: async () => active,
    },
    playEngine,
    stopEngine: { execute: async () => assert.fail("a fresh start should not stop a session") },
    producer: {},
    logger,
  });

  const result = await startEngine.execute({ tone: 7, requestId: "start-1" });
  assert.deepEqual(created, [7]);
  assert.equal(result.session.tone, 7);
  assert.equal(result.frame.audioUrl, "https://signed.example/11");
  assert.equal(calls.claim, 1);
});

test("PlayEngine returns an explicit waiting state when no generated frame is ready", async () => {
  const { engine } = makePlayEngine({ claimed: null });
  const result = await engine.execute({ sessionId: session().id });
  assert.deepEqual(result, { waiting: true, frame: null });
});

test("a repeated start for an active tone reuses its session and current frame", async () => {
  const active = session();
  const current = frame({ delivery_status: "PLAYING" });
  const { engine: playEngine, calls } = makePlayEngine({ current, sessionValue: active });
  let creates = 0;
  const startEngine = new StartEngine({
    sessionRepository: {
      findActive: async () => active,
      create: async () => { creates += 1; return active; },
      get: async () => null,
      activate: async () => active,
    },
    playEngine,
    stopEngine: { execute: async () => assert.fail("same tone must not be stopped") },
    producer: {},
    logger,
  });

  const result = await startEngine.execute({ tone: 1 });
  assert.equal(result.session.id, active.id);
  assert.equal(creates, 0);
  assert.equal(calls.claim, 0);
});

test("changing tone stops the old schedule before activating a fresh session version", async () => {
  const old = session({ tone: 1, session_version: 1 });
  const activated = session({ tone: 9, session_version: 3 });
  const events = [];
  const { engine: playEngine } = makePlayEngine({ sessionValue: activated });
  const startEngine = new StartEngine({
    sessionRepository: {
      get: async () => old,
      findActive: async () => old,
      create: async () => assert.fail("an existing session should be activated"),
      activate: async (input) => { events.push({ type: "activate", ...input }); return activated; },
    },
    playEngine,
    stopEngine: { execute: async (input) => events.push({ type: "stop", ...input }) },
    producer: {},
    logger,
  });

  const result = await startEngine.execute({ tone: 9, sessionId: old.id });
  assert.equal(result.session.session_version, 3);
  assert.deepEqual(events, [
    { type: "stop", sessionId: old.id, reason: "channel_changed", status: SessionState.STOPPED },
    { type: "activate", sessionId: old.id, tone: 9 },
  ]);
});

test("scheduler calculates lead time from playback start, not request completion", () => {
  const timers = [];
  const clock = {
    now: 100000,
    Date: { now: () => clock.now },
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimeout() {},
  };
  const scheduler = new FrameScheduler({ config, logger, onPrepare: async () => ({ frame: frame() }), clock });
  scheduler.scheduleForPlayback({
    session: session(),
    frame: frame({ duration_seconds: 30 }),
    playbackStartedAt: new Date(100000).toISOString(),
  });
  assert.equal(timers[0].delay, 22000);
});

test("a cancelled in-flight scheduler callback cannot recreate a retry timer", async () => {
  const timers = [];
  const clock = {
    Date,
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimeout() {},
  };
  let resolvePreparation;
  const scheduler = new FrameScheduler({
    config,
    logger,
    clock,
    onPrepare: () => new Promise((resolve) => { resolvePreparation = resolve; }),
  });
  const sessionId = session().id;
  scheduler.scheduleRetry({ sessionId, sessionVersion: 1 });
  const running = timers[0].callback();
  scheduler.cancel(sessionId);
  resolvePreparation({ frame: null, stale: false });
  await running;
  assert.equal(scheduler.hasSchedule(sessionId), false);
  assert.equal(timers.length, 1);
});

test("StopEngine cancels schedules and is idempotent", async () => {
  let cancels = 0;
  let producerStops = 0;
  let call = 0;
  const stopEngine = new StopEngine({
    scheduler: { cancel: () => { cancels += 1; } },
    producer: { stopSession: async () => { producerStops += 1; } },
    logger,
    sessionRepository: {
      deactivate: async () => {
        call += 1;
        return { session: session({ status: SessionState.STOPPED, session_version: 2 }), transitioned: call === 1 };
      },
    },
  });

  const first = await stopEngine.execute({ sessionId: session().id });
  const second = await stopEngine.execute({ sessionId: session().id });
  assert.equal(first.alreadyInactive, false);
  assert.equal(second.alreadyInactive, true);
  assert.equal(cancels, 2);
  assert.equal(producerStops, 1);
});

test("a stale version cannot reserve frames after a channel change", async () => {
  const current = session({ tone: 2, session_version: 2 });
  const { engine, calls } = makePlayEngine({ sessionValue: current });
  const result = await engine.prepareNext({ sessionId: current.id, sessionVersion: 1 });
  assert.deepEqual(result, { frame: null, stale: true });
  assert.equal(calls.claim, 0);
});

test("producer failures do not hide an already-ready frame", async () => {
  const { engine } = makePlayEngine();
  engine.producer.ensureFrame = async () => { throw new Error("producer down"); };
  const result = await engine.execute({ sessionId: session().id });
  assert.equal(result.waiting, false);
  assert.equal(result.frame.id, "11");
});

test("database failures are surfaced instead of pretending playback started", async () => {
  const { engine } = makePlayEngine({ claimError: new Error("database unavailable") });
  await assert.rejects(() => engine.execute({ sessionId: session().id }), /database unavailable/);
});

test("heartbeat reconciliation expires stale sessions and cancels their orchestration", async () => {
  const stale = session({ id: "0d4ee347-7cf0-48d5-bd9e-83765aa71163", last_seen: new Date(1000).toISOString() });
  const stopped = [];
  const clock = { Date: { now: () => 100000 }, setTimeout: () => 1, clearTimeout() {} };
  const monitor = new SessionLifecycleMonitor({
    sessionRepository: { listActive: async () => [stale] },
    frameRepository: { getFrame: async () => null },
    stopEngine: { execute: async (input) => stopped.push(input) },
    scheduler: { scheduleForPlayback() {} },
    config,
    logger,
    clock,
  });

  await monitor.reconcile();
  assert.deepEqual(stopped, [{ sessionId: stale.id, reason: "heartbeat_expired", status: SessionState.EXPIRED }]);
});

test("startup reconciliation restores a schedule for a persisted playing frame", async () => {
  const active = session({ last_seen: new Date().toISOString() });
  const schedules = [];
  const monitor = new SessionLifecycleMonitor({
    sessionRepository: {
      listActive: async () => [active],
      latestPlayingFrame: async () => ({ frame_id: "11", playback_started_at: new Date().toISOString() }),
    },
    frameRepository: { getFrame: async () => frame() },
    stopEngine: { execute: async () => assert.fail("fresh session should not expire") },
    scheduler: { scheduleForPlayback: (input) => schedules.push(input) },
    config,
    logger,
  });

  await monitor.reconcile({ restoreSchedules: true });
  assert.equal(schedules.length, 1);
  assert.equal(schedules[0].session.id, active.id);
});

test("the migration uses a session row lock and stable per-session frame uniqueness", () => {
  const migration = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20261010100000_create_radio_engine_tables.sql"), "utf8");
  assert.match(migration, /for update;/i);
  assert.match(migration, /unique \("session_id", "sequence_number"\)/i);
  assert.match(migration, /unique \("session_id", "frame_id"\)/i);
});
