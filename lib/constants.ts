export const FREE_LIMIT = 10;
export const FREE_ASK_TURNS = 10;
export const MODEL = "claude-sonnet-4-6";
export const POLL_MS = 2500;
export const SIGNED_URL_TTL_SEC = 60 * 10;
export const UPLOAD_BUCKET = "uploads";
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
export const ALLOWED_VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/x-m4v",
] as const;

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;

export const ALLOWED_UPLOAD_TYPES = [...ALLOWED_VIDEO_TYPES, ...ALLOWED_IMAGE_TYPES] as const;

const VIDEO_EXTENSIONS = [".mkv", ".mov", ".mp4", ".m4v", ".webm"];

export const ACCEPT_ATTRIBUTE = [...ALLOWED_UPLOAD_TYPES, ...VIDEO_EXTENSIONS].join(",");

// Some browsers report an empty MIME type for .mkv and .mov, so the extensions
// have to be in the accept list too or the picker greys those files out.
export const ACCEPT_VIDEO_ATTRIBUTE = [...ALLOWED_VIDEO_TYPES, ...VIDEO_EXTENSIONS].join(",");
