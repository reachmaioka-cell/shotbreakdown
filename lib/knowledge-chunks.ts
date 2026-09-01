import { createAdminClient } from "@/lib/supabase/admin";
import { embedOptional } from "@/lib/embeddings";

export type TextChunk = {
  heading: string | null;
  content: string;
  tokenEst: number;
};

const TARGET_CHARS = 1100;
const MAX_CHARS = 1600;
const MIN_CHARS = 200;

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Split markdown into retrieval-sized chunks on headings, then soft-split long sections.
 */
export function splitMarkdownChunks(markdown: string, title?: string): TextChunk[] {
  const cleaned = markdown.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];

  if (cleaned.length <= MAX_CHARS) {
    return [{ heading: title ?? null, content: cleaned, tokenEst: estimateTokens(cleaned) }];
  }

  const sections: { heading: string | null; body: string }[] = [];
  const lines = cleaned.split("\n");
  let heading: string | null = title ?? null;
  let buf: string[] = [];

  const flush = () => {
    const body = buf.join("\n").trim();
    if (body) sections.push({ heading, body });
    buf = [];
  };

  for (const line of lines) {
    const match = /^(#{1,3})\s+(.+)$/.exec(line);
    if (match) {
      flush();
      heading = match[2].trim();
      continue;
    }
    buf.push(line);
  }
  flush();

  if (!sections.length) {
    sections.push({ heading: title ?? null, body: cleaned });
  }

  const chunks: TextChunk[] = [];
  for (const section of sections) {
    for (const piece of softSplit(section.body)) {
      chunks.push({
        heading: section.heading,
        content: piece,
        tokenEst: estimateTokens(piece),
      });
    }
  }

  return chunks.length ? chunks : [{ heading: title ?? null, content: cleaned.slice(0, MAX_CHARS), tokenEst: estimateTokens(cleaned) }];
}

function softSplit(text: string): string[] {
  if (text.length <= MAX_CHARS) return [text];

  const paragraphs = text.split(/\n{2,}/);
  const out: string[] = [];
  let current = "";

  const pushCurrent = () => {
    const t = current.trim();
    if (t) out.push(t);
    current = "";
  };

  for (const para of paragraphs) {
    const next = current ? `${current}\n\n${para}` : para;
    if (next.length <= TARGET_CHARS) {
      current = next;
      continue;
    }
    if (current) pushCurrent();
    if (para.length <= MAX_CHARS) {
      current = para;
      continue;
    }
    // Hard-split very long paragraphs on sentence boundaries.
    let remaining = para;
    while (remaining.length > MAX_CHARS) {
      let cut = remaining.lastIndexOf(". ", MAX_CHARS);
      if (cut < MIN_CHARS) cut = remaining.lastIndexOf(" ", MAX_CHARS);
      if (cut < MIN_CHARS) cut = MAX_CHARS;
      out.push(remaining.slice(0, cut + 1).trim());
      remaining = remaining.slice(cut + 1).trim();
    }
    current = remaining;
  }
  pushCurrent();
  return out.length ? out : [text.slice(0, MAX_CHARS)];
}

export async function syncKnowledgeChunks(options: {
  articleId: string;
  title: string;
  content: string;
}): Promise<{ chunks: number }> {
  const admin = createAdminClient();
  const pieces = splitMarkdownChunks(options.content, options.title);

  await admin.from("knowledge_chunks").delete().eq("article_id", options.articleId);

  let written = 0;
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    const embedText = [options.title, piece.heading, piece.content]
      .filter(Boolean)
      .join("\n")
      .slice(0, 8000);
    const embedding = await embedOptional(embedText);
    const { error } = await admin.from("knowledge_chunks").insert({
      article_id: options.articleId,
      chunk_index: i,
      heading: piece.heading,
      content: piece.content,
      token_est: piece.tokenEst,
      embedding: embedding ?? null,
    });
    if (error) {
      console.error("syncKnowledgeChunks", options.articleId, error.message);
      continue;
    }
    written += 1;
  }

  return { chunks: written };
}

export async function syncKnowledgeChunksBySlug(slug: string): Promise<{ chunks: number } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("knowledge_articles")
    .select("id, title, content")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) return null;
  return syncKnowledgeChunks({
    articleId: data.id as string,
    title: data.title as string,
    content: data.content as string,
  });
}

/** Backfill chunks for articles that have none (or force rebuild). */
export async function backfillKnowledgeChunks(options?: {
  limit?: number;
  force?: boolean;
}): Promise<{ articles: number; chunks: number }> {
  const admin = createAdminClient();
  const limit = options?.limit ?? 25;

  const query = admin
    .from("knowledge_articles")
    .select("id, slug, title, content")
    .order("updated_at", { ascending: false })
    .limit(limit);

  const { data: articles, error } = await query;
  if (error) throw error;

  let done = 0;
  let chunks = 0;

  for (const article of articles ?? []) {
    if (!options?.force) {
      const { count } = await admin
        .from("knowledge_chunks")
        .select("id", { count: "exact", head: true })
        .eq("article_id", article.id);
      if ((count ?? 0) > 0) continue;
    }

    const result = await syncKnowledgeChunks({
      articleId: article.id as string,
      title: article.title as string,
      content: article.content as string,
    });
    done += 1;
    chunks += result.chunks;
  }

  return { articles: done, chunks };
}
