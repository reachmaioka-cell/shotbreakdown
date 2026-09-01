export const FREE_LIMIT = 10;
export const FREE_ASK_TURNS = 10;
export const MODEL = "claude-sonnet-4-6";
export const POLL_MS = 2500;
export const SIGNED_URL_TTL_SEC = 60 * 10;
export const UPLOAD_BUCKET = "uploads";
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
export const ALLOWED_UPLOAD_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/x-m4v",
] as const;

export const ACCEPT_ATTRIBUTE = [...ALLOWED_UPLOAD_TYPES, ".mkv", ".mov", ".mp4", ".m4v", ".webm"].join(",");
