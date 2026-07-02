import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

export type DiscoveredRelease = {
  title: string
  artist: string | null
  type: 'film' | 'show' | 'music_video'
  genre: string
  category: string
  releaseDate: string
  buzz: number
  buzzDelta: number | null
  description: string
  sourceUrl: string | null
  trailerUrl: string | null
  isEstimated: boolean
  confirmedSource: string | null
}

export async function POST(req: NextRequest) {
  const { existingTitles, today } = await req.json()

  const exclusionList = (existingTitles as string[]).map((t) => `- ${t}`).join('\n')

  const prompt = `You are a film, TV, and music industry trend-tracking analyst. Search the web for what's genuinely trending RIGHT NOW, as close to ${today} as possible — including any surprise drops, announcements, or releases from roughly the last 14 days, plus major near-term upcoming titles.

Cover all three categories: films, TV shows, and music videos.

Rules:
- Do NOT include any of these titles — they're already being tracked:
${exclusionList || '(none yet)'}
- For MUSIC VIDEOS: only include an artist if you can confirm via search that they have roughly 1,000,000+ Instagram followers AND roughly 5,000,000+ Spotify monthly listeners. Search for these numbers — do not guess. Skip anything you can't reasonably confirm meets this bar.
- For FILMS/SHOWS: only include titles generating real, confirmable buzz — major studio/streamer releases, award-season contenders, or genuinely viral premieres. Search for actual news, don't guess.
- Prioritize surprise drops and very recent news over things that were already widely known weeks ago.
- Return at most 12 candidates, ranked by how significant/trending they are right now.

There are two separate URL fields — do not mix them up:
- "sourceUrl": the link a human clicks to read about / rate the title.
  - MUSIC VIDEOS: same as trailerUrl (the YouTube video itself).
  - FILMS/SHOWS: the DIRECT IMDB title page — the form https://www.imdb.com/title/ttXXXXXXX/ for that specific title, never a generic browse/search page. This is the page that shows its rating. If you can't find that specific title page, use an official site or trade article about that title specifically instead.
- "trailerUrl": a URL that a program can actually download/embed a playable video from.
  - MUSIC VIDEOS: the official YouTube video URL.
  - FILMS/SHOWS: the official trailer's YouTube URL (studios almost always post trailers to YouTube — search for "<title> official trailer"). This must be a real youtube.com/watch or youtu.be URL, not an IMDB link (IMDB video pages are not embeddable/downloadable). Null if you can't find one.

For each candidate return an object:
{
  "title": string,
  "artist": string or null (only for music videos),
  "type": "film" | "show" | "music_video",
  "genre": string,
  "category": string (e.g. "Single", "Franchise", "Prestige TV"),
  "releaseDate": "YYYY-MM-DD",
  "buzz": number 0-20 (millions of estimated mention-equivalents, same scale as: social mentions + search volume + trailer views + press coverage),
  "buzzDelta": number or null (positive = rising vs prior month),
  "description": "1-2 sentences with concrete detail (director/artist, cast, concept)",
  "sourceUrl": "URL as described above, or null",
  "trailerUrl": "youtube.com/watch or youtu.be URL as described above, or null",
  "isEstimated": true or false (false only if you found a reputable confirmed source),
  "confirmedSource": "URL" or null
}

Respond with ONLY a JSON array of these objects, no other text.`

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
      messages: [{ role: 'user', content: prompt }],
    })

    const text = message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return NextResponse.json({ candidates: [] })
    const candidates: DiscoveredRelease[] = JSON.parse(match[0])
    return NextResponse.json({ candidates })
  } catch (e) {
    console.error('discover-trending failed:', String(e).slice(0, 300))
    return NextResponse.json({ candidates: [] }, { status: 500 })
  }
}
