'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

const ADMIN_EMAIL = 'reachmaioka@gmail.com'

type Breakdown = {
  shot_id: string
  camera_specs: Record<string, string> | null
  ai_tools: Record<string, string> | null
  lighting: Record<string, string> | null
  camera_movement: Record<string, string> | null
  vfx: string[] | null
  tags: string[] | null
  recreation_steps: unknown[] | null
  color_grade: Record<string, string> | null
  production_design: Record<string, string> | null
  editing: Record<string, string> | null
  user_rating: number | null
}

type Shot = {
  id: string
  title: string
  platform: string
  status: string
  thumbnail_url: string | null
  source_url: string | null
  created_at: string
  is_curated: boolean
  user_id: string | null
}

function computeQualityScore(bd: Breakdown | null): number {
  if (!bd) return 0
  let score = 0
  const cam = bd.camera_specs
  if (cam?.camera) score += 1.5
  if (cam?.lens) score += 1
  if (cam?.aperture) score += 0.5
  if (cam?.frame_rate) score += 0.3
  const light = bd.lighting
  if (light?.type) score += 0.8
  if (light?.key_light) score += 0.8
  if (light?.notes) score += 0.4
  const move = bd.camera_movement
  if (move?.type) score += 0.5
  if (move?.notes) score += 0.4
  score += Math.min((bd.recreation_steps?.length ?? 0) * 0.2, 1.5)
  score += Math.min((bd.vfx?.length ?? 0) * 0.2, 0.6)
  if (bd.color_grade) score += 0.5
  if (bd.production_design) score += 0.3
  if (bd.editing) score += 0.3
  return Math.min(Math.round(score * 10) / 10, 10)
}

function computeCurationScore(quality: number, userRating: number | null): number {
  if (userRating !== null) {
    return Math.round((quality * 0.6 + userRating * 0.4) * 10) / 10
  }
  return quality
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 8 ? 'text-green-400 bg-green-500/10 border-green-500/20'
    : score >= 6 ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
    : score >= 4 ? 'text-white/50 bg-white/5 border-white/10'
    : 'text-white/25 bg-white/3 border-white/5'
  return (
    <span className={`text-xs px-2 py-1 rounded-full border font-medium tabular-nums ${color}`}>
      {score.toFixed(1)}
    </span>
  )
}

