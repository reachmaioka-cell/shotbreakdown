/**
 * Continuous learning worker — runs forever, never stops.
 * Seeds recurring jobs, processes the queue, sleeps when idle.
 *
 * Usage: npm run learning:worker
 * Requires: .env.local with Supabase + OPENAI_API_KEY (embeddings) + optional SERPER_API_KEY
 */
import { runLearningWorker } from "@/lib/learning/worker";

const BATCH_SIZE = 8;
const IDLE_SLEEP_MS = 20_000;
const ACTIVE_SLEEP_MS = 2_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loop() {
  console.log("[learning] worker started — batch", BATCH_SIZE);
  for (;;) {
    try {
      const result = await runLearningWorker(BATCH_SIZE);
      const ts = new Date().toISOString();
      console.log(
        `[learning] ${ts} seeded=${result.seeded} claimed=${result.claimed} ok=${result.completed} fail=${result.failed} pending=${result.pending}`
      );
      for (const j of result.jobs) {
        if (!j.ok) console.log(`  ✗ ${j.type}: ${j.error}`);
      }
      await sleep(result.claimed === 0 && result.seeded === 0 ? IDLE_SLEEP_MS : ACTIVE_SLEEP_MS);
    } catch (e) {
      console.error("[learning] loop error", e instanceof Error ? e.message : e);
      await sleep(IDLE_SLEEP_MS);
    }
  }
}

loop().catch((e) => {
  console.error(e);
  process.exit(1);
});
