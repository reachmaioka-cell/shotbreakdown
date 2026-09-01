export type LearningJobType =
  | "ingest_learn"
  | "distill_verified_batch"
  | "distill_submission"
  | "distill_shot"
  | "distill_corrections"
  | "research_topic"
  | "warm_research"
  | "learn_music_video"
  | "learn_film"
  | "learn_technique"
  | "learn_ai_tool"
  | "reembed_submission"
  | "reembed_batch"
  | "prompt_insights"
  | "embed_missing"
  | "rechunk_knowledge"
  | "discover_library";

export type LearningJob = {
  id: string;
  job_type: LearningJobType;
  payload: Record<string, unknown>;
  status: "pending" | "running" | "done" | "failed";
  priority: number;
  attempts: number;
  max_attempts: number;
  dedupe_key: string | null;
};

export type LearningJobResult = {
  ok: boolean;
  detail?: Record<string, unknown>;
  error?: string;
};
