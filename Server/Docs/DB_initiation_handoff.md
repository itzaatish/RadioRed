# Server database toolkit

## One shared Supabase client

Copy `.env.example` to `.env` and add the project URL plus a **server-only** Supabase secret key. Do not put that key in frontend code or commit `.env`.

Every server module uses the same client factory:

```js
const { getSupabase } = require("./src/db");

const { data, error } = await getSupabase().from("episodes").select("*");
```

`getSupabase("public")` is the default. A custom schema must be explicitly exposed in the Supabase Data API before the client can query it.

## Create a table from a schema definition

1. Initialize Supabase locally once:

   ```powershell
   npm run supabase -- init
   ```

2. Copy and edit `database/table.schema.example.json`. The generator accepts lower_snake_case identifiers and safe Pos ketgreSQL types,ys, foreign keys, indexes, defaults, and RLS.

3. Generate the migration through the Supabase CLI:

   ```powershell
   npm run db:make-table -- --definition database/table.schema.example.json
   ```

4. Link the Supabase project, review the generated SQL under `supabase/migrations`, then deploy it:

   ```powershell
   npm run supabase -- link
   npm run supabase -- db push
   ```

Every generated table has RLS enabled by default. Add narrowly scoped policies to its migration before granting browser roles access. The server client uses a secret key and therefore bypasses RLS.

## Bulk upload

CSV, JSON arrays, JSONL, and NDJSON are supported. Imports run in batches of 500 by default (maximum 1,000).

```powershell
npm run db:bulk-upload -- --table episodes --file data/imports/episodes.csv
npm run db:bulk-upload -- --table episodes --file data/imports/episodes.json --mode upsert --on-conflict external_id
```

The conflict column(s) must have a matching unique or primary-key constraint. Verify the connection and table after migration:

```powershell
npm run db:verify -- --table episodes
```
