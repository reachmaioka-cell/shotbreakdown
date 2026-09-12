export const FREE_LIMIT = 10;
export const FREE_ASK_TURNS = 10;
export const MODEL = "claude-sonnet-4-6";

/**
 * The model that writes a single shot's facet record.
 *
 * Separate from MODEL because the two calls are no longer the same kind of
 * work. The segment breakdown is the product — one written read of a whole
 * segment — and stays on Sonnet. The per-shot record is classification against
 * a fixed schema, and the per-shot call is the one that runs 5-10 times per
 * segment, so it is where the money goes. Splitting the constant means the
 * shot record can move to a cheaper model without touching the breakdown.
 *
 * Moving it is a one-line edit here, and it should only follow a measured
 * comparison: `npm run model:compare`.
 *
 * Haiku 4.5 was measured and declined. Against a same-run, same-shots control
 * of Sonnet read twice — which agrees with itself on all but one of the enum
 * facets — Haiku agreed on 57%, and the fields it lost are the ones a shot
 * record exists to carry: it read a pan on a flat title card that does not
 * move, called a dusk sky artificial light, and put a focal length and an
 * aperture on two shots that have no lens, where Sonnet correctly returned
 * nothing. That last one is the disqualifier: the record is trusted because it
 * says "unknown" when it does not know. Declining cost roughly $0.015 a shot.
 */
export const SHOT_MODEL = "claude-sonnet-4-6";
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
