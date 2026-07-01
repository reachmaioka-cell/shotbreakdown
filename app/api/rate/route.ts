import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type PreferenceEntry = { camera?: string; lighting?: string; movement?: string; ai_tool?: string; rating: number }
type PreferenceProfile = {
  ratings: (PreferenceEntry & { shot_id: string })[]
  computed: {
    top_cameras: string[]
    top_lighting: string[]
    top_movements: string[]
    top_ai_tools: string[]
    avg_rating: number
  }
}

function topN(entries: PreferenceEntry[], key: keyof PreferenceEntry, n = 3): string[] {
  const counts: Record<string, { total: number; count: number }> = {}
  for (const e of entries) {
    const v = e[key]
    if (!v || typeof v !== 'string') continue
    if (!counts[v]) counts[v] = { total: 0, count: 0 }
    counts[v].total += e.rating
    counts[v].count++
  }
  return Object.entries(counts)
    .sort((a, b) => b[1].total / b[1].count - a[1].total / a[1].count)
    .slice(0, n)
    .map(([k]) => k)
}

export async function POST(req: NextRequest) {
  try {
    const { shotId, rating, userId } = await req.json()
    if (!shotId || !rating || rating < 1 || rating > 10) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
    }

    await supabase.from('breakdowns').update({ user_rating: rating }).eq('shot_id', shotId)

    if (!userId) return NextResponse.json({ success: true })

    const { data: bd } = await supabase
      .from('breakdowns')
      .select('camera_specs, lighting, camera_movement, ai_tools')
      .eq('shot_id', shotId)
      .single()

    const cam = (bd?.camera_specs as Record<string, string> | null)?.camera ?? ''
    const light = (bd?.lighting as Record<string, string> | null)?.type ?? ''
    const move = (bd?.camera_movement as Record<string, string> | null)?.type ?? ''
    const ai = (bd?.ai_tools as Record<string, string> | null)?.platform ?? ''

    const { data: profile } = await supabase
      .from('profiles')
      .select('preference_profile')
      .eq('id', userId)
      .single()

    const existing: PreferenceProfile = (profile?.preference_profile as PreferenceProfile) ?? {
      ratings: [],
      computed: { top_cameras: [], top_lighting: [], top_movements: [], top_ai_tools: [], avg_rating: 0 },
    }

    const filtered = existing.ratings.filter(r => r.shot_id !== shotId)
    const entry = { shot_id: shotId, rating, camera: cam, lighting: light, movement: move, ai_tool: ai }
    const allRatings = [...filtered, entry]

    const updated: PreferenceProfile = {
      ratings: allRatings.slice(-200),
      computed: {
        top_cameras: topN(allRatings, 'camera'),
        top_lighting: topN(allRatings, 'lighting'),
        top_movements: topN(allRatings, 'movement'),
        top_ai_tools: topN(allRatings, 'ai_tool'),
        avg_rating: Math.round((allRatings.reduce((s, r) => s + r.rating, 0) / allRatings.length) * 10) / 10,
      },
    }

    await supabase.from('profiles').update({ preference_profile: updated }).eq('id', userId)

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
