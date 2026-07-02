import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { downloadClip, getVideoDuration, uploadToGeminiAndWait, analyzeVideoWithGemini, cleanupGeminiFile } from '@/lib/video-analysis'

export type SuggestedClip = {
  title: string
  startTime: string
  endTime: string
  focus: string
}

function tcToSecs(t: string): number {
  const [m, s] = t.split(':').map(Number)
  return (m || 0) * 60 + (s || 0)
}

async function suggestFromVideo(videoUrl: string, label: string, typeLabel: string, genre: string, description: string): Promise<SuggestedClip[]> {
  const sourceLabel = typeLabel === 'music video' ? 'video' : 'trailer'
  const tmpPath = path.join(os.tmpdir(), `suggest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp4`)
  let geminiFileUri: string | null = null
  try {
    const [downloaded, duration] = await Promise.all([
      downloadClip(videoUrl, null, null, tmpPath),
      getVideoDuration(videoUrl),
    ])
    if (!downloaded) throw new Error(`Could not download the ${sourceLabel} — check the URL is a valid, public YouTube link, or try again`)

    geminiFileUri = await uploadToGeminiAndWait(tmpPath)
    if (!geminiFileUri) throw new Error(`Could not upload the ${sourceLabel} for analysis — try again`)

    const durationNote = duration
      ? `Total video duration: ${Math.floor(duration / 60)}:${String(Math.round(duration % 60)).padStart(2, '0')} (${Math.round(duration)} seconds). Every timestamp must be less than this.`
      : ''
    const prompt = `You are a cinematography analyst helping an admin choose clip moments to break down from a ${typeLabel}.

${typeLabel === 'music video' ? 'Music Video' : 'Production'}: ${label}
Genre: ${genre}
Description: ${description}
${durationNote}

You are watching the actual video. Identify 30 specific moments from what you are actually seeing that would yield rich cinematography analysis — grounded in the real content, describing what actually happens at each timestamp. For each moment:
- Timestamps MUST fall within the video's actual duration and match what really happens at that point in the footage.
- Default clip duration is ~5 seconds (e.g. "1:14" to "1:19")
- Make the clip longer when:
  • The moment is a long take with no cuts — capture the full take
  • A sequence of shots all use the same visual language or technique — include the whole sequence
  • Complex choreography, rig move, or VFX build that needs full context to analyze
  • An establishing or transitional shot that has meaningful duration
- Focus areas: camera work, lighting setups, color grading, VFX layers, editing rhythm, production design, movement rigs, performance + framing, directorial choices

Return ONLY a JSON array of exactly 30 objects, no other text:
[
  { "title": "short descriptive name for this moment", "startTime": "0:00", "endTime": "0:05", "focus": "what specifically happens here and why it's cinematographically interesting" }
]`

    const rawText = await analyzeVideoWithGemini(geminiFileUri, prompt, 8192)
    if (!rawText) throw new Error('The AI did not return a response — try again')

    const stripped = rawText.replace(/```(?:json)?\n?/g, '').trim()
    const match = stripped.match(/\[[\s\S]*\]/)
    if (!match) throw new Error('The AI response was malformed — try again')
    const clips: SuggestedClip[] = JSON.parse(match[0])

    // Safety net: drop anything that still ended up out of bounds despite instructions.
    return duration ? clips.filter(c => tcToSecs(c.startTime) < duration && tcToSecs(c.endTime) <= duration + 1) : clips
  } finally {
    fs.unlink(tmpPath, () => {})
    if (geminiFileUri) cleanupGeminiFile(geminiFileUri)
  }
}

export async function POST(req: NextRequest) {
  const { title, artist, type, genre, description, videoUrl } = await req.json()
  const sourceLabel = type === 'music_video' ? 'video' : 'trailer'

  if (!videoUrl) {
    return NextResponse.json({ clips: [], error: `No ${sourceLabel} URL for this release yet` }, { status: 400 })
  }

  const label = artist ? `"${title}" by ${artist}` : `"${title}"`
  const typeLabel = type === 'music_video' ? 'music video' : type === 'show' ? 'TV series' : 'film'

  try {
    const clips = await suggestFromVideo(videoUrl, label, typeLabel, genre, description)
    return NextResponse.json({ clips })
  } catch (e) {
    console.error('suggest-clips failed:', String(e).slice(0, 300))
    const message = e instanceof Error ? e.message : `Could not analyze the ${sourceLabel} — try again`
    return NextResponse.json({ clips: [], error: message }, { status: 500 })
  }
}
