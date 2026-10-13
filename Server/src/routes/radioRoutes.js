// Objective: Map the public radio API paths to their thin HTTP controller handlers.
const express = require("express");

function createRadioRoutes(controller) {
  const router = express.Router();
  router.post("/start", controller.start);
  router.post("/pause", controller.pause);
  router.post("/stop", controller.stop);
  router.post("/heartbeat", controller.heartbeat);
  router.get("/next", controller.next);
  router.post("/frame/:frameId/started", controller.started);
  router.post("/frame/:frameId/played", controller.played);
  return router;
}

module.exports = { createRadioRoutes };