export default function SubmissionsPage() {
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [shots, setShots] = useState<Shot[]>([])
  const [breakdowns, setBreakdowns] = useState<Record<string, Breakdown>>({})
  const [loading, setLoading] = useState(true)
  const [promoting, setPromoting] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'score' | 'newest' | 'rating'>('score')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setAuthLoading(false)
    })
    loadAll()
  }, [])

  const loadAll = async () => {
    setLoading(true)
    const [{ data: s }, { data: b }] = await Promise.all([
      supabase.from('shots').select('*').eq('status', 'analyzed').order('created_at', { ascending: false }),
      supabase.from('breakdowns').select('*'),
    ])
    if (s) setShots(s as Shot[])
    if (b) {
      const map: Record<string, Breakdown> = {}
      for (const row of b as Breakdown[]) map[row.shot_id] = row
      setBreakdowns(map)
    }
    setLoading(false)
  }

  const promoteShot = async (shotId: string) => {
    setPromoting(shotId)
    await supabase.from('shots').update({ is_curated: true }).eq('id', shotId)
    setShots(prev => prev.map(s => s.id === shotId ? { ...s, is_curated: true } : s))
    setPromoting(null)
    setConfirmingId(null)
  }

  const demoteShot = async (shotId: string) => {
    await supabase.from('shots').update({ is_curated: false }).eq('id', shotId)
    setShots(prev => prev.map(s => s.id === shotId ? { ...s, is_curated: false } : s))
  }

  if (authLoading) return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <p className="text-white/30">Loading...</p>
    </div>
  )

  if (!user || user.email !== ADMIN_EMAIL) return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <p className="text-white/30">Access denied.</p>
    </div>
  )

  const scoredShots = shots.map(shot => {
    const bd = breakdowns[shot.id] ?? null
    const quality = computeQualityScore(bd)
    const userRating = bd?.user_rating ?? null
    const score = computeCurationScore(quality, userRating)
    return { shot, quality, userRating, score }
  })

  const sorted = [...scoredShots].sort((a, b) => {
    if (sortBy === 'score') return b.score - a.score
    if (sortBy === 'rating') return (b.userRating ?? 0) - (a.userRating ?? 0)
    return new Date(b.shot.created_at).getTime() - new Date(a.shot.created_at).getTime()
  })

  const curated = sorted.filter(x => x.shot.is_curated)
  const pending = sorted.filter(x => !x.shot.is_curated)

  return (
    <main className="min-h-screen bg-black text-white">
      <nav className="border-b border-white/10 px-6 py-4 flex items-center gap-4">
        <Link href="/admin" className="text-sm text-white/40 hover:text-white transition">← Admin</Link>
        <span className="text-white/15">|</span>
        <span className="text-sm font-medium">User Submissions</span>
        <span className="text-xs text-white/20 bg-white/5 px-2 py-0.5 rounded-full ml-auto">{shots.length} total</span>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-10 space-y-12">

        {/* Score key */}
        <div className="border border-white/5 rounded-xl px-5 py-4 bg-white/[0.02]">
          <p className="text-xs text-white/30 mb-3 uppercase tracking-widest">Curation Score</p>
          <div className="flex flex-wrap gap-4 text-xs text-white/40">
            <span>60% analysis quality (completeness + depth)</span>
            <span>·</span>
            <span>40% user rating (if provided)</span>
            <span>·</span>
            <span className="text-green-400/60">≥ 8.0 = strong candidate</span>
          </div>
        </div>

        {/* Sort + controls */}
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {(['score', 'newest', 'rating'] as const).map(opt => (
              <button
                key={opt}
                onClick={() => setSortBy(opt)}
                className={`text-xs px-3 py-1.5 rounded-full border transition capitalize ${
                  sortBy === opt ? 'border-white text-white' : 'border-white/10 text-white/30 hover:border-white/30'
                }`}
              >
                {opt === 'score' ? 'By score' : opt === 'rating' ? 'By rating' : 'Newest'}
              </button>
            ))}
          </div>
          <button onClick={loadAll} className="text-xs text-white/30 hover:text-white transition">Refresh</button>
        </div>

        {loading ? (
          <p className="text-white/20 text-sm">Loading submissions...</p>
        ) : (
          <>
            {/* Already in public library */}
            {curated.length > 0 && (
              <section>
                <h2 className="text-sm font-medium mb-4 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-400 inline-block"></span>
                  In Public Library
                  <span className="text-xs text-white/20 font-normal ml-1">({curated.length})</span>
                </h2>
                <div className="space-y-1">
                  {curated.map(({ shot, quality, userRating, score }) => (
                    <SubmissionRow
                      key={shot.id}
                      shot={shot}
                      quality={quality}
                      userRating={userRating}
                      score={score}
                      isCurated
                      confirmingId={confirmingId}
                      promoting={promoting}
                      onDemote={() => demoteShot(shot.id)}
                      onStartPromote={() => {}}
                      onConfirmPromote={() => {}}
                      onCancelPromote={() => {}}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Pending submissions */}
            <section>
              <h2 className="text-sm font-medium mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-white/20 inline-block"></span>
                Pending Review
                <span className="text-xs text-white/20 font-normal ml-1">({pending.length})</span>
              </h2>
              {pending.length === 0 ? (
                <p className="text-sm text-white/20">All submissions are in the public library.</p>
              ) : (
                <div className="space-y-1">
                  {pending.map(({ shot, quality, userRating, score }) => (
                    <SubmissionRow
                      key={shot.id}
                      shot={shot}
                      quality={quality}
                      userRating={userRating}
                      score={score}
                      isCurated={false}
                      confirmingId={confirmingId}
                      promoting={promoting}
                      onDemote={() => {}}
                      onStartPromote={() => setConfirmingId(shot.id)}
                      onConfirmPromote={() => promoteShot(shot.id)}
                      onCancelPromote={() => setConfirmingId(null)}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  )
}

function SubmissionRow({
  shot, quality, userRating, score, isCurated,
  confirmingId, promoting,
  onDemote, onStartPromote, onConfirmPromote, onCancelPromote,
}: {
  shot: Shot
  quality: number
  userRating: number | null
  score: number
  isCurated: boolean
  confirmingId: string | null
  promoting: string | null
  onDemote: () => void
  onStartPromote: () => void
  onConfirmPromote: () => void
  onCancelPromote: () => void
}) {
  const isConfirming = confirmingId === shot.id
  const isPromoting = promoting === shot.id

  return (
    <div className="flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-white/[0.02] transition group">
      {shot.thumbnail_url ? (
        <img src={shot.thumbnail_url} alt={shot.title} className="w-16 h-10 object-cover rounded-lg shrink-0" />
      ) : (
        <div className="w-16 h-10 bg-white/5 rounded-lg shrink-0" />
      )}

      <Link href={`/shot/${shot.id}`} className="flex-1 min-w-0">
        <p className="text-sm truncate group-hover:text-white/80 transition">{shot.title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <p className="text-xs text-white/25 capitalize">{shot.platform}</p>
          {userRating !== null && (
            <p className="text-xs text-white/25">User rated: {userRating}/10</p>
          )}
        </div>
      </Link>

      <div className="flex items-center gap-2 shrink-0">
        <div className="text-right">
          <p className="text-xs text-white/20 mb-1">quality</p>
          <ScoreBadge score={quality} />
        </div>
        <div className="text-right">
          <p className="text-xs text-white/20 mb-1">score</p>
          <ScoreBadge score={score} />
        </div>
      </div>

      <div className="shrink-0 w-40 flex justify-end">
        {isCurated ? (
          <button
            onClick={onDemote}
            className="text-xs text-white/25 hover:text-red-400 transition px-3 py-1.5 rounded-full border border-white/10 hover:border-red-500/30"
          >
            Remove from Library
          </button>
        ) : isConfirming ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-amber-400/70">Confirm?</span>
            <button
              onClick={onConfirmPromote}
              disabled={isPromoting}
              className="text-xs bg-white text-black px-3 py-1.5 rounded-full font-medium hover:bg-white/90 transition disabled:opacity-40"
            >
              {isPromoting ? '...' : 'Yes, add'}
            </button>
            <button onClick={onCancelPromote} className="text-xs text-white/30 hover:text-white transition">
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={onStartPromote}
            className="text-xs text-white/40 hover:text-white transition px-3 py-1.5 rounded-full border border-white/10 hover:border-white/30"
          >
            Add to Library
          </button>
        )}
      </div>
    </div>
  )
}
