import { createAdminClient } from "@/lib/supabase/admin";
import { extractYoutubeId } from "@/lib/clip";

export type ResearchSnippet = {
  title: string;
  excerpt: string;
  url?: string;
  source: "youtube" | "tiktok" | "web" | "wikipedia" | "cache";
};

export type ResearchContext = {
  sourceUrl: string | null;
  sourceType: string | null;
  title: string | null;
  creator: string | null;
  description: string | null;
  queries: string[];
  snippets: ResearchSnippet[];
  gearMentions: string[];
  fetchedAt: string;
};

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function cacheKey(sourceUrl: string | null, title: string | null, sourceType: string | null) {
  return [sourceType ?? "unknown", sourceUrl ?? "", title ?? ""].join("|").slice(0, 512);
}

function extractGearMentions(text: string): string[] {
  const patterns = [
    /\b(?:ARRI|RED|Sony|Canon|Panasonic|Blackmagic|DJI|Zeiss|Cooke|Sigma|Laowa)[^\n,.]{0,40}/gi,
    /\b(?:SkyPanel|Aputure|Nanlite|Kino Flo|LiteMat|M18|600d|300d|MC Pro)[^\n,.]{0,30}/gi,
    /\b\d{1,4}mm\b/g,
    /\bf\/[\d.]+/gi,
    /\b(?:DaVinci|Premiere|After Effects|Nuke|Fusion|Runway|Pika|Sora|Midjourney)[^\n,.]{0,30}/gi,
  ];
  const found = new Set<string>();
  for (const re of patterns) {
    for (const m of text.match(re) ?? []) {
      found.add(m.trim().slice(0, 80));
    }
  }
  return [...found].slice(0, 20);
}

function buildQueries(title: string | null, sourceType: string | null): string[] {
  if (!title) return [];
  const base = title.replace(/\[[^\]]+\]/g, "").replace(/\([^)]*\)/g, "").trim();
  const queries = [
    `${base} cinematography behind the scenes`,
    `${base} camera lens lighting breakdown`,
    `${base} DP director of photography interview`,
    `${base} VFX breakdown editing color grade`,
  ];
  if (sourceType === "youtube") {
    queries.push(`${base} filmmaker gear used`);
  }
  if (sourceType === "instagram" || sourceType === "tiktok") {
    queries.push(`${base} cinematographer BTS behind the scenes`);
    queries.push(`${base} filmmaker reel lighting`);
  }
  return [...new Set(queries.map((q) => q.replace(/\s+/g, " ").trim()))].slice(0, 5);
}

async function fetchYouTubeRichMeta(url: string): Promise<{
  title: string | null;
  creator: string | null;
  description: string | null;
}> {
  try {
    const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
    if (!res.ok) return { title: null, creator: null, description: null };
    const data = (await res.json()) as {
      title?: string;
      author_name?: string;
      author_url?: string;
    };
    let description: string | null = null;
    const id = extractYoutubeId(url);
    if (id) {
      try {
        const page = await fetch(`https://www.youtube.com/watch?v=${id}`, {
          headers: { "Accept-Language": "en-US,en;q=0.9" },
        });
        if (page.ok) {
          const html = await page.text();
          const match = html.match(/"shortDescription":"((?:\\.|[^"\\])*)"/);
          if (match?.[1]) {
            description = JSON.parse(`"${match[1]}"`).slice(0, 1200);
          }
        }
      } catch {
        description = null;
      }
    }
    return {
      title: data.title ?? null,
      creator: data.author_name ?? null,
      description,
    };
  } catch {
    return { title: null, creator: null, description: null };
  }
}

async function fetchWikipediaSummary(query: string): Promise<ResearchSnippet | null> {
  try {
    const search = await fetch(
      `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=1&format=json`
    );
    if (!search.ok) return null;
    const [, titles, descriptions, urls] = (await search.json()) as [string, string[], string[], string[]];
    const title = titles[0];
    const excerpt = descriptions[0];
    const url = urls[0];
    if (!title || !excerpt) return null;
    return { title, excerpt, url, source: "wikipedia" };
  } catch {
    return null;
  }
}

async function searchWeb(query: string): Promise<ResearchSnippet[]> {
  const serperKey = process.env.SERPER_API_KEY;
  if (serperKey) {
    try {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, num: 5 }),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as {
        organic?: { title?: string; snippet?: string; link?: string }[];
      };
      return (data.organic ?? []).slice(0, 5).map((row) => ({
        title: row.title ?? query,
        excerpt: row.snippet ?? "",
        url: row.link,
        source: "web" as const,
      }));
    } catch {
      return [];
    }
  }

  const wiki = await fetchWikipediaSummary(query);
  return wiki ? [wiki] : [];
}

