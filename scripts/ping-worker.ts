/**
 * Ping the processing worker. Use this locally, or as an external pinger on
 * Vercel Hobby where cron can only run once a day.
 *
 *   npm run worker:ping
 *   E2E_BASE_URL=https://your.domain CRON_SECRET=… npx tsx scripts/ping-worker.ts
 */
const base = (process.env.E2E_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3002").replace(
  /\/$/,
  ""
);
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET is required");
  process.exit(1);
}

async function main() {
  const res = await fetch(`${base}/api/worker`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(res.status, body);
    process.exit(1);
  }
  console.log(body);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export {};
