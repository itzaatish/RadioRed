// Objective: Import approved data files into a Supabase table in bounded batches.
const fs = require("node:fs");
const path = require("node:path");

const { parse } = require("csv-parse/sync");
const { getSupabase } = require("../src/db");

const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function requireIdentifier(value, label) {
  if (!IDENTIFIER.test(value || "")) throw new Error(`Invalid ${label}: ${value}`);
  return value;
}

function readRows(filePath) {
  const content = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".csv") return parse(content, { columns: true, skip_empty_lines: true, trim: true });
  if (extension === ".json") {
    const rows = JSON.parse(content);
    if (!Array.isArray(rows)) throw new Error("JSON input must be an array of row objects.");
    return rows;
  }
  if (extension === ".jsonl" || extension === ".ndjson") {
    return content.split(/\r?\n/).filter(Boolean).map((line, index) => {
      try { return JSON.parse(line); } catch { throw new Error(`Invalid JSON on line ${index + 1}`); }
    });
  }
  throw new Error("Supported input formats: .csv, .json, .jsonl, .ndjson");
}

function chunk(rows, size) {
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, index) => rows.slice(index * size, (index + 1) * size));
}

async function main() {
  const table = requireIdentifier(argument("table"), "table");
  const schema = requireIdentifier(argument("schema", "public"), "schema");
  const file = argument("file");
  if (!file) throw new Error("Usage: npm run db:bulk-upload -- --table episodes --file data.csv [--mode upsert --on-conflict external_id]");
  const mode = argument("mode", "insert");
  const onConflict = argument("on-conflict");
  const batchSize = Number(argument("batch-size", "500"));
  if (!["insert", "upsert"].includes(mode)) throw new Error("mode must be insert or upsert");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error("batch-size must be an integer from 1 to 1000");
  if (mode === "upsert" && !onConflict) throw new Error("--on-conflict is required with --mode upsert");

  const rows = readRows(path.resolve(process.cwd(), file));
  if (rows.length === 0) throw new Error("Input contains no rows.");
  if (!rows.every((row) => row && typeof row === "object" && !Array.isArray(row))) throw new Error("Every row must be an object.");

  const db = getSupabase(schema);
  let uploaded = 0;
  for (const [index, batch] of chunk(rows, batchSize).entries()) {
    const result = mode === "upsert"
      ? await db.from(table).upsert(batch, { onConflict })
      : await db.from(table).insert(batch);
    if (result.error) throw new Error(`Batch ${index + 1} (rows ${uploaded + 1}-${uploaded + batch.length}) failed: ${result.error.message}`);
    uploaded += batch.length;
    console.log(`Uploaded ${uploaded}/${rows.length}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