async function readCache(key: string): Promise<ResearchContext | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("research_cache")
      .select("snippets, metadata, fetched_at, expires_at")
      .eq("cache_key", key)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!data) return null;
    const metadata = data.metadata as Omit<ResearchContext, "snippets" | "fetchedAt">;
    return {
      ...metadata,
      snippets: (data.snippets as ResearchSnippet[]) ?? [],
      fetchedAt: data.fetched_at as string,
    };
  } catch {
    return null;
  }
}

async function writeCache(key: string, ctx: ResearchContext) {
  try {
    const admin = createAdminClient();
    const { snippets, fetchedAt, ...metadata } = ctx;
    await admin.from("research_cache").upsert(
      {
        cache_key: key,
        source_url: ctx.sourceUrl,
        query: ctx.queries[0] ?? null,
        snippets,
        metadata,
        fetched_at: fetchedAt,
        expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
      },
      { onConflict: "cache_key" }
    );
  } catch (err) {
    console.error("research cache write failed", err instanceof Error ? err.message : err);
  }
}

export async function gatherClipResearch(options: {
  sourceUrl?: string | null;
  sourceType?: string | null;
  title?: string | null;
}): Promise<ResearchContext> {
  const sourceUrl = options.sourceUrl ?? null;
  const sourceType = options.sourceType ?? null;
  let title = options.title ?? null;
  let creator: string | null = null;
  let description: string | null = null;
  const snippets: ResearchSnippet[] = [];

  const key = cacheKey(sourceUrl, title, sourceType);
  const cached = await readCache(key);
  if (cached) return cached;

  if (sourceUrl && sourceType === "youtube") {
    const rich = await fetchYouTubeRichMeta(sourceUrl);
    title = title ?? rich.title;
    creator = rich.creator;
    description = rich.description;
    if (rich.title) {
      snippets.push({
        title: rich.title,
        excerpt: [rich.creator ? `Channel: ${rich.creator}` : null, rich.description].filter(Boolean).join(". "),
        url: sourceUrl,
        source: "youtube",
      });
    }
  }

  if (sourceUrl && (sourceType === "instagram" || sourceUrl.includes("instagram.com"))) {
    const igTitle = title ?? "Instagram reel";
    snippets.push({
      title: igTitle,
      excerpt: `Instagram source: ${sourceUrl}`,
      url: sourceUrl,
      source: "web",
    });
    const igQueries = [
      `${igTitle} cinematography breakdown`,
      `site:instagram.com ${igTitle} filmmaker`,
      `${sourceUrl} BTS lighting`,
    ];
    for (const q of igQueries.slice(0, 2)) {
      const hits = await searchWeb(q);
      snippets.push(...hits);
    }
  }

  const queries = buildQueries(title, sourceType);
  const searchResults = await Promise.all(queries.slice(0, 3).map((q) => searchWeb(q)));
  for (const batch of searchResults) {
    snippets.push(...batch);
  }

  const filmLike = title?.replace(/\b(official|trailer|music video|mv|hd|4k)\b/gi, "").trim();
  if (filmLike && filmLike.length > 3) {
    const wiki = await fetchWikipediaSummary(filmLike);
    if (wiki && !snippets.some((s) => s.url === wiki.url)) snippets.push(wiki);
  }

  const deduped = snippets.filter(
    (s, i, arr) => arr.findIndex((x) => x.excerpt === s.excerpt && x.title === s.title) === i
  );

  const gearMentions = extractGearMentions(
    [description ?? "", ...deduped.map((s) => `${s.title} ${s.excerpt}`)].join("\n")
  );

  const ctx: ResearchContext = {
    sourceUrl,
    sourceType,
    title,
    creator,
    description,
    queries,
    snippets: deduped.slice(0, 12),
    gearMentions,
    fetchedAt: new Date().toISOString(),
  };

  await writeCache(key, ctx);
  return ctx;
}

export function formatResearchBlock(ctx: ResearchContext | null): string | undefined {
  if (!ctx || ctx.snippets.length === 0) return undefined;
  const lines = [
    ctx.title ? `Clip title: ${ctx.title}` : "",
    ctx.creator ? `Creator / channel: ${ctx.creator}` : "",
    ctx.description ? `Source description: ${ctx.description.slice(0, 600)}` : "",
    ctx.gearMentions.length ? `Gear/tools mentioned in sources: ${ctx.gearMentions.join("; ")}` : "",
    "Web research snippets (use to inform guesses — do not copy blindly):",
    ...ctx.snippets.map(
      (s, i) =>
        `${i + 1}. [${s.source}] ${s.title}${s.url ? ` (${s.url})` : ""}\n${s.excerpt.slice(0, 400)}`
    ),
  ].filter(Boolean);
  return lines.join("\n");
}

/** Search the web for a topic (used by continuous learning worker). */
export async function searchTopic(query: string): Promise<ResearchSnippet[]> {
  const results = await searchWeb(query);
  const wiki =
    results.length === 0 ? await fetchWikipediaSummary(query) : null;
  const combined = wiki && !results.some((r) => r.url === wiki.url) ? [...results, wiki] : results;
  return combined.slice(0, 8);
}
