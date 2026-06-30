import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const SCHEMA = `{
  "ai_tools": { "platform": "...", "model": "...", "prompt": "...", "steps": ["..."] },
  "camera_specs": { "camera": "...", "lens": "...", "aperture": "...", "shutter": "...", "iso": "...", "frame_rate": "..." },
  "lighting": { "type": "...", "key_light": "...", "fill": "...", "notes": "..." },
  "vfx": ["..."],
  "recreation_steps": [{ "step": 1, "title": "...", "description": "..." }]
}`

export async function POST(req: NextRequest) {
  const { shotId, instruction } = await req.json()
  if (!shotId || !instruction) return NextResponse.json({ error: 'Missing shotId or instruction' }, { status: 400 })

  const { data: breakdown } = await supabase
    .from('breakdowns')
    .select('ai_tools, camera_specs, lighting, vfx, recreation_steps')
    .eq('shot_id', shotId)
    .single()

  if (!breakdown) return NextResponse.json({ error: 'Breakdown not found' }, { status: 404 })

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: `You are helping a filmmaker curator correct and improve shot breakdowns.
Apply the curator's instruction to update the breakdown. Preserve all fields not mentioned.
Return ONLY valid JSON matching this schema — no extra text:
${SCHEMA}`,
    messages: [{
      role: 'user',
      content: `Current breakdown:\n${JSON.stringify(breakdown, null, 2)}\n\nCurator instruction: ${instruction}`,
    }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : ''
  const match = text.replace(/```(?:json)?\n?/g, '').trim().match(/\{[\s\S]*\}/)

  if (!match) return NextResponse.json({ error: 'No JSON in response', raw: text.slice(0, 200) }, { status: 500 })

  let updated
  try { updated = JSON.parse(match[0]) }
  catch { return NextResponse.json({ error: 'Invalid JSON from AI' }, { status: 500 }) }

  const merged = {
    ai_tools: updated.ai_tools ?? breakdown.ai_tools,
    camera_specs: updated.camera_specs ?? breakdown.camera_specs,
    lighting: updated.lighting ?? breakdown.lighting,
    vfx: updated.vfx ?? breakdown.vfx,
    recreation_steps: updated.recreation_steps ?? breakdown.recreation_steps,
  }

  const { error } = await supabase
    .from('breakdowns')
    .update(merged)
    .eq('shot_id', shotId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ breakdown: merged })
}
