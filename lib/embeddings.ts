import type { Breakdown, ShotMetadata } from "@/lib/validation";

const OPENAI_EMBED_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIM = 1536;

export class EmbeddingError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "EmbeddingError";
    this.retryable = retryable;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Embed text. Throws on failure — a silently-null embedding makes a shot
 * permanently invisible to retrieval with nothing to alert on, which is exactly
 * the class of failure that looks like a working product and is not one.
 * Transient provider errors (429 / 5xx / network) are retried with backoff.
 */
export async function embed(text: string, attempts = 3): Promise<number[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new EmbeddingError("OPENAI_API_KEY is not configured", false);

  const input = text.replace(/\s+/g, " ").trim().slice(0, 8000);
  if (!input) throw new EmbeddingError("Nothing to embed", false);

  let lastError: EmbeddingError = new EmbeddingError("embedding failed", true);

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(400 * 2 ** (attempt - 1));

    let res: Response;
    try {
      res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: OPENAI_EMBED_MODEL, input }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      lastError = new EmbeddingError(
        `embedding request failed: ${e instanceof Error ? e.message : "network error"}`,
        true
      );
      continue;
    }

    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      const detail = await res.text().catch(() => "");
      lastError = new EmbeddingError(
        `embedding provider returned ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
        retryable
      );
      if (!retryable) throw lastError;
      continue;
    }

    const json = (await res.json()) as { data?: { embedding: number[] }[] };
    const vector = json.data?.[0]?.embedding;
    if (!vector || vector.length !== EMBEDDING_DIM) {
      throw new EmbeddingError("embedding provider returned an unexpected vector", false);
    }
    return vector;
  }

  throw lastError;
}

/**
 * Embed where a missing vector is genuinely acceptable — bulk knowledge
 * ingestion loops that should not abort a whole batch for one bad row.
 * Never use this on the shot indexing path.
 */
export async function embedOptional(text: string): Promise<number[] | null> {
  try {
    return await embed(text);
  } catch (e) {
    console.error("embedOptional", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Pre-breakdown query: title, tags, source type. */
export function embeddingQueryText(input: {
  title?: string | null;
  sourceType?: string | null;
  summary?: string | null;
  tags?: string[] | null;
}): string {
  return [
    input.summary,
    input.title,
    input.tags?.join(" "),
    input.sourceType,
    "cinematography shot breakdown",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Post-breakdown store: unified text for similar-shot retrieval. */
export function breakdownEmbeddingText(
  breakdown: Breakdown,
  meta?: { title?: string | null; sourceType?: string | null }
): string {
  return [
    meta?.title,
    breakdown.one_line_summary,
    breakdown.tags.join(" "),
    breakdown.shot_type,
    breakdown.lens,
    breakdown.lighting.key,
    breakdown.lighting.fill,
    breakdown.movement.type,
    breakdown.movement.rig_guess,
    breakdown.color.look,
    breakdown.post_production?.ai_tools,
    breakdown.vfx.join(" "),
    meta?.sourceType,
    "cinematography shot breakdown",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The text a shot is indexed on. Deliberately description-led and facet-rich so
 * a natural-language query like "moody nighttime portrait" lands near a shot
 * tagged night / low-key / close-up / shallow, even with no literal overlap.
 */
export function shotEmbeddingText(
  metadata: ShotMetadata,
  meta?: { title?: string | null; sourceType?: string | null; videoTitle?: string | null }
): string {
  const parts: (string | null | undefined)[] = [
    metadata.description,
    metadata.one_line_summary,
    metadata.why_it_works,
    meta?.title,
    meta?.videoTitle,
    metadata.tags?.join(" "),
    metadata.mood?.join(" "),
  ];

  if (metadata.composition) {
    parts.push(
      metadata.composition.shot_size,
      metadata.composition.camera_angle,
      metadata.composition.camera_height,
      metadata.composition.framing,
      metadata.composition.subject_position,
      metadata.composition.symmetry,
      metadata.composition.depth,
      metadata.composition.foreground,
      metadata.composition.background
    );
  }
  if (metadata.optics) {
    parts.push(
      metadata.optics.lens_type,
      metadata.optics.focal_length_range,
      `${metadata.optics.depth_of_field} depth of field`,
      metadata.optics.compression,
      metadata.optics.bokeh
    );
  }
  if (metadata.lighting_facets) {
    const l = metadata.lighting_facets;
    parts.push(
      `${l.quality} light`,
      `${l.key_level} key`,
      `${l.key_direction} key direction`,
      `${l.source} light source`,
      `${l.contrast} contrast`,
      `${l.color_temperature} colour temperature`,
      l.backlight ? "backlight" : "",
      l.rim_light ? "rim light" : "",
      l.silhouette ? "silhouette" : "",
      l.practicals_visible ? "practical lights" : ""
    );
  }
  if (metadata.color_facets) {
    parts.push(
      metadata.color_facets.palette,
      metadata.color_facets.dominant_colors.join(" "),
      `${metadata.color_facets.saturation} saturation`,
      `${metadata.color_facets.temperature} colour`
    );
  }
  if (metadata.environment) {
    parts.push(
      metadata.environment.interior_exterior,
      metadata.environment.location_type,
      metadata.environment.time_of_day,
      metadata.environment.weather,
      metadata.environment.descriptors.join(" ")
    );
  }
  if (metadata.subject) {
    parts.push(metadata.subject.types.join(" "), metadata.subject.count, metadata.subject.description);
  }
  if (metadata.movement_facets) {
    const m = metadata.movement_facets;
    parts.push(
      `${m.type} camera move`,
      m.direction !== "none" ? `moving ${m.direction}` : "",
      `${m.speed} speed`
    );
  }

  parts.push(metadata.lighting?.key, metadata.color?.look, metadata.lens, metadata.lighting_notes, metadata.color_notes, meta?.sourceType);

  return parts.filter(Boolean).join(". ").slice(0, 7500);
}
