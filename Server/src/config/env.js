const path = require("node:path");

const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Copy Server/.env.example to Server/.env and set it.`);
  }
  return value;
}

module.exports = { requiredEnv };
