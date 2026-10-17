// Objective: Compose repositories, engines, scheduler, producer boundary, and lifecycle monitor via dependency injection.
const { getSupabase } = require("../db");
const { readRadioConfig } = require("../config/radioConfig");
const { createRadioLogger } = require("./logger");
const SessionRepository = require("../repositories/SessionRepository");
const FrameRepository = require("../repositories/FrameRepository");
const AudioUrlService = require("../services/AudioUrlService");
const ProducerAdapter = require("../producer/ProducerAdapter");
const FrameScheduler = require("./FrameScheduler");
const SessionLifecycleMonitor = require("./SessionLifecycleMonitor");
const PlayEngine = require("../engines/PlayEngine");
const StopEngine = require("../engines/StopEngine");
const StartEngine = require("../engines/StartEngine");
const BroadcastRepository = require("../repositories/BroadcastRepository");
const { BroadcastContextManager } = require("../services/BroadcastContextManager");

function createRadioApplication({ config = readRadioConfig(), logger = createRadioLogger(), db = getSupabase, producer = new ProducerAdapter() } = {}) {
  const sessionRepository = new SessionRepository({ db });
  const frameRepository = new FrameRepository({ db });              
  const broadcastRepository = new BroadcastRepository({ db });
  const broadcastContextManager = new BroadcastContextManager({ repository: broadcastRepository });
  const audioUrlService = new AudioUrlService({ db, config });      // This just make audio url at time of need
  let playEngine;
  const scheduler = new FrameScheduler({
    config,
    logger,
    onPrepare: (input) => playEngine.prepareNext(input),
  });
  playEngine = new PlayEngine({ sessionRepository, frameRepository, audioUrlService, producer, scheduler, logger, config });
  const stopEngine = new StopEngine({ sessionRepository, scheduler, producer, logger });
  const startEngine = new StartEngine({ sessionRepository, playEngine, stopEngine, logger });
  const lifecycleMonitor = new SessionLifecycleMonitor({
    sessionRepository,
    frameRepository,
    stopEngine,
    scheduler,
    config,
    logger,
  });

  return {
    config,
    logger,
    sessionRepository,
    frameRepository,
    broadcastRepository,
    broadcastContextManager,
    audioUrlService,
    producer,
    scheduler,
    lifecycleMonitor,
    startEngine,
    stopEngine,
    playEngine,
  };
}

module.exports = { createRadioApplication };
