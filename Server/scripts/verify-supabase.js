// Objective: Verify server-side Supabase connectivity and inspect a requested table safely.
const { getSupabase } = require("../src/db");

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

async function main() {
  const table = argument("table");
  if (!table) throw new Error("Usage: npm run db:verify -- --table your_table [--schema public]");
  const schema = argument("schema", "public");
  const { error } = await getSupabase(schema).from(table).select("*").limit(1);
  if (error) throw error;
  console.log(`Supabase connection and ${schema}.${table} access verified.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
