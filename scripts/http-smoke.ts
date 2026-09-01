/**
 * HTTP smoke test against the running dev/prod server.
 * Usage: npx tsx --env-file=.env.local scripts/http-smoke.ts [baseUrl]
 */
const BASE = process.argv[2] ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3002";

type Check = { name: string; ok: boolean; detail?: string };

async function check(name: string, fn: () => Promise<void>): Promise<Check> {
  try {
    await fn();
    return { name, ok: true };
  } catch (e) {
    return { name, ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

async function main() {
  const results: Check[] = [];

  results.push(
    await check("GET /", async () => {
      const res = await fetch(`${BASE}/`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const html = await res.text();
      if (!html.includes("ShotBreakdown")) throw new Error("missing title");
    })
  );

  results.push(
    await check("GET /library", async () => {
      const res = await fetch(`${BASE}/library`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const html = await res.text();
      if (!html.includes("Library")) throw new Error("missing heading");
    })
  );

  results.push(
    await check("GET /api/shots/search", async () => {
      const res = await fetch(`${BASE}/api/shots/search?q=low-key%20portrait`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { shots?: unknown[]; total?: number };
      if (!Array.isArray(data.shots)) throw new Error("missing shots array");
      if (typeof data.total !== "number") throw new Error("missing total");
    })
  );

  results.push(
    await check("GET /api/shots/search facet", async () => {
      const res = await fetch(`${BASE}/api/shots/search?lighting_key=low-key&limit=5`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { total?: number };
      if (typeof data.total !== "number") throw new Error("missing total");
    })
  );

  results.push(
    await check("GET /api/me (guest)", async () => {
      const res = await fetch(`${BASE}/api/me`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { authed?: boolean };
      if (data.authed !== false) throw new Error("expected authed:false");
    })
  );

  results.push(
    await check("GET /history redirects to /videos", async () => {
      const res = await fetch(`${BASE}/history`, { redirect: "manual" });
      if (res.status !== 308 && res.status !== 307 && res.status !== 301) {
        throw new Error(`status ${res.status}`);
      }
      const loc = res.headers.get("location") ?? "";
      if (!loc.includes("/videos")) throw new Error(`location ${loc}`);
    })
  );

  results.push(
    await check("GET /videos redirects guests to login", async () => {
      const res = await fetch(`${BASE}/videos`, { redirect: "manual" });
      if (res.status !== 307 && res.status !== 302) throw new Error(`status ${res.status}`);
      const loc = res.headers.get("location") ?? "";
      if (!loc.includes("/auth/login")) throw new Error(`location ${loc}`);
    })
  );

  results.push(
    await check("GET /auth/login", async () => {
      const res = await fetch(`${BASE}/auth/login`);
      if (!res.ok) throw new Error(`status ${res.status}`);
    })
  );

  results.push(
    await check("GET /upgrade", async () => {
      const res = await fetch(`${BASE}/upgrade`);
      if (!res.ok) throw new Error(`status ${res.status}`);
    })
  );

  results.push(
    await check("public shot page + recreation guide", async () => {
      const search = await fetch(`${BASE}/api/shots/search?limit=1`);
      if (!search.ok) throw new Error(`search ${search.status}`);
      const data = (await search.json()) as {
        shots?: { id: string; slug?: string | null }[];
      };
      const shot = data.shots?.[0];
      if (!shot) throw new Error("no public shots");
      const page = await fetch(`${BASE}/shots/${shot.slug ?? shot.id}`);
      if (!page.ok) throw new Error(`shot page ${page.status}`);
      const html = await page.text();
      if (!html.includes("Recreate it")) throw new Error("missing Recreate it section");
      const guide = await fetch(`${BASE}/api/shots/${shot.id}/recreation-guide`);
      if (!guide.ok) throw new Error(`guide ${guide.status}`);
      const body = (await guide.json()) as { status?: string };
      if (body.status !== "ready" && body.status !== "missing" && body.status !== "pending") {
        throw new Error(`unexpected guide status ${body.status}`);
      }
    })
  );

  console.log(`\nShotBreakdown HTTP smoke (${BASE})\n`);
  for (const r of results) {
    console.log(r.ok ? `✓ ${r.name}` : `✗ ${r.name}${r.detail ? `: ${r.detail}` : ""}`);
  }
  console.log("");

  const failed = results.filter((r) => !r.ok);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export {};
