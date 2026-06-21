import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function fetchYouTubeMeta(url: string) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`)
    if (!res.ok) return null
    const data = await res.json()
    return { title: data.title, author: data.author_name, thumbnail: data.thumbnail_url }
  } catch { return null }
}

async function fetchImageAsBase64(url: string): Promise<{ data: string; mediaType: string } | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buffer = await res.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const mediaType = res.headers.get('content-type') || 'image/jpeg'
    return { data: base64, mediaType }
  } catch { return null }
}

export async function POST(req: NextRequest) {
  const { shotId } = await req.json()

  const { data: shot } = await supabase
    .from('shots')
    .select('*')
    .eq('id', shotId)
    .single()

  if (!shot) return NextResponse.json({ error: 'Shot not found' }, { status: 404 })

  const timeRange = shot.start_time && shot.end_time
    ? `The shot occurs between ${shot.start_time} and ${shot.end_time}.`
    : ''

  const jsonSchema = `{
  "ai_tools": {
    "platform": "Higgsfield / Runway / Kling / Pika / Sora / Real Camera / Unknown",
    "model": "specific model name or null",
    "prompt": "example prompt to recreate this look",
    "steps": ["step 1", "step 2", "step 3"]
  },
  "camera_specs": {
    "camera": "e.g. Sony FX3 / RED Komodo / AI Simulated",
    "lens": "focal length and lens type",
    "aperture": "f/stop",
    "shutter": "shutter speed",
    "iso": "ISO",
    "frame_rate": "fps"
  },
  "lighting": {
    "type": "natural / artificial / mixed",
    "key_light": "description",
    "fill": "description",
    "notes": "additional notes"
  },
  "camera_movement": {
    "type": "dolly / pan / tilt / handheld / static / orbit / zoom",
    "speed": "slow / medium / fast",
    "notes": "movement description"
  },
  "vfx": ["element 1", "element 2"],
  "recreation_steps": [
    { "step": 1, "title": "Step title", "description": "How to recreate this" }
  ],
  "tags": ["tag1", "tag2", "tag3"]
}`

  const textPrompt = `You are an expert cinematographer and AI video specialist. Analyze this shot and return ONLY a JSON object with no extra text.

${timeRange}

Return this exact JSON structure:
${jsonSchema}`

  let messageContent: Anthropic.MessageParam['content']

  // Try to get a visual — use thumbnail if YouTube, otherwise text only
  if (shot.platform === 'youtube' && shot.source_url) {
    const meta = await fetchYouTubeMeta(shot.source_url)
    if (meta?.thumbnail) {
      await supabase.from('shots').update({ thumbnail_url: meta.thumbnail, title: meta.title }).eq('id', shotId)
      const image = await fetchImageAsBase64(meta.thumbnail)
      if (image) {
        messageContent = [
          {
            type: 'image',
            source: { type: 'base64', media_type: image.mediaType as 'image/jpeg', data: image.data },
          },
          { type: 'text', text: `Video: "${meta.title}" by ${meta.author}\n\n${textPrompt}` },
        ]
      }
    }
  }

  if (!messageContent) {
    messageContent = [{ type: 'text', text: textPrompt }]
  }

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [{ role: 'user', content: messageContent }],
  })

  const content = message.content[0]
  if (content.type !== 'text') throw new Error('Unexpected response type')

  const stripped = content.text.replace(/```(?:json)?\n?/g, '').trim()
  const jsonMatch = stripped.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    console.error('No JSON:', stripped.slice(0, 300))
    throw new Error('No JSON found in response')
  }

  const breakdown = JSON.parse(jsonMatch[0])

  const { error: insertError } = await supabase.from('breakdowns').insert({
    shot_id: shotId,
    ai_tools: breakdown.ai_tools,
    camera_specs: breakdown.camera_specs,
    lighting: breakdown.lighting,
    vfx: breakdown.vfx,
    recreation_steps: breakdown.recreation_steps,
    verified: false,
  })

  if (insertError) console.error('BREAKDOWN INSERT ERROR:', JSON.stringify(insertError))

  const { error: updateError } = await supabase.from('shots').update({ status: 'analyzed' }).eq('id', shotId)
  if (updateError) console.error('SHOT UPDATE ERROR:', JSON.stringify(updateError))

  return NextResponse.json({ success: true, breakdown })
}
