// Objective: Assemble Express middleware, radio routes, and consistent API error handling.
const express = require("express");
const cors = require("cors");
const { createRadioApplication } = require("./radio/createRadioApplication");
const { createRadioController, radioErrorHandler } = require("./controllers/radioController");
const { createRadioRoutes } = require("./routes/radioRoutes");

function createApp({ radioApplication = createRadioApplication() } = {}) {
  const app = express();
  app.use(cors({
    origin: process.env.CORS_ORIGIN || true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: false,
  }));
  app.use(express.json({ limit: "64kb" }));

  app.get("/", (req, res) => {
    res.send("Aatish FM radio service");
  });

  const controller = createRadioController({
    startEngine: radioApplication.startEngine,
    stopEngine: radioApplication.stopEngine,
    playEngine: radioApplication.playEngine,
    sessionRepository: radioApplication.sessionRepository,
    frameRepository: radioApplication.frameRepository,
    scheduler: radioApplication.scheduler,
  });
  app.use("/api/radio", createRadioRoutes(controller));
  app.use(radioErrorHandler);

  return app;
}

module.exports = { createApp };
