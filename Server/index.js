// Objective: Bootstrap the HTTP server and radio lifecycle monitor, then handle graceful shutdown.
require("dotenv").config();

const { createApp } = require("./src/app");
const { createRadioApplication } = require("./src/radio/createRadioApplication");

const port = Number(process.env.PORT) || 3000;
const radioApplication = createRadioApplication();
const app = createApp({ radioApplication });

if (require.main === module) {
  const server = app.listen(port, () => {
    console.log(`Aatish FM server is running on port ${port}`);
  });

  radioApplication.lifecycleMonitor.start().catch((error) => {
    console.error("[radio] lifecycle_monitor_start_failed", { message: error.message });
  });

  const shutdown = () => {
    radioApplication.lifecycleMonitor.stop();
    server.close(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

module.exports = { app, radioApplication };
