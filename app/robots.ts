import type { MetadataRoute } from "next";
import { getAppUrl } from "@/lib/env";
import { FEATURES } from "@/lib/features";
import { TAXONOMY_GROUPS } from "@/lib/taxonomy";

export default function robots(): MetadataRoute.Robots {
  const origin = getAppUrl();

  // A flagged-off surface answers 404. Crawlers should not spend budget on it,
  // and anything already indexed should stop being refreshed, so every disabled
  // flag adds its paths to the disallow list.
  const flaggedOff: string[] = [];
  if (!FEATURES.publicLibrary) flaggedOff.push("/library", "/shots");
  if (!FEATURES.taxonomyPages) flaggedOff.push(...TAXONOMY_GROUPS.map((group) => `/${group.segment}`));
  if (!FEATURES.tagPages) flaggedOff.push("/tags");
  if (!FEATURES.learnPages) flaggedOff.push("/learn");

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Private surfaces, share links and anything user-scoped stay out of the
      // index. /library is crawlable only while the public library is on; its
      // filtered variants set noindex per page.
      disallow: [
        "/api/",
        "/admin",
        "/s/",
        "/videos",
        "/collections",
        "/upload",
        "/settings",
        "/onboarding",
        "/history",
        "/breakdown/",
        "/auth/",
        ...flaggedOff,
      ],
    },
    sitemap: `${origin}/sitemap.xml`,
  };
}
