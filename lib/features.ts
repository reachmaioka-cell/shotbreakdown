/**
 * Launch feature flags.
 *
 * ShotBreakdown launches around one flow: upload a segment of a video, get a
 * breakdown of it. Everything that needs footage the user did not upload — a
 * public corpus, an editorial library, SEO surfaces built on top of one — is
 * switched off here rather than deleted. All of it is built and tested; each
 * flag is one environment variable away from coming back.
 *
 * Every flag defaults to OFF. Set `FEATURE_<NAME>=1` to enable.
 *
 * SERVER ONLY. Next.js inlines `process.env` at build time for client bundles
 * and only for `NEXT_PUBLIC_*` names, so importing this from a client component
 * would silently read `undefined` and evaluate every flag as false. Read flags
 * in a server component and pass them down as props.
 */

function enabled(name: string): boolean {
  return process.env[`FEATURE_${name}`] === "1";
}

export const FEATURES = {
  /**
   * The public shot library: the `All shots` scope, anonymous search, the
   * homepage shot grid, and public shot pages. Needs a rights-cleared corpus.
   */
  publicLibrary: enabled("PUBLIC_LIBRARY"),

  /** Programmatic technique pages under /camera-movements, /lighting, etc. */
  taxonomyPages: enabled("TAXONOMY_PAGES"),

  /** /tags/[tag] pages. */
  tagPages: enabled("TAG_PAGES"),

  /** /learn/[topic] articles. */
  learnPages: enabled("LEARN_PAGES"),

  /** "Visually similar" on the shot page — meaningless over one user's shots. */
  similarShots: enabled("SIMILAR_SHOTS"),

  /** The /onboarding interstitial. New users go straight to the app instead. */
  onboarding: enabled("ONBOARDING"),

  /** /admin/review — the editorial queue that publishes shots to the library. */
  adminReview: enabled("ADMIN_REVIEW"),

  /** /admin/learning — the knowledge-ingestion console. */
  adminLearning: enabled("ADMIN_LEARNING"),

  /**
   * Pasting a YouTube / TikTok / Instagram link. That path analyses the cover
   * frame as a single shot, which cannot answer "what happens in this segment".
   */
  linkSources: enabled("LINK_SOURCES"),

  /** Uploading a still image instead of a video segment. Same reason. */
  stillUploads: enabled("STILL_UPLOADS"),
} as const;

export type FeatureName = keyof typeof FEATURES;
