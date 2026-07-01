'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import NavBar from '@/app/_components/NavBar'

type Collection = {
  id: string
  title: string
  cover_url: string | null
  type: string | null
  description: string | null
}

type Shot = {
  id: string
  title: string
  thumbnail_url: string | null
  platform: string
  start_time: string | null
  end_time: string | null
  breakdowns: { camera_specs: Record<string, string> | null; lighting: Record<string, string> | null; camera_movement: Record<string, string> | null }[]
}

const TYPE_LABEL: Record<string, string> = {
  film: 'Film', show: 'TV Show', music_video: 'Music Video', other: 'Other',
}

export default function CollectionPage() {
  const { id } = useParams() as { id: string }
  const router = useRouter()
  const [collection, setCollection] = useState<Collection | null>(null)
  const [shots, setShots] = useState<Shot[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    const load = async () => {
      const [{ data: col }, { data: s }] = await Promise.all([
        supabase.from('collections').select('*').eq('id', id).single(),
        supabase.from('shots')
          .select('id, title, thumbnail_url, platform, start_time, end_time, breakdowns(camera_specs, lighting, camera_movement)')
          .eq('collection_id', id)
          .eq('status', 'analyzed')
          .order('created_at', { ascending: true }),
      ])
      if (!col) { setNotFound(true); setLoading(false); return }
      setCollection(col)
      setShots((s ?? []) as Shot[])
      setLoading(false)
    }
    load()
  }, [id])

  if (notFound) return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center">
      <p className="text-white/30">Collection not found.</p>
    </main>
  )

  return (
    <main className="min-h-screen bg-black text-white">
      <NavBar />

      <div className="max-w-6xl mx-auto px-6 py-12">
        <button onClick={() => router.back()} className="text-sm text-white/40 hover:text-white transition mb-8 flex items-center gap-1">
          ← Featured
        </button>

        {loading ? (
          <div className="text-center py-32 text-white/20">Loading...</div>
        ) : collection && (
          <>
            {/* Header */}
            <div className="flex gap-8 mb-12 items-start">
              {collection.cover_url && (
                <div className="w-32 shrink-0 aspect-[2/3] rounded-xl overflow-hidden bg-white/5">
                  <img src={collection.cover_url} alt={collection.title} className="w-full h-full object-cover" />
                </div>
              )}
              <div className="pt-2">
                {collection.type && (
                  <p className="text-xs text-white/30 uppercase tracking-widest mb-2">{TYPE_LABEL[collection.type] ?? collection.type}</p>
                )}
                <h1 className="text-4xl font-bold mb-3">{collection.title}</h1>
                {collection.description && (
                  <p className="text-white/50 text-sm leading-relaxed max-w-lg">{collection.description}</p>
                )}
                <p className="text-xs text-white/25 mt-4">{shots.length} shot breakdown{shots.length !== 1 ? 's' : ''}</p>
              </div>
            </div>

            {/* Shots grid */}
            {shots.length === 0 ? (
              <div className="text-center py-24 text-white/20">
                <p>No breakdowns added to this collection yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {shots.map(shot => {
                  const bd = shot.breakdowns?.[0]
                  const camera = bd?.camera_specs?.camera ?? ''
                  const lighting = bd?.lighting?.type ?? ''
                  const movement = bd?.camera_movement?.type ?? ''
                  return (
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
                          <h3 className="font-medium mb-2 truncate group-hover:text-white/80 transition">{shot.title}</h3>
                          <div className="flex flex-wrap gap-1">
                            {camera && <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/40">{camera}</span>}
                            {lighting && <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/40 capitalize">{lighting}</span>}
                            {movement && <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/40 capitalize">{movement}</span>}
                            {shot.start_time && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/30">{shot.start_time}{shot.end_time ? ` – ${shot.end_time}` : ''}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
