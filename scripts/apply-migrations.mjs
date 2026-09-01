import { readdir, readFile } from "fs/promises";
import path from "path";
import postgres from "postgres";

const dir = path.join(process.cwd(), "supabase/migrations");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Set DATABASE_URL (Supabase Database settings → URI, use the postgres role).");
    process.exit(1);
  }

  const isLocal = url.includes("127.0.0.1") || url.includes("localhost");
  const sql = postgres(url, { max: 1, ssl: isLocal ? false : "require" });

  try {
    await sql`
      create table if not exists public.schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `;

    const [{ exists }] = await sql`
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'submissions'
      ) as exists
    `;

    const applied = await sql`
      select filename from public.schema_migrations order by filename
    `;
    const appliedSet = new Set(applied.map((r) => r.filename));

    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (exists && file.startsWith("0001_") && appliedSet.has(file)) {
        console.log(`skip ${file} (already applied)`);
        continue;
      }
      if (appliedSet.has(file)) {
        console.log(`skip ${file} (already applied)`);
        continue;
      }

      const raw = await readFile(path.join(dir, file), "utf8");
      console.log(`apply ${file}`);
      await sql.begin(async (tx) => {
        await tx.unsafe(raw);
        await tx`insert into public.schema_migrations (filename) values (${file})`;
      });
    }
    // PostgREST caches the schema; new functions/tables are invisible to the
    // REST API until it reloads.
    await sql`notify pgrst, 'reload schema'`;
    console.log("migrations ok");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
