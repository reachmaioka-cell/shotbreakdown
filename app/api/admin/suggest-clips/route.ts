import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

export type SuggestedClip = {
  title: string
  startTime: string
  endTime: string
  focus: string
}

export async function POST(req: NextRequest) {
  const { title, artist, type, genre, description } = await req.json()

  const label = artist ? `"${title}" by ${artist}` : `"${title}"`
  const typeLabel = type === 'music_video' ? 'music video' : type === 'show' ? 'TV series' : 'film'

  const prompt = `You are a cinematography analyst helping an admin choose clip moments to break down from a ${typeLabel}.

${typeLabel === 'music video' ? 'Music Video' : 'Production'}: ${label}
Genre: ${genre}
Description: ${description}

Identify 30 specific moments that would yield rich cinematography analysis. For each moment:
- Default clip duration is ~5 seconds (e.g. "1:14" to "1:19")
- Make the clip longer when:
  • The moment is a long take with no cuts — capture the full take
  • A sequence of shots all use the same visual language or technique — include the whole sequence
  • Complex choreography, rig move, or VFX build that needs full context to analyze
  • An establishing or transitional shot that has meaningful duration
- Focus areas: camera work, lighting setups, color grading, VFX layers, editing rhythm, production design, movement rigs, performance + framing, directorial choices

Use your specific knowledge of this ${typeLabel} if you know it. If you don't, base timestamps and focus areas on the genre and description — make educated, confident suggestions.

Return ONLY a JSON array of exactly 30 objects, no other text:
[
  { "title": "short descriptive name for this moment", "startTime": "0:00", "endTime": "0:05", "focus": "what specifically to analyze and why it's cinematographically interesting" }
]`

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '[]'
    const match = text.match(/\[[\s\S]*\]/)
    const clips: SuggestedClip[] = match ? JSON.parse(match[0]) : []
    return NextResponse.json({ clips })
  } catch {
    return NextResponse.json({ clips: [] }, { status: 500 })
  }
}
