'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import NavBar from '@/app/_components/NavBar'

type Shot = {
  id: string
  title: string
  platform: string
  status: string
  thumbnail_url: string | null
  source_url: string | null
  created_at: string
  featured: boolean
  likes: number
}

type Tab = 'featured' | 'trending' | 'new'

export default function FeaturedPage() {
  const [tab, setTab] = useState<Tab>('featured')
  const [shots, setShots] = useState<Shot[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      let query = supabase.from('shots').select('*').eq('status', 'analyzed')

      if (tab === 'featured') query = query.eq('featured', true).order('created_at', { ascending: false })
      else if (tab === 'trending') query = query.order('likes', { ascending: false }).limit(24)
      else query = query.order('created_at', { ascending: false }).limit(24)

      const { data } = await query
      setShots(data ?? [])
      setLoading(false)
    }
    load()
  }, [tab])

  const hero = shots[0] ?? null
  const rest = shots.slice(1)

  const TabButton = ({ t, label }: { t: Tab; label: string }) => (
    <button
      onClick={() => setTab(t)}
      className={`text-sm px-5 py-2 rounded-full transition ${
        tab === t ? 'bg-white text-black font-medium' : 'text-white/50 hover:text-white'
      }`}
    >
      {label}
    </button>
  )

  return (
    <main className="min-h-screen bg-black text-white">
      <NavBar cta={{ href: '/submit', label: 'Analyze a Shot' }} />

      <div className="max-w-6xl mx-auto px-6 py-12">

        {/* Header + tabs */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10">
          <div>
            <h1 className="text-3xl font-bold mb-1">Featured</h1>
            <p className="text-white/40 text-sm">Notable shots, trending breakdowns, and what's new.</p>
          </div>
          <div className="flex gap-1 bg-white/5 rounded-full p-1">
            <TabButton t="featured" label="Featured" />
            <TabButton t="trending" label="Trending" />
            <TabButton t="new" label="New" />
          </div>
        </div>

        {loading ? (
          <div className="text-center py-32 text-white/20">Loading...</div>
        ) : shots.length === 0 ? (
          <div className="text-center py-32 text-white/30">
            {tab === 'featured' ? (
              <>
                <p className="text-xl font-medium mb-3">Nothing featured yet</p>
                <p className="text-sm text-white/20 max-w-sm mx-auto">
                  Mark shots as featured in your Supabase dashboard by setting <code className="bg-white/5 px-1.5 py-0.5 rounded text-xs">featured = true</code> on any shot.
                </p>
              </>
            ) : (
              <>
                <p className="text-xl font-medium mb-3">Nothing here yet</p>
                <p className="text-sm text-white/20 mb-6">Analyses will appear here as the library grows.</p>
                <Link href="/submit" className="text-sm border border-white/20 px-5 py-2.5 rounded-full hover:border-white/40 transition text-white/50">
                  Analyze a Shot
                </Link>
              </>
            )}
          </div>
        ) : (
          <>
            {/* Hero */}
            {hero && (
              <Link href={`/shot/${hero.id}`} className="block mb-8 group">
                <div className="relative rounded-2xl overflow-hidden aspect-video bg-white/5">
                  {hero.thumbnail_url ? (
                    <img src={hero.thumbnail_url} alt={hero.title} className="w-full h-full object-cover group-hover:scale-[1.02] transition duration-500" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="text-white/10">No preview</span>
                    </div>
                  )}
                  {/* Gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-8">
                    <div className="flex gap-2 mb-2">
                      {hero.platform && (
                        <span className="text-xs px-2 py-1 rounded-full bg-white/10 text-white/60 capitalize backdrop-blur-sm">
                          {hero.platform}
                        </span>
                      )}
                      {tab === 'featured' && (
                        <span className="text-xs px-2 py-1 rounded-full bg-white/10 text-white/60 backdrop-blur-sm">
                          ★ Featured
                        </span>
                      )}
                    </div>
                    <h2 className="text-2xl font-bold mb-1 group-hover:text-white/80 transition">{hero.title}</h2>
                    <p className="text-sm text-white/40">View breakdown →</p>
                  </div>
                </div>
              </Link>
            )}

            {/* Grid */}
            {rest.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {rest.map(shot => (
                  <Link key={shot.id} href={`/shot/${shot.id}`}>
                    <div className="group border border-white/10 rounded-2xl overflow-hidden hover:border-white/30 transition cursor-pointer">
                      <div className="aspect-video bg-white/5 flex items-center justify-center">
                        {shot.thumbnail_url ? (
                          <img src={shot.thumbnail_url} alt={shot.title} className="w-full h-full object-cover group-hover:scale-[1.02] transition duration-300" />
                        ) : (
                          <span className="text-white/10 text-sm">No preview</span>
                        )}
                      </div>
                      <div className="p-4">
                        <h3 className="font-medium mb-1.5 group-hover:text-white/80 transition truncate">{shot.title}</h3>
                        <div className="flex gap-2 flex-wrap">
                          {shot.platform && (
                            <span className="text-xs px-2 py-1 rounded-full bg-white/5 text-white/40 capitalize">{shot.platform}</span>
                          )}
                          {shot.likes > 0 && (
                            <span className="text-xs px-2 py-1 rounded-full bg-white/5 text-white/40">{shot.likes} likes</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
