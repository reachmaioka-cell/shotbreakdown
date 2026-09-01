import { runLearningWorker } from "@/lib/learning/worker";

const batch = Number(process.argv[2] ?? 5);
runLearningWorker(batch)
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
