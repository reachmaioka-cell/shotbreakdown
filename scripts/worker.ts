/**
 * Local processing worker. In production the same code runs from /api/worker on
 * a cron; this is the loop you run beside `npm run dev`.
 *
 *   npm run worker
 */
import { drainQueue } from "../lib/pipeline/worker";

const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 3000);

async function main() {
  console.log("worker started — polling for processing jobs");
  for (;;) {
    try {
      const result = await drainQueue({ maxMs: 5 * 60_000, batchSize: 1 });
      if (result.done > 0 || result.failed > 0) {
        console.log(`tick: ${result.done} done, ${result.failed} failed, ${result.remaining} left`);
      }
    } catch (e) {
      console.error("worker tick failed", e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
