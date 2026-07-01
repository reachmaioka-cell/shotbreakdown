import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
const client = new Anthropic()

type VerifyResult = {
  date: string | null
  confidence: 'confirmed' | 'estimated' | 'unknown'
  note: string
  sourceUrl: string | null
  released: boolean
}

type YtMatch = { id: string; title: string; channel: string; uploadDate: string }

function toIsoDate(yyyymmdd: string): string | null {
  if (!/^\d{8}$/.test(yyyymmdd)) return null
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
}

async function searchYouTube(query: string): Promise<YtMatch[]> {
  try {
    const { stdout } = await execFileAsync('yt-dlp', [
      `ytsearch8:${query}`,
      '--print', '%(id)s\t%(title)s\t%(channel)s\t%(upload_date)s',
      '--skip-download', '--no-playlist', '--quiet',
    ], { timeout: 30_000 })
    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [id, title, channel, uploadDate] = line.split('\t')
        return { id, title, channel: channel ?? '', uploadDate: uploadDate ?? '' }
      })
  } catch (e) {
    console.error('yt-dlp search failed:', String(e).slice(0, 300))
    return []
  }
}

async function verifyMusicVideo(title: string, artist: string | undefined): Promise<VerifyResult> {
  const query = artist ? `${artist} ${title} official music video` : `${title} official music video`
  const matches = await searchYouTube(query)

  const artistFirstWord = (artist ?? '').toLowerCase().split(' ')[0]
  const best =
    matches.find((m) => artistFirstWord && m.channel.toLowerCase().includes(artistFirstWord)) ??
    matches.find((m) => /official/i.test(m.title)) ??
    matches[0]

  if (!best) {
    return {
      date: null,
      confidence: 'unknown',
      note: 'Not found on YouTube yet — likely still upcoming',
      sourceUrl: null,
      released: false,
    }
  }

  const iso = toIsoDate(best.uploadDate)
  return {
    date: iso,
    confidence: iso ? 'confirmed' : 'unknown',
    note: `Found on YouTube: "${best.title}" — ${best.channel}`,
    sourceUrl: `https://www.youtube.com/watch?v=${best.id}`,
    released: true,
  }
}

async function verifyFilmOrShow(title: string, artist: string | undefined, type: string, currentDate: string): Promise<VerifyResult> {
  const label = artist ? `"${title}" by ${artist}` : `"${title}"`
  const typeLabel = type === 'show' ? 'TV show' : 'film'

  const prompt = `Search the web to find whether the ${typeLabel} ${label} has actually been released yet, and if so, its confirmed release date and an official/reputable source URL (official site, studio/distributor page, IMDB, or a major trade publication article).

Currently listed release date: ${currentDate}

Search for recent news to confirm or correct this. If you find a reliable, dated source, use it. If you cannot find confirmation either way, say so honestly rather than guessing.

After searching, respond with ONLY a JSON object (no other text) in this exact format:
{
  "date": "YYYY-MM-DD or null",
  "confidence": "confirmed" | "estimated" | "unknown",
  "note": "brief source or reason",
  "sourceUrl": "URL or null",
  "released": true or false
}`

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON in web-search response')
  return JSON.parse(match[0])
}

export async function POST(req: NextRequest) {
  const { title, artist, type, currentDate } = await req.json()

  try {
    const result =
      type === 'music_video'
        ? await verifyMusicVideo(title, artist)
        : await verifyFilmOrShow(title, artist, type, currentDate)
    return NextResponse.json(result)
  } catch (e) {
    console.error('verify-release failed:', String(e).slice(0, 300))
    return NextResponse.json(
      { date: null, confidence: 'unknown', note: 'Verification failed', sourceUrl: null, released: false },
      { status: 500 }
    )
  }
}
