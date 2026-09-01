import { distillVerifiedBreakdowns, ingestLearnArticles } from "@/lib/knowledge";

async function main() {
  const learn = await ingestLearnArticles();
  const verified = await distillVerifiedBreakdowns(20);
  console.log(`Ingested ${learn.upserted} learn articles, ${verified.upserted} verified distillations.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
