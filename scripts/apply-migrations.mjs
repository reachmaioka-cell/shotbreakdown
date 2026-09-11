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

  /*
   * .env.local carries a LOCAL Supabase URL and a PRODUCTION DATABASE_URL, so
   * `npm run db:migrate` with no argument reads the local file and writes the
   * live database. Two migrations landed in production that way on 2026-09-11.
   * Anything that is not plainly localhost now has to be asked for.
   */
  if (!isLocal && !process.argv.includes("--production")) {
    const host = new URL(url).host;
    console.error(`DATABASE_URL points at ${host}, which is not local.`);
    console.error("Re-run as `npm run db:migrate -- --production` if that is what you meant.");
    process.exit(1);
  }

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
