'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type Shot = {
  id: string
  title: string
  platform: string
  thumbnail_url: string | null
}

type PlatformFilter = 'all' | 'youtube' | 'tiktok' | 'instagram' | 'upload'

const FILTERS: { key: PlatformFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'upload', label: 'Uploaded' },
]

export default function LandingGallery() {
  const [shots, setShots] = useState<Shot[]>([])
  const [filter, setFilter] = useState<PlatformFilter>('all')

  useEffect(() => {
    supabase
      .from('shots')
      .select('id, title, platform, thumbnail_url')
      .eq('status', 'analyzed')
      .order('created_at', { ascending: false })
      .limit(12)
      .then(({ data }) => { if (data) setShots(data) })
  }, [])

  const visible = filter === 'all' ? shots : shots.filter(s => s.platform === filter)

  if (shots.length === 0) return null

  return (
    <section className="max-w-5xl mx-auto px-6 pb-24">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold">Recent Breakdowns</h2>
        <Link href="/research" className="text-sm text-white/40 hover:text-white transition">
          Browse all →
        </Link>
      </div>

      {/* Platform filter pills */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`text-xs px-3 py-1.5 rounded-full border transition ${
              filter === f.key
                ? 'bg-white text-black border-white font-medium'
                : 'border-white/10 text-white/50 hover:border-white/30 hover:text-white'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-white/20 py-8 text-center">No {filter} shots yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {visible.slice(0, 8).map(shot => (
            <Link key={shot.id} href={`/shot/${shot.id}`}>
              <div className="group rounded-xl overflow-hidden border border-white/10 hover:border-white/30 transition cursor-pointer">
                <div className="aspect-video bg-white/5 flex items-center justify-center">
                  {shot.thumbnail_url ? (
                    <img src={shot.thumbnail_url} alt={shot.title} className="w-full h-full object-cover group-hover:scale-[1.03] transition duration-300" />
                  ) : (
                    <span className="text-white/10 text-xs">No preview</span>
                  )}
                </div>
                <div className="p-2.5">
                  <p className="text-xs font-medium truncate group-hover:text-white/70 transition">{shot.title}</p>
                  <p className="text-xs text-white/30 capitalize mt-0.5">{shot.platform}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
