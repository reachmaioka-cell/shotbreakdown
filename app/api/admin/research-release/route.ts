import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

export type ResearchResult = {
  // Trending
  trending: boolean
  trendDirection: 'rising' | 'falling' | 'stable' | 'unknown'
  buzzScore: number | null
  buzzDelta: number | null  // vs prior month, in same units
  // Date
  date: string | null
  dateConfidence: 'confirmed' | 'estimated' | 'unknown'
  dateSource: string | null
  // Video / source link
  videoUrl: string | null          // direct playable URL (YouTube/Vimeo/Instagram/TikTok)
  sourceLinkUrl: string | null     // fallback: official site, IMDB, distributor
  sourceLinkLabel: string | null   // e.g. "Official site", "IMDB", "Letterboxd"
  // Meta
  note: string
}

export async function POST(req: NextRequest) {
  const { title, artist, type, genre, releaseDate, today } = await req.json()

  const label = artist ? `"${title}" by ${artist}` : `"${title}"`
  const typeLabel = type === 'music_video' ? 'music video' : type === 'show' ? 'TV series' : 'film'

  const prompt = `You are a film, TV, and music industry research analyst with access to your training data up to August 2025. Today's editorial date is ${today}.

Research the following ${typeLabel} and answer each question as accurately as possible. Use only facts you are confident about — do not guess or fabricate.

${typeLabel === 'music video' ? 'Music Video' : 'Title'}: ${label}
Genre: ${genre}
Currently listed release date: ${releaseDate}

Answer ALL of the following in the JSON format below:

1. TRENDING: Is this title generating significant search or social buzz right now (within the 3-month window around its release)? Is momentum rising, falling, or stable compared to the prior month?

2. BUZZ: On a scale of 0–20M estimated mention-equivalents (combining: social mentions on X/Instagram/TikTok in the past 30 days + search volume + trailer views + press coverage), what is the estimated buzz score? Also estimate the delta vs the prior month (positive = rising).

3. DATE: What is the most accurate confirmed release date you know? Is this date confirmed (reputable trade/official announcement) or estimated? What is the source?

4. VIDEO LINK: If this is already released and available:
   - For music videos: provide the official YouTube URL if you know it. Format: https://www.youtube.com/watch?v=VIDEO_ID
   - For films/shows: if there is an official trailer on YouTube, provide that. Otherwise null.
   - If the video is on Vimeo, Instagram, or TikTok instead, provide that URL.
   - If no direct playable video URL is available, return null.

5. SOURCE LINK: If no direct video URL is available (or as a supplement), what is the most reputable source link for this title? Priority: official site > studio/distributor page > IMDB > Letterboxd > Rotten Tomatoes > Wikipedia. Return the full URL.

6. NOTE: One sentence summarising any important context, caveats, or corrections to the currently listed data.

Return ONLY valid JSON:
{
  "trending": true or false,
  "trendDirection": "rising" | "falling" | "stable" | "unknown",
  "buzzScore": number between 0 and 20, or null if unknown,
  "buzzDelta": number (positive = rising vs last month), or null if unknown,
  "date": "YYYY-MM-DD" or null,
  "dateConfidence": "confirmed" | "estimated" | "unknown",
  "dateSource": "short description of source" or null,
  "videoUrl": "full URL" or null,
  "sourceLinkUrl": "full URL" or null,
  "sourceLinkLabel": "label for the link" or null,
  "note": "one sentence"
}`

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return NextResponse.json({ error: 'No JSON returned' }, { status: 500 })
    const result: ResearchResult = JSON.parse(match[0])
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Research failed' }, { status: 500 })
  }
}
