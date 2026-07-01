'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import NavBar from '@/app/_components/NavBar'

type Collection = {
  id: string
  title: string
  cover_url: string | null
  type: string | null
  description: string | null
  created_at: string
}

const TYPE_LABEL: Record<string, string> = {
  film: 'Film',
  show: 'TV Show',
  music_video: 'Music Video',
  other: 'Other',
}

export default function FeaturedPage() {
  const [collections, setCollections] = useState<Collection[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('collections')
      .select('*')
      .eq('is_featured', true)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => {
        setCollections(data ?? [])
        setLoading(false)
      })
  }, [])

  return (
    <main className="min-h-screen bg-black text-white">
      <NavBar />

      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="mb-10">
          <h1 className="text-3xl font-bold mb-2">Featured</h1>
          <p className="text-white/40 text-sm">Curated breakdowns from films, shows, and music videos.</p>
        </div>

        {loading ? (
          <div className="text-center py-32 text-white/20">Loading...</div>
        ) : collections.length === 0 ? (
          <div className="text-center py-32 text-white/30">
            <p className="text-xl font-medium mb-3">Nothing featured yet</p>
            <p className="text-sm text-white/20 max-w-sm mx-auto">Collections will appear here once featured by the admin.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
            {collections.map(col => (
              <Link key={col.id} href={`/featured/${col.id}`}>
                <div className="group cursor-pointer">
                  <div className="aspect-[2/3] rounded-xl overflow-hidden bg-white/5 mb-3 relative">
                    {col.cover_url ? (
                      <img
                        src={col.cover_url}
                        alt={col.title}
                        className="w-full h-full object-cover group-hover:scale-[1.03] transition duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="text-white/10 text-3xl">◻</span>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition duration-300" />
                    <div className="absolute bottom-0 left-0 right-0 p-3 translate-y-1 group-hover:translate-y-0 opacity-0 group-hover:opacity-100 transition duration-300">
                      <p className="text-xs text-white/70">View breakdowns →</p>
                    </div>
                  </div>
                  <p className="font-medium text-sm leading-snug group-hover:text-white/70 transition truncate">{col.title}</p>
                  {col.type && (
                    <p className="text-xs text-white/30 mt-0.5">{TYPE_LABEL[col.type] ?? col.type}</p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
