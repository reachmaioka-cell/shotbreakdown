import type { MetadataRoute } from "next";
import { getAppUrl } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  const origin = getAppUrl();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Private surfaces, share links and anything user-scoped stay out of the
      // index. /library is allowed; its filtered variants set noindex per page.
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
      ],
    },
    sitemap: `${origin}/sitemap.xml`,
  };
}
