// Objective: Create and cache server-only Supabase clients scoped to validated database schemas.
const { createClient } = require("@supabase/supabase-js");

const { requiredEnv } = require("../config/env");

const clients = new Map();

function assertSchemaName(schema) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error(`Invalid database schema: ${schema}`);
  }
}

/**
 * Returns one cached, server-only Supabase client per database schema.
 * Do not import this module into browser/client code: the secret key bypasses RLS.
 */
function getSupabase(schema = "public") {
  assertSchemaName(schema);
  if (!clients.has(schema)) {
    const url = requiredEnv("SUPABASE_URL");
    const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secretKey) {
      throw new Error("Missing SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY).");
    }

    clients.set(
      schema,
      createClient(url, secretKey, {
        db: { schema },
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      }),
    );
  }
  return clients.get(schema);
}

module.exports = { getSupabase };
